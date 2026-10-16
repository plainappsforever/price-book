/** @jest-environment node */
// Data functions for stores, products and prices (SPEC 4, 2.2, 2.4, 7) on node:sqlite.
import { createTestDb } from '../../test/node-sqlite-db';
import { productStats } from '@/engine/stats';

import { migrate } from './migrations';
import {
  addObservation, deleteObservation, findDuplicate, lastObservation, listAllObservations, listExportRows, listObservations, toPriceObservation,
  updateObservation, type ObservationInput,
} from './observations';
import {
  countProductPrices, createProduct, deleteProduct, findProductsByName, getProduct, listCategories, listProducts, matchesSearch, setFavorite, updateProduct,
} from './products';
import {
  createStore, deleteStore, findOrCreateStore, listStores, recentStores, renameStore, setStoreArchived, storeNameKey,
} from './stores';

const TODAY = { today: '2026-09-30', now: '2026-09-30T10:00:00.000Z' };

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const rewe = await createStore(db, '  Rewe  ');
  const aldi = await createStore(db, 'Aldi Süd');
  const coffee = await createProduct(db, { name: 'Coffee beans', brand: 'Mokka Mill', variant: 'Crema', category: 'Coffee', dimension: 'mass' });
  const milk = await createProduct(db, { name: 'Milk', category: 'Dairy', dimension: 'volume', favorite: true });
  if (!rewe.ok || !aldi.ok || !coffee.ok || !milk.ok) throw new Error('setup failed');
  return { db, rewe: rewe.id, aldi: aldi.id, coffee: coffee.id, milk: milk.id };
}

function input(productId: number, storeId: number | null, extra: Partial<ObservationInput> = {}): ObservationInput {
  return { productId, storeId, observedOn: '2026-09-01', currency: 'EUR', packPriceMinor: 249, packCount: 1, itemSize: '500', unit: 'g', ...extra };
}

describe('stores', () => {
  it('trims names, refuses empty and case-insensitive duplicates', async () => {
    const { db, rewe } = await setup();
    expect(storeNameKey('  REWE   City ')).toBe('rewe city');
    expect(await createStore(db, '   ')).toEqual({ ok: false, error: 'empty' });
    expect(await createStore(db, 'rewe')).toEqual({ ok: false, error: 'duplicate', id: rewe });
    expect((await listStores(db)).map((s) => s.name)).toEqual(['Aldi Süd', 'Rewe']);
  });
  it('rename, archive, find-or-create un-archives', async () => {
    const { db, rewe, aldi } = await setup();
    expect(await renameStore(db, rewe, 'aldi süd')).toEqual({ ok: false, error: 'duplicate', id: aldi });
    expect(await renameStore(db, rewe, 'Rewe City')).toEqual({ ok: true, id: rewe });
    expect(await renameStore(db, 999, 'X')).toEqual({ ok: false, error: 'notFound' });
    await setStoreArchived(db, aldi, true);
    expect((await listStores(db)).map((s) => s.name)).toEqual(['Rewe City']);
    expect((await listStores(db, { includeArchived: true })).length).toBe(2);
    expect(await findOrCreateStore(db, 'ALDI SÜD')).toEqual({ ok: true, id: aldi });
    expect((await listStores(db)).length).toBe(2);
  });
  it('delete keeps the prices as "No store" and reports how many', async () => {
    const { db, rewe, coffee } = await setup();
    await addObservation(db, input(coffee, rewe), TODAY);
    await addObservation(db, input(coffee, rewe, { observedOn: '2026-09-02' }), TODAY);
    expect(await deleteStore(db, rewe)).toBe(2);
    expect((await listObservations(db, coffee)).map((o) => o.store_id)).toEqual([null, null]);
  });
  it('recent stores follow the most recently saved prices', async () => {
    const { db, rewe, aldi, coffee } = await setup();
    await addObservation(db, input(coffee, rewe), { today: TODAY.today, now: '2026-09-01T08:00:00.000Z' });
    await addObservation(db, input(coffee, aldi, { packPriceMinor: 229 }), { today: TODAY.today, now: '2026-09-02T08:00:00.000Z' });
    expect((await recentStores(db)).map((s) => s.id)).toEqual([aldi, rewe]);
    expect((await recentStores(db, 1)).map((s) => s.id)).toEqual([aldi]);
  });
});

describe('products', () => {
  it('refuses empty names and unknown dimensions; trims optional text to null', async () => {
    const { db, coffee } = await setup();
    expect(await createProduct(db, { name: ' ', dimension: 'mass' })).toEqual({ ok: false, error: 'empty' });
    expect(await createProduct(db, { name: 'X', dimension: 'weight' as never })).toEqual({ ok: false, error: 'dimension' });
    const p = await createProduct(db, { name: ' Rolls ', brand: '  ', dimension: 'count', countLabel: 'rolls' });
    expect(p.ok && (await getProduct(db, p.id))).toMatchObject({ name: 'Rolls', brand: null, count_label: 'rolls' });
    expect((await getProduct(db, coffee))?.count_label).toBeNull();
  });
  it('SPEC 7: dimension change refused while prices use the old dimension, allowed without prices', async () => {
    const { db, coffee, milk } = await setup();
    await addObservation(db, input(coffee, null), TODAY);
    expect(await updateProduct(db, coffee, { name: 'Coffee beans', dimension: 'volume' })).toEqual({ ok: false, error: 'dimensionInUse' });
    expect(await updateProduct(db, milk, { name: 'Milk', dimension: 'mass' })).toEqual({ ok: true, id: milk });
    expect(await updateProduct(db, 999, { name: 'X', dimension: 'mass' })).toEqual({ ok: false, error: 'notFound' });
  });
  it('delete removes the prices and reports how many', async () => {
    const { db, coffee } = await setup();
    await addObservation(db, input(coffee, null), TODAY);
    expect(await countProductPrices(db, coffee)).toBe(1);
    expect(await deleteProduct(db, coffee)).toBe(1);
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM observations')).toEqual({ n: 0 });
  });
  it('list: search (name, brand, variant, category, store; accents ignored), favourites, store and category filters, sorts', async () => {
    const { db, aldi, coffee, milk } = await setup();
    await addObservation(db, input(coffee, aldi, { observedOn: '2026-08-01' }), TODAY);
    await addObservation(db, input(milk, null, { unit: 'l', itemSize: '1', observedOn: '2026-09-01' }), TODAY);
    const names = async (q: Parameters<typeof listProducts>[1]) => (await listProducts(db, q)).map((p) => p.name);
    expect(await names({})).toEqual(['Milk', 'Coffee beans']); // most recent price first
    expect(await names({ sort: 'name' })).toEqual(['Coffee beans', 'Milk']);
    expect(await names({ search: 'mokka' })).toEqual(['Coffee beans']);
    expect(await names({ search: 'crema coffee' })).toEqual(['Coffee beans']);
    expect(await names({ search: 'aldi sud' })).toEqual(['Coffee beans']);
    expect(await names({ search: 'dairy' })).toEqual(['Milk']);
    expect(await names({ search: 'tea' })).toEqual([]);
    expect(await names({ favoritesOnly: true })).toEqual(['Milk']);
    expect(await names({ storeId: aldi })).toEqual(['Coffee beans']);
    expect(await names({ category: 'Dairy' })).toEqual(['Milk']);
    await setFavorite(db, coffee, true);
    expect(await names({ favoritesOnly: true, sort: 'name' })).toEqual(['Coffee beans', 'Milk']);
    const [row] = await listProducts(db, { search: 'coffee' });
    expect(row).toMatchObject({ price_count: 1, last_observed_on: '2026-08-01', store_names: 'Aldi Süd' });
    expect(await listCategories(db)).toEqual(['Coffee', 'Dairy']);
    expect(matchesSearch({ name: 'Käse', brand: null, variant: null, category: null, store_names: null }, 'KASE')).toBe(true);
  });
});

describe('prices', () => {
  it.each([
    ['product', { productId: 999 }],
    ['store', { storeId: 999 }],
    ['unit', { unit: 'ml' }],
    ['unit', { unit: 'stone' }],
    ['date', { observedOn: '2026-02-30' }],
    ['future', { observedOn: '2026-10-01' }],
    ['currency', { currency: 'eur' }],
    ['price', { packPriceMinor: -1 }],
    ['price', { packPriceMinor: 2.5 }],
    ['paid', { paidPriceMinor: -5 }],
    ['size', { itemSize: '0' }],
    ['size', { itemSize: '500.0' }],
    ['size', { itemSize: '1,5' }],
    ['packCount', { packCount: 0 }],
    ['packCount', { packCount: 1000 }],
    ['deposit', { depositMinor: -1 }],
  ] as const)('refuses %s: %j', async (error, change) => {
    const { db, rewe, coffee } = await setup();
    expect(await addObservation(db, input(coffee, rewe, change as Partial<ObservationInput>), TODAY)).toEqual({ ok: false, error });
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM observations')).toEqual({ n: 0 });
  });
  it('saves, edits, lists newest first, deletes; promo, paid price, deal text and today are fine', async () => {
    const { db, rewe, coffee } = await setup();
    const a = await addObservation(db, input(coffee, rewe, { observedOn: '2026-09-30', paidPriceMinor: 199, isPromo: true, dealText: ' 3 for 2 ' }), TODAY);
    const b = await addObservation(db, input(coffee, null, { observedOn: '2026-08-01' }), TODAY);
    if (!a.ok || !b.ok) throw new Error('save failed');
    const rows = await listObservations(db, coffee);
    expect(rows.map((r) => r.id)).toEqual([a.id, b.id]);
    expect(rows[0]).toMatchObject({ paid_price_minor: 199, is_promo: 1, deal_text: '3 for 2', created_at: TODAY.now });
    expect(await updateObservation(db, b.id, input(coffee, rewe, { packPriceMinor: 259 }), TODAY)).toEqual({ ok: true, id: b.id });
    expect(await updateObservation(db, b.id, input(coffee, rewe, { unit: 'l' }), TODAY)).toEqual({ ok: false, error: 'unit' });
    expect(await updateObservation(db, 999, input(coffee, rewe), TODAY)).toEqual({ ok: false, error: 'notFound' });
    expect((await lastObservation(db, coffee))?.id).toBe(a.id);
    await deleteObservation(db, a.id);
    expect((await listObservations(db, coffee)).map((r) => r.id)).toEqual([b.id]);
  });
  it('duplicate guard finds an identical price of the same product only', async () => {
    const { db, rewe, coffee, milk } = await setup();
    const a = await addObservation(db, input(coffee, rewe), TODAY);
    if (!a.ok) throw new Error('save failed');
    expect(await findDuplicate(db, input(coffee, rewe))).toMatchObject({ id: a.id, kind: 'exact' });
    expect(await findDuplicate(db, input(coffee, rewe), a.id)).toBeNull(); // editing that price itself
    expect(await findDuplicate(db, input(coffee, rewe, { packPriceMinor: 299 }))).toBeNull();
    expect(await findDuplicate(db, input(milk, rewe, { unit: 'l', itemSize: '1' }))).toBeNull();
  });
  it('near-duplicate (R10, D64): same tag typed again with a typo or another way of writing the size', async () => {
    const { db, rewe, coffee } = await setup();
    const a = await addObservation(db, input(coffee, rewe), TODAY);
    if (!a.ok) throw new Error('save failed');
    expect(await findDuplicate(db, input(coffee, rewe, { packPriceMinor: 250 }))).toMatchObject({ id: a.id, kind: 'near', row: { pack_price_minor: 249 } });
    expect(await findDuplicate(db, input(coffee, rewe, { itemSize: '0.5', unit: 'kg' }))).toMatchObject({ id: a.id, kind: 'near' });
    expect(await findDuplicate(db, input(coffee, rewe, { itemSize: '1', unit: 'kg', packPriceMinor: 498 }))).toBeNull(); // another pack size
    expect(await findDuplicate(db, input(coffee, null, { packPriceMinor: 250 }))).toBeNull(); // no store vs Rewe
    expect(await findDuplicate(db, input(coffee, rewe, { packPriceMinor: 250, observedOn: '2026-09-02' }))).toBeNull();
    // an exact match wins over a near one, whatever the order
    const b = await addObservation(db, input(coffee, rewe, { packPriceMinor: 250 }), TODAY);
    if (!b.ok) throw new Error('save failed');
    expect(await findDuplicate(db, input(coffee, rewe))).toMatchObject({ id: a.id, kind: 'exact' });
    expect(await findDuplicate(db, input(coffee, rewe, { packPriceMinor: 250 }))).toMatchObject({ id: b.id, kind: 'exact' });
    expect(await findDuplicate(db, input(coffee, rewe, { packPriceMinor: 251 }))).toMatchObject({ id: b.id, kind: 'near' }); // newest first
  });
  it('rows feed the statistics engine unchanged', async () => {
    const { db, rewe, coffee } = await setup();
    await addObservation(db, input(coffee, rewe, { observedOn: '2026-09-01' }), TODAY);
    await addObservation(db, input(coffee, rewe, { observedOn: '2026-09-02', itemSize: '1', unit: 'kg', packPriceMinor: 399, isPromo: true }), TODAY);
    const s = productStats((await listObservations(db, coffee)).map(toPriceObservation), '2026-09-30', { currency: 'EUR', dimension: 'mass' });
    expect(s.count).toBe(2);
    expect(s.lowest?.isPromo).toBe(true);
  });
  it('export rows join product and store, oldest first', async () => {
    const { db, rewe, coffee } = await setup();
    await addObservation(db, input(coffee, rewe, { observedOn: '2026-09-02' }), TODAY);
    await addObservation(db, input(coffee, null, { observedOn: '2026-09-01' }), TODAY);
    const rows = await listExportRows(db);
    expect(rows.map((r) => [r.observedOn, r.product, r.store])).toEqual([['2026-09-01', 'Coffee beans', null], ['2026-09-02', 'Coffee beans', 'Rewe']]);
  });
});

describe('D41: each saved price records its decimals', () => {
  it.each([['EUR', 2], ['JPY', 0], ['KWD', 3], ['HUF', 2]] as const)('%s -> minor_digits %i (also after an edit)', async (currency, digits) => {
    const { db, coffee, rewe } = await setup();
    const r = await addObservation(db, input(coffee, rewe, { currency: 'EUR' }), TODAY);
    if (!r.ok) throw new Error(r.error);
    expect(await updateObservation(db, r.id, input(coffee, rewe, { currency }), TODAY)).toEqual({ ok: true, id: r.id });
    expect((await listObservations(db, coffee))[0].minor_digits).toBe(digits);
    expect((await listExportRows(db))[0].minorDigits).toBe(digits);
  });
});

describe('review #8: the data layer enforces the keypad LIMITS', () => {
  it.each([
    ['price', { packPriceMinor: 1e15 }],
    ['price', { packPriceMinor: 100000001 }],
    ['paid', { paidPriceMinor: 100000001 }],
    ['deposit', { depositMinor: 100000001 }],
    ['size', { itemSize: '1000000000000' }],
    ['size', { itemSize: '1000000.001' }],
    ['size', { itemSize: '0.0005' }],
  ] as const)('refuses %s: %j', async (error, change) => {
    const { db, coffee, rewe } = await setup();
    expect(await addObservation(db, input(coffee, rewe, change), TODAY)).toEqual({ ok: false, error });
  });
  it('accepts the edges: EUR 1 000 000.00, JPY 1 000 000, size 1 000 000 and 0.001', async () => {
    const { db, coffee, rewe } = await setup();
    for (const change of [{ packPriceMinor: 100000000 }, { currency: 'JPY', packPriceMinor: 1000000 }, { itemSize: '1000000' }, { itemSize: '0.001' }]) {
      expect((await addObservation(db, input(coffee, rewe, change), TODAY)).ok).toBe(true);
    }
  });
});

describe('review #10: changing the count label of a product with prices needs a confirmation', () => {
  async function rolls() {
    const { db } = await setup();
    const p = await createProduct(db, { name: 'Toilet paper', dimension: 'count', countLabel: 'rolls' });
    if (!p.ok) throw new Error('product');
    return { db, id: p.id };
  }
  it('"rolls" -> "sheets" with prices is refused, then allowed when confirmed', async () => {
    const { db, id } = await rolls();
    expect((await addObservation(db, input(id, null, { unit: 'pcs', itemSize: '8' }), TODAY)).ok).toBe(true);
    const change = { name: 'Toilet paper', dimension: 'count' as const, countLabel: 'sheets' };
    expect(await updateProduct(db, id, change)).toEqual({ ok: false, error: 'countLabelInUse' });
    expect((await getProduct(db, id))?.count_label).toBe('rolls');
    expect(await updateProduct(db, id, { ...change, confirmCountLabelChange: true })).toEqual({ ok: true, id });
    expect((await getProduct(db, id))?.count_label).toBe('sheets');
  });
  it('no prices, same label in another case, or a first label: no question', async () => {
    const { db, id } = await rolls();
    expect((await updateProduct(db, id, { name: 'Toilet paper', dimension: 'count', countLabel: 'sheets' })).ok).toBe(true);
    await addObservation(db, input(id, null, { unit: 'pcs', itemSize: '8' }), TODAY);
    expect((await updateProduct(db, id, { name: 'Toilet paper', dimension: 'count', countLabel: 'Sheets' })).ok).toBe(true);
    const plain = await createProduct(db, { name: 'Eggs', dimension: 'count' });
    if (!plain.ok) throw new Error('product');
    await addObservation(db, input(plain.id, null, { unit: 'pcs', itemSize: '10' }), TODAY);
    expect((await updateProduct(db, plain.id, { name: 'Eggs', dimension: 'count', countLabel: 'eggs' })).ok).toBe(true);
  });
});

describe('review #9: same-name hint', () => {
  it('finds "Coffee beans" for " coffee  BEANS", accents folded; a second one is still allowed', async () => {
    const { db, coffee } = await setup();
    expect((await findProductsByName(db, ' coffee  BEANS')).map((p) => p.id)).toEqual([coffee]);
    expect(await findProductsByName(db, 'Coffee')).toEqual([]);
    expect(await findProductsByName(db, '  ')).toEqual([]);
    const kase = await createProduct(db, { name: 'Käse', dimension: 'mass' });
    expect((await findProductsByName(db, 'kase')).map((p) => p.id)).toEqual([kase.ok ? kase.id : -1]);
    expect((await createProduct(db, { name: 'Coffee beans', dimension: 'mass' })).ok).toBe(true);
  });
});

describe('listAllObservations (Price Book list: one query for every row, A17)', () => {
  it('returns every price, grouped by product and oldest first inside a product', async () => {
    const { db, rewe, coffee, milk } = await setup();
    await addObservation(db, input(milk, rewe, { observedOn: '2026-09-02', unit: 'l', itemSize: '1' }), TODAY);
    await addObservation(db, input(coffee, rewe, { observedOn: '2026-09-10' }), TODAY);
    await addObservation(db, input(coffee, rewe, { observedOn: '2026-08-01' }), TODAY);
    const all = await listAllObservations(db);
    expect(all.map((o) => [o.product_id, o.observed_on])).toEqual([
      [coffee, '2026-08-01'],
      [coffee, '2026-09-10'],
      [milk, '2026-09-02'],
    ]);
  });
  it('is empty for a new book', async () => {
    const { db } = await setup();
    expect(await listAllObservations(db)).toEqual([]);
  });
});
