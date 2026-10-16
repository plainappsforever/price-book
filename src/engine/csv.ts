// CSV export of every saved price (SPEC §6, D20, D37, D43). Pure: rows in, file text out. RFC 4180 quoting,
// UTF-8 BOM, CRLF line ends, and a leading ' on any field that a spreadsheet would run as a formula. The number
// format follows the phone (D43, review #7): "." decimals with "," between fields, or — when the phone's decimal
// separator is "," (de-DE …) — "," decimals with ";" between fields, which is what German Excel opens into
// columns. Money and unit prices are exact decimal text (no floating point, A3).
import { div, fromDecimal, mul, pow10, rat, toDecimalString, type Rat } from './rational';
import { basisFor, type EngineSettings } from './deals';
import { displayBarcode } from './barcode';
import { currencyExponent } from './money';
import { BASE_UNIT, basisQuantity, dimensionOf, isUnitId, packQuantity } from './units';

export const CSV_COLUMNS = [
  'date', 'product', 'brand', 'variant', 'category', 'store', 'currency', 'pack_price', 'paid_price', 'pack_count', 'item_size',
  'unit', 'total_quantity', 'base_unit', 'unit_price', 'unit_price_basis', 'deposit', 'promo', 'deal', 'note', 'barcodes',
] as const;

/** One price joined with its product and store (src/db/observations.ts `listExportRows`). */
export type CsvRow = {
  observedOn: string;
  product: string;
  brand: string | null;
  variant: string | null;
  category: string | null;
  store: string | null;
  currency: string;
  packPriceMinor: number;
  paidPriceMinor: number | null;
  packCount: number;
  itemSize: string;
  unit: string;
  depositMinor: number;
  isPromo: boolean;
  dealText: string | null;
  note: string | null;
  /** Decimals the row's minor units were saved with (D41); default: the currency's ISO 4217 exponent. */
  minorDigits?: number;
  /** The product's barcodes (canonical, D63), written as printed (UPC-A with 12 digits), separated by spaces. */
  barcodes?: readonly string[];
};

export type CsvSettings = Pick<EngineSettings, 'measurementSystem' | 'bases'> & {
  /** The phone's decimal separator (settings key `decimalSeparator`); "," switches to ";"-separated fields. Default ".". */
  decimalSeparator?: '.' | ',';
};

/** Field separator for a decimal separator: ";" when numbers use "," (D43). */
export function csvSeparator(decimalSeparator: '.' | ',' = '.'): ',' | ';' {
  return decimalSeparator === ',' ? ';' : ',';
}

export function csvFileName(date: string): string {
  return `price-book-prices-${date}.csv`;
}

const FORMULA_START = /^'*[=+\-@\t\r]/;

/**
 * Formula-injection guard: text a spreadsheet would treat as a formula (= + - @, and tab / CR per OWASP)
 * gets one leading apostrophe. Text that already starts with apostrophes before such a character gets one
 * more, so `unguardFormula` can always undo it exactly.
 */
export function guardFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}
export function unguardFormula(text: string): string {
  return text.startsWith("'") && FORMULA_START.test(text.slice(1)) ? text.slice(1) : text;
}

/** RFC 4180: quote a field holding a quote, the field separator, CR or LF; double inner quotes. */
export function csvField(value: string, separator: ',' | ';' = ','): string {
  const guarded = guardFormula(value);
  const needsQuotes = guarded.includes('"') || guarded.includes(separator) || /[\r\n]/.test(guarded);
  return needsQuotes ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** Columns that hold numbers (written with the phone's decimal separator). */
const NUMBER_COLUMNS: readonly (typeof CSV_COLUMNS)[number][] = ['pack_price', 'paid_price', 'item_size', 'total_quantity', 'unit_price', 'deposit'];

/** Exact decimal text of a terminating fraction (every unit factor is one); else rounded to 9 places. */
export function exactDecimal(value: Rat): string {
  let d = value.d;
  let places = 0;
  const two = BigInt(2);
  const five = BigInt(5);
  const zero = BigInt(0);
  while (d % two === zero || d % five === zero) {
    d = d % two === zero ? d / two : d / five;
    places++;
  }
  if (d !== BigInt(1)) return toDecimalString(value, 9);
  const text = toDecimalString(value, places);
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function money(minor: number, exponent: number): string {
  return toDecimalString(rat(minor, pow10(exponent)), exponent);
}

function rowFields(r: CsvRow, settings: CsvSettings): string[] {
  const exponent = r.minorDigits ?? currencyExponent(r.currency);
  let totalQuantity = '';
  let baseUnit = '';
  let unitPrice = '';
  let basis = '';
  if (isUnitId(r.unit)) {
    const dimension = dimensionOf(r.unit);
    const itemSize = fromDecimal(r.itemSize);
    if (itemSize && itemSize.n > BigInt(0)) {
      const quantity = packQuantity(r.packCount, itemSize, r.unit);
      basis = basisFor(dimension, { ...settings, currency: r.currency, taxMode: 'include' });
      totalQuantity = exactDecimal(quantity);
      baseUnit = BASE_UNIT[dimension];
      const perBasis = mul(div(rat(r.paidPriceMinor ?? r.packPriceMinor), quantity), basisQuantity(dimension, basis)!);
      // major units with one decimal more than the currency (the most precise on-screen display, SPEC 5.1)
      unitPrice = toDecimalString(div(perBasis, rat(pow10(exponent))), exponent + 1);
    }
  }
  return [
    r.observedOn, r.product, r.brand ?? '', r.variant ?? '', r.category ?? '', r.store ?? '', r.currency,
    money(r.packPriceMinor, exponent), r.paidPriceMinor === null ? '' : money(r.paidPriceMinor, exponent),
    String(r.packCount), r.itemSize, r.unit, totalQuantity, baseUnit, unitPrice, basis,
    money(r.depositMinor, exponent), r.isPromo ? 'yes' : 'no', r.dealText ?? '', r.note ?? '',
    (r.barcodes ?? []).map(displayBarcode).join(' '),
  ];
}

/** The whole CSV file text (BOM + header + one line per price, CRLF after every line). */
export function buildPricesCsv(rows: readonly CsvRow[], settings: CsvSettings): string {
  const decimal = settings.decimalSeparator === ',' ? ',' : '.';
  const sep = csvSeparator(decimal);
  const numberAt = new Set(NUMBER_COLUMNS.map((c) => CSV_COLUMNS.indexOf(c)));
  const line = (fields: string[]) =>
    fields.map((f, i) => csvField(decimal === ',' && numberAt.has(i) ? f.replace('.', ',') : f, sep)).join(sep);
  const lines = [CSV_COLUMNS.join(sep), ...rows.map((r) => line(rowFields(r, settings)))];
  return `﻿${lines.join('\r\n')}\r\n`;
}
