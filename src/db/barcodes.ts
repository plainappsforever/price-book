// Barcodes as the user's own product IDs (V1.5 P1, R2/R9, D63). A product can have several codes; a code belongs to at
// most one product (migration 5). Codes are canonical text from src/engine/barcode.ts; every function here re-checks
// that and never throws on user input. Reads and writes run through the queue in tx.ts (`queued`, `inTransaction`).
import { isCanonicalBarcode } from '@/engine/barcode';

import type { ProductRow } from './products';
import { inTransaction, queued } from './tx';
import type { Db } from './types';

/** More codes than this on one product is a mistake, not a pack history. */
export const MAX_BARCODES_PER_PRODUCT = 20;

export type BarcodeOwner = { code: string; ownerId: number; ownerName: string };
export type BarcodeProblem =
  | { error: 'barcode'; code: string } // not a canonical code
  | { error: 'barcodeTaken'; owner: BarcodeOwner } // another product has it
  | { error: 'tooManyBarcodes' };

/** The product that owns one of a scan's readings, trying `candidates` in order (the reading to store first). */
export const findProductByBarcode = queued(async function findProductByBarcode(
  db: Db,
  candidates: readonly string[]
): Promise<{ product: ProductRow; code: string } | null> {
  for (const code of candidates) {
    if (!isCanonicalBarcode(code)) continue;
    const product = await db.getFirstAsync<ProductRow>(
      'SELECT p.* FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE b.code = ?',
      code
    );
    if (product) return { product, code };
  }
  return null;
});

/** A product's codes, oldest first. */
export const listBarcodes = queued(async function listBarcodes(db: Db, productId: number): Promise<string[]> {
  const rows = await db.getAllAsync<{ code: string }>(
    'SELECT code FROM product_barcodes WHERE product_id = ? ORDER BY created_at, code',
    productId
  );
  return rows.map((r) => r.code);
});

/** Every product's codes (CSV export, Price Book search). */
export const barcodesByProduct = queued(async function barcodesByProduct(db: Db): Promise<Map<number, string[]>> {
  const rows = await db.getAllAsync<{ code: string; product_id: number }>(
    'SELECT code, product_id FROM product_barcodes ORDER BY product_id, created_at, code'
  );
  const map = new Map<number, string[]>();
  for (const r of rows) map.set(r.product_id, [...(map.get(r.product_id) ?? []), r.code]);
  return map;
});

/** Why `codes` cannot be the code list of product `productId` (null for a new product), or null if they can. */
export const checkBarcodes = queued(async function checkBarcodes(db: Db, productId: number | null, codes: readonly string[]): Promise<BarcodeProblem | null> {
  const unique = [...new Set(codes)];
  if (unique.length > MAX_BARCODES_PER_PRODUCT) return { error: 'tooManyBarcodes' };
  for (const code of unique) {
    if (!isCanonicalBarcode(code)) return { error: 'barcode', code };
    const owner = await db.getFirstAsync<{ id: number; name: string }>(
      'SELECT p.id, p.name FROM product_barcodes b JOIN products p ON p.id = b.product_id WHERE b.code = ?',
      code
    );
    if (owner && owner.id !== productId) return { error: 'barcodeTaken', owner: { code, ownerId: owner.id, ownerName: owner.name } };
  }
  return null;
});

/**
 * Makes `codes` the product's code list: removes the others, adds the new ones. Called with the handle of the product
 * write's transaction after `checkBarcodes` returned null.
 */
export const writeBarcodes = queued(async function writeBarcodes(db: Db, productId: number, codes: readonly string[], now: string): Promise<void> {
  const unique = [...new Set(codes)];
  const current = await db.getAllAsync<{ code: string }>('SELECT code FROM product_barcodes WHERE product_id = ?', productId);
  for (const { code } of current) {
    if (!unique.includes(code)) await db.runAsync('DELETE FROM product_barcodes WHERE code = ?', code);
  }
  const have = new Set(current.map((r) => r.code));
  for (const code of unique) {
    if (!have.has(code)) await db.runAsync('INSERT INTO product_barcodes (code, product_id, created_at) VALUES (?, ?, ?)', code, productId, now);
  }
});

export type AttachResult = { ok: true; already: boolean } | ({ ok: false } & (BarcodeProblem | { error: 'notFound' }));

/** Adds one code to a product (the scan flow's "add this code to a product"). Its own transaction. */
export function attachBarcode(db: Db, productId: number, code: string, now: string = new Date().toISOString()): Promise<AttachResult> {
  return inTransaction(db, async (db) => {
    const product = await db.getFirstAsync<{ id: number }>('SELECT id FROM products WHERE id = ?', productId);
    if (!product) return { ok: false, error: 'notFound' };
    const current = (await db.getAllAsync<{ code: string }>('SELECT code FROM product_barcodes WHERE product_id = ?', productId)).map((r) => r.code);
    if (current.includes(code)) return { ok: true, already: true };
    const problem = await checkBarcodes(db, productId, [...current, code]);
    if (problem) return { ok: false, ...problem };
    await db.runAsync('INSERT INTO product_barcodes (code, product_id, created_at) VALUES (?, ?, ?)', code, productId, now);
    return { ok: true, already: false };
  });
}
