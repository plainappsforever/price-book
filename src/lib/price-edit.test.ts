/** @jest-environment node */
// v1.1 B1 / S1 regression: editing a saved price from the book must not change anything the user did not change
// (REVIEW_V1 probes P1 and P2, reproduced on node:sqlite before the fix).
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { addObservation, getObservation, listObservations, toPriceObservation, updateObservation } from '@/db/observations';
import { createProduct } from '@/db/products';
import { createStore } from '@/db/stores';
import { productStats } from '@/engine/stats';

import { readAppSettings } from './app-settings';
import { addDeal, newDraft, nextField, pressKey, PRESETS, type Draft } from './compare-draft';
import { buildPriceInput, formFromObservation, keptPaidMinor, pressPriceKey } from './price-form';
import { candidateInput, saveCandidate } from './save-from-compare';

const EU = readAppSettings({ currency: 'EUR', unitSystem: 'metric', decimalSeparator: '.' });
const CLOCK = { today: '2026-09-30', now: '2026-09-30T10:00:00.000Z' };

function type(draft: Draft, keys: string): Draft {
  let d = draft;
  for (const k of keys) d = k === '>' ? nextField(d) : pressKey(d, k, 2);
  return d;
}

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const store = await createStore(db, 'Rewe');
  const product = await createProduct(db, { name: 'Crisps', dimension: 'mass' });
  if (!store.ok || !product.ok) throw new Error('setup');
  return { db, store: store.id, product: product.id };
}

async function latestPerKg(db: ReturnType<typeof createTestDb>, productId: number, currency = 'EUR') {
  const s = productStats((await listObservations(db, productId)).map(toPriceObservation), '2026-09-30', { currency, dimension: 'mass' });
  return s.latest?.unitPrice;
}

describe('B1: editing a price saved from Compare keeps its after-deal price', () => {
  async function savedThreeForTwo() {
    const { db, store, product } = await setup();
    const draft = addDeal(type(newDraft('g'), '2.29>500'), 'c1', PRESETS.threeForTwo);
    const candidate = saveCandidate(draft, 'c1', EU, 'en-US')!;
    const saved = await addObservation(db, candidateInput(candidate, product, store, 'EUR', '2026-09-30'), CLOCK);
    if (!saved.ok) throw new Error('save');
    return { db, product, id: saved.id };
  }

  it('the review probe: change only the note -> paid 153 and €3.06/kg stay', async () => {
    const { db, product, id } = await savedThreeForTwo();
    expect(await latestPerKg(db, product)).toEqual({ n: BigInt(306), d: BigInt(1) });
    const row = (await getObservation(db, id))!;
    const form = { ...formFromObservation(row), note: 'fixed the note' };
    const built = buildPriceInput(form, product, 'EUR');
    if (!built.ok) throw new Error('build');
    expect(await updateObservation(db, id, built.input, CLOCK)).toEqual({ ok: true, id });
    const after = (await getObservation(db, id))!;
    expect(after).toMatchObject({ paid_price_minor: 153, pack_price_minor: 229, is_promo: 1, deal_text: '3 for 2', note: 'fixed the note' });
    expect(await latestPerKg(db, product)).toEqual({ n: BigInt(306), d: BigInt(1) }); // not €4.58/kg
  });

  it('changing the store or the date keeps it too; changing the shelf price drops it unless the user keeps it', async () => {
    const { db, id } = await savedThreeForTwo();
    const form = formFromObservation((await getObservation(db, id))!);
    expect(keptPaidMinor({ ...form, date: '2026-09-29', storeId: null }, 229)).toBe(153);
    let changed = pressPriceKey(pressPriceKey(form, 'del', 2), '5', 2); // 2.29 -> 2.25
    expect(changed.price).toBe('2.25');
    expect(keptPaidMinor(changed, 225)).toBeNull();
    changed = { ...changed, keepPaid: true };
    expect(keptPaidMinor(changed, 225)).toBe(153);
    expect(keptPaidMinor(changed, 150)).toBeNull(); // never above the shelf price
    expect(keptPaidMinor({ ...form, keepPaid: false }, 229)).toBeNull(); // "Remove"
    // Typing the same price again restores the automatic keep.
    expect(keptPaidMinor(pressPriceKey(pressPriceKey(form, 'del', 2), '9', 2), 229)).toBe(153);
  });

  it('a deal text on a non-promo row (deal did not change the price) survives an edit', async () => {
    const { db, store, product } = await setup();
    const r = await addObservation(db, { productId: product, storeId: store, observedOn: '2026-09-30', currency: 'EUR', packPriceMinor: 229, packCount: 1, itemSize: '500', unit: 'g', dealText: '3 for 2' }, CLOCK);
    if (!r.ok) throw new Error('add');
    const built = buildPriceInput({ ...formFromObservation((await getObservation(db, r.id))!), note: 'x' }, product, 'EUR');
    if (!built.ok) throw new Error('build');
    await updateObservation(db, r.id, built.input, CLOCK);
    expect(await getObservation(db, r.id)).toMatchObject({ deal_text: '3 for 2', is_promo: 0, paid_price_minor: null });
  });
});

describe('S1: editing a price in another currency keeps its currency and decimals', () => {
  it('the review probe: ¥398 while the book is EUR stays ¥398', async () => {
    const { db, store, product } = await setup();
    const r = await addObservation(db, { productId: product, storeId: store, observedOn: '2026-09-01', currency: 'JPY', packPriceMinor: 398, packCount: 1, itemSize: '500', unit: 'g' }, CLOCK);
    if (!r.ok) throw new Error('add');
    const form = formFromObservation((await getObservation(db, r.id))!);
    expect(form).toMatchObject({ currency: 'JPY', price: '398' });
    const built = buildPriceInput({ ...form, note: 'Tokyo' }, product, 'EUR');
    if (!built.ok) throw new Error('build');
    expect(built.input).toMatchObject({ currency: 'JPY', packPriceMinor: 398 });
    await updateObservation(db, r.id, built.input, CLOCK);
    expect(await getObservation(db, r.id)).toMatchObject({ currency: 'JPY', pack_price_minor: 398, minor_digits: 0, note: 'Tokyo' });
    expect(await latestPerKg(db, product, 'JPY')).toEqual({ n: BigInt(796), d: BigInt(1) });
  });

  it('the keypad of a KWD price takes three decimals, the EUR book does not matter', async () => {
    const { db, store, product } = await setup();
    const r = await addObservation(db, { productId: product, storeId: store, observedOn: '2026-09-01', currency: 'KWD', packPriceMinor: 1250, packCount: 1, itemSize: '1', unit: 'kg' }, CLOCK);
    if (!r.ok) throw new Error('add');
    const form = formFromObservation((await getObservation(db, r.id))!);
    expect(form.price).toBe('1.25');
    const typed = pressPriceKey(pressPriceKey(form, '5', 3), '9', 3); // 1.255, then the 4th decimal is refused
    expect(typed.price).toBe('1.255');
    const built = buildPriceInput(typed, product, 'EUR');
    expect(built.ok && built.input).toMatchObject({ currency: 'KWD', packPriceMinor: 1255 });
  });

  it('a new price still uses the book currency', async () => {
    const built = buildPriceInput(
      { storeId: null, date: '2026-09-30', price: '1.99', size: '500', unit: 'g', deposit: '', isPromo: false, dealText: '', note: '', focus: 'price', currency: null, paid: null, keepPaid: null, hiddenDealText: null },
      1,
      'EUR'
    );
    expect(built.ok && built.input).toMatchObject({ currency: 'EUR', packPriceMinor: 199, paidPriceMinor: null });
  });
});
