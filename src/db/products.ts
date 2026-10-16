// Products (SPEC §4, §2.2). A product measures one dimension; it cannot change dimension while it has prices
// in a unit of the old one (SPEC §7). Deleting a product deletes its prices (ON DELETE CASCADE).
import type { ProductRecord } from '@/engine/backup';
import { isDimension, unitMatchesDimension, type Dimension } from '@/engine/units';

import { checkBarcodes, writeBarcodes, type BarcodeOwner } from './barcodes';
import { cleanName } from './stores';
import { inTransaction, queued } from './tx';
import type { Db } from './types';

export type ProductInput = {
  name: string;
  brand?: string | null;
  variant?: string | null;
  category?: string | null;
  dimension: Dimension;
  countLabel?: string | null;
  favorite?: boolean;
  note?: string | null;
  /** The user confirmed changing the count label ("rolls" -> "sheets") of a product that has prices (review #10). */
  confirmCountLabelChange?: boolean;
  /** The product's barcodes (canonical, D63); undefined = leave them as they are. */
  barcodes?: readonly string[];
};

/** A product row as stored: the backup fields plus its local random identity (migration 4, never reused). */
export type ProductRow = ProductRecord & { uid: string };

export type ProductError =
  | 'empty' | 'dimension' | 'dimensionInUse' | 'countLabelInUse' | 'notFound' | 'barcode' | 'barcodeTaken' | 'tooManyBarcodes';
export type ProductResult = { ok: true; id: number } | { ok: false; error: ProductError; owner?: BarcodeOwner; code?: string };

/** A Price Book list row: the product plus how many prices it has and its latest date. */
export type ProductListRow = ProductRow & { price_count: number; last_observed_on: string | null; store_names: string | null };

export type ProductQuery = {
  search?: string;
  favoritesOnly?: boolean;
  storeId?: number | null;
  category?: string | null;
  sort?: 'recent' | 'name';
};

function optional(text: string | null | undefined): string | null {
  const clean = text == null ? '' : cleanName(text);
  return clean === '' ? null : clean;
}

function check(input: ProductInput): ProductError | null {
  if (!cleanName(input.name)) return 'empty';
  if (!isDimension(input.dimension)) return 'dimension';
  return null;
}

export const createProduct = queued(async function createProduct(db: Db, input: ProductInput, now: string = new Date().toISOString()): Promise<ProductResult> {
  const error = check(input);
  if (error) return { ok: false, error };
  if (input.barcodes?.length) {
    const problem = await checkBarcodes(db, null, input.barcodes);
    if (problem) return { ok: false, ...problem };
  }
  return inTransaction(db, async (db) => {
    const result = await db.runAsync(
      `INSERT INTO products (name, brand, variant, category, dimension, count_label, favorite, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cleanName(input.name),
      optional(input.brand),
      optional(input.variant),
      optional(input.category),
      input.dimension,
      input.dimension === 'count' ? optional(input.countLabel) : null,
      input.favorite ? 1 : 0,
      optional(input.note),
      now,
      now
    );
    if (input.barcodes?.length) await writeBarcodes(db, result.lastInsertRowId, input.barcodes, now);
    return { ok: true, id: result.lastInsertRowId };
  });
});

export const getProduct = queued(async function getProduct(db: Db, id: number): Promise<ProductRow | null> {
  return db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?', id);
});

export const updateProduct = queued(async function updateProduct(db: Db, id: number, input: ProductInput, now: string = new Date().toISOString()): Promise<ProductResult> {
  const error = check(input);
  if (error) return { ok: false, error };
  const current = await getProduct(db, id);
  if (!current) return { ok: false, error: 'notFound' };
  if (current.dimension !== input.dimension) {
    const units = await db.getAllAsync<{ unit: string }>('SELECT DISTINCT unit FROM observations WHERE product_id = ?', id);
    if (units.some((u) => !unitMatchesDimension(u.unit, input.dimension))) return { ok: false, error: 'dimensionInUse' };
  }
  // A different count label changes what the saved per-item prices mean (per roll vs per sheet): ask first.
  const oldLabel = current.count_label?.toLowerCase() ?? null;
  const newLabel = input.dimension === 'count' ? (optional(input.countLabel)?.toLowerCase() ?? null) : null;
  if (oldLabel && newLabel && oldLabel !== newLabel && !input.confirmCountLabelChange && (await countProductPrices(db, id)) > 0) {
    return { ok: false, error: 'countLabelInUse' };
  }
  if (input.barcodes) {
    const problem = await checkBarcodes(db, id, input.barcodes);
    if (problem) return { ok: false, ...problem };
  }
  return inTransaction(db, async (db) => {
    await db.runAsync(
      `UPDATE products SET name = ?, brand = ?, variant = ?, category = ?, dimension = ?, count_label = ?, favorite = ?, note = ?,
       updated_at = ? WHERE id = ?`,
      cleanName(input.name),
      optional(input.brand),
      optional(input.variant),
      optional(input.category),
      input.dimension,
      input.dimension === 'count' ? optional(input.countLabel) : null,
      input.favorite ? 1 : 0,
      optional(input.note),
      now,
      id
    );
    if (input.barcodes) await writeBarcodes(db, id, input.barcodes, now);
    return { ok: true, id };
  });
});

export const setFavorite = queued(async function setFavorite(db: Db, id: number, favorite: boolean, now: string = new Date().toISOString()): Promise<void> {
  await db.runAsync('UPDATE products SET favorite = ?, updated_at = ? WHERE id = ?', favorite ? 1 : 0, now, id);
});

export const countProductPrices = queued(async function countProductPrices(db: Db, id: number): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM observations WHERE product_id = ?', id);
  return row?.n ?? 0;
});

/** Deletes the product and its prices; returns how many prices went with it. */
export const deleteProduct = queued(async function deleteProduct(db: Db, id: number): Promise<number> {
  const count = await countProductPrices(db, id);
  await db.runAsync('DELETE FROM products WHERE id = ?', id);
  return count;
});

/** Lower-case, accents removed ("Käse" matches "kase"), spaces collapsed. */
export function searchKey(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Every search word must appear in the name, brand, variant, category or a store the product was seen at. */
export function matchesSearch(row: Pick<ProductListRow, 'name' | 'brand' | 'variant' | 'category' | 'store_names'>, search: string): boolean {
  const words = searchKey(search).split(' ').filter(Boolean);
  const hay = searchKey([row.name, row.brand, row.variant, row.category, row.store_names].filter(Boolean).join(' \u0001 '));
  return words.every((w) => hay.includes(w));
}

/** Price Book list (SPEC §2.2): search, favourites, store and category filters, recent or name order. */
export const listProducts = queued(async function listProducts(db: Db, query: ProductQuery = {}): Promise<ProductListRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.favoritesOnly) where.push('p.favorite = 1');
  if (query.category != null) {
    where.push('p.category = ?');
    params.push(query.category);
  }
  if (query.storeId != null) {
    where.push('EXISTS (SELECT 1 FROM observations x WHERE x.product_id = p.id AND x.store_id = ?)');
    params.push(query.storeId);
  }
  const order = query.sort === 'name' ? 'p.name COLLATE NOCASE, p.id' : 'COALESCE(MAX(o.observed_on), \'\') DESC, p.updated_at DESC, p.id DESC';
  const rows = await db.getAllAsync<ProductListRow>(
    `SELECT p.*, COUNT(o.id) AS price_count, MAX(o.observed_on) AS last_observed_on,
            (SELECT GROUP_CONCAT(DISTINCT s.name) FROM observations y JOIN stores s ON s.id = y.store_id WHERE y.product_id = p.id) AS store_names
     FROM products p LEFT JOIN observations o ON o.product_id = p.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY p.id ORDER BY ${order}`,
    ...params
  );
  const search = query.search?.trim();
  return search ? rows.filter((r) => matchesSearch(r, search)) : rows;
});

export const listCategories = queued(async function listCategories(db: Db): Promise<string[]> {
  const rows = await db.getAllAsync<{ category: string }>(
    'SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category COLLATE NOCASE'
  );
  return rows.map((r) => r.category);
});

/**
 * Products with the same name, ignoring case, accents and spaces (review #9): the add-product sheet shows
 * "You already have Coffee beans" and offers the existing one. Same names stay allowed (variants are legitimate).
 */
export const findProductsByName = queued(async function findProductsByName(db: Db, name: string): Promise<ProductRow[]> {
  const key = searchKey(name);
  if (!key) return [];
  const rows = await db.getAllAsync<ProductRow>('SELECT * FROM products ORDER BY id');
  return rows.filter((r) => searchKey(r.name) === key);
});
