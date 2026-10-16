/** @jest-environment node */
// v1.1 (REVIEW_V1 S2, probes P3 and P4): a Compare card's product link must never point at another product — not after
// the linked product is deleted and SQLite gives its id to a new one, and not after a restore.
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { createProduct, deleteProduct, getProduct, updateProduct } from '@/db/products';
import { exportBackupText, restoreFromText } from '@/db/restore';

import { linkProduct, newDraft, parseDraft, revalidateLinks, serializeDraft, unlinkAll, type LinkTarget } from './compare-draft';
import { getDraft, revalidateDraftLinks, unlinkAllCards, updateDraft } from './compare-store';


async function setup() {
  const db = createTestDb();
  await migrate(db);
  const coffee = await createProduct(db, { name: 'Coffee', dimension: 'mass' });
  const butter = await createProduct(db, { name: 'Butter', dimension: 'mass' });
  if (!coffee.ok || !butter.ok) throw new Error('setup');
  return { db, coffee: (await getProduct(db, coffee.id))!, butter: (await getProduct(db, butter.id))! };
}

const target = (p: { id: number; uid: string; name: string; count_label: string | null }): LinkTarget => ({ id: p.id, uid: p.uid, name: p.name, count_label: p.count_label });

describe('revalidateLinks (pure)', () => {
  const linked = linkProduct(newDraft('g'), 'c1', { id: 2, uid: 'aaa', name: 'Butter', label: null });
  it('keeps a valid link (same object) and follows a rename', () => {
    expect(revalidateLinks(linked, new Map([[2, { id: 2, uid: 'aaa', name: 'Butter', count_label: null }]]))).toBe(linked);
    const renamed = revalidateLinks(linked, new Map([[2, { id: 2, uid: 'aaa', name: 'Salted butter', count_label: null }]]));
    expect(renamed.cards[0]).toMatchObject({ productId: 2, productUid: 'aaa', productName: 'Salted butter' });
  });
  it('drops a link whose id now holds another product, or no product', () => {
    expect(revalidateLinks(linked, new Map([[2, { id: 2, uid: 'bbb', name: 'Butter', count_label: null }]])).cards[0]).toMatchObject({ productId: null, productUid: null, productName: null });
    expect(revalidateLinks(linked, new Map([[2, null]])).cards[0].productId).toBeNull();
  });
  it('a v1.0 link (no uid) is checked by name once and adopts the uid', () => {
    const legacy = parseDraft(serializeDraft(linked).replace('"productUid":"aaa",', ''), 'g');
    expect(legacy.cards[0]).toMatchObject({ productId: 2, productUid: null });
    expect(revalidateLinks(legacy, new Map([[2, { id: 2, uid: 'ccc', name: 'butter ', count_label: null }]])).cards[0]).toMatchObject({ productId: 2, productUid: 'ccc' });
    expect(revalidateLinks(legacy, new Map([[2, { id: 2, uid: 'ccc', name: 'Cheese', count_label: null }]])).cards[0].productId).toBeNull();
  });
  it('unlinkAll drops every link', () => {
    expect(unlinkAll(linked).cards.every((c) => c.productId === null && c.productUid === null)).toBe(true);
  });
});

describe('on the database', () => {
  beforeEach(() => updateDraft(() => newDraft('g')));

  it('probe P3: delete the newest product, create Cheese (same id) -> the Butter card is unlinked', async () => {
    const { db, butter } = await setup();
    updateDraft((d) => linkProduct(d, 'c1', { id: butter.id, uid: butter.uid, name: butter.name, label: null }));
    await deleteProduct(db, butter.id);
    const cheese = await createProduct(db, { name: 'Cheese', dimension: 'mass' });
    expect(cheese.ok && cheese.id).toBe(butter.id); // SQLite reused the id
    await revalidateDraftLinks(db);
    expect(getDraft().cards[0]).toMatchObject({ productId: null, productUid: null, productName: null });
  });

  it('a renamed product stays linked with its new name; an untouched one stays as it is', async () => {
    const { db, coffee, butter } = await setup();
    updateDraft((d) => linkProduct(linkProduct(d, 'c1', { id: coffee.id, uid: coffee.uid, name: coffee.name, label: null }), 'c2', { id: butter.id, uid: butter.uid, name: butter.name, label: null }));
    await updateProduct(db, coffee.id, { name: 'Coffee beans', dimension: 'mass' });
    await revalidateDraftLinks(db);
    expect(getDraft().cards.map((c) => [c.productId, c.productName])).toEqual([[coffee.id, 'Coffee beans'], [butter.id, 'Butter']]);
  });

  it('probe P4: after a restore no card stays linked, and a stale saved link fails the uid check', async () => {
    const { db, coffee } = await setup();
    const file = await exportBackupText(db);
    if (!file.ok) throw new Error('export');
    updateDraft((d) => linkProduct(d, 'c1', { id: coffee.id, uid: coffee.uid, name: coffee.name, label: null }));
    const stale = getDraft();
    expect(await restoreFromText(db, file.text)).toMatchObject({ ok: true });
    unlinkAllCards(); // what the Data screen does after a restore
    expect(getDraft().cards[0].productId).toBeNull();
    // A draft saved before the restore (e.g. the app was killed within 300 ms): the same id now has a new uid.
    const restored = (await getProduct(db, coffee.id))!;
    expect(restored.name).toBe('Coffee');
    expect(revalidateLinks(stale, new Map([[coffee.id, target(restored)]])).cards[0].productId).toBeNull();
  });
});
