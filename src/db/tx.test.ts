/** @jest-environment node */
// Review finding #1 (docs/REVIEW_ENGINE.md): every database access goes through one serialised queue, so a
// write made while a restore (or any transaction) runs can neither join it, nor be rolled back with it, nor
// read its uncommitted rows; a second transaction waits instead of failing. Probes (a)–(c) of the review are
// kept here as regression tests on the node:sqlite fake.
import * as fs from 'node:fs';
import * as path from 'node:path';

import { createTestDb } from '../../test/node-sqlite-db';
import { buildBackup } from '@/engine/backup';
import { loadSeed, seedData } from '@/debug/seeds';

import { LATEST_VERSION, migrate } from './migrations';
import { addObservation } from './observations';
import { createProduct } from './products';
import { exportBackupText, readAllData, restoreBackup, restoreFromText } from './restore';
import { getSetting, setSetting } from './settings';
import { createStore, findStoreByName } from './stores';
import { exclusive, inTransaction, isQueueHandle, withRead } from './tx';
import type { Db } from './types';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The fake with a macrotask pause before every statement (so other callers really get a chance to run), and
 *  an optional failure on the n-th statement matching `failOn`. */
function slowDb(options: { failOn?: RegExp; failAt?: number } = {}): Db & { statements: string[]; arm: () => void } {
  const inner = createTestDb();
  const statements: string[] = [];
  let hits = 0;
  let armed = false;
  const step = async (sql: string) => {
    await tick();
    statements.push(sql);
    if (armed && options.failOn && options.failOn.test(sql) && ++hits === options.failAt) throw new Error('injected failure');
  };
  return {
    statements,
    arm: () => {
      armed = true;
    },
    execAsync: async (sql: string) => (await step(sql), inner.execAsync(sql)),
    runAsync: (async (sql: string, ...params: never[]) => (await step(sql), inner.runAsync(sql, ...params))) as Db['runAsync'],
    getAllAsync: (async (sql: string, ...params: never[]) => (await step(sql), inner.getAllAsync(sql, ...params))) as Db['getAllAsync'],
    getFirstAsync: (async (sql: string, ...params: never[]) => (await step(sql), inner.getFirstAsync(sql, ...params))) as Db['getFirstAsync'],
  };
}

/** Migrated, seeded with s1, and only then armed to fail. */
async function ready(db: Db & { arm?: () => void }) {
  await migrate(db);
  await loadSeed(db, 's1');
  db.arm?.();
}

const s1File = () => buildBackup(seedData('s1'), LATEST_VERSION, '2026-09-30T10:00:00.000Z');

describe('probe (a): a write during a failing restore survives', () => {
  it('createStore and the draft save made during the restore are kept after its rollback', async () => {
    const db = slowDb({ failOn: /INSERT INTO observations/, failAt: 5 });
    await ready(db);
    const restore = restoreBackup(db, s1File());
    await tick();
    const draft = setSetting(db, 'compareDraft', '{"cards":[]}');
    const lidl = createStore(db, 'Lidl');
    const [r, , created] = await Promise.all([restore, draft, lidl]);
    expect(r.ok).toBe(false);
    expect(created.ok).toBe(true);
    expect(await findStoreByName(db, 'Lidl')).not.toBeNull();
    expect(await getSetting(db, 'compareDraft')).toBe('{"cards":[]}');
  });
});

describe('probe (b): a second transaction waits instead of throwing', () => {
  it('restore started while another transaction is open runs after it', async () => {
    const db = slowDb();
    await ready(db);
    const order: string[] = [];
    const first = inTransaction(db, async (db) => {
      order.push('A begin');
      await createStore(db, 'Netto');
      await tick();
      await tick();
      order.push('A end');
    });
    await tick();
    const second = restoreBackup(db, s1File()).then((r) => {
      order.push('B done');
      return r;
    });
    await first;
    expect((await second).ok).toBe(true);
    expect(order).toEqual(['A begin', 'A end', 'B done']);
  });
  it('two overlapping inTransaction calls run one after the other', async () => {
    const db = slowDb();
    await migrate(db);
    const before = db.statements.length;
    const log: string[] = [];
    const run = (name: string) =>
      inTransaction(db, async (db) => {
        log.push(`${name}+`);
        await setSetting(db, name, '1');
        await tick();
        log.push(`${name}-`);
      });
    await Promise.all([run('x'), run('y'), run('z')]);
    expect(log).toEqual(['x+', 'x-', 'y+', 'y-', 'z+', 'z-']);
    expect(db.statements.slice(before).filter((s) => s.startsWith('BEGIN')).length).toBe(3);
  });
});

describe('probe (c): no reads of uncommitted rows', () => {
  it('addObservation during a successful restore sees the restored product, not the half-deleted state', async () => {
    const db = slowDb();
    await ready(db);
    const restore = restoreBackup(db, s1File());
    await tick();
    const add = addObservation(
      db,
      { productId: 1, storeId: 1, observedOn: '2026-09-30', currency: 'EUR', packPriceMinor: 499, packCount: 1, itemSize: '1', unit: 'kg' },
      { today: '2026-09-30', now: '2026-09-30T12:00:00.000Z' }
    );
    expect((await restore).ok).toBe(true);
    expect((await add).ok).toBe(true);
    expect((await readAllData(db)).observations.length).toBe(8);
  });
  it('a read made during a restore returns the state after it', async () => {
    const db = slowDb();
    await ready(db);
    const restore = restoreBackup(db, s1File());
    await tick();
    const read = readAllData(db);
    await restore;
    expect((await read).observations.length).toBe(7);
  });
});

describe('withRead (mobile-starter template helper)', () => {
  it('a read made during a restore waits and sees the state after it', async () => {
    const db = slowDb();
    await ready(db);
    const restore = restoreBackup(db, s1File());
    await tick();
    const read = withRead(db, (tx) => tx.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM observations'));
    await restore;
    expect((await read)?.n).toBe(7);
  });
  it('joins the running unit when given its handle (no deadlock)', async () => {
    const db = slowDb();
    await ready(db);
    const n = await inTransaction(db, (tx) => withRead(tx, async (inner) => (await inner.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM stores'))?.n));
    expect(typeof n).toBe('number');
  });
});

describe('review #5: a backup is one consistent snapshot', () => {
  it('"add product Tea + first price" saved while the backup is read: the file still restores', async () => {
    const db = slowDb();
    await ready(db);
    const backup = exportBackupText(db, '2026-09-30T10:00:00.000Z');
    await tick();
    const save = inTransaction(db, async (db) => {
      const p = await createProduct(db, { name: 'Tea', dimension: 'mass' });
      if (!p.ok) throw new Error('product');
      return addObservation(
        db,
        { productId: p.id, storeId: 1, observedOn: '2026-09-30', currency: 'EUR', packPriceMinor: 299, packCount: 1, itemSize: '250', unit: 'g' },
        { today: '2026-09-30' }
      );
    });
    const [file] = await Promise.all([backup, save]);
    if (!file.ok) throw new Error(file.error.detail);
    const target = createTestDb();
    await migrate(target);
    expect(await restoreFromText(target, file.text)).toEqual({ ok: true, counts: { prices: 7, products: 2, stores: 3 } });
  });
  it('the five SELECTs (settings, stores, products, prices, barcodes) run inside one transaction', async () => {
    const db = slowDb();
    await ready(db);
    const before = db.statements.length;
    await readAllData(db);
    const run = db.statements.slice(before);
    expect(run[0]).toMatch(/^BEGIN/);
    expect(run.filter((s) => s.startsWith('SELECT')).length).toBe(5);
    expect(run[run.length - 1]).toMatch(/^COMMIT/);
  });
});

describe('queue rules', () => {
  it('a restore racing a draft save: the draft is never lost', async () => {
    for (const failAt of [1, 3, 7, 99]) {
      const db = slowDb({ failOn: /INSERT INTO observations/, failAt });
      await ready(db);
      const restore = restoreBackup(db, s1File());
      for (let i = 0; i < failAt; i++) await tick();
      await setSetting(db, 'compareDraft', `draft-${failAt}`);
      await restore;
      expect(await getSetting(db, 'compareDraft')).toBe(`draft-${failAt}`);
    }
  });
  it('nested transactions become savepoints: an inner failure undoes only the inner part', async () => {
    const db = createTestDb();
    await migrate(db);
    await inTransaction(db, async (db) => {
      await createStore(db, 'Outer');
      await expect(
        inTransaction(db, async (db) => {
          await createStore(db, 'Inner');
          throw new Error('inner');
        })
      ).rejects.toThrow('inner');
    });
    expect(await findStoreByName(db, 'Outer')).not.toBeNull();
    expect(await findStoreByName(db, 'Inner')).toBeNull();
  });
  it('a failing unit does not block the queue', async () => {
    const db = createTestDb();
    await migrate(db);
    await expect(exclusive(db, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect((await createStore(db, 'After')).ok).toBe(true);
  });
  it('a handle stops working when its unit ends', async () => {
    const db = createTestDb();
    await migrate(db);
    let kept: Db | null = null;
    await exclusive(db, async (h) => {
      kept = h;
      expect(isQueueHandle(h)).toBe(true);
    });
    expect(isQueueHandle(kept!)).toBe(false);
    expect(() => kept!.getAllAsync('SELECT 1')).toThrow(/after its queue slot ended/);
    await expect(createStore(kept!, 'Late')).rejects.toThrow(/after its queue slot ended/);
  });
  it('a product created inside a transaction is visible to a nested data function', async () => {
    const db = createTestDb();
    await migrate(db);
    const id = await inTransaction(db, async (db) => {
      const p = await createProduct(db, { name: 'Tea', dimension: 'mass' });
      if (!p.ok) throw new Error('product');
      const o = await addObservation(
        db,
        { productId: p.id, storeId: null, observedOn: '2026-09-30', currency: 'EUR', packPriceMinor: 299, packCount: 1, itemSize: '250', unit: 'g' },
        { today: '2026-09-30' }
      );
      return o.ok ? o.id : null;
    });
    expect(id).toBe(1);
  });
});

describe('every database access goes through the queue (source scan)', () => {
  const root = path.join(__dirname, '..');
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return files(p);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
    });
  it('src/db exports no plain async function taking a Db (each is queued or a transaction)', () => {
    const offenders: string[] = [];
    for (const f of files(path.join(root, 'db'))) {
      if (f.endsWith(`${path.sep}tx.ts`)) continue; // the queue itself
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^export (async )?function \w+\(db: Db/.test(line) && !/^\s+return (exclusive|inTransaction)\(db,/.test(lines[i + 1] ?? '')) {
          offenders.push(`${path.basename(f)}: ${line}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
  it('nothing outside src/db runs SQL on the connection directly', () => {
    const offenders = files(root)
      .filter((f) => !f.includes(`${path.sep}db${path.sep}`))
      .filter((f) => /\.(execAsync|runAsync|getAllAsync|getFirstAsync)\(/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
