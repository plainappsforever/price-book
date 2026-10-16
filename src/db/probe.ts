// Device probe for the D39 queue (P4): the P3.5 review probes (a)–(c), "seed while the draft autosaves", the
// consistent backup snapshot, foreign keys, and migration 3 on an existing schema-2 database — run against REAL
// expo-sqlite by the dev-only route debug/db-probe (on a separate probe database, never the user's), and against
// node:sqlite in Jest (probe.test.ts), so both drivers run the same code.
import { loadSeed, seedData } from '@/debug/seeds';
import { buildBackup, parseBackup } from '@/engine/backup';

import { LATEST_VERSION, migrate } from './migrations';
import { addObservation } from './observations';
import { createProduct, deleteProduct } from './products';
import { exportBackupText, readAllData, restoreBackup } from './restore';
import { getSetting, setSetting } from './settings';
import { createStore, deleteStore, findStoreByName } from './stores';
import { exclusive, inTransaction, queued } from './tx';
import type { Db } from './types';

export type ProbeResult = { name: string; ok: boolean; detail: string; ms: number };
export type DbHealth = { userVersion: number; foreignKeys: number; hasMinorDigits: boolean; hasProductUid: boolean; hasBarcodes: boolean };

/** user_version, PRAGMA foreign_keys, the migration-3 and -4 columns and the migration-5 table of a connection (main database or probe). */
export const dbHealth = queued(async function dbHealth(db: Db): Promise<DbHealth> {
  const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const fk = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
  const cols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(observations)');
  const productCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(products)');
  const barcodeCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(product_barcodes)');
  return {
    userVersion: v?.user_version ?? -1,
    foreignKeys: fk?.foreign_keys ?? -1,
    hasMinorDigits: cols.some((c) => c.name === 'minor_digits'),
    hasProductUid: productCols.some((c) => c.name === 'uid'),
    hasBarcodes: barcodeCols.some((c) => c.name === 'code'),
  };
});

/** A connection that yields to the event loop before every statement, so other callers really interleave. */
export function slowed(inner: Db): Db {
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    execAsync: async (sql: string) => (await pause(), inner.execAsync(sql)),
    runAsync: (async (sql: string, ...params: never[]) => (await pause(), inner.runAsync(sql, ...params))) as Db['runAsync'],
    getAllAsync: (async (sql: string, ...params: never[]) => (await pause(), inner.getAllAsync(sql, ...params))) as Db['getAllAsync'],
    getFirstAsync: (async (sql: string, ...params: never[]) => (await pause(), inner.getFirstAsync(sql, ...params))) as Db['getFirstAsync'],
  };
}

/** Probe database only: back to an empty file at user_version 0. */
function resetProbeDatabase(db: Db): Promise<void> {
  return exclusive(db, (db) =>
    db.execAsync(
      `PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS product_barcodes; DROP TABLE IF EXISTS observations; DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS stores;
       DROP TABLE IF EXISTS settings; DROP TABLE IF EXISTS items; PRAGMA user_version = 0;`
    )
  );
}

function expect(condition: boolean, what: string): void {
  if (!condition) throw new Error(what);
}

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const TODAY = '2026-09-30';

/**
 * Runs every probe in order. `open()` returns a connection to the probe database; calling it again must return a
 * NEW connection to the same file (the device closes and reopens it), used for the migration-3 upgrade.
 */
export async function runDbProbes(open: () => Promise<Db>, options: { slow?: boolean } = {}): Promise<ProbeResult[]> {
  const wrap = (d: Db) => (options.slow ? slowed(d) : d);
  let db = wrap(await open());
  const results: ProbeResult[] = [];
  const probe = async (name: string, body: () => Promise<string>) => {
    const started = Date.now();
    try {
      results.push({ name, ok: true, detail: await body(), ms: Date.now() - started });
    } catch (e) {
      results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - started });
    }
  };
  const fresh = async (seed: 'empty' | 's1' = 's1') => {
    await resetProbeDatabase(db);
    await migrate(db);
    await loadSeed(db, seed);
  };

  await probe('fresh install: migrations 1-3, foreign keys on', async () => {
    await resetProbeDatabase(db);
    await migrate(db);
    const h = await dbHealth(db);
    expect(h.userVersion === LATEST_VERSION && h.foreignKeys === 1 && h.hasMinorDigits && h.hasProductUid && h.hasBarcodes, JSON.stringify(h));
    return `user_version ${h.userVersion}, foreign_keys ${h.foreignKeys}`;
  });

  await probe('migration 3 on an existing schema-2 database (reopened)', async () => {
    await resetProbeDatabase(db);
    await migrate(db, 2);
    const before = await dbHealth(db);
    expect(before.userVersion === 2 && !before.hasMinorDigits, `before: ${JSON.stringify(before)}`);
    await inTransaction(db, async (db) => {
      await db.runAsync("INSERT INTO products (id, name, dimension) VALUES (1, 'Rice', 'mass')");
      const rows: [number, string, number][] = [[1, 'EUR', 249], [2, 'JPY', 500], [3, 'KWD', 1250], [4, 'IQD', 2500], [5, 'HUF', 49900]];
      for (const [id, currency, minor] of rows) {
        await db.runAsync(
          "INSERT INTO observations (id, product_id, observed_on, currency, pack_price_minor, item_size, unit) VALUES (?, 1, '2026-09-01', ?, ?, '1', 'kg')",
          id, currency, minor
        );
      }
    });
    db = wrap(await open()); // a new connection to the same file, like the next app start after an update
    await migrate(db);
    const after = await dbHealth(db);
    const digits = await exclusive(db, (db) => db.getAllAsync<{ currency: string; minor_digits: number }>('SELECT currency, minor_digits FROM observations ORDER BY id'));
    const got = digits.map((r) => `${r.currency}=${r.minor_digits}`).join(' ');
    expect(after.userVersion === LATEST_VERSION && after.foreignKeys === 1, `after: ${JSON.stringify(after)}`);
    expect(got === 'EUR=2 JPY=0 KWD=3 IQD=3 HUF=2', got);
    return `v2 -> v${after.userVersion}; ${got}`;
  });

  await probe('(a) failing restore + draft save + new store: both writes kept', async () => {
    await fresh();
    const good = seedData('s1');
    const bad = buildBackup({ ...good, observations: [...good.observations, { ...good.observations[0], id: 99, product_id: 999 }] }, LATEST_VERSION, '2026-09-30T10:00:00.000Z');
    const restore = restoreBackup(db, bad);
    const draft = setSetting(db, 'compareDraft', 'probe-a');
    const store = createStore(db, 'Lidl');
    const [r, , s] = await Promise.all([restore, draft, store]);
    expect(!r.ok, 'the broken restore succeeded');
    expect(s.ok && (await findStoreByName(db, 'Lidl')) !== null, 'store lost');
    expect((await getSetting(db, 'compareDraft')) === 'probe-a', 'draft lost');
    const data = await readAllData(db);
    expect(data.observations.length === 7, `prices ${data.observations.length}`);
    return 'restore rolled back; draft and store kept; 7 prices';
  });

  await probe('(b) a restore started inside another transaction waits for it', async () => {
    await fresh();
    const order: string[] = [];
    const first = inTransaction(db, async (db) => {
      order.push('A+');
      await createStore(db, 'Netto');
      await later(5);
      order.push('A-');
    });
    const second = restoreBackup(db, buildBackup(seedData('s1'), LATEST_VERSION, '2026-09-30T10:00:00.000Z')).then((r) => {
      order.push('B');
      return r;
    });
    await first;
    const r = await second;
    expect(r.ok, r.ok ? '' : JSON.stringify(r.error));
    expect(order.join(' ') === 'A+ A- B', order.join(' '));
    const all = await Promise.all(['x', 'y', 'z'].map((k) => inTransaction(db, async (db) => (await setSetting(db, `probe.${k}`, k), k))));
    expect(all.join('') === 'xyz', all.join(''));
    return 'A+ A- B; three overlapping transactions ran in turn';
  });

  await probe('(c) a read during a restore returns the state after it', async () => {
    await fresh('empty');
    const restore = restoreBackup(db, buildBackup(seedData('s1'), LATEST_VERSION, '2026-09-30T10:00:00.000Z'));
    const read = readAllData(db);
    await restore;
    const n = (await read).observations.length;
    expect(n === 7, `read saw ${n} prices`);
    return 'read saw 7 prices';
  });

  await probe('seed while the compare draft autosaves (12 rounds)', async () => {
    await fresh();
    for (let i = 0; i < 12; i++) {
      const seed = loadSeed(db, i % 2 ? 's1' : 'empty');
      await later(i % 4);
      await setSetting(db, 'compareDraft', `draft-${i}`);
      await seed;
      const kept = await getSetting(db, 'compareDraft');
      expect(kept === `draft-${i}`, `round ${i}: ${kept}`);
    }
    return 'draft kept in 12 of 12 rounds';
  });

  await probe('backup read while a product + price is saved: file restores', async () => {
    await fresh();
    const backup = exportBackupText(db, '2026-09-30T10:00:00.000Z');
    const save = inTransaction(db, async (db) => {
      const p = await createProduct(db, { name: 'Tea', dimension: 'mass' });
      if (!p.ok) throw new Error('product');
      return addObservation(db, { productId: p.id, storeId: 1, observedOn: TODAY, currency: 'EUR', packPriceMinor: 299, packCount: 1, itemSize: '250', unit: 'g' }, { today: TODAY });
    });
    const [file, saved] = await Promise.all([backup, save]);
    expect(saved.ok, 'save failed');
    expect(file.ok, file.ok ? '' : file.error.detail);
    const parsed = file.ok ? parseBackup(file.text, LATEST_VERSION) : null;
    expect(!!parsed && parsed.ok, 'file does not parse');
    return `snapshot ${parsed && parsed.ok ? parsed.counts.prices : '?'} prices, valid`;
  });

  await probe('foreign keys act: product delete cascades, store delete keeps prices', async () => {
    await fresh();
    await deleteProduct(db, 2);
    await deleteStore(db, 3);
    const data = await readAllData(db);
    const noStore = data.observations.filter((o) => o.store_id === null).length;
    expect(data.observations.length === 5 && noStore === 1, `prices ${data.observations.length}, no store ${noStore}`);
    return '5 prices left, 1 without a store';
  });

  return results;
}
