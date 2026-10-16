// Backup and replace-restore on the database (SPEC §6, D20, A9; barcodes since schema 5, D63). Reading is one read transaction (a consistent
// snapshot, review #5) and the written text is re-validated before it may be shared; restoring
// validates first (src/engine/backup.ts), then replaces every table in ONE transaction and checks the
// foreign keys before committing. Any error rolls everything back: the old data stays as it was.
import {
  buildBackup, countsOf, parseBackup, serializeBackup, UNSAVED_SETTINGS,
  type BackupCounts, type BackupData, type BackupFileData, type BarcodeRecord, type BackupError, type BackupFile, type ObservationRecord, type ProductRecord, type StoreRecord,
} from '@/engine/backup';

import { LATEST_VERSION } from './migrations';
import { inTransaction, queued } from './tx';
import type { Db } from './types';

/** Every row of every table, ordered by id, read in ONE transaction (a consistent snapshot); settings minus the compare draft. */
export function readAllData(db: Db): Promise<BackupData> {
  return inTransaction(db, async (db) => {
    const settingRows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key');
    const settings: Record<string, string> = {};
    for (const r of settingRows) if (!UNSAVED_SETTINGS.includes(r.key)) settings[r.key] = r.value;
    return {
      settings,
      stores: await db.getAllAsync<StoreRecord>('SELECT * FROM stores ORDER BY id'),
      // Named columns: the local uid (migration 4) is not part of the backup file.
      products: await db.getAllAsync<ProductRecord>(
        'SELECT id, name, brand, variant, category, dimension, count_label, favorite, note, created_at, updated_at FROM products ORDER BY id'
      ),
      observations: await db.getAllAsync<ObservationRecord>('SELECT * FROM observations ORDER BY id'),
      barcodes: await db.getAllAsync<BarcodeRecord>('SELECT code, product_id, created_at FROM product_barcodes ORDER BY product_id, created_at, code'),
    };
  });
}

/** How many prices, products and stores are on this phone now (the restore confirmation shows both sides, REVIEW_V1 S7). */
export const countData = queued(async function countData(db: Db): Promise<BackupCounts> {
  const n = async (table: string) => (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0;
  return { prices: await n('observations'), products: await n('products'), stores: await n('stores') };
});

export const exportBackup = queued(async function exportBackup(db: Db, exportedAt: string = new Date().toISOString()): Promise<BackupFile> {
  return buildBackup(await readAllData(db), LATEST_VERSION, exportedAt);
});

export type BackupText = { ok: true; text: string; counts: BackupCounts } | { ok: false; error: BackupError };

/**
 * The backup file's text, ready to write and share — but only after this app's own restore validation accepted
 * it (review #5): a file that could not be restored is never offered. The UI shows `error.detail` instead.
 */
export const exportBackupText = queued(async function exportBackupText(db: Db, exportedAt: string = new Date().toISOString()): Promise<BackupText> {
  const text = serializeBackup(await exportBackup(db, exportedAt));
  const check = parseBackup(text, LATEST_VERSION);
  return check.ok ? { ok: true, text, counts: check.counts } : check;
});

/**
 * Replaces stores, products, prices and settings with `data` in one transaction (the compare draft on
 * this phone is kept). Throws — after rolling back — if anything fails.
 */
export function replaceAllData(db: Db, data: BackupFileData): Promise<void> {
  return inTransaction(db, async (db) => {
    await db.runAsync('DELETE FROM product_barcodes');
    await db.runAsync('DELETE FROM observations');
    await db.runAsync('DELETE FROM products');
    await db.runAsync('DELETE FROM stores');
    await db.runAsync(`DELETE FROM settings WHERE key NOT IN (${UNSAVED_SETTINGS.map(() => '?').join(', ')})`, ...UNSAVED_SETTINGS);
    for (const [key, value] of Object.entries(data.settings)) {
      if (UNSAVED_SETTINGS.includes(key)) continue;
      await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', key, value);
    }
    for (const s of data.stores) {
      await db.runAsync(
        'INSERT INTO stores (id, name, name_key, note, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        s.id, s.name, s.name_key, s.note, s.archived, s.created_at, s.updated_at
      );
    }
    for (const p of data.products) {
      await db.runAsync(
        `INSERT INTO products (id, name, brand, variant, category, dimension, count_label, favorite, note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, p.name, p.brand, p.variant, p.category, p.dimension, p.count_label, p.favorite, p.note, p.created_at, p.updated_at
      );
    }
    for (const o of data.observations) {
      await db.runAsync(
        `INSERT INTO observations (id, product_id, store_id, observed_on, currency, pack_price_minor, paid_price_minor, pack_count,
           item_size, unit, deposit_minor, is_promo, deal_text, note, created_at, updated_at, minor_digits)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        o.id, o.product_id, o.store_id, o.observed_on, o.currency, o.pack_price_minor, o.paid_price_minor, o.pack_count,
        o.item_size, o.unit, o.deposit_minor, o.is_promo, o.deal_text, o.note, o.created_at, o.updated_at, o.minor_digits
      );
    }
    for (const b of data.barcodes ?? []) {
      await db.runAsync('INSERT INTO product_barcodes (code, product_id, created_at) VALUES (?, ?, ?)', b.code, b.product_id, b.created_at);
    }
    const broken = await db.getAllAsync('PRAGMA foreign_key_check');
    if (broken.length) throw new Error(`${broken.length} rows point at missing rows`);
  });
}

export type RestoreResult = { ok: true; counts: BackupCounts } | { ok: false; error: BackupError | { code: 'database'; detail: string } };

/** Restores an already validated backup (the UI shows `counts` and asks once before calling this). */
export const restoreBackup = queued(async function restoreBackup(db: Db, file: BackupFile): Promise<RestoreResult> {
  try {
    await replaceAllData(db, file.data);
    return { ok: true, counts: countsOf(file.data) };
  } catch (e) {
    return { ok: false, error: { code: 'database', detail: e instanceof Error ? e.message : String(e) } };
  }
});

/** Validate + restore in one call (tests, debug tools). Nothing changes unless it returns ok. */
export const restoreFromText = queued(async function restoreFromText(db: Db, text: string): Promise<RestoreResult> {
  const parsed = parseBackup(text, LATEST_VERSION);
  if (!parsed.ok) return parsed;
  return restoreBackup(db, parsed.file);
});
