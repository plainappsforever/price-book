/** @jest-environment node */
// A9: backup -> wipe -> restore reproduces the database row by row; broken files and a failure in the
// middle of the restore transaction leave the data exactly as it was (SPEC 6, D20).
import * as fs from 'node:fs';
import * as path from 'node:path';

import { expectGolden } from '../../test/golden';
import { createTestDb } from '../../test/node-sqlite-db';
import { parseBackup, serializeBackup, type ObservationRecord } from '@/engine/backup';
import { buildPricesCsv, type CsvRow } from '@/engine/csv';
import { loadSeed } from '@/debug/seeds';

import { LATEST_VERSION, migrate } from './migrations';
import { countData, exportBackup, exportBackupText, readAllData, restoreBackup, restoreFromText } from './restore';
import { toPriceObservation } from './observations';
import { setSetting } from './settings';
import { createStore } from './stores';
import type { Db } from './types';

async function seeded(name: 's1' | 'big5000' | 'empty' = 's1') {
  const db = createTestDb();
  await migrate(db);
  await setSetting(db, 'theme', 'dark');
  await loadSeed(db, name);
  return db;
}

/**
 * Every row of every table, as SQLite returns them (the A9 row-by-row comparison) — except the products' local uid
 * (migration 4), which a restore renews on purpose (checked separately below).
 */
async function dump(db: Db) {
  const out: Record<string, unknown[]> = {};
  for (const t of ['settings', 'stores', 'products', 'observations', 'product_barcodes']) {
    const order = t === 'settings' ? 'key' : t === 'product_barcodes' ? 'code' : 'id';
    const rows = await db.getAllAsync<Record<string, unknown>>(`SELECT * FROM ${t} ORDER BY ${order}`);
    out[t] = t === 'products' ? rows.map(({ uid: _uid, ...rest }) => rest) : rows;
  }
  return out;
}

describe('v1.1 (REVIEW_V1 S2): a restore gives every product a new uid, and the backup does not carry it', () => {
  it('same ids, new uids; no "uid" field in the file', async () => {
    const db = await seeded('s1');
    const uids = async () => (await db.getAllAsync<{ id: number; uid: string }>('SELECT id, uid FROM products ORDER BY id'));
    const before = await uids();
    const file = await exportBackupText(db);
    if (!file.ok) throw new Error('export');
    expect(file.text).not.toContain('"uid"');
    expect(await restoreFromText(db, file.text)).toMatchObject({ ok: true });
    const after = await uids();
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    for (let i = 0; i < after.length; i++) {
      expect(after[i].uid).toMatch(/^[0-9a-f]{32}$/);
      expect(after[i].uid).not.toBe(before[i].uid);
    }
  });
});

describe('REVIEW_V1 S7: the restore confirmation counts what is on the phone now', () => {
  it('countData', async () => {
    expect(await countData(await seeded('s1'))).toEqual({ prices: 7, products: 2, stores: 3 });
    expect(await countData(await seeded('empty'))).toEqual({ prices: 0, products: 0, stores: 0 });
  });
});

describe('A9 round trip', () => {
  it.each(['s1', 'big5000'] as const)('%s: back up -> wipe -> restore gives an identical database', async (name) => {
    const db = await seeded(name);
    const before = await dump(db);
    const file = serializeBackup(await exportBackup(db, '2026-09-30T10:00:00.000Z'));
    await loadSeed(db, 'empty');
    expect((await dump(db)).observations).toEqual([]);
    const r = await restoreFromText(db, file);
    expect(r.ok).toBe(true);
    expect(await dump(db)).toEqual(before);
  });
  it('restores into a brand-new install too', async () => {
    const source = await seeded('s1');
    const target = createTestDb();
    await migrate(target);
    const r = await restoreFromText(target, serializeBackup(await exportBackup(source)));
    expect(r).toEqual({ ok: true, counts: { prices: 7, products: 2, stores: 3 } });
    expect(await dump(target)).toEqual(await dump(source));
  });
  it('the compare draft of this phone is neither backed up nor overwritten', async () => {
    const db = await seeded('s1');
    await setSetting(db, 'compareDraft', '{"mine":1}');
    const file = await exportBackup(db);
    expect(file.data.settings.compareDraft).toBeUndefined();
    await setSetting(db, 'compareDraft', '{"later":1}');
    await restoreBackup(db, file);
    expect((await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'compareDraft'"))?.value).toBe('{"later":1}');
  });
  it('S1 backup matches the committed golden file', async () => {
    const db = await seeded('s1');
    await db.runAsync("DELETE FROM settings WHERE key = 'theme'");
    expectGolden('s1-backup.json', serializeBackup(await exportBackup(db, '2026-09-30T10:00:00.000Z')));
  });
  it('backups carry the schema version', async () => {
    expect((await exportBackup(await seeded())).schemaVersion).toBe(LATEST_VERSION);
  });
});

describe('a broken file changes nothing', () => {
  const s1Text = async () => serializeBackup(await exportBackup(await seeded('s1')));
  const cases: [string, (t: string) => string][] = [
    ['cut off half way', (t) => t.slice(0, t.length / 2)],
    ['made by a newer app', (t) => t.replace(`"schemaVersion": ${LATEST_VERSION}`, `"schemaVersion": ${LATEST_VERSION + 1}`)],
    ['a price of a product that is not in the file', (t) => t.replace('"product_id": 2', '"product_id": 42')],
    ['litres on a mass product', (t) => t.replace('"unit": "kg"', '"unit": "l"')],
  ];
  it.each(cases)('%s', async (_label, breakIt) => {
    const db = await seeded('big5000'); // different data than the file, so a partial restore would show
    const before = await dump(db);
    const text = breakIt(await s1Text());
    expect(text).not.toBe(await s1Text());
    const r = await restoreFromText(db, text);
    expect(r.ok).toBe(false);
    expect(await dump(db)).toEqual(before);
  });

  it('a failure in the middle of the transaction rolls everything back', async () => {
    const db = await seeded('big5000');
    const before = await dump(db);
    const parsed = parseBackup(await s1Text(), LATEST_VERSION);
    if (!parsed.ok) throw new Error('S1 should parse');
    let inserts = 0;
    const failing: Db = {
      ...db,
      runAsync: (async (sql: string, ...params: never[]) => {
        if (sql.includes('INSERT INTO observations') && ++inserts === 5) throw new Error('disk full (injected)');
        return (db.runAsync as (s: string, ...p: never[]) => Promise<unknown>)(sql, ...params);
      }) as Db['runAsync'],
    };
    const r = await restoreBackup(failing, parsed.file);
    expect(r).toEqual({ ok: false, error: { code: 'database', detail: 'disk full (injected)' } });
    expect(inserts).toBe(5); // it really was half-way through
    expect(await dump(db)).toEqual(before);
  });

  it('a file that passes validation but breaks a constraint rolls back', async () => {
    const db = await seeded('s1');
    const before = await dump(db);
    const parsed = parseBackup(await s1Text(), LATEST_VERSION);
    if (!parsed.ok) throw new Error('S1 should parse');
    // bypass the validator (parsed object edited afterwards) so the database's CHECK refuses row 4
    parsed.file.data.observations[3] = { ...parsed.file.data.observations[3], pack_count: 0 };
    const r = await restoreBackup(db, parsed.file);
    expect(r.ok).toBe(false);
    expect(await dump(db)).toEqual(before);
  });
});

describe('data read', () => {
  it('readAllData returns rows in id order', async () => {
    const data = await readAllData(await seeded('s1'));
    expect(data.observations.map((o) => o.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(data.settings).toEqual({ currency: 'EUR', theme: 'dark', unitSystem: 'metric' });
  });
});

describe('D41 / review #3 and #12: price decimals travel with the data; schema-2 files stay restorable', () => {
  // Frozen copy of the P3 golden (schema 2, before minor_digits). Never regenerate this file.
  const schema2 = fs.readFileSync(path.join(__dirname, '../../test/fixtures/backup/schema2-s1.json'), 'utf8');

  it('the frozen schema-2 S1 backup restores, and every price gets its ISO 4217 decimals', async () => {
    expect(schema2).toContain('"schemaVersion": 2');
    expect(schema2).not.toContain('minor_digits');
    const db = createTestDb();
    await migrate(db);
    expect(await restoreFromText(db, schema2)).toEqual({ ok: true, counts: { prices: 7, products: 2, stores: 3 } });
    const rows = await db.getAllAsync<{ minor_digits: number }>('SELECT minor_digits FROM observations');
    expect(rows.map((r) => r.minor_digits)).toEqual([2, 2, 2, 2, 2, 2, 2]);
    const fresh = await dump(await seeded('s1'));
    const restored = await dump(db);
    for (const t of ['stores', 'products', 'observations']) expect(restored[t]).toEqual(fresh[t]);
  });
  it('a schema-2 JPY price is read as 0 decimals', () => {
    const jpy = schema2.replace(/"currency": "EUR"/g, '"currency": "JPY"');
    const r = parseBackup(jpy, LATEST_VERSION);
    expect(r.ok && r.file.data.observations.map((o) => o.minor_digits)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
  it('a schema-3 file must carry minor_digits 0-4', async () => {
    const s1 = serializeBackup(await exportBackup(await seeded('s1')));
    expect(parseBackup(s1.replace('"minor_digits": 2', '"minor_digits": 7'), LATEST_VERSION)).toMatchObject({ ok: false, error: { code: 'shape' } });
    expect(parseBackup(s1.replace(/,\n\s*"minor_digits": 2/, ''), LATEST_VERSION)).toMatchObject({ ok: false, error: { code: 'shape' } });
  });
  it('a price saved with other decimals than today\'s table is rescaled when read, never reinterpreted', async () => {
    const db = await seeded('s1');
    // e.g. a HUF price written by an app whose table said 0 decimals: 1990 Ft stored as 1990 with minor_digits 0
    await db.runAsync("UPDATE observations SET currency = 'HUF', pack_price_minor = 1990, minor_digits = 0 WHERE id = 1");
    const row = (await readAllData(db)).observations[0];
    expect(toPriceObservation(row).packPriceMinor).toBe(199000);
    expect(buildPricesCsv([{ ...exportRow(row), minorDigits: row.minor_digits }], {}).split('\r\n')[1]).toContain(',HUF,1990,');
  });
});

function exportRow(r: ObservationRecord): CsvRow {
  return {
    observedOn: r.observed_on, product: 'x', brand: null, variant: null, category: null, store: null, currency: r.currency,
    packPriceMinor: r.pack_price_minor, paidPriceMinor: r.paid_price_minor, packCount: r.pack_count, itemSize: r.item_size, unit: r.unit,
    depositMinor: r.deposit_minor, isPromo: r.is_promo === 1, dealText: null, note: null,
  };
}

describe('review #11: store name keys are recomputed on restore', () => {
  it('a file whose "aldi" key was edited to "zzz" still blocks a second Aldi after the restore', async () => {
    const text = serializeBackup(await exportBackup(await seeded('s1'))).replace('"name_key": "aldi"', '"name_key": "zzz"');
    expect(text).toContain('"zzz"');
    const db = createTestDb();
    await migrate(db);
    expect((await restoreFromText(db, text)).ok).toBe(true);
    expect(await createStore(db, 'Aldi')).toEqual({ ok: false, error: 'duplicate', id: 2 });
  });
  it('two stores whose names differ only in case and spaces are refused as duplicates', async () => {
    const text = serializeBackup(await exportBackup(await seeded('s1'))).replace('"name": "Aldi"', '"name": "  REWE "');
    expect(parseBackup(text, LATEST_VERSION)).toMatchObject({ ok: false, error: { code: 'duplicate' } });
  });
});

describe('V1.5 P1 (D63): barcodes travel with the backup; schema-4 files stay restorable', () => {
  // Frozen copy of the v1.1 golden (schema 4, before barcodes). Never regenerate this file.
  const schema4 = fs.readFileSync(path.join(__dirname, '../../test/fixtures/backup/schema4-s1.json'), 'utf8');

  it('the S1 barcode survives backup -> wipe -> restore', async () => {
    const text = serializeBackup(await exportBackup(await seeded('s1')));
    expect(text).toContain('"code": "4001234567891"');
    const db = await seeded('empty');
    expect(await restoreFromText(db, text)).toMatchObject({ ok: true });
    expect(await db.getAllAsync('SELECT code, product_id FROM product_barcodes')).toEqual([{ code: '4001234567891', product_id: 1 }]);
  });
  it('the frozen schema-4 S1 backup restores with no barcodes and replaces the ones on the phone', async () => {
    expect(schema4).toContain('"schemaVersion": 4');
    expect(schema4).not.toContain('barcodes');
    const db = await seeded('s1');
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM product_barcodes')).toEqual({ n: 1 });
    expect(await restoreFromText(db, schema4)).toEqual({ ok: true, counts: { prices: 7, products: 2, stores: 3 } });
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM product_barcodes')).toEqual({ n: 0 });
    const fresh = await dump(await seeded('s1'));
    const restored = await dump(db);
    for (const t of ['stores', 'products', 'observations']) expect(restored[t]).toEqual(fresh[t]);
  });
  it.each([
    ['a code with a wrong check digit', (t: string) => t.replace('"4001234567891"', '"4001234567892"'), 'shape'],
    ['a 12-digit (not stored) form', (t: string) => t.replace('"4001234567891"', '"036000291452"'), 'shape'],
    ['a number instead of text', (t: string) => t.replace('"4001234567891"', '4001234567891'), 'shape'],
    ['a code of a missing product', (t: string) => t.replace('"product_id": 1,\n    "created_at": "2026-01-01', '"product_id": 9,\n    "created_at": "2026-01-01'), 'reference'],
    ['the same code twice', (t: string) => t.replace(/("barcodes": \[\n)(\s*\{[^}]*\})/, '$1$2,\n$2'), 'duplicate'],
    ['schema 5 without the barcodes list', (t: string) => t.replace(/,\n\s*"barcodes": \[[\s\S]*?\]\n/, '\n'), 'shape'],
    ['an unknown field on a barcode', (t: string) => t.replace('"code": "4001234567891",', '"code": "4001234567891", "extra": 1,'), 'shape'],
  ])('refuses %s', async (_label, change, code) => {
    const text = serializeBackup(await exportBackup(await seeded('s1')));
    const bad = change(text);
    expect(bad).not.toBe(text);
    expect(parseBackup(bad, LATEST_VERSION)).toMatchObject({ ok: false, error: { code } });
  });
  it('a schema-4 file with a barcodes list is refused (strict shape per schema)', () => {
    const bad = schema4.replace('"observations": [', '"barcodes": [],\n  "observations": [');
    expect(parseBackup(bad, LATEST_VERSION)).toMatchObject({ ok: false, error: { code: 'shape' } });
  });
  it('a phone on schema 4 (v1.1) refuses a schema-5 file as newer', async () => {
    const text = serializeBackup(await exportBackup(await seeded('s1')));
    expect(parseBackup(text, 4)).toMatchObject({ ok: false, error: { code: 'newerVersion' } });
  });
});
