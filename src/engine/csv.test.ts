/** @jest-environment node */
// CSV export (SPEC 6, A10): golden file for the S1 book, RFC 4180 round trip, formula guard.
import { expectGolden } from '../../test/golden';
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { listExportRows } from '@/db/observations';
import { loadSeed } from '@/debug/seeds';

import { buildPricesCsv, CSV_COLUMNS, csvField, csvFileName, csvSeparator, exactDecimal, guardFormula, unguardFormula, type CsvRow, type CsvSettings } from './csv';
import { rat } from './rational';

/** Minimal RFC 4180 reader for the round trip (CSV import itself is V1.5). */
function parseCsv(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else field += c;
  }
  if (field !== '' || row.length) throw new Error('CSV does not end with CRLF');
  return rows;
}

const ROW: CsvRow = {
  observedOn: '2026-09-01', product: 'Coffee', brand: null, variant: null, category: null, store: 'Rewe', currency: 'EUR',
  packPriceMinor: 249, paidPriceMinor: null, packCount: 1, itemSize: '500', unit: 'g', depositMinor: 0, isPromo: false,
  dealText: null, note: null,
};
const METRIC: CsvSettings = { measurementSystem: 'metric' };

async function s1Rows() {
  const db = createTestDb();
  await migrate(db);
  await loadSeed(db, 's1');
  return listExportRows(db);
}

describe('A10: S1 book', () => {
  it('matches the committed golden file byte for byte', async () => {
    expectGolden('s1-prices.csv', buildPricesCsv(await s1Rows(), METRIC));
  });
  it('round-trips: every field reads back as written (after removing the formula guard)', async () => {
    const rows = await s1Rows();
    const text = buildPricesCsv(rows, METRIC);
    expect(text.startsWith('﻿')).toBe(true);
    const parsed = parseCsv(text.slice(1));
    expect(parsed[0]).toEqual([...CSV_COLUMNS]);
    expect(parsed.length).toBe(rows.length + 1);
    parsed.slice(1).forEach((fields, i) => {
      const r = rows[i];
      const get = (name: (typeof CSV_COLUMNS)[number]) => unguardFormula(fields[CSV_COLUMNS.indexOf(name)]);
      expect(fields.length).toBe(CSV_COLUMNS.length);
      expect([get('date'), get('product'), get('brand'), get('variant'), get('category'), get('store'), get('deal'), get('note')])
        .toEqual([r.observedOn, r.product, r.brand ?? '', r.variant ?? '', r.category ?? '', r.store ?? '', r.dealText ?? '', r.note ?? '']);
      expect(get('item_size')).toBe(r.itemSize);
      expect(get('pack_count')).toBe(String(r.packCount));
      expect(get('promo')).toBe(r.isPromo ? 'yes' : 'no');
      expect(get('barcodes')).toBe(r.product === 'Coffee beans' ? '4001234567891' : '');
    });
    // the S1 promo row: "=promo week" is guarded, the deal text with comma and quotes is quoted
    expect(text).toContain(`,"Weekend offer, ""1 kg for 3.99""",'=promo week,4001234567891\r\n`);
  });
  it('unit prices are the SPEC S1 numbers per kg with one extra decimal', async () => {
    const parsed = parseCsv(buildPricesCsv(await s1Rows(), METRIC).slice(1));
    const coffee = parsed.slice(1).filter((f) => f[1] === 'Coffee beans').map((f) => f[CSV_COLUMNS.indexOf('unit_price')]);
    expect(coffee).toEqual(['4.980', '4.580', '3.990', '5.180', '4.980']);
  });
});

describe('fields', () => {
  it.each([
    ['=SUM(A1)', "'=SUM(A1)"], ['+49 170', "'+49 170"], ['-5', "'-5"], ['@cmd', "'@cmd"], ['\tx', "'\tx"], ['\rx', "'\rx"],
    ["'=x", "''=x"], ["'plain", "'plain"], ['plain', 'plain'], ['a=b', 'a=b'], ['', ''],
  ])('guard %j -> %j and back', (input, guarded) => {
    expect(guardFormula(input)).toBe(guarded);
    expect(unguardFormula(guarded)).toBe(input);
  });
  it('RFC 4180 quoting', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('=1,2')).toBe(`"'=1,2"`);
    expect(csvField('Käse')).toBe('Käse');
  });
  it('file name', () => expect(csvFileName('2026-09-30')).toBe('price-book-prices-2026-09-30.csv'));
  it('exact decimals for quantities', () => {
    expect(exactDecimal(rat(453592370, 1000000))).toBe('453.59237');
    expect(exactDecimal(rat(1980))).toBe('1980');
    expect(exactDecimal(rat(1, 1000))).toBe('0.001');
    expect(exactDecimal(rat(1, 3))).toBe('0.333333333');
  });
});

describe('rows', () => {
  const line = (r: CsvRow, settings = METRIC) => parseCsv(buildPricesCsv([r], settings).slice(1))[1];
  const col = (fields: string[], name: (typeof CSV_COLUMNS)[number]) => fields[CSV_COLUMNS.indexOf(name)];
  it('paid price drives the unit price, deposit is listed but excluded', () => {
    const f = line({ ...ROW, paidPriceMinor: 199, depositMinor: 25, isPromo: true });
    expect([col(f, 'pack_price'), col(f, 'paid_price'), col(f, 'unit_price'), col(f, 'deposit'), col(f, 'promo')]).toEqual(['2.49', '1.99', '3.980', '0.25', 'yes']);
  });
  it('multipack, base unit and basis follow the settings', () => {
    const f = line({ ...ROW, packCount: 6, itemSize: '0.33', unit: 'l', packPriceMinor: 499 }, { measurementSystem: 'us' });
    expect([col(f, 'total_quantity'), col(f, 'base_unit'), col(f, 'unit_price_basis')]).toEqual(['1980', 'ml', 'floz_us']);
    expect(col(f, 'unit_price')).toBe('0.075'); // 4.99 / 1980 ml x 29.5735295625 = 0.0745...
  });
  it('JPY and KWD use their own minor units', () => {
    expect(col(line({ ...ROW, currency: 'JPY', packPriceMinor: 398 }), 'pack_price')).toBe('398');
    expect(col(line({ ...ROW, currency: 'KWD', packPriceMinor: 1250 }), 'pack_price')).toBe('1.250');
  });
  it('a row with an unknown unit still exports, without unit price', () => {
    const f = line({ ...ROW, unit: 'stone' });
    expect([col(f, 'unit'), col(f, 'unit_price'), col(f, 'total_quantity')]).toEqual(['stone', '', '']);
  });
  it('barcodes (V1.5 P1, D63): last column, as printed (UPC-A with 12 digits), several separated by spaces', () => {
    expect(col(line(ROW), 'barcodes')).toBe('');
    expect(col(line({ ...ROW, barcodes: ['0036000291452', '73513537'] }), 'barcodes')).toBe('036000291452 73513537');
    expect(CSV_COLUMNS[CSV_COLUMNS.length - 1]).toBe('barcodes');
  });
  it('empty book: BOM, header, CRLF', () => {
    expect(buildPricesCsv([], METRIC)).toBe(`﻿${CSV_COLUMNS.join(',')}\r\n`);
  });
});

describe('D43 / review #7: number format of the phone (German Excel: ";" and decimal comma)', () => {
  const DE: CsvSettings = { measurementSystem: 'metric', decimalSeparator: ',' };
  it('S1 in the de-DE format matches its golden file byte for byte', async () => {
    expectGolden('s1-prices-de.csv', buildPricesCsv(await s1Rows(), DE));
  });
  it('";" between fields, "," in every number column, BOM and CRLF kept', async () => {
    const text = buildPricesCsv(await s1Rows(), DE);
    expect(text.startsWith('﻿date;product;brand;')).toBe(true);
    const parsed = parseCsv(text.slice(1), ';');
    expect(parsed[0]).toEqual([...CSV_COLUMNS]);
    const coffee = parsed.slice(1).filter((f) => f[1] === 'Coffee beans');
    expect(coffee.map((f) => f[CSV_COLUMNS.indexOf('unit_price')])).toEqual(['4,980', '4,580', '3,990', '5,180', '4,980']);
    expect(coffee[0][CSV_COLUMNS.indexOf('pack_price')]).toBe('2,49');
    // text keeps its own commas and is quoted only for its quotes; dates untouched
    expect(text).toContain(`;"Weekend offer, ""1 kg for 3.99""";'=promo week;4001234567891\r\n`);
    expect(coffee[0][0]).toBe('2026-01-10');
  });
  it('every number column and only those change', () => {
    const f = parseCsv(buildPricesCsv([{ ...ROW, packCount: 6, itemSize: '0.33', unit: 'l', paidPriceMinor: 449, depositMinor: 150 }], DE).slice(1), ';')[1];
    const col = (name: (typeof CSV_COLUMNS)[number]) => f[CSV_COLUMNS.indexOf(name)];
    expect([col('pack_price'), col('paid_price'), col('item_size'), col('total_quantity'), col('unit_price'), col('deposit')])
      .toEqual(['2,49', '4,49', '0,33', '1980', '2,268', '1,50']);
    expect([col('pack_count'), col('unit'), col('unit_price_basis'), col('promo')]).toEqual(['6', 'l', 'l', 'no']);
  });
  it('a ";" in text is quoted; the separator follows the decimal separator', () => {
    expect(csvField('a;b', ';')).toBe('"a;b"');
    expect(csvField('a,b', ';')).toBe('a,b');
    expect([csvSeparator(','), csvSeparator('.'), csvSeparator()]).toEqual([';', ',', ',']);
  });
});
