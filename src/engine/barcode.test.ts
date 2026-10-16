/** @jest-environment node */
// Barcode normaliser (V1.5 P1, D63). Fixtures come from test/oracle/gen_barcode_fixtures.py, written from the GS1 rules
// before the engine and checked against hand-typed published examples (Wikipedia EAN-13 / EAN-8 / UPC-A / UPC-E / ISBN).
import fixtures from '../../test/fixtures/engine/barcode.json';
import { checkCases, type Case } from '../../test/engine-fixtures';
import { barcodeLabel, displayBarcode, expandUpcE, gs1CheckDigit, isCanonicalBarcode, parseBarcode, RETAIL_BARCODE_TYPES } from './barcode';

type Input = { raw: string; hint: string | null };
const cases = fixtures as unknown as Case<Input, Record<string, unknown>>[];

describe('barcode.json (oracle)', () => {
  it('has well-formed cases', () => {
    checkCases('barcode', cases);
    expect(cases.length).toBeGreaterThan(400);
  });
  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(parseBarcode(c.input.raw, c.input.hint)).toEqual(c.expected);
  });
});

describe('published examples', () => {
  it('check digits', () => {
    expect(gs1CheckDigit('400638133393')).toBe('1'); // EAN-13 4006381333931
    expect(gs1CheckDigit('7351353')).toBe('7'); // EAN-8 73513537
    expect(gs1CheckDigit('03600029145')).toBe('2'); // UPC-A 036000291452
    expect(gs1CheckDigit('978030640615')).toBe('7'); // ISBN 9780306406157
  });
  it('UPC-E 04252614 is UPC-A 042100005264', () => {
    expect(expandUpcE('04252614')).toBe('042100005264');
  });
});

describe('one pack, one code', () => {
  it('UPC-A, the same code as EAN-13 and as GTIN-14 store the same text', () => {
    const forms = ['036000291452', '0036000291452', '00036000291452', '0 36000 29145 2', '036000-291452'];
    const codes = forms.map((f) => parseBarcode(f));
    for (const c of codes) expect(c).toMatchObject({ ok: true, code: '0036000291452', display: '036000291452' });
  });
  it('a UPC-E scan and its printed UPC-A form store the same text', () => {
    expect(parseBarcode('04252614', 'upc_e')).toMatchObject({ ok: true, code: '0042100005264', kind: 'upce' });
    expect(parseBarcode('042100005264')).toMatchObject({ ok: true, code: '0042100005264', kind: 'upca' });
  });
  it('eight digits valid as EAN-8 and as UPC-E: the hint picks, both are candidates', () => {
    // find such a code
    let both = '';
    for (let n = 0; n < 1000000 && !both; n++) {
      const body = `0${String(n).padStart(6, '0')}`;
      const ean = body + gs1CheckDigit(body);
      const upce = parseBarcode(ean, 'upc_e');
      if (upce.ok && upce.kind === 'upce' && upce.candidates.length === 2) both = ean;
    }
    expect(both).not.toBe('');
    const asEan = parseBarcode(both);
    const asUpcE = parseBarcode(both, 'upc_e');
    expect(asEan).toMatchObject({ ok: true, kind: 'ean8', code: both });
    expect(asUpcE).toMatchObject({ ok: true, kind: 'upce' });
    if (asEan.ok && asUpcE.ok) expect([...asEan.candidates].sort()).toEqual([...asUpcE.candidates].sort());
  });
  it('Apple type names are understood as hints', () => {
    expect(parseBarcode('04252614', 'org.gs1.UPC-E')).toMatchObject({ ok: true, kind: 'upce' });
    expect(parseBarcode('4006381333931', 'org.gs1.EAN-13')).toMatchObject({ ok: true, kind: 'ean13' });
  });
});

describe('refusals and labels', () => {
  it('names every refusal', () => {
    expect(parseBarcode('')).toEqual({ ok: false, error: 'empty' });
    expect(parseBarcode('12a')).toEqual({ ok: false, error: 'chars' });
    expect(parseBarcode('123456')).toEqual({ ok: false, error: 'length' });
    expect(parseBarcode('4006381333932')).toEqual({ ok: false, error: 'checkDigit' });
    expect(parseBarcode('4006381333931', 'qr')).toEqual({ ok: false, error: 'format' });
    const coupon = `990123456789`;
    expect(parseBarcode(coupon + gs1CheckDigit(coupon))).toEqual({ ok: false, error: 'coupon' });
  });
  it('every single-digit typo and every adjacent swap (of different digits, except 0<->5 style pairs) is caught', () => {
    const code = '4006381333931';
    for (let i = 0; i < code.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === code[i]) continue;
        const typo = code.slice(0, i) + d + code.slice(i + 1);
        expect(parseBarcode(typo).ok).toBe(false);
      }
    }
    let caught = 0;
    let swaps = 0;
    for (let i = 0; i < code.length - 1; i++) {
      if (code[i] === code[i + 1]) continue;
      swaps++;
      const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2);
      if (!parseBarcode(swapped).ok) caught++;
    }
    // mod 10 with weights 3/1 misses a swap only when the two digits differ by 5
    expect(caught).toBe(swaps - [...Array(code.length - 1).keys()].filter((i) => Math.abs(Number(code[i]) - Number(code[i + 1])) === 5).length);
  });
  it('shop labels (weighed or in-store items) are flagged', () => {
    expect(barcodeLabel('2112345000004')).toBe('storeLabel');
    expect(barcodeLabel('0212345000003')).toBe('storeLabel');
    expect(barcodeLabel('4006381333931')).toBe('product');
    expect(barcodeLabel('20123451')).toBe('storeLabel');
    expect(barcodeLabel('73513537')).toBe('product');
  });
  it('accepts only the four retail types from the camera', () => {
    expect(RETAIL_BARCODE_TYPES).toEqual(['ean13', 'ean8', 'upc_a', 'upc_e']);
  });
});

describe('canonical codes (database and backup)', () => {
  it('accepts stored forms and refuses everything else', () => {
    expect(isCanonicalBarcode('4006381333931')).toBe(true);
    expect(isCanonicalBarcode('73513537')).toBe(true);
    expect(isCanonicalBarcode('0042100005264')).toBe(true);
    expect(isCanonicalBarcode('036000291452')).toBe(false); // 12 digits: not the stored form
    expect(isCanonicalBarcode('4006381333932')).toBe(false);
    expect(isCanonicalBarcode(' 4006381333931')).toBe(false);
    expect(isCanonicalBarcode(4006381333931)).toBe(false);
    expect(isCanonicalBarcode(null)).toBe(false);
  });
  it('every valid fixture code is canonical and displays as printed', () => {
    for (const c of cases) {
      const e = c.expected as { ok: boolean; code?: string; display?: string };
      if (!e.ok) continue;
      expect(isCanonicalBarcode(e.code)).toBe(true);
      expect(displayBarcode(e.code!)).toBe(e.display);
    }
  });
});
