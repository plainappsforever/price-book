// Retail barcodes as the user's own product ID (V1.5 phase 1, R2/R9, D63). Pure, no React Native imports.
// A scan or typed number becomes ONE canonical text so that every way of reading the same pack finds the same
// product: EAN-13, UPC-A (= EAN-13 with a leading 0, which is how iOS reports it) and UPC-E (expanded to UPC-A)
// are stored as 13 digits, EAN-8 as 8 digits. Every code must pass the GS1 mod-10 check digit.
// Eight digits can be an EAN-8 or a UPC-E; both readings that pass their check are returned as `candidates`
// (lookups try all of them), and the scanner's type decides which one is stored.
// Oracle: test/oracle/gen_barcode_fixtures.py -> test/fixtures/engine/barcode.json.

export type BarcodeKind = 'ean13' | 'ean8' | 'upca' | 'upce';
/** product = a normal retail number; storeLabel = a GS1 restricted-circulation number (a shop's own label, often weighed items). */
export type BarcodeLabel = 'product' | 'storeLabel';
export type BarcodeError =
  | 'empty' // nothing typed
  | 'format' // the scanner read another symbology (QR, Code 128 ...)
  | 'chars' // something other than digits, spaces and hyphens
  | 'length' // not 8, 12 or 13 digits (or 14 with a leading 0)
  | 'checkDigit' // no reading passes its check digit (a typo or a misread)
  | 'coupon'; // a coupon or refund-receipt number, not a product

export type Barcode = {
  ok: true;
  /** Canonical stored form: 13 digits, or 8 for EAN-8. */
  code: string;
  kind: BarcodeKind;
  /** Every valid canonical reading of the digits, `code` first. */
  candidates: string[];
  label: BarcodeLabel;
  /** What to show: the canonical code, with a 13-digit code starting with 0 shown as its 12-digit UPC-A. */
  display: string;
};
export type BarcodeParse = Barcode | { ok: false; error: BarcodeError };

/** Barcode types this app accepts from the camera (expo-camera `BarcodeType` names). */
export const RETAIL_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

/** GS1 mod 10: weights 3, 1, 3, 1 ... from the rightmost data digit. */
export function gs1CheckDigit(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const digit = data.charCodeAt(data.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return String((10 - (sum % 10)) % 10);
}

function checks(code: string): boolean {
  return gs1CheckDigit(code.slice(0, -1)) === code.slice(-1);
}

/** UPC-E (number system, six digits, check) -> the 12-digit UPC-A it stands for (same check digit). */
export function expandUpcE(code8: string): string {
  const ns = code8[0];
  const [d1, d2, d3, d4, d5, d6] = code8.slice(1, 7);
  const check = code8[7];
  let body: string;
  if (d6 === '0' || d6 === '1' || d6 === '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${ns}${body}${check}`;
}

/** The scanner's type (expo-camera `ean13`, or an Apple name like `org.gs1.EAN-13`) -> kind; undefined = not a retail code. */
function hintKind(hint: string | null | undefined): BarcodeKind | null | undefined {
  if (hint == null || hint === '') return null;
  const h = hint.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const kind of ['ean13', 'ean8', 'upca', 'upce'] as const) if (h.includes(kind)) return kind;
  return undefined;
}

/** The first three digits as an integer (digit arithmetic, no Number(): src/engine stays float-free, A3). */
function prefix3(code: string): number {
  return (code.charCodeAt(0) - 48) * 100 + (code.charCodeAt(1) - 48) * 10 + (code.charCodeAt(2) - 48);
}

/** GS1 restricted-circulation numbers: 13 digits 020-029, 040-049, 200-299; EAN-8 starting with 0 or 2. */
export function barcodeLabel(code: string): BarcodeLabel {
  if (code.length === 8) return code[0] === '0' || code[0] === '2' ? 'storeLabel' : 'product';
  const p = prefix3(code);
  return (p >= 20 && p <= 29) || (p >= 40 && p <= 49) || (p >= 200 && p <= 299) ? 'storeLabel' : 'product';
}

function isCoupon(code: string): boolean {
  if (code.length !== 13) return false;
  const p = prefix3(code);
  return (p >= 980 && p <= 983) || p >= 990;
}

/** How a stored code is shown: a 13-digit code starting with 0 is a UPC-A and printed with 12 digits. */
export function displayBarcode(code: string): string {
  return code.length === 13 && code[0] === '0' ? code.slice(1) : code;
}

const SAME_HINT: Record<BarcodeKind, readonly BarcodeKind[]> = {
  ean13: ['ean13', 'upca'],
  upca: ['upca', 'ean13'],
  ean8: ['ean8'],
  upce: ['upce'],
};

/**
 * A scanned or typed barcode -> its canonical form, or why not. Spaces and hyphens are ignored; `hint` is the
 * scanner's type (it chooses between an EAN-8 and a UPC-E reading of eight digits). Never throws.
 */
export function parseBarcode(raw: string, hint?: string | null): BarcodeParse {
  const want = hintKind(hint);
  if (want === undefined) return { ok: false, error: 'format' };
  let text = String(raw ?? '').trim().replace(/[ \u00a0\u202f\u2009-]/g, '');
  if (text === '') return { ok: false, error: 'empty' };
  if (!/^[0-9]+$/.test(text)) return { ok: false, error: 'chars' };
  if (text.length === 14 && text[0] === '0') text = text.slice(1);
  if (text.length !== 8 && text.length !== 12 && text.length !== 13) return { ok: false, error: 'length' };

  const found: { kind: BarcodeKind; code: string }[] = [];
  if (text.length === 13 && checks(text)) found.push({ kind: 'ean13', code: text });
  if (text.length === 12 && checks(text)) found.push({ kind: 'upca', code: `0${text}` });
  if (text.length === 8) {
    if (checks(text)) found.push({ kind: 'ean8', code: text });
    if (text[0] === '0' || text[0] === '1') {
      const upcA = expandUpcE(text);
      if (checks(upcA)) found.push({ kind: 'upce', code: `0${upcA}` });
    }
  }
  if (found.length === 0) return { ok: false, error: 'checkDigit' };

  let primary = found[0];
  if (want) {
    for (const kind of SAME_HINT[want]) {
      const hit = found.find((f) => f.kind === kind);
      if (hit) {
        primary = hit;
        break;
      }
    }
  }
  if (isCoupon(primary.code)) return { ok: false, error: 'coupon' };
  const candidates = [primary.code, ...found.map((f) => f.code).filter((c) => c !== primary.code)];
  return { ok: true, code: primary.code, kind: primary.kind, candidates, label: barcodeLabel(primary.code), display: displayBarcode(primary.code) };
}

/** True for a canonical stored code (what the database and a backup file may hold). */
export function isCanonicalBarcode(code: unknown): code is string {
  if (typeof code !== 'string' || !/^([0-9]{8}|[0-9]{13})$/.test(code)) return false;
  const parsed = parseBarcode(code, code.length === 8 ? 'ean8' : 'ean13');
  return parsed.ok && parsed.code === code;
}
