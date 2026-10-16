/** @jest-environment node */
// Barcodes as the user's own product IDs (V1.5 P1, R2/R9, D63): lookup by every reading of a scan, attach, create and
// edit a product with its codes, one code one product, cascade on delete.
import { createTestDb } from '../../test/node-sqlite-db';
import { gs1CheckDigit, parseBarcode } from '@/engine/barcode';
import { loadSeed } from '@/debug/seeds';

import { attachBarcode, barcodesByProduct, findProductByBarcode, listBarcodes, MAX_BARCODES_PER_PRODUCT } from './barcodes';
import { migrate } from './migrations';
import { createProduct, deleteProduct, updateProduct, type ProductInput } from './products';

async function setup() {
  const db = createTestDb();
  await migrate(db);
  await loadSeed(db, 's1'); // Coffee beans (id 1) has 4001234567891; Crisps (id 2) has none
  return db;
}
const NOW = '2026-10-14T10:00:00.000Z';
const crisps: ProductInput = { name: 'Crisps', brand: 'Crunchy', variant: 'Paprika', category: 'Snacks', dimension: 'mass' };

function readings(raw: string, hint?: string) {
  const p = parseBarcode(raw, hint);
  if (!p.ok) throw new Error(`bad test code ${raw}`);
  return p.candidates;
}

describe('lookup', () => {
  it('finds the product by its code, typed or scanned in any form', async () => {
    const db = await setup();
    for (const raw of ['4001234567891', '4 001234 567891', '04001234567891']) {
      expect(await findProductByBarcode(db, readings(raw))).toMatchObject({ product: { id: 1, name: 'Coffee beans' }, code: '4001234567891' });
    }
    expect(await findProductByBarcode(db, readings('73513537'))).toBeNull();
  });
  it('a UPC-A pack is found from its UPC-A, EAN-13 and UPC-E readings', async () => {
    const db = await setup();
    expect(await attachBarcode(db, 2, '0042100005264', NOW)).toEqual({ ok: true, already: false });
    for (const [raw, hint] of [['042100005264', undefined], ['0042100005264', 'ean13'], ['04252614', 'upc_e']] as const) {
      expect(await findProductByBarcode(db, readings(raw, hint))).toMatchObject({ product: { id: 2 } });
    }
  });
  it('eight digits stored as EAN-8 are found again when the scanner calls them UPC-E (and the other way round)', async () => {
    const db = await setup();
    let both = ''; // a code valid as both
    for (let n = 0; !both; n++) {
      const body = `0${String(n).padStart(6, '0')}`;
      const p = parseBarcode(body + gs1CheckDigit(body));
      if (p.ok && p.candidates.length === 2) both = body + gs1CheckDigit(body);
    }
    const typed = parseBarcode(both);
    const scanned = parseBarcode(both, 'upc_e');
    if (!typed.ok || !scanned.ok) throw new Error('setup');
    expect(typed.kind).toBe('ean8');
    expect(scanned.kind).toBe('upce');
    await attachBarcode(db, 2, typed.code, NOW);
    expect(await findProductByBarcode(db, scanned.candidates)).toMatchObject({ product: { id: 2 }, code: typed.code });
  });
  it('ignores non-canonical candidates instead of failing', async () => {
    const db = await setup();
    expect(await findProductByBarcode(db, ['abc', '', '4001234567891'])).toMatchObject({ product: { id: 1 } });
  });
});

describe('attach', () => {
  it('adds, is idempotent, refuses a code of another product, a bad code and a missing product', async () => {
    const db = await setup();
    expect(await attachBarcode(db, 2, '73513537', NOW)).toEqual({ ok: true, already: false });
    expect(await attachBarcode(db, 2, '73513537', NOW)).toEqual({ ok: true, already: true });
    expect(await attachBarcode(db, 2, '4001234567891', NOW)).toEqual({
      ok: false, error: 'barcodeTaken', owner: { code: '4001234567891', ownerId: 1, ownerName: 'Coffee beans' },
    });
    expect(await attachBarcode(db, 2, '4001234567892', NOW)).toEqual({ ok: false, error: 'barcode', code: '4001234567892' });
    expect(await attachBarcode(db, 99, '96385074', NOW)).toEqual({ ok: false, error: 'notFound' });
    expect(await listBarcodes(db, 2)).toEqual(['73513537']);
  });
  it(`stops at ${MAX_BARCODES_PER_PRODUCT} codes per product`, async () => {
    const db = await setup();
    for (let n = 0; n < MAX_BARCODES_PER_PRODUCT; n++) {
      const body = `5${String(n).padStart(11, '0')}`;
      expect(await attachBarcode(db, 2, body + gs1CheckDigit(body), NOW)).toEqual({ ok: true, already: false });
    }
    expect(await attachBarcode(db, 2, '73513537', NOW)).toEqual({ ok: false, error: 'tooManyBarcodes' });
  });
});

describe('product create and edit with codes', () => {
  it('creates a product with its scanned code in one step', async () => {
    const db = await setup();
    const r = await createProduct(db, { name: 'Oat drink', dimension: 'volume', barcodes: ['73513537'] }, NOW);
    if (!r.ok) throw new Error(r.error);
    expect(await listBarcodes(db, r.id)).toEqual(['73513537']);
    expect(await findProductByBarcode(db, ['73513537'])).toMatchObject({ product: { id: r.id, name: 'Oat drink' } });
  });
  it('refuses to create a product with a code another product has, and writes nothing', async () => {
    const db = await setup();
    const before = await db.getFirstAsync('SELECT COUNT(*) AS n FROM products');
    expect(await createProduct(db, { name: 'Other coffee', dimension: 'mass', barcodes: ['4001234567891'] }, NOW)).toEqual({
      ok: false, error: 'barcodeTaken', owner: { code: '4001234567891', ownerId: 1, ownerName: 'Coffee beans' },
    });
    expect(await createProduct(db, { name: 'Bad', dimension: 'mass', barcodes: ['123'] }, NOW)).toEqual({ ok: false, error: 'barcode', code: '123' });
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM products')).toEqual(before);
  });
  it("editing replaces the code list; undefined leaves it; another product's code is refused and nothing changes", async () => {
    const db = await setup();
    expect(await updateProduct(db, 2, { ...crisps, barcodes: ['73513537', '96385074'] }, NOW)).toEqual({ ok: true, id: 2 });
    expect((await listBarcodes(db, 2)).sort()).toEqual(['73513537', '96385074']);
    expect(await updateProduct(db, 2, { ...crisps, name: 'Crisps!' }, NOW)).toEqual({ ok: true, id: 2 });
    expect((await listBarcodes(db, 2)).sort()).toEqual(['73513537', '96385074']);
    expect(await updateProduct(db, 2, { ...crisps, barcodes: ['96385074'] }, NOW)).toEqual({ ok: true, id: 2 });
    expect(await listBarcodes(db, 2)).toEqual(['96385074']);
    expect(await updateProduct(db, 2, { ...crisps, name: 'Renamed', barcodes: ['96385074', '4001234567891'] }, NOW)).toMatchObject({ ok: false, error: 'barcodeTaken' });
    expect(await listBarcodes(db, 2)).toEqual(['96385074']);
    expect(await db.getFirstAsync('SELECT name FROM products WHERE id = 2')).toEqual({ name: 'Crisps' }); // not 'Renamed'
    // a code removed from one product can go to another
    expect(await updateProduct(db, 2, { ...crisps, barcodes: [] }, NOW)).toEqual({ ok: true, id: 2 });
    expect(await attachBarcode(db, 1, '96385074', NOW)).toEqual({ ok: true, already: false });
  });
  it('deleting a product frees its codes', async () => {
    const db = await setup();
    await deleteProduct(db, 1);
    expect(await findProductByBarcode(db, ['4001234567891'])).toBeNull();
    expect(await attachBarcode(db, 2, '4001234567891', NOW)).toEqual({ ok: true, already: false });
    expect(await barcodesByProduct(db)).toEqual(new Map([[2, ['4001234567891']]]));
  });
});
