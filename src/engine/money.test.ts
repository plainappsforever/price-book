/** @jest-environment node */
import rounding from '../../test/fixtures/engine/rounding.json';
import { checkCases, parseRat, type Case } from '../../test/engine-fixtures';
import {
  currencyExponent, currencyExponentFromTable, formatMinor, formatUnitPrice, minorToRat, percentOf, rescaleMinor, toMinor, unitPriceDecimals,
} from './money';
import { eq, fromDecimal, rat, roundHalfUp, toDecimalString, toSafeInt } from './rational';

const sections = rounding as unknown as Record<string, Case<any, any>[]>;

describe('fixture hygiene', () => {
  it.each(Object.keys(sections))('%s: every case has an id and a note, ids are unique', (name) => {
    checkCases(name, sections[name]);
  });
});

describe('roundHalfUp (rounding.json)', () => {
  it.each(sections.halfUp.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(roundHalfUp(rat(BigInt(c.input.n), BigInt(c.input.d))).toString()).toBe(c.expected);
  });
});

describe('toMinor: major units -> minor units half up (rounding.json)', () => {
  it.each(sections.toMinor.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(toMinor(fromDecimal(c.input.amountMajor)!, c.input.exponent).toString()).toBe(c.expected);
  });
});

describe('percentOf: one named percent step of the pipeline (rounding.json)', () => {
  it.each(sections.percentOf.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(percentOf(c.input.amountMinor, fromDecimal(c.input.pct)!).toString()).toBe(c.expected);
  });
  it('SPEC E4 end to end: 9.99 -25 % -15 % is 6.37, E5: 10.00 -20 % -10 % is 7.20', () => {
    const step = (amount: bigint, pct: string) => amount - percentOf(amount, fromDecimal(pct)!);
    expect(step(step(BigInt(999), '25'), '15')).toBe(BigInt(637));
    expect(step(step(BigInt(1000), '20'), '10')).toBe(BigInt(720));
  });
});

describe('toDecimalString (rounding.json)', () => {
  it.each(sections.toDecimalString.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(toDecimalString(parseRat(c.input.value), c.input.decimals)).toBe(c.expected);
  });
});

describe('float traps: price per 400 g, naive floats disagree with exact half up (rounding.json)', () => {
  it('has the cases from the spec research (E1: 9, 11, 15 and 189 cents among them)', () => {
    const prices = sections.floatTraps400g.map((c) => c.input.packPriceMinor);
    expect(prices).toEqual(expect.arrayContaining([9, 11, 15, 189]));
    expect(sections.floatTraps400g.length).toBeGreaterThanOrEqual(100);
  });
  it.each(sections.floatTraps400g.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const { packPriceMinor, sizeG } = c.input;
    // exact: P cents / size g x 1000 g per kg, rounded half up once
    const perKg = rat(packPriceMinor * 1000, sizeG);
    expect(roundHalfUp(perKg).toString()).toBe(String(c.expected));
  });
  it('the naive float formulas really do get at least one of these wrong (that is why D12 exists)', () => {
    const naive = (p: number) => Math.round((p / 100 / 0.4) * 100); // euros per 0.4 kg, back to cents
    expect(naive(189)).toBe(472); // exact answer is 473
  });
});

describe('currency exponent (rounding.json)', () => {
  it.each(sections.exponents.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(currencyExponent(c.input.currency)).toBe(c.expected);
  });
  it.each(sections.exponentFallbackTable.map((c) => [c.id, c] as const))('table %s', (_id, c) => {
    expect(currencyExponentFromTable(c.input.currency)).toBe(c.expected);
  });
  it('falls back to the table (default 2) for a code Intl rejects', () => {
    expect(currencyExponent('not-a-code')).toBe(2);
    expect(currencyExponent('')).toBe(2);
  });
});

describe('unit price display precision (rounding.json)', () => {
  it.each(sections.displayDecimals.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(unitPriceDecimals(c.input.valuesMinor.map(parseRat), c.input.exponent)).toBe(c.expected);
  });
});

describe('formatting (display only)', () => {
  it.each(sections.formatMinor.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(formatMinor(c.input.minor, c.input.currency, c.input.locale)).toBe(c.expected);
  });
  it.each(sections.formatUnitPrice.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(formatUnitPrice(parseRat(c.input.unitMinor), c.input.currency, c.input.decimals, c.input.locale)).toBe(c.expected);
  });
  it('formats bigint and number minor amounts the same', () => {
    expect(formatMinor(BigInt(473), 'EUR', 'en-US')).toBe(formatMinor(473, 'EUR', 'en-US'));
  });
});

describe('helpers', () => {
  it('minorToRat and toSafeInt round-trip an integer', () => {
    expect(eq(minorToRat(473), rat(473))).toBe(true);
    expect(toSafeInt(roundHalfUp(minorToRat(BigInt(473))))).toBe(473);
  });
});

describe('D41 / review #3: the exponent is fixed data (ISO 4217), never the device ICU', () => {
  // Typed from the ISO 4217 List One "Minor unit" column (2026), not from the table in money.ts.
  const ISO: [string, number][] = [
    ['HUF', 2], ['IDR', 2], ['IQD', 3], ['COP', 2], ['PKR', 2], ['LBP', 2], ['MGA', 2], ['ISK', 0], ['CLF', 4],
    ['EUR', 2], ['USD', 2], ['JPY', 0], ['KWD', 3], ['BHD', 3], ['KRW', 0], ['huf', 2],
  ];
  it.each(ISO)('%s has %i decimals', (code, digits) => {
    expect(currencyExponent(code)).toBe(digits);
  });
  it('does not change when Intl reports other digits (Node ICU gives HUF 0, IQD 0)', () => {
    const real = Intl.NumberFormat;
    const fake = function () {
      return { resolvedOptions: () => ({ maximumFractionDigits: 0 }), format: () => '?' };
    } as unknown as typeof Intl.NumberFormat;
    (Intl as { NumberFormat: typeof Intl.NumberFormat }).NumberFormat = fake;
    try {
      expect(['HUF', 'IDR', 'IQD', 'COP', 'EUR'].map(currencyExponent)).toEqual([2, 2, 3, 2, 2]);
    } finally {
      (Intl as { NumberFormat: typeof Intl.NumberFormat }).NumberFormat = real;
    }
  });
  it('rescaleMinor converts stored decimals exactly (half up when it shrinks)', () => {
    expect(rescaleMinor(1990, 0, 2)).toBe(199000);
    expect(rescaleMinor(1250, 3, 2)).toBe(125);
    expect(rescaleMinor(1255, 3, 2)).toBe(126);
    expect(rescaleMinor(499, 2, 2)).toBe(499);
  });
});
