import { exclusive, inTransaction } from './tx';
import type { Db } from './types';

// Append-only. Never edit a migration that has shipped; add a new one instead.
const MIGRATIONS: string[] = [
  `CREATE TABLE items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  // 2 — Price Book data model (SPEC 4, D18): replaces the template demo table.
  `DROP TABLE items;
   CREATE TABLE stores (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     name_key TEXT NOT NULL UNIQUE,
     note TEXT,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at TEXT,
     updated_at TEXT
   );
   CREATE TABLE products (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     brand TEXT,
     variant TEXT,
     category TEXT,
     dimension TEXT NOT NULL CHECK (dimension IN ('mass', 'volume', 'count', 'length')),
     count_label TEXT,
     favorite INTEGER NOT NULL DEFAULT 0,
     note TEXT,
     created_at TEXT,
     updated_at TEXT
   );
   CREATE TABLE observations (
     id INTEGER PRIMARY KEY,
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
     observed_on TEXT NOT NULL,
     currency TEXT NOT NULL,
     pack_price_minor INTEGER NOT NULL CHECK (pack_price_minor >= 0),
     paid_price_minor INTEGER,
     pack_count INTEGER NOT NULL DEFAULT 1 CHECK (pack_count BETWEEN 1 AND 999),
     item_size TEXT NOT NULL,
     unit TEXT NOT NULL,
     deposit_minor INTEGER NOT NULL DEFAULT 0,
     is_promo INTEGER NOT NULL DEFAULT 0,
     deal_text TEXT,
     note TEXT,
     created_at TEXT,
     updated_at TEXT
   );
   CREATE INDEX observations_product_date ON observations (product_id, observed_on);`,
  // 3 — P3.5 (D41, review #3): each price stores the decimals its minor units were saved with, so its meaning
  // never depends on the device's currency data. Existing rows get the ISO 4217 value (frozen copy of the
  // table in src/engine/money.ts as of 2026-10-01; never edit this list, add a migration instead).
  `ALTER TABLE observations ADD COLUMN minor_digits INTEGER NOT NULL DEFAULT 2 CHECK (minor_digits BETWEEN 0 AND 4);
   UPDATE observations SET minor_digits = CASE
     WHEN currency IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 0
     WHEN currency IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 3
     WHEN currency IN ('CLF', 'UYW') THEN 4
     ELSE 2 END;`,
  // 4 — v1.1 (REVIEW_V1 S2): products get a stable random identity. Row ids are reused by SQLite (a deleted newest
  // product's id goes to the next new one) and a restore brings other products under the same ids, so a Compare card
  // linked by id alone could judge or save against a different product. Every product row gets a 128-bit random
  // `uid` (existing rows now, every later insert by the trigger, including restore and seeds); links store id + uid.
  // The uid is local to this phone: backups do not carry it, so a restore gives every product a new one.
  `ALTER TABLE products ADD COLUMN uid TEXT;
   UPDATE products SET uid = lower(hex(randomblob(16)));
   CREATE UNIQUE INDEX products_uid ON products (uid);
   CREATE TRIGGER products_uid_on_insert AFTER INSERT ON products FOR EACH ROW WHEN NEW.uid IS NULL
   BEGIN
     UPDATE products SET uid = lower(hex(randomblob(16))) WHERE id = NEW.id;
   END;`,
  // 5 — V1.5 P1 (R2/R9, D63): barcodes are the user's own product IDs. A product can have several (other pack sizes,
  // promotional packs, regional codes); a code belongs to at most one product. Codes are canonical text from
  // src/engine/barcode.ts (13 digits, or 8 for EAN-8); deleting a product deletes its codes.
  `CREATE TABLE product_barcodes (
     code TEXT PRIMARY KEY NOT NULL CHECK (length(code) IN (8, 13) AND code NOT GLOB '*[^0-9]*'),
     product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
     created_at TEXT
   );
   CREATE INDEX product_barcodes_product ON product_barcodes (product_id);`,
];

export const LATEST_VERSION = MIGRATIONS.length;

/**
 * Brings the database to LATEST_VERSION as one queue unit, one transaction per migration (a failure rolls that migration
 * back and rethrows). Also switches foreign keys on for this connection: SQLite has them off by default
 * and the cascade / set-null deletes of migration 2 depend on them.
 */
export function migrate(db: Db, target = MIGRATIONS.length): Promise<void> {
  return exclusive(db, async (db) => {
    await db.execAsync('PRAGMA foreign_keys = ON;');
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    let version = row?.user_version ?? 0;
    while (version < target) {
      const sql = `${MIGRATIONS[version]} PRAGMA user_version = ${version + 1};`;
      await inTransaction(db, (db) => db.execAsync(sql));
      version++;
    }
  });
}
