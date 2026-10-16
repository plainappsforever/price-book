// Keypad strings -> exact numbers (SPEC §5.3, §7). Never throws on user input: every function returns
// { ok: true, value } or { ok: false, error }. Both "." and "," are accepted as the decimal separator;
// thousands separators are not (a second separator is an error).
import { pow10, toSafeInt } from './rational';

export type ParseError =
  | 'empty' // nothing typed yet
  | 'incomplete' // e.g. "6x" — waiting for more keys
  | 'malformed' // characters or structure that can never become valid
  | 'tooManyDecimals'
  | 'tooLarge'
  | 'zero' // size or quantity of 0 (price 0 is valid: "Free")
  | 'countRange'; // pack count outside 1..999

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: ParseError };

export const LIMITS = {
  /** Largest price in major units (1 000 000.00). */
  priceMajorMax: 1_000_000,
  /** Largest item size (in its own unit). */
  sizeMax: 1_000_000,
  /** Most decimals in a size. */
  sizeDecimalsMax: 3,
  packCountMax: 999,
  quantityMax: 999,
} as const;

export type ParsedSize = {
  /** Packs in a multipack ("6" in 6x330); 1 for a plain size. */
  packCount: number;
  /** Canonical decimal text of one item's size, e.g. "0.33", "500", "1.2". */
  itemSize: string;
};

const fail = (error: ParseError): { ok: false; error: ParseError } => ({ ok: false, error });

type Decimal = { int: string; frac: string };

/** Splits "12", "1.5", "1,5", ".5", "7." into digit strings; errors for anything else. */
function splitDecimal(text: string): ParseResult<Decimal> {
  if (text === '') return fail('empty');
  const m = /^(\d*)(?:[.,](\d*))?$/.exec(text);
  if (!m) return fail('malformed');
  const int = m[1] ?? '';
  const frac = m[2] ?? '';
  if (int === '' && frac === '') return fail('incomplete'); // just a separator
  return { ok: true, value: { int: int.replace(/^0+(?=\d)/, '') || '0', frac } };
}

function canonical(d: Decimal): string {
  const frac = d.frac.replace(/0+$/, '');
  return frac === '' ? d.int : `${d.int}.${frac}`;
}

/** True when the integer digits (leading zeros already stripped) exceed `max`. */
function intExceeds(int: string, max: number): boolean {
  const limit = String(max);
  return int.length > limit.length || (int.length === limit.length && int > limit);
}

/** Canonical decimal text ("2,50" -> "2.5", ".5" -> "0.5", "007" -> "7") or null if not a plain number. */
export function canonicalDecimal(text: string): string | null {
  const split = splitDecimal(text.trim());
  return split.ok ? canonical(split.value) : null;
}

/** Price in integer minor units. `exponent` = currency minor digits (2 for EUR, 0 for JPY, 3 for KWD). */
export function parsePrice(text: string, exponent: number): ParseResult<number> {
  const split = splitDecimal(text.trim());
  if (!split.ok) return split;
  const { int, frac } = split.value;
  if (frac.length > exponent) return fail('tooManyDecimals');
  if (intExceeds(int, LIMITS.priceMajorMax)) return fail('tooLarge');
  const minor = BigInt(int + frac.padEnd(exponent, '0'));
  if (minor > BigInt(LIMITS.priceMajorMax) * pow10(exponent)) return fail('tooLarge');
  return { ok: true, value: toSafeInt(minor) };
}

function parseItemSize(text: string): ParseResult<string> {
  const split = splitDecimal(text);
  if (!split.ok) return split;
  const { int, frac } = split.value;
  if (frac.length > LIMITS.sizeDecimalsMax) return fail('tooManyDecimals');
  if (intExceeds(int, LIMITS.sizeMax) || (int === String(LIMITS.sizeMax) && /[1-9]/.test(frac))) return fail('tooLarge');
  if (!/[1-9]/.test(int + frac)) return fail('zero');
  return { ok: true, value: canonical(split.value) };
}

/** True for one item's size as the keypad would store it: canonical text, > 0, <= LIMITS.sizeMax, <= 3 decimals (review #8). */
export function isKeypadItemSize(text: unknown): text is string {
  if (typeof text !== 'string') return false;
  const parsed = parseItemSize(text);
  return parsed.ok && parsed.value === text;
}

/** Whole number 1..max from digits only. */
function parseWhole(text: string, max: number, error: ParseError): ParseResult<number> {
  if (text === '') return fail('empty');
  if (!/^\d+$/.test(text)) return fail('malformed');
  const digits = text.replace(/^0+(?=\d)/, '');
  if (digits === '0') return fail(error);
  if (intExceeds(digits, max)) return fail(error === 'zero' ? 'tooLarge' : error);
  return { ok: true, value: toSafeInt(BigInt(digits)) };
}

/**
 * Size field: "500", "1.2", "6x330", "6×330", "6 x 0.33" (x, X or ×, spaces allowed around it).
 * The multipack count must be a whole number 1..999; the item size has at most 3 decimals and is > 0.
 */
export function parseSize(text: string): ParseResult<ParsedSize> {
  const cleaned = text.replace(/\s+/g, '');
  if (cleaned === '') return fail('empty');
  const parts = cleaned.split(/[x×X]/);
  if (parts.length > 2) return fail('malformed');
  if (parts.length === 1) {
    const size = parseItemSize(parts[0]);
    return size.ok ? { ok: true, value: { packCount: 1, itemSize: size.value } } : size;
  }
  const [countText, sizeText] = parts;
  if (countText === '') return fail('malformed');
  const count = parseWhole(countText, LIMITS.packCountMax, 'countRange');
  if (!count.ok) return count;
  if (sizeText === '') return fail('incomplete');
  const size = parseItemSize(sizeText);
  return size.ok ? { ok: true, value: { packCount: count.value, itemSize: size.value } } : size;
}

/** Quantity bought (packs): whole number 1..999. */
export function parseQuantity(text: string): ParseResult<number> {
  return parseWhole(text.trim(), LIMITS.quantityMax, 'zero');
}

// ---------- key-by-key input (the keypad) ----------

export type KeyField = 'price' | 'size' | 'quantity';
export const MULTIPLY_KEY = '×';

// While typing, these mean "keep going"; everything else is a hard refusal that leaves the text unchanged.
const PREFIX_OK: readonly ParseError[] = ['empty', 'incomplete', 'zero'];

function isAcceptablePrefix(field: KeyField, candidate: string, exponent: number): boolean {
  const result = field === 'price' ? parsePrice(candidate, exponent) : field === 'size' ? parseSize(candidate) : parseQuantity(candidate);
  return result.ok || PREFIX_OK.includes(result.error);
}

/**
 * Applies one key press to the field text. Over-limit or impossible keys are ignored (the same text is
 * returned), never an exception (SPEC §7). Keys: 0-9, "." and "," (either is a decimal separator; a
 * second one in the same number is ignored), "×" or "x" (size field only, once, after a whole number).
 */
export function appendKey(text: string, key: string, field: KeyField, exponent = 2): string {
  const lastStart = Math.max(text.lastIndexOf(MULTIPLY_KEY), text.toLowerCase().lastIndexOf('x')) + 1;
  const segment = text.slice(lastStart);
  let candidate: string;
  if (/^\d$/.test(key)) {
    if (segment === '0') {
      if (key === '0') return text; // "0" then "0" stays "0"
      candidate = text.slice(0, lastStart) + key; // "0" then "5" is "5"
    } else {
      candidate = text + key;
    }
  } else if (key === '.' || key === ',') {
    if (field === 'quantity' || (field === 'price' && exponent === 0)) return text;
    if (/[.,]/.test(segment)) return text;
    candidate = segment === '' ? `${text}0${key}` : text + key;
  } else if (key === MULTIPLY_KEY || key === 'x' || key === 'X') {
    if (field !== 'size' || text === '' || /[x×X]/.test(text) || /[.,]/.test(text) || segment === '') return text;
    candidate = text + MULTIPLY_KEY;
  } else {
    return text;
  }
  return isAcceptablePrefix(field, candidate, exponent) ? candidate : text;
}

/** Backspace: removes the last character. */
export function deleteLastKey(text: string): string {
  return text.slice(0, -1);
}
