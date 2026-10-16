// Stores (SPEC §4). Names are unique by `name_key` (trimmed, single-spaced, lower-cased). Deleting a store
// keeps its prices as "No store" (ON DELETE SET NULL, SPEC §7).
import type { StoreRecord } from '@/engine/backup';
import { cleanName, storeNameKey } from '@/engine/names';

import { queued } from './tx';
import type { Db } from './types';

export type StoreResult = { ok: true; id: number } | { ok: false; error: 'empty' | 'duplicate' | 'notFound'; id?: number };

export { cleanName, storeNameKey };

export const listStores = queued(async function listStores(db: Db, options: { includeArchived?: boolean } = {}): Promise<StoreRecord[]> {
  return db.getAllAsync<StoreRecord>(
    `SELECT * FROM stores ${options.includeArchived ? '' : 'WHERE archived = 0'} ORDER BY name_key, id`
  );
});

export const getStore = queued(async function getStore(db: Db, id: number): Promise<StoreRecord | null> {
  return db.getFirstAsync<StoreRecord>('SELECT * FROM stores WHERE id = ?', id);
});

export const findStoreByName = queued(async function findStoreByName(db: Db, name: string): Promise<StoreRecord | null> {
  return db.getFirstAsync<StoreRecord>('SELECT * FROM stores WHERE name_key = ?', storeNameKey(name));
});

export const createStore = queued(async function createStore(db: Db, name: string, now: string = new Date().toISOString()): Promise<StoreResult> {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: 'empty' };
  const existing = await findStoreByName(db, clean);
  if (existing) return { ok: false, error: 'duplicate', id: existing.id };
  const result = await db.runAsync(
    'INSERT INTO stores (name, name_key, archived, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
    clean,
    storeNameKey(clean),
    now,
    now
  );
  return { ok: true, id: result.lastInsertRowId };
});

/** "New store" in the add-price sheet: the existing store of that name (un-archived) or a new one. */
export const findOrCreateStore = queued(async function findOrCreateStore(db: Db, name: string, now: string = new Date().toISOString()): Promise<StoreResult> {
  const created = await createStore(db, name, now);
  if (created.ok || created.error !== 'duplicate' || created.id === undefined) return created;
  await db.runAsync('UPDATE stores SET archived = 0, updated_at = ? WHERE id = ? AND archived = 1', now, created.id);
  return { ok: true, id: created.id };
});

export const renameStore = queued(async function renameStore(db: Db, id: number, name: string, now: string = new Date().toISOString()): Promise<StoreResult> {
  const clean = cleanName(name);
  if (!clean) return { ok: false, error: 'empty' };
  const existing = await findStoreByName(db, clean);
  if (existing && existing.id !== id) return { ok: false, error: 'duplicate', id: existing.id };
  const result = await db.runAsync('UPDATE stores SET name = ?, name_key = ?, updated_at = ? WHERE id = ?', clean, storeNameKey(clean), now, id);
  return result.changes ? { ok: true, id } : { ok: false, error: 'notFound' };
});

export const setStoreArchived = queued(async function setStoreArchived(db: Db, id: number, archived: boolean, now: string = new Date().toISOString()): Promise<void> {
  await db.runAsync('UPDATE stores SET archived = ?, updated_at = ? WHERE id = ?', archived ? 1 : 0, now, id);
});

export const countStorePrices = queued(async function countStorePrices(db: Db, id: number): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM observations WHERE store_id = ?', id);
  return row?.n ?? 0;
});

/** Deletes the store; its prices stay, shown as "No store". Returns how many prices lost their store. */
export const deleteStore = queued(async function deleteStore(db: Db, id: number): Promise<number> {
  const count = await countStorePrices(db, id);
  await db.runAsync('DELETE FROM stores WHERE id = ?', id);
  return count;
});

/** Store chips in the add-price sheet: the stores of the most recently saved prices (not archived). */
export const recentStores = queued(async function recentStores(db: Db, limit: number = 4): Promise<StoreRecord[]> {
  return db.getAllAsync<StoreRecord>(
    `SELECT s.* FROM stores s JOIN observations o ON o.store_id = s.id
     WHERE s.archived = 0 GROUP BY s.id ORDER BY MAX(o.created_at) DESC, MAX(o.id) DESC LIMIT ?`,
    limit
  );
});
