// Currency helpers (SPEC §5.1). Money is integer minor units; every rounding is half up. Floating point
// is allowed ONLY inside the display-only block at the bottom (formatting through Intl).
import { cmp, mul, pow10, rat, roundHalfUp, toSafeInt, type Rat } from './rational';

/**
 * ISO 4217 minor units (List One, the "Minor unit" column): every active code whose exponent is not 2. This table —
 * never the device's Intl/ICU data — decides what an integer in the database means (D41, review #3): ICU builds
 * disagree for HUF, IDR, PKR, COP, IQD, LBP, MGA …, which would silently shift a whole history by 100x after a
 * restore on another phone, an OS update, or Hermes vs Node. Codes not listed (and unknown codes) have 2.
 */
const ISO_4217_MINOR_UNITS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0,
  XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
};

/** Minor-unit exponent of an ISO 4217 code from the fixed table (JPY 0, KWD 3, CLF 4, otherwise 2). Never from Intl. */
export function currencyExponent(currency: string): number {
  return ISO_4217_MINOR_UNITS[currency.toUpperCase()] ?? 2;
}
/** Same as `currencyExponent` (kept for the P1 tests' name). */
export const currencyExponentFromTable = currencyExponent;

/** An integer amount stored with `fromDigits` decimals, in minor units of `toDigits` decimals (exact; half up when it shrinks). */
export function rescaleMinor(minor: number, fromDigits: number, toDigits: number): number {
  if (fromDigits === toDigits) return minor;
  if (fromDigits < toDigits) return toSafeInt(BigInt(minor) * pow10(toDigits - fromDigits));
  return toSafeInt(roundHalfUp(rat(minor, pow10(fromDigits - toDigits))));
}

/** Integer minor units (number or bigint) as an exact rational. */
export function minorToRat(minor: number | bigint): Rat {
  return rat(minor);
}

/** Exact amount in MAJOR units (e.g. 4.725) -> minor units, half up (-> 473 for exponent 2). */
export function toMinor(amountMajor: Rat, exponent: number): bigint {
  return roundHalfUp(mul(amountMajor, rat(pow10(exponent))));
}

/** round(amount x pct/100) in minor units: one named percent step of the pipeline (§5.4). */
export function percentOf(amountMinor: bigint | number, pct: Rat): bigint {
  return roundHalfUp(mul(mul(rat(amountMinor), pct), rat(1, 100)));
}

/** Decimals for unit prices shown together: exponent if every value >= 1 currency unit, else exponent + 1. */
export function unitPriceDecimals(valuesMinor: readonly Rat[], exponent: number): number {
  const oneUnit = rat(pow10(exponent));
  return valuesMinor.every((v) => cmp(v, oneUnit) >= 0) ? exponent : exponent + 1;
}

// @display-only-start
// Everything below turns already-rounded integers into text through Intl. Floats are tolerated here
// because the value is k / 10^decimals with k an exact integer, which always formats back to k.
export function formatScaled(scaled: bigint, decimals: number, currency: string, locale?: string): string {
  const value = Number(scaled) / Number(pow10(decimals));
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** Pack/till amount: integer minor units -> "€4.73". */
export function formatMinor(minor: number | bigint, currency: string, locale?: string): string {
  const exponent = currencyExponent(currency);
  return formatScaled(typeof minor === 'bigint' ? minor : BigInt(minor), exponent, currency, locale);
}

/** Exact unit price (in minor units per basis) rounded half up to `decimals` for display only. */
export function formatUnitPrice(unitMinor: Rat, currency: string, decimals: number, locale?: string): string {
  const exponent = currencyExponent(currency);
  const scaled = roundHalfUp(mul(unitMinor, rat(pow10(decimals), pow10(exponent))));
  return formatScaled(scaled, decimals, currency, locale);
}
// @display-only-end
