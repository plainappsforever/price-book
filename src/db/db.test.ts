/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { LATEST_VERSION, migrate } from './migrations';
import { getThemePreference, setThemePreference } from './settings';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

async function tables(db: Awaited<ReturnType<typeof freshDb>>) {
  const rows = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY name");
  return rows.map((r) => r.name);
}

const PRODUCT = "INSERT INTO products (id, name, dimension) VALUES (1, 'Coffee', 'mass')";
const STORE = "INSERT INTO stores (id, name, name_key) VALUES (1, 'Rewe', 'rewe')";
const PRICE = `INSERT INTO observations (id, product_id, store_id, observed_on, currency, pack_price_minor, item_size, unit)
               VALUES (1, 1, 1, '2026-09-01', 'EUR', 249, '500', 'g')`;

describe('migrations', () => {
  it('reaches the latest version and is safe to run again', async () => {
    const db = await freshDb();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_VERSION);
    expect(LATEST_VERSION).toBe(5);
  });

  it('A11: fresh install has the Price Book schema and no demo table', async () => {
    const db = await freshDb();
    expect(await tables(db)).toEqual([
      'observations', 'observations_product_date', 'product_barcodes', 'product_barcodes_product', 'products', 'products_uid', 'settings', 'stores',
    ]);
  });

  it('A11: upgrade from migration 1 drops items, keeps settings and reaches the same schema', async () => {
    const db = createTestDb();
    await migrate(db, 1);
    await db.runAsync("INSERT INTO items (title, created_at) VALUES ('demo', 1)");
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
    await migrate(db);
    const fresh = await freshDb();
    expect(await tables(db)).toEqual(await tables(fresh));
    const schema = (d: typeof db) => d.getAllAsync("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name");
    expect(await schema(db)).toEqual(await schema(fresh));
    expect(await getThemePreference(db)).toBe('dark');
  });

  it('a failing migration rolls back and leaves the version unchanged', async () => {
    const db = createTestDb();
    await migrate(db, 1);
    await db.execAsync('CREATE TABLE stores (x INTEGER)'); // collides with migration 2
    await expect(migrate(db)).rejects.toThrow();
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(1);
    expect(await tables(db)).toContain('items'); // DROP TABLE items was rolled back too
  });

  it('migration 3 (D41): every price gets the ISO 4217 decimals of its currency; new rows are checked', async () => {
    const db = createTestDb();
    await migrate(db, 2);
    await db.execAsync(`${PRODUCT}; ${STORE};`);
    const rows: [number, string][] = [[1, 'EUR'], [2, 'JPY'], [3, 'KWD'], [4, 'HUF'], [5, 'CLF'], [6, 'IQD'], [7, 'ISK']];
    for (const [id, currency] of rows) {
      await db.runAsync(
        "INSERT INTO observations (id, product_id, observed_on, currency, pack_price_minor, item_size, unit) VALUES (?, 1, '2026-09-01', ?, 100, '1', 'kg')",
        id, currency
      );
    }
    await migrate(db);
    const got = await db.getAllAsync<{ currency: string; minor_digits: number }>('SELECT currency, minor_digits FROM observations ORDER BY id');
    expect(got.map((r) => [r.currency, r.minor_digits])).toEqual([['EUR', 2], ['JPY', 0], ['KWD', 3], ['HUF', 2], ['CLF', 4], ['IQD', 3], ['ISK', 0]]);
    await expect(db.runAsync('UPDATE observations SET minor_digits = 5 WHERE id = 1')).rejects.toThrow(/CHECK/);
  });

  it('migration 4 (v1.1, REVIEW_V1 S2): every product gets a random uid that a reused row id never repeats', async () => {
    const db = createTestDb();
    await migrate(db, 3);
    await db.execAsync(`${PRODUCT}; INSERT INTO products (id, name, dimension) VALUES (2, 'Butter', 'mass'); ${STORE}; ${PRICE};`);
    await migrate(db);
    const before = await db.getAllAsync<{ id: number; uid: string }>('SELECT id, uid FROM products ORDER BY id');
    expect(before.map((r) => r.id)).toEqual([1, 2]);
    for (const r of before) expect(r.uid).toMatch(/^[0-9a-f]{32}$/);
    expect(before[0].uid).not.toBe(before[1].uid);
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM observations')).toEqual({ n: 1 }); // prices untouched
    // The review probe P3: delete the newest product, create another one -> SQLite reuses id 2, the uid differs.
    await db.runAsync('DELETE FROM products WHERE id = 2');
    await db.runAsync("INSERT INTO products (name, dimension) VALUES ('Cheese', 'mass')");
    const cheese = await db.getFirstAsync<{ id: number; uid: string }>("SELECT id, uid FROM products WHERE name = 'Cheese'");
    expect(cheese?.id).toBe(2);
    expect(cheese?.uid).toMatch(/^[0-9a-f]{32}$/);
    expect(cheese?.uid).not.toBe(before[1].uid);
    // An insert that names its uid keeps it; uids are unique.
    await db.runAsync("INSERT INTO products (name, dimension, uid) VALUES ('Tea', 'mass', 'abc')");
    expect(await db.getFirstAsync("SELECT uid FROM products WHERE name = 'Tea'")).toEqual({ uid: 'abc' });
    await expect(db.runAsync("INSERT INTO products (name, dimension, uid) VALUES ('Tea 2', 'mass', 'abc')")).rejects.toThrow(/UNIQUE/);
  });

  it('migration 5 (V1.5 P1, D63): product barcodes; one code one product, many codes per product, cascade on delete', async () => {
    const db = createTestDb();
    await migrate(db, 4);
    await db.execAsync(`${PRODUCT}; INSERT INTO products (id, name, dimension) VALUES (2, 'Butter', 'mass'); ${STORE}; ${PRICE};`);
    const before = await db.getAllAsync('SELECT id, uid FROM products ORDER BY id');
    await migrate(db);
    expect(await db.getAllAsync('SELECT id, uid FROM products ORDER BY id')).toEqual(before); // products and prices untouched
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM observations')).toEqual({ n: 1 });
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM product_barcodes')).toEqual({ n: 0 });
    const add = (code: string, productId: number) => db.runAsync('INSERT INTO product_barcodes (code, product_id) VALUES (?, ?)', code, productId);
    await add('4001234567891', 1);
    await add('0036000291452', 1); // a second pack of the same product
    await add('73513537', 2);
    await expect(add('4001234567891', 2)).rejects.toThrow(/UNIQUE|PRIMARY/); // one code, one product
    await expect(add('4001234', 1)).rejects.toThrow(/CHECK/); // 7 digits
    await expect(add('400123456789a', 1)).rejects.toThrow(/CHECK/);
    await expect(add('12345678', 9)).rejects.toThrow(/FOREIGN KEY/);
    await db.runAsync('DELETE FROM products WHERE id = 1');
    expect(await db.getAllAsync('SELECT code, product_id FROM product_barcodes')).toEqual([{ code: '73513537', product_id: 2 }]);
  });

  it('switches foreign keys on', async () => {
    const db = await freshDb();
    expect(await db.getFirstAsync('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });

  it('deleting a product deletes its prices (cascade); deleting a store keeps them as "No store" (set null)', async () => {
    const db = await freshDb();
    await db.execAsync(`${PRODUCT}; ${STORE}; ${PRICE};`);
    await db.runAsync('DELETE FROM stores WHERE id = 1');
    expect(await db.getFirstAsync('SELECT store_id FROM observations WHERE id = 1')).toEqual({ store_id: null });
    await db.runAsync('DELETE FROM products WHERE id = 1');
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM observations')).toEqual({ n: 0 });
  });

  it('enforces the SPEC 4 constraints', async () => {
    const db = await freshDb();
    await db.execAsync(`${PRODUCT}; ${STORE};`);
    await expect(db.runAsync("INSERT INTO products (name, dimension) VALUES ('X', 'weight')")).rejects.toThrow(/CHECK/);
    await expect(db.runAsync("INSERT INTO stores (name, name_key) VALUES ('REWE', 'rewe')")).rejects.toThrow(/UNIQUE/);
    await expect(db.execAsync(PRICE.replace('249', '-1'))).rejects.toThrow(/CHECK/);
    await expect(db.runAsync(
      "INSERT INTO observations (product_id, observed_on, currency, pack_price_minor, pack_count, item_size, unit) VALUES (1, '2026-09-01', 'EUR', 1, 1000, '1', 'g')"
    )).rejects.toThrow(/CHECK/);
    await expect(db.execAsync(PRICE.replace('VALUES (1, 1, 1', 'VALUES (1, 9, 1'))).rejects.toThrow(/FOREIGN KEY/);
  });
});

describe('theme preference', () => {
  it('defaults to system, persists changes, and ignores invalid stored values', async () => {
    const db = await freshDb();
    expect(await getThemePreference(db)).toBe('system');

    await setThemePreference(db, 'dark');
    expect(await getThemePreference(db)).toBe('dark');

    await db.runAsync("UPDATE settings SET value = 'purple' WHERE key = 'theme'");
    expect(await getThemePreference(db)).toBe('system');
  });
});
