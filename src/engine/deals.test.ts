/** @jest-environment node */
// Promotion pipeline (SPEC 5.4, 5.7). Fixtures come from test/oracle/gen_engine_fixtures.py, an independent
// Python Fraction implementation; its "examples" section holds the SPEC 5.7 numbers typed from the SPEC table.
import deals from '../../test/fixtures/engine/deals.json';
import { checkCases, type Case } from '../../test/engine-fixtures';
import { evaluateCard, memoryPrice, type Breakdown, type Card, type CardWarning, type EngineSettings } from './deals';
import { currencyExponent, unitPriceDecimals } from './money';
import { div, eq, fromDecimal, mul, pow10, rat, toDecimalString } from './rational';

type DealInput = { card: Card; settings: EngineSettings };
type DealExpected = {
  missing?: string;
  quantity?: number; s0?: number; s?: number; paid?: number; tax?: number; cashback?: number; effective?: number; deposit?: number;
  unitMinor?: string; unitDisplay?: string; steps?: [string, number][]; hints?: unknown[]; warnings?: string[];
  /** D40 price-memory basis (S-based unit price) and the per-pack paid price saved from Compare. */
  memoryUnitMinor?: string; memoryPaid?: number | null;
};
const sections = deals as unknown as Record<string, Case<DealInput, DealExpected>[]>;

function warningKey(w: CardWarning): string {
  return w.code === 'W5' ? `W5:${w.reason}` : w.code;
}
function decimalsOf(text: string): number {
  const i = text.indexOf('.');
  return i < 0 ? 0 : text.length - i - 1;
}

/** Everything the fixture can check, in fixture vocabulary. */
function actual(b: Breakdown, settings: EngineSettings, e: DealExpected, card: Card): DealExpected {
  const exponent = currencyExponent(settings.currency);
  const a: DealExpected = {
    quantity: b.quantity, s0: b.s0Minor, s: b.sMinor, paid: b.paidMinor, tax: b.taxMinor, cashback: b.cashbackMinor,
    effective: b.effectiveMinor, deposit: b.depositTotalMinor,
    steps: b.steps.map((s) => [s.kind, s.amountMinor]),
    hints: b.hints,
    warnings: b.warnings.map(warningKey),
    unitDisplay: toDecimalString(div(b.unitPrice, rat(pow10(exponent))), unitPriceDecimals([b.unitPrice], exponent)),
  };
  if (e.unitMinor !== undefined) a.unitMinor = toDecimalString(b.unitPrice, decimalsOf(e.unitMinor));
  if (e.memoryUnitMinor !== undefined) a.memoryUnitMinor = toDecimalString(b.memoryUnitPrice, decimalsOf(e.memoryUnitMinor));
  a.memoryPaid = memoryPrice(card, b)?.paidPriceMinor;
  return a;
}

describe('fixture hygiene', () => {
  it.each(Object.keys(sections))('%s: every case has an id and a note, ids are unique', (name) => {
    checkCases(name, sections[name]);
  });
  it('has the SPEC examples and enough generated cases', () => {
    const ids = sections.examples.map((c) => c.id.split('-')[0]);
    for (const e of ['E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'E13', 'E14', 'E15', 'E16', 'E17', 'E18']) expect(ids).toContain(e);
    expect(sections.generated.length).toBeGreaterThanOrEqual(150);
  });
});

describe.each(Object.keys(sections))('deals.json %s', (name) => {
  it.each(sections[name].map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const result = evaluateCard(c.input.card, c.input.settings);
    if (c.expected.missing) {
      expect(result).toEqual({ ok: false, missing: c.expected.missing });
      return;
    }
    if (!result.ok) throw new Error(`card incomplete: ${result.missing}`);
    const got = actual(result.breakdown, c.input.settings, c.expected, c.input.card);
    const want = Object.fromEntries(Object.keys(c.expected).map((k) => [k, (got as Record<string, unknown>)[k]]));
    expect(want).toEqual(c.expected);
  });
});

const EUR: EngineSettings = { currency: 'EUR', taxMode: 'include', measurementSystem: 'metric' };
const USD: EngineSettings = { currency: 'USD', taxMode: 'add', measurementSystem: 'us', taxRate: '8.875' };
const card = (over: Partial<Card> = {}): Card => ({ id: 'A', priceMinor: 499, size: { packCount: 1, itemSize: '12' }, unit: 'oz', ...over });
function ok(c: Card, s: EngineSettings): Breakdown {
  const r = evaluateCard(c, s);
  if (!r.ok) throw new Error(r.missing);
  return r.breakdown;
}

describe('breakdown details', () => {
  it('E14: tax step shows the base, the manufacturer coupon total and the till amount', () => {
    const b = ok(card({ quantity: 2, deals: { percents: [{ pct: '20' }], coupons: [{ amountMinor: 100, manufacturer: true }] } }), USD);
    expect(b.steps.find((s) => s.kind === 'taxAdded')).toEqual({ kind: 'taxAdded', rate: '8.875', baseMinor: 798, taxMinor: 71, amountMinor: 71, totalMinor: 769 });
    expect(b.manufacturerCouponMinor).toBe(100);
    expect(b.netMinor).toBe(698);
  });
  it('E17: prices incl. 7 % show net 2.79 and VAT 0.20 without changing the total', () => {
    const b = ok(card({ priceMinor: 299, unit: 'kg', size: { packCount: 1, itemSize: '1' } }), { ...EUR, taxRate: '7' });
    expect(b.steps.at(-1)).toEqual({ kind: 'taxIncluded', rate: '7', netMinor: 279, taxMinor: 20, amountMinor: 0, totalMinor: 299 });
    expect([b.paidMinor, b.netMinor, b.taxMinor]).toEqual([299, 279, 20]);
  });
  it('E4: total stacked discount is 36.2 %', () => {
    expect(ok(card({ priceMinor: 999, deals: { percents: [{ pct: '25' }, { pct: '15' }] } }), EUR).discountPermille).toBe(362);
  });
  it('E5: 20 % then 10 % is 28.0 %, not 30 %', () => {
    expect(ok(card({ priceMinor: 1000, deals: { percents: [{ pct: '20' }, { pct: '10' }] } }), EUR).discountPermille).toBe(280);
  });
  it('E1 C: W3 converts 16 oz to exactly 453.59237 g on a per-kg basis', () => {
    const b = ok(card({ priceMinor: 239, size: { packCount: 1, itemSize: '16' } }), EUR);
    const w = b.warnings.find((x) => x.code === 'W3');
    expect(w && w.code === 'W3' && w.toUnit).toBe('g');
    expect(w && w.code === 'W3' && eq(w.converted, fromDecimal('453.59237')!)).toBe(true);
  });
  it('no W3 for count units or when the unit matches the basis family', () => {
    expect(ok(card({ unit: 'dozen' }), EUR).warnings).toEqual([]);
    expect(ok(card(), { ...USD, taxRate: null }).warnings).toEqual([]);
  });
  it('E15: paid per pack is 11.32 (1132.33 c)', () => {
    const b = ok(card({ priceMinor: 1299, quantity: 3, unit: 'pcs', size: { packCount: 1, itemSize: '1' }, deals: { spendSave: { thresholdMinor: 3000, saveMinor: 500 } } }), EUR);
    expect(toDecimalString(b.perPack, 2)).toBe('1132.33');
  });
  it('E18: deposit is outside E and U but inside the till amount', () => {
    const b = ok(card({ priceMinor: 449, unit: 'ml', size: { packCount: 6, itemSize: '330' }, depositMinor: 150 }), EUR);
    expect([b.effectiveMinor, b.depositTotalMinor, b.tillMinor]).toEqual([449, 150, 599]);
    expect(eq(b.totalQuantity, rat(1980))).toBe(true);
    expect(b.steps.at(-1)).toEqual({ kind: 'deposit', quantity: 1, depositMinor: 150, amountMinor: 150, totalMinor: 449 });
  });
  it('U x q x Q / basis gives back E exactly', () => {
    const b = ok(card({ priceMinor: 349, quantity: 3, deals: { quantity: { kind: 'buyXGetY', x: 1, y: 1, pct: '50' } } }), USD);
    expect(eq(div(mul(b.unitPrice, b.totalQuantity), fromDecimal('28.349523125')!), rat(b.effectiveMinor))).toBe(true);
  });
  it('multi-buy step reports complete groups and items outside the deal', () => {
    const b = ok(card({ priceMinor: 199, quantity: 5, deals: { quantity: { kind: 'multiBuy', n: 3, priceMinor: 500 } } }), EUR);
    expect(b.steps[1]).toEqual({ kind: 'multiBuy', n: 3, dealPriceMinor: 500, perItem: false, groups: 1, outside: 2, amountMinor: -97, totalMinor: 898 });
  });
  it('a clamped coupon is marked and warned', () => {
    const b = ok(card({ priceMinor: 349, unit: 'pcs', deals: { coupons: [{ amountMinor: 500 }] } }), EUR);
    expect(b.steps[1]).toMatchObject({ kind: 'coupon', requestedMinor: 500, amountMinor: -349, clamped: true });
    expect(b.warnings).toEqual([{ code: 'W5', reason: 'coupon', index: 0, requestedMinor: 500, appliedMinor: 349 }, { code: 'W8' }]);
    expect(b.free).toBe(true);
  });
});

describe('cards that cannot be evaluated never throw', () => {
  const cases: [string, Card, EngineSettings, string][] = [
    ['no price', card({ priceMinor: null }), EUR, 'price'],
    ['negative price', card({ priceMinor: -1 }), EUR, 'price'],
    ['fractional price', card({ priceMinor: 1.5 }), EUR, 'price'],
    ['no size', card({ size: null }), EUR, 'size'],
    ['size 0', card({ size: { packCount: 1, itemSize: '0' } }), EUR, 'size'],
    ['size not a number', card({ size: { packCount: 1, itemSize: 'abc' } }), EUR, 'size'],
    ['pack count 0', card({ size: { packCount: 0, itemSize: '1' } }), EUR, 'size'],
    ['pack count 1000', card({ size: { packCount: 1000, itemSize: '1' } }), EUR, 'size'],
    ['unknown unit', card({ unit: 'stone' as never }), EUR, 'size'],
    ['q 0', card({ quantity: 0 }), EUR, 'quantity'],
    ['q 1000', card({ quantity: 1000 }), EUR, 'quantity'],
    ['q 1.5', card({ quantity: 1.5 }), EUR, 'quantity'],
    ['negative deposit', card({ depositMinor: -5 }), EUR, 'deposit'],
    ['X 0', card({ deals: { quantity: { kind: 'buyXGetY', x: 0, y: 1, pct: '100' } } }), EUR, 'deal'],
    ['z over 100', card({ deals: { quantity: { kind: 'buyXGetY', x: 1, y: 1, pct: '150' } } }), EUR, 'deal'],
    ['N 0', card({ deals: { quantity: { kind: 'multiBuy', n: 0, priceMinor: 100 } } }), EUR, 'deal'],
    ['percent text', card({ deals: { percents: [{ pct: 'ten' }] } }), EUR, 'deal'],
    ['percent minimum 0', card({ deals: { percents: [{ pct: '10', minQty: 0 }] } }), EUR, 'deal'],
    ['negative coupon', card({ deals: { coupons: [{ amountMinor: -100 }] } }), EUR, 'deal'],
    ['spend-and-save with both amount and %', card({ deals: { spendSave: { thresholdMinor: 100, saveMinor: 10, savePct: '5' } } }), EUR, 'deal'],
    ['spend-and-save with neither', card({ deals: { spendSave: { thresholdMinor: 100 } } }), EUR, 'deal'],
    ['cashback with neither', card({ deals: { cashback: {} } }), EUR, 'deal'],
    ['tax rate text', card(), { ...EUR, taxRate: 'x' }, 'tax'],
    ['tax rate over 100', card(), { ...EUR, taxRate: '101' }, 'tax'],
  ];
  it.each(cases)('%s', (_name, c, s, missing) => {
    expect(evaluateCard(c, s)).toEqual({ ok: false, missing });
  });
});
