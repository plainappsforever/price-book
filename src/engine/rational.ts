// Exact arithmetic for money and unit prices (D12). No floating point anywhere in this file.
// Hermes-safe on purpose: no BigInt literals (`1n`) and no `**` (a Babel transform may rewrite it to
// Math.pow, which throws on BigInt); constants come from BigInt() and powers from a loop.

export type Rat = { readonly n: bigint; readonly d: bigint };

const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);
const B10 = BigInt(10);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export const ZERO: Rat = { n: B0, d: B1 };
export const ONE: Rat = { n: B1, d: B1 };

function abs(a: bigint): bigint {
  return a < B0 ? -a : a;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== B0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** 10^exp as a BigInt (exp is a small non-negative integer). */
export function pow10(exp: number): bigint {
  if (!Number.isInteger(exp) || exp < 0) throw new RangeError(`pow10 needs a non-negative integer, got ${exp}`);
  let result = B1;
  for (let i = 0; i < exp; i++) result *= B10;
  return result;
}

/** Normalised fraction: denominator > 0, lowest terms. Accepts bigints or safe integers. */
export function rat(n: bigint | number, d: bigint | number = B1): Rat {
  const num = typeof n === 'bigint' ? n : BigInt(n);
  const den = typeof d === 'bigint' ? d : BigInt(d);
  if (den === B0) throw new RangeError('Division by zero');
  const g = gcd(num, den);
  const sign = den < B0 ? -B1 : B1;
  return { n: (sign * num) / g, d: (sign * den) / g };
}

/**
 * Exact value of a plain decimal string such as "2.49", "0.33", "500", ".5", "7." (point only; the
 * keypad parser normalises a comma first). Returns null for anything else, including signs and exponents.
 */
export function fromDecimal(text: string): Rat | null {
  const m = /^(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[1] === '' && (m[2] === undefined || m[2] === ''))) return null;
  const whole = m[1] ?? '';
  const frac = m[2] ?? '';
  return rat(BigInt(whole + frac), pow10(frac.length));
}

export function add(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d);
}
export function sub(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d - b.n * a.d, a.d * b.d);
}
export function mul(a: Rat, b: Rat): Rat {
  return rat(a.n * b.n, a.d * b.d);
}
export function div(a: Rat, b: Rat): Rat {
  if (b.n === B0) throw new RangeError('Division by zero');
  return rat(a.n * b.d, a.d * b.n);
}
export function neg(a: Rat): Rat {
  return { n: -a.n, d: a.d };
}
export function cmp(a: Rat, b: Rat): -1 | 0 | 1 {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
}
export function eq(a: Rat, b: Rat): boolean {
  return cmp(a, b) === 0;
}
export function isZero(a: Rat): boolean {
  return a.n === B0;
}
export function sign(a: Rat): -1 | 0 | 1 {
  return a.n < B0 ? -1 : a.n > B0 ? 1 : 0;
}
export function min(a: Rat, b: Rat): Rat {
  return cmp(a, b) <= 0 ? a : b;
}
export function max(a: Rat, b: Rat): Rat {
  return cmp(a, b) >= 0 ? a : b;
}

/** Largest integer <= a. */
export function floor(a: Rat): bigint {
  const q = a.n / a.d; // truncates toward zero
  return a.n < B0 && q * a.d !== a.n ? q - B1 : q;
}

/** Round half up (0.5 -> 1). Negative values round half away from zero (-0.5 -> -1), so the rule is symmetric. */
export function roundHalfUp(a: Rat): bigint {
  if (a.n < B0) return -roundHalfUp(neg(a));
  return (B2 * a.n + a.d) / (B2 * a.d);
}

/** Decimal string of `a` rounded half up to `decimals` places, e.g. (4.725, 2) -> "4.73". */
export function toDecimalString(a: Rat, decimals: number): string {
  const scaled = roundHalfUp(mul(a, rat(pow10(decimals))));
  const negative = scaled < B0;
  const digits = abs(scaled).toString().padStart(decimals + 1, '0');
  const body = decimals === 0 ? digits : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
  return negative ? `-${body}` : body;
}

/**
 * bigint -> JS integer saturated at +-max (max must be a safe integer). For values handed to the UI that can grow
 * without bound on extreme but accepted input (review #4): never throws; the caller flags `capped` for the UI.
 */
export function clampToInt(value: bigint, max: number): number {
  const limit = BigInt(max);
  if (value > limit) return max;
  if (value < -limit) return -max;
  return toSafeInt(value);
}

/** Exact bigint -> safe JS integer (throws if it does not fit); used where SQLite/JSON needs a number. */
export function toSafeInt(value: bigint): number {
  if (abs(value) > MAX_SAFE) throw new RangeError('Integer is too large for a JavaScript number');
  return parseInt(value.toString(), 10);
}
