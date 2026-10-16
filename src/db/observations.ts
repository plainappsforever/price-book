// Saved prices (SPEC §4, §2.4). Every write is checked first and returns { ok, error } — never throws on
// user input: unit must measure the product's dimension, date valid and not in the future, money in
// whole minor units, size canonical decimal text > 0.
import type { ObservationRecord } from '@/engine/backup';
import type { CsvRow } from '@/engine/csv';
import { currencyExponent, rescaleMinor } from '@/engine/money';
import { maxMinorFor } from '@/engine/deals';
import { isKeypadItemSize, LIMITS } from '@/engine/parse';
import { duplicateKind, isValidDate, type DuplicateKind, type PriceObservation } from '@/engine/stats';
import { unitMatchesDimension } from '@/engine/units';

import { barcodesByProduct } from './barcodes';
import { getProduct } from './products';
import { queued } from './tx';
import type { Db } from './types';

export type ObservationInput = {
  productId: number;
  storeId: number | null;
  observedOn: string;
  currency: string;
  packPriceMinor: number;
  paidPriceMinor?: number | null;
  packCount: number;
  itemSize: string;
  unit: string;
  depositMinor?: number;
  isPromo?: boolean;
  dealText?: string | null;
  note?: string | null;
};

export type ObservationError =
  | 'product' // no such product
  | 'store' // no such store
  | 'unit' // unit of another dimension (SPEC §7)
  | 'date'
  | 'future' // SPEC §7: future date refused
  | 'currency'
  | 'price'
  | 'paid'
  | 'size'
  | 'packCount'
  | 'deposit'
  | 'notFound';

export type ObservationResult = { ok: true; id: number } | { ok: false; error: ObservationError };
type Clock = { today: string; now?: string };

/** Whole minor units within the keypad range of the currency (review #8: the data layer enforces LIMITS too). */
function isMoney(v: unknown, currency: string): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= maxMinorFor(currency);
}
function optionalText(v: string | null | undefined): string | null {
  const t = v == null ? '' : v.trim();
  return t === '' ? null : t;
}

async function check(db: Db, input: ObservationInput, today: string): Promise<ObservationError | null> {
  const product = await getProduct(db, input.productId);
  if (!product) return 'product';
  if (input.storeId !== null) {
    const store = await db.getFirstAsync<{ id: number }>('SELECT id FROM stores WHERE id = ?', input.storeId);
    if (!store) return 'store';
  }
  if (!unitMatchesDimension(input.unit, product.dimension)) return 'unit';
  if (!isValidDate(input.observedOn)) return 'date';
  if (input.observedOn > today) return 'future';
  if (!/^[A-Z]{3}$/.test(input.currency)) return 'currency';
  if (!isMoney(input.packPriceMinor, input.currency)) return 'price';
  if (input.paidPriceMinor != null && !isMoney(input.paidPriceMinor, input.currency)) return 'paid';
  if (!isKeypadItemSize(input.itemSize)) return 'size';
  if (!Number.isInteger(input.packCount) || input.packCount < 1 || input.packCount > LIMITS.packCountMax) return 'packCount';
  if (input.depositMinor != null && !isMoney(input.depositMinor, input.currency)) return 'deposit';
  return null;
}

function values(input: ObservationInput) {
  return [
    input.productId, input.storeId, input.observedOn, input.currency, input.packPriceMinor, input.paidPriceMinor ?? null,
    input.packCount, input.itemSize, input.unit, input.depositMinor ?? 0, input.isPromo ? 1 : 0,
    optionalText(input.dealText), optionalText(input.note), currencyExponent(input.currency),
  ] as const;
}

export const addObservation = queued(async function addObservation(db: Db, input: ObservationInput, clock: Clock): Promise<ObservationResult> {
  const error = await check(db, input, clock.today);
  if (error) return { ok: false, error };
  const now = clock.now ?? new Date().toISOString();
  const result = await db.runAsync(
    `INSERT INTO observations (product_id, store_id, observed_on, currency, pack_price_minor, paid_price_minor, pack_count,
       item_size, unit, deposit_minor, is_promo, deal_text, note, minor_digits, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...values(input),
    now,
    now
  );
  return { ok: true, id: result.lastInsertRowId };
});

export const updateObservation = queued(async function updateObservation(db: Db, id: number, input: ObservationInput, clock: Clock): Promise<ObservationResult> {
  const error = await check(db, input, clock.today);
  if (error) return { ok: false, error };
  const result = await db.runAsync(
    `UPDATE observations SET product_id = ?, store_id = ?, observed_on = ?, currency = ?, pack_price_minor = ?, paid_price_minor = ?,
       pack_count = ?, item_size = ?, unit = ?, deposit_minor = ?, is_promo = ?, deal_text = ?, note = ?, minor_digits = ?, updated_at = ?
     WHERE id = ?`,
    ...values(input),
    clock.now ?? new Date().toISOString(),
    id
  );
  return result.changes ? { ok: true, id } : { ok: false, error: 'notFound' };
});

/** Prices saved in one currency (REVIEW_V1 N7: changing the book currency hides them from the statistics). */
export const countPricesInCurrency = queued(async function countPricesInCurrency(db: Db, currency: string): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM observations WHERE currency = ?', currency))?.n ?? 0;
});

export const deleteObservation = queued(async function deleteObservation(db: Db, id: number): Promise<void> {
  await db.runAsync('DELETE FROM observations WHERE id = ?', id);
});

export const getObservation = queued(async function getObservation(db: Db, id: number): Promise<ObservationRecord | null> {
  return db.getFirstAsync<ObservationRecord>('SELECT * FROM observations WHERE id = ?', id);
});

/** A product's prices, newest first (the Product screen's price list). */
export const listObservations = queued(async function listObservations(db: Db, productId: number): Promise<ObservationRecord[]> {
  return db.getAllAsync<ObservationRecord>(
    'SELECT * FROM observations WHERE product_id = ? ORDER BY observed_on DESC, created_at DESC, id DESC',
    productId
  );
});

/** Every price, oldest first (the Price Book list groups them by product: one query instead of one per row, A17). */
export const listAllObservations = queued(async function listAllObservations(db: Db): Promise<ObservationRecord[]> {
  return db.getAllAsync<ObservationRecord>('SELECT * FROM observations ORDER BY product_id, observed_on, created_at, id');
});

/**
 * Row -> the engine's PriceObservation (src/engine/stats.ts), in minor units of the currency's CURRENT ISO 4217
 * decimals: a row saved with other decimals (an older table, D41) is rescaled, never reinterpreted.
 */
export function toPriceObservation(r: ObservationRecord): PriceObservation {
  const from = r.minor_digits ?? currencyExponent(r.currency);
  const to = currencyExponent(r.currency);
  const scale = (minor: number) => rescaleMinor(minor, from, to);
  return {
    id: r.id,
    storeId: r.store_id,
    observedOn: r.observed_on,
    createdAt: r.created_at ?? '',
    currency: r.currency,
    packPriceMinor: scale(r.pack_price_minor),
    paidPriceMinor: r.paid_price_minor === null ? null : scale(r.paid_price_minor),
    packCount: r.pack_count,
    itemSize: r.item_size,
    unit: r.unit,
    depositMinor: scale(r.deposit_minor),
    isPromo: r.is_promo === 1,
  };
}

export type DuplicateHit = { id: number; kind: DuplicateKind; row: ObservationRecord };

/**
 * Duplicate guard (SPEC 5.8) with the near-duplicate rule (R10, D64): a saved price of the same product that is
 * identical (`exact`) or looks like a second capture of the same shelf tag (`near`); exact wins, then the newest.
 */
export const findDuplicate = queued(async function findDuplicate(db: Db, input: ObservationInput, exceptId?: number): Promise<DuplicateHit | null> {
  const rows = await db.getAllAsync<ObservationRecord>(
    'SELECT * FROM observations WHERE product_id = ? AND observed_on = ? ORDER BY created_at DESC, id DESC',
    input.productId,
    input.observedOn
  );
  // The candidate in minor units of the currency's current decimals, like the rows (toPriceObservation).
  const candidate = { ...input, paidPriceMinor: input.paidPriceMinor ?? null };
  let near: DuplicateHit | null = null;
  for (const r of rows) {
    if (r.id === exceptId) continue;
    const kind = duplicateKind(candidate, toPriceObservation(r));
    if (kind === 'exact') return { id: r.id, kind, row: r };
    if (kind === 'near' && !near) near = { id: r.id, kind, row: r };
  }
  return near;
});

/** Prefill for "Add price" (SPEC 2.3): the product's most recent price (store, pack size, unit). */
export const lastObservation = queued(async function lastObservation(db: Db, productId: number): Promise<ObservationRecord | null> {
  return db.getFirstAsync<ObservationRecord>(
    'SELECT * FROM observations WHERE product_id = ? ORDER BY observed_on DESC, created_at DESC, id DESC LIMIT 1',
    productId
  );
});

/** Every price joined with product and store for the CSV export, oldest first. */
export const listExportRows = queued(async function listExportRows(db: Db): Promise<CsvRow[]> {
  const rows = await db.getAllAsync<ObservationRecord & { product: string; brand: string | null; variant: string | null; category: string | null; store: string | null }>(
    `SELECT o.*, p.name AS product, p.brand, p.variant, p.category, s.name AS store
     FROM observations o JOIN products p ON p.id = o.product_id LEFT JOIN stores s ON s.id = o.store_id
     ORDER BY o.observed_on, p.name COLLATE NOCASE, o.created_at, o.id`
  );
  const codes = await barcodesByProduct(db);
  return rows.map((r) => ({
    observedOn: r.observed_on,
    product: r.product,
    brand: r.brand,
    variant: r.variant,
    category: r.category,
    store: r.store,
    currency: r.currency,
    packPriceMinor: r.pack_price_minor,
    paidPriceMinor: r.paid_price_minor,
    packCount: r.pack_count,
    itemSize: r.item_size,
    unit: r.unit,
    depositMinor: r.deposit_minor,
    isPromo: r.is_promo === 1,
    dealText: r.deal_text,
    note: r.note,
    minorDigits: r.minor_digits,
    barcodes: codes.get(r.product_id) ?? [],
  }));
});
