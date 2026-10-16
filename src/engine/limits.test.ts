/** @jest-environment node */
// Review finding #4 (D27 "never throws on user input"): every value the keypad accepts — sizes and prices at the
// LIMITS edges — goes through compareCards, productStats, gauge and latestGauge without an exception, and every
// number handed to the UI is a safe integer. Values beyond what can be shown are capped and flagged (W9,
// moneyCapped, timesCapped, percentCapped). Own seeded PRNG (mulberry32); the seed is in the test name.
import { compareCards, SAVINGS_MAX_MINOR, TIMES_MAX, type Comparison } from './compare';
import { evaluateCard, maxMinorFor, type Card, type Deals, type EngineSettings } from './deals';
import { rat } from './rational';
import { gauge, latestGauge, PERCENT_MAX, productStats, type PriceObservation } from './stats';
import { dimensionOf, UNIT_IDS, type UnitId } from './units';

const RUNS = 2000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rng(seed: number) {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { int, pick: <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)], chance: (p: number) => next() < p };
}

const CURRENCIES = ['EUR', 'JPY', 'KWD', 'CLF', 'USD'];
// Keypad edges (parse.ts LIMITS): size 0.001 … 1 000 000 with 3 decimals, multipack 1 … 999, quantity 1 … 999.
const SIZES = ['0.001', '0.002', '1', '999999.999', '1000000', '330', '0.5'];
const PACKS = [1, 2, 999];
const QTYS = [1, 2, 999, null];
const priceEdges = (max: number) => [0, 1, 99, 4999, max - 1, max];

function isSafe(n: unknown): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

/** Every number in the comparison the UI might format must be a safe integer. */
function checkNumbers(c: Comparison) {
  for (const g of c.groups) {
    if (g.savings) {
      expect(isSafe(g.savings.permille) && isSafe(g.savings.moneyMinor)).toBe(true);
      expect(g.savings.moneyMinor).toBeLessThanOrEqual(SAVINGS_MAX_MINOR);
    }
    if (g.lowestToPay) expect(isSafe(g.lowestToPay.amountMinor)).toBe(true);
  }
  for (const w of c.warnings) if (w.code === 'W4') expect(isSafe(w.times) && w.times <= TIMES_MAX).toBe(true);
}

function randomDeals(r: ReturnType<typeof rng>, max: number): Deals {
  const d: Deals = {};
  if (r.chance(0.3)) d.quantity = r.chance(0.5) ? { kind: 'buyXGetY', x: r.pick([1, 2, 998]), y: 1, pct: r.pick(['100', '99.99', '0.01']) } : { kind: 'multiBuy', n: r.pick([2, 999]), priceMinor: r.pick(priceEdges(max)), perItem: r.chance(0.5) };
  if (r.chance(0.3)) d.percents = [{ pct: r.pick(['99.99', '100', '0.01']), minQty: r.pick([null, 999]) }];
  if (r.chance(0.3)) d.coupons = [{ amountMinor: r.pick(priceEdges(max)), perPack: r.chance(0.5), manufacturer: r.chance(0.5) }];
  if (r.chance(0.2)) d.spendSave = { thresholdMinor: r.pick(priceEdges(max)), saveMinor: r.pick(priceEdges(max)) };
  if (r.chance(0.2)) d.cashback = r.chance(0.5) ? { pct: '100' } : { amountMinor: r.pick(priceEdges(max)) };
  return d;
}

function randomCard(r: ReturnType<typeof rng>, id: string, units: readonly UnitId[], max: number): Card {
  return {
    id,
    priceMinor: r.pick(priceEdges(max)),
    size: { packCount: r.pick(PACKS), itemSize: r.pick(SIZES) },
    unit: r.pick(units),
    quantity: r.pick(QTYS),
    depositMinor: r.chance(0.2) ? r.pick(priceEdges(max)) : 0,
    deals: r.chance(0.5) ? randomDeals(r, max) : null,
  };
}

describe(`compareCards never throws at the LIMITS edges (seed 4242, ${RUNS} runs)`, () => {
  it('random edge cards, every unit, both tax modes, 0/2/3/4-decimal currencies', () => {
    const r = rng(4242);
    for (let i = 0; i < RUNS; i++) {
      const currency = r.pick(CURRENCIES);
      const max = maxMinorFor(currency);
      const settings: EngineSettings = {
        currency, taxMode: r.pick(['include', 'add'] as const), taxRate: r.pick([null, '0', '8.875', '100']), measurementSystem: r.pick(['metric', 'us', 'uk'] as const),
      };
      const units = r.chance(0.5) ? UNIT_IDS : UNIT_IDS.filter((u) => dimensionOf(u) === 'mass');
      const cards = Array.from({ length: r.int(2, 5) }, (_, k) => randomCard(r, String.fromCharCode(65 + k), units, max));
      let result: Comparison | null = null;
      expect(() => {
        result = compareCards(cards, settings);
      }).not.toThrow();
      checkNumbers(result!);
    }
  });
});

describe('the review cases', () => {
  const EUR: EngineSettings = { currency: 'EUR', taxMode: 'include', measurementSystem: 'metric' };
  const huge: Card = { id: 'A', priceMinor: 1, size: { packCount: 999, itemSize: '1000000' }, unit: 'kg' };
  it('savings: A 999 x 1 000 000 kg at EUR 0.01 vs B 1 g at EUR 99.00 -> capped, W9', () => {
    const c = compareCards([huge, { id: 'B', priceMinor: 9900, size: { packCount: 1, itemSize: '1' }, unit: 'g' }], EUR);
    expect(c.groups[0].savings).toMatchObject({ winnerId: 'A', moneyMinor: SAVINGS_MAX_MINOR, moneyCapped: true });
    expect(c.warnings).toContainEqual({ code: 'W9', dimension: 'mass', what: 'savings' });
  });
  it('W4: A as above vs B 0.001 mg at EUR 1 000 000 -> "more than 1 000 000x", W9', () => {
    const c = compareCards([huge, { id: 'B', priceMinor: 100000000, size: { packCount: 1, itemSize: '0.001' }, unit: 'mg' }], EUR);
    expect(c.warnings).toContainEqual(expect.objectContaining({ code: 'W4', times: TIMES_MAX, timesCapped: true }));
    expect(c.warnings).toContainEqual({ code: 'W9', dimension: 'mass', what: 'ratio' });
  });
  it('ordinary comparisons are not flagged', () => {
    const c = compareCards([{ id: 'A', priceMinor: 249, size: { packCount: 1, itemSize: '500' }, unit: 'g' }, { id: 'B', priceMinor: 549, size: { packCount: 1, itemSize: '1.2' }, unit: 'kg' }], EUR);
    expect(c.groups[0].savings).toMatchObject({ moneyMinor: 49, moneyCapped: false });
    expect(c.warnings.some((w) => w.code === 'W9')).toBe(false);
  });
  it('a price above the keypad limit makes the card incomplete instead of overflowing', () => {
    expect(evaluateCard({ id: 'A', priceMinor: Number.MAX_SAFE_INTEGER, size: { packCount: 1, itemSize: '1' }, unit: 'kg', quantity: 999 }, EUR)).toEqual({ ok: false, missing: 'price' });
    expect(evaluateCard({ id: 'A', priceMinor: 100000001, size: { packCount: 1, itemSize: '1' }, unit: 'kg' }, EUR)).toEqual({ ok: false, missing: 'price' });
    expect(evaluateCard({ id: 'A', priceMinor: 100000000, size: { packCount: 1, itemSize: '1' }, unit: 'kg' }, EUR).ok).toBe(true);
    expect(maxMinorFor('JPY')).toBe(1000000);
    expect(maxMinorFor('KWD')).toBe(1000000000);
  });
  it('gauge: x = 1e11 minor/kg against a history whose low and high differ by 0.0003 c', () => {
    const o = (id: number, minor: number, size: string): PriceObservation => ({
      id, storeId: 1, observedOn: `2026-09-0${id}`, createdAt: '', currency: 'EUR', packPriceMinor: minor, paidPriceMinor: null,
      packCount: 1, itemSize: size, unit: 'kg', depositMinor: 0, isPromo: false,
    });
    const s = productStats([o(1, 100000, '999999.999'), o(2, 100000, '1000000'), o(3, 100000, '999999.998')], '2026-09-30', { currency: 'EUR', dimension: 'mass' });
    let g: ReturnType<typeof gauge> | null = null;
    expect(() => {
      g = gauge(s, rat(100000000000));
    }).not.toThrow();
    expect(g).toMatchObject({ verdict: 'highest', percentVsUsual: PERCENT_MAX, percentCapped: true, candidatePermille: 1000 });
  });
});

describe(`price memory never throws at the LIMITS edges (seed 777, ${RUNS} runs)`, () => {
  it('productStats + gauge + latestGauge with random edge histories and candidates', () => {
    const r = rng(777);
    for (let i = 0; i < RUNS; i++) {
      const currency = r.pick(CURRENCIES);
      const max = maxMinorFor(currency);
      const units = UNIT_IDS.filter((u) => dimensionOf(u) === 'mass');
      const history: PriceObservation[] = Array.from({ length: r.int(0, 7) }, (_, k) => {
        const pack = r.pick(priceEdges(max));
        return {
          id: k + 1, storeId: r.pick([null, 1, 2]), observedOn: `2026-0${r.int(1, 9)}-1${r.int(0, 9)}`, createdAt: '', currency,
          packPriceMinor: pack, paidPriceMinor: r.chance(0.3) ? r.pick(priceEdges(max)) : null, packCount: r.pick(PACKS),
          itemSize: r.pick(SIZES), unit: r.pick(units), depositMinor: 0, isPromo: r.chance(0.3),
        };
      });
      const settings = { currency, dimension: 'mass' as const, measurementSystem: r.pick(['metric', 'us'] as const) };
      expect(() => {
        const s = productStats(history, '2026-09-30', settings);
        for (const e of s.shrinkflation) expect(isSafe(e.unitChangePermille) && isSafe(e.sizeChangePermille)).toBe(true);
        for (const x of [rat(0), rat(1), rat(max), rat(max * 1000), rat(1, 1000000)]) {
          const g = gauge(s, x);
          if (g.kind === 'verdict') expect(isSafe(g.candidatePermille) && (g.percentVsUsual === null || isSafe(g.percentVsUsual))).toBe(true);
        }
        latestGauge(history, '2026-09-30', settings);
      }).not.toThrow();
    }
  });
});
