/** @jest-environment node */
// Backup file validation (SPEC 6, D20, D36): every rule refuses a bad file without throwing.
import { seedData } from '@/debug/seeds';

import { BACKUP_VERSION, backupFileName, buildBackup, MAX_BACKUP_CHARS, parseBackup, serializeBackup, type BackupFile } from './backup';

const SCHEMA = 5; // BARCODES_SCHEMA: the files this suite builds carry the barcodes list
const good = (): BackupFile => buildBackup(seedData('s1'), SCHEMA, '2026-09-30T10:00:00.000Z');
const text = (f: unknown) => JSON.stringify(f);

/** A copy of the S1 backup with one change applied to its parsed JSON. */
function broken(change: (f: Record<string, any>) => void): string {
  const f = JSON.parse(serializeBackup(good()));
  change(f);
  return text(f);
}

describe('good files', () => {
  it('S1 parses with counts, and serialize -> parse is the identity', () => {
    const r = parseBackup(serializeBackup(good()), SCHEMA);
    expect(r).toEqual({ ok: true, file: good(), counts: { prices: 7, products: 2, stores: 3 } });
  });
  it('accepts a UTF-8 BOM, an empty book, and an older backupVersion/schema within range', () => {
    expect(parseBackup(`﻿${serializeBackup(good())}`, SCHEMA).ok).toBe(true);
    expect(parseBackup(serializeBackup(buildBackup(seedData('empty'), SCHEMA, 'x')), SCHEMA)).toMatchObject({ ok: true, counts: { prices: 0 } });
    expect(parseBackup(serializeBackup(good()), 6).ok).toBe(true);
  });
  it('big5000 validates', () => {
    expect(parseBackup(serializeBackup(buildBackup(seedData('big5000'), SCHEMA, 'x')), SCHEMA)).toMatchObject({ ok: true, counts: { prices: 5000, products: 200, stores: 8 } });
  });
  it('leaves the compare draft out, both when building and when reading', () => {
    const data = { ...seedData('s1'), settings: { compareDraft: '{"cards":[]}', theme: 'dark' } };
    expect(buildBackup(data, SCHEMA, 'x').data.settings).toEqual({ theme: 'dark' });
    const r = parseBackup(broken((f) => { f.data.settings.compareDraft = '{}'; }), SCHEMA);
    expect(r.ok && r.file.data.settings).toEqual({ currency: 'EUR', unitSystem: 'metric' });
  });
  it('file name', () => expect(backupFileName('2026-09-30')).toBe('price-book-backup-2026-09-30.json'));
});

describe('bad files are refused with a reason', () => {
  const half = serializeBackup(good());
  it.each([
    ['notJson', 'truncated', half.slice(0, half.length / 2)],
    ['notJson', 'empty', ''],
    ['notJson', 'binary', '\u0000\u0001PK\u0003\u0004'],
    ['notPriceBook', 'other app', text({ app: 'meter-tracker', backupVersion: 1, schemaVersion: 2, data: {} })],
    ['notPriceBook', 'array', '[]'],
    ['notPriceBook', 'null', 'null'],
    ['newerVersion', 'backupVersion + 1', broken((f) => { f.backupVersion = BACKUP_VERSION + 1; })],
    ['newerVersion', 'schemaVersion + 1', broken((f) => { f.schemaVersion = SCHEMA + 1; f.data.newTable = []; })],
    ['unsupported', 'schema 1', broken((f) => { f.schemaVersion = 1; })],
    ['shape', 'no backupVersion', broken((f) => { delete f.backupVersion; })],
    ['shape', 'unknown top-level field', broken((f) => { f.extra = 1; })],
    ['shape', 'missing data.stores', broken((f) => { delete f.data.stores; })],
    ['shape', 'stores not a list', broken((f) => { f.data.stores = {}; })],
    ['shape', 'unknown row field', broken((f) => { f.data.products[0].colour = 'red'; })],
    ['shape', 'missing row field', broken((f) => { delete f.data.observations[0].note; })],
    ['shape', 'fractional price', broken((f) => { f.data.observations[0].pack_price_minor = 2.49; })],
    ['shape', 'negative price', broken((f) => { f.data.observations[0].pack_price_minor = -1; })],
    ['shape', 'price as text', broken((f) => { f.data.observations[0].pack_price_minor = '249'; })],
    ['shape', 'negative paid', broken((f) => { f.data.observations[0].paid_price_minor = -1; })],
    ['shape', 'bad date', broken((f) => { f.data.observations[0].observed_on = '2026-02-30'; })],
    ['shape', 'lower-case currency', broken((f) => { f.data.observations[0].currency = 'eur'; })],
    ['shape', 'size not canonical', broken((f) => { f.data.observations[0].item_size = '500.0'; })],
    ['shape', 'size zero', broken((f) => { f.data.observations[0].item_size = '0'; })],
    ['shape', 'size with comma', broken((f) => { f.data.observations[0].item_size = '1,5'; })],
    ['shape', 'pack count 0', broken((f) => { f.data.observations[0].pack_count = 0; })],
    ['shape', 'pack count 1000', broken((f) => { f.data.observations[0].pack_count = 1000; })],
    ['shape', 'is_promo 2', broken((f) => { f.data.observations[0].is_promo = 2; })],
    ['shape', 'is_promo true', broken((f) => { f.data.observations[0].is_promo = true; })],
    ['shape', 'empty product name', broken((f) => { f.data.products[0].name = ' '; })],
    ['shape', 'unknown dimension', broken((f) => { f.data.products[0].dimension = 'weight'; })],
    ['shape', 'id 0', broken((f) => { f.data.stores[0].id = 0; })],
    ['shape', 'setting not text', broken((f) => { f.data.settings.currency = 1; })],
    ['shape', 'settings a list', broken((f) => { f.data.settings = []; })],
    ['duplicate', 'two prices with one id', broken((f) => { f.data.observations[1].id = f.data.observations[0].id; })],
    ['duplicate', 'two products with one id', broken((f) => { f.data.products[1].id = f.data.products[0].id; })],
    ['duplicate', 'two stores with one name', broken((f) => { f.data.stores[1].name = ' REWE  '; /* keys come from names (review #11) */ })],
    ['reference', 'missing product', broken((f) => { f.data.observations[0].product_id = 99; })],
    ['reference', 'missing store', broken((f) => { f.data.observations[0].store_id = 99; })],
    ['unitDimension', 'litres on coffee', broken((f) => { f.data.observations[0].unit = 'l'; })],
    ['unitDimension', 'unknown unit', broken((f) => { f.data.observations[0].unit = 'stone'; })],
  ])('%s: %s', (code, _label, input) => {
    const r = parseBackup(input, SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe(code);
      expect(r.error.detail.length).toBeGreaterThan(5);
    }
  });
  it('tooLarge: over 20 million characters is refused before parsing', () => {
    expect(parseBackup(' '.repeat(MAX_BACKUP_CHARS + 1), SCHEMA)).toMatchObject({ ok: false, error: { code: 'tooLarge' } });
  });
  it('not text at all', () => {
    expect(parseBackup(undefined, SCHEMA)).toMatchObject({ ok: false, error: { code: 'notJson' } });
  });
});

describe('review #8: backups hold only keypad-range values', () => {
  it.each([
    ['money above EUR 1 000 000.00', (f: Record<string, any>) => { f.data.observations[0].pack_price_minor = 100000001; }],
    ['paid price near 2^53', (f: Record<string, any>) => { f.data.observations[0].paid_price_minor = 9007199254740991; }],
    ['size of 10^12', (f: Record<string, any>) => { f.data.observations[0].item_size = '1000000000000'; }],
    ['size with 4 decimals', (f: Record<string, any>) => { f.data.observations[0].item_size = '0.0005'; }],
  ])('%s -> shape', (_label, change) => {
    expect(parseBackup(broken(change), SCHEMA)).toMatchObject({ ok: false, error: { code: 'shape' } });
  });
});
