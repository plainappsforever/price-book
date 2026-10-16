/** @jest-environment node */
// Seeded property tests for the promotion engine and the ranking (SPEC A2, V1_PLAN P2). Own PRNG
// (mulberry32, no dependency); 2 000 runs per property; the seed is in each test name so a failure can be replayed.
import { summary } from '../../test/engine-fixtures';
import { compareCards } from './compare';
import { evaluateCard, type Breakdown, type Card, type Deals, type EngineSettings } from './deals';
import { add, cmp, div, fromDecimal, mul, rat, sub, eq, type Rat } from './rational';
import { BASES, dimensionOf, type UnitId } from './units';

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
type Rng = { int: (lo: number, hi: number) => number; pick: <T>(xs: readonly T[]) => T; chance: (p: number) => boolean };
function rng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { int, pick: (xs) => xs[int(0, xs.length - 1)], chance: (p) => next() < p };
}

const UNITS: UnitId[] = ['g', 'kg', 'oz', 'lb', 'ml', 'l', 'floz_us', 'gal_uk', 'pcs', 'dozen', 'm', 'ft'];
const PCTS = ['5', '10', '12.5', '15', '20', '25', '33.3', '50', '75', '100', '0', '7.25', '99.9'];

function sizeText(r: Rng): string {
  const whole = r.int(0, 2000);
  const decimals = r.int(0, 3);
  // Canonical like the keypad stores it (no trailing zeros): evaluateCard refuses anything else (oracle review M2).
  const frac = decimals === 0 ? '' : `.${String(r.int(1, 10 ** decimals - 1)).padStart(decimals, '0')}`.replace(/0+$/, '');
  return whole === 0 && frac === '' ? '1' : `${whole}${frac}`;
}
function randomDeals(r: Rng): Deals {
  const d: Deals = {};
  const kind = r.int(0, 3);
  if (kind === 1) d.quantity = { kind: 'buyXGetY', x: r.int(1, 4), y: r.int(1, 3), pct: r.pick(PCTS) };
  if (kind === 2) d.quantity = { kind: 'multiBuy', n: r.int(1, 10), priceMinor: r.int(0, 3000), perItem: r.chance(0.3) };
  if (r.chance(0.5)) d.percents = Array.from({ length: r.int(1, 3) }, () => ({ pct: r.pick(PCTS), minQty: r.chance(0.3) ? r.int(1, 6) : null }));
  if (r.chance(0.4)) d.coupons = Array.from({ length: r.int(1, 2) }, () => ({ amountMinor: r.int(0, 800), perPack: r.chance(0.5), manufacturer: r.chance(0.3) }));
  if (r.chance(0.3)) d.spendSave = r.chance(0.5) ? { thresholdMinor: r.int(0, 5000), saveMinor: r.int(0, 1500) } : { thresholdMinor: r.int(0, 5000), savePct: r.pick(PCTS) };
  if (r.chance(0.3)) d.cashback = r.chance(0.5) ? { amountMinor: r.int(0, 1000) } : { pct: r.pick(PCTS) };
  return d;
}
function randomCard(r: Rng, id: string, unit?: UnitId): Card {
  return {
    id,
    priceMinor: r.chance(0.05) ? 0 : r.int(1, 5000),
    size: { packCount: r.chance(0.7) ? 1 : r.int(2, 24), itemSize: sizeText(r) },
    unit: unit ?? r.pick(UNITS),
    quantity: r.chance(0.3) ? null : r.int(1, 12),
    depositMinor: r.chance(0.2) ? r.int(0, 300) : null,
    label: r.chance(0.2) ? r.pick(['rolls', 'sheets', 'washes']) : null,
    deals: randomDeals(r),
  };
}
function randomSettings(r: Rng): EngineSettings {
  const taxMode = r.chance(0.5) ? 'add' : 'include';
  return {
    currency: r.pick(['EUR', 'USD', 'JPY', 'KWD']),
    taxMode,
    taxRate: r.chance(0.3) ? null : r.pick(['0', '6', '7', '8.875', '19', '25']),
    measurementSystem: r.pick(['metric', 'uk', 'us'] as const),
  };
}
function evaluate(c: Card, s: EngineSettings): Breakdown {
  const e = evaluateCard(c, s);
  if (!e.ok) throw new Error(`generated card not evaluable: ${e.missing} ${JSON.stringify(c)}`);
  return e.breakdown;
}
function forAll(seed: number, body: (r: Rng, run: number) => void): void {
  const r = rng(seed);
  for (let run = 0; run < RUNS; run++) body(r, run);
}

describe('promotion pipeline properties (2 000 runs each)', () => {
  it('seed 101: every total is >= 0 and E <= Paid', () => {
    forAll(101, (r) => {
      const b = evaluate(randomCard(r, 'A'), randomSettings(r));
      for (const v of [b.s0Minor, b.sMinor, b.paidMinor, b.taxMinor, b.netMinor, b.cashbackMinor, b.effectiveMinor, b.depositTotalMinor]) expect(v).toBeGreaterThanOrEqual(0);
      for (const s of b.steps) expect(s.totalMinor).toBeGreaterThanOrEqual(0);
      expect(b.effectiveMinor).toBeLessThanOrEqual(b.paidMinor);
      expect(cmp(b.unitPrice, rat(0))).toBeGreaterThanOrEqual(0);
    });
  });

  it('seed 202: deals never raise S above S0 (except a flagged fake multi-buy, D33); discount steps never add', () => {
    forAll(202, (r) => {
      const b = evaluate(randomCard(r, 'A'), randomSettings(r));
      const fake = b.warnings.some((w) => w.code === 'W5' && w.reason === 'multiBuy');
      if (!fake) expect(b.sMinor).toBeLessThanOrEqual(b.s0Minor);
      for (const s of b.steps) {
        if (s.kind === 'buyXGetY' || s.kind === 'percent' || s.kind === 'coupon' || s.kind === 'spendSave' || s.kind === 'cashback') {
          expect(s.amountMinor).toBeLessThanOrEqual(0);
        }
      }
    });
  });

  it('seed 303: sequential percentages never take more than the sum of the percentages (+ 1/2 minor unit per rounding)', () => {
    forAll(303, (r) => {
      const percents = Array.from({ length: r.int(1, 4) }, () => ({ pct: r.pick(PCTS) }));
      const c: Card = { id: 'A', priceMinor: r.int(1, 100000), size: { packCount: 1, itemSize: '1' }, unit: 'kg', quantity: r.int(1, 9), deals: { percents } };
      const b = evaluate(c, { currency: 'EUR', taxMode: 'include' });
      const sum = percents.reduce((acc, p) => add(acc, fromDecimal(p.pct)!), rat(0));
      const bound = add(mul(rat(b.s0Minor), div(sum, rat(100))), rat(percents.length, 2));
      expect(cmp(rat(b.s0Minor - b.sMinor), bound)).toBeLessThanOrEqual(0);
      expect(b.sMinor).toBeLessThanOrEqual(b.s0Minor);
    });
  });

  it('seed 404: the unit price is the same quantity on every display basis (U / basis is invariant)', () => {
    forAll(404, (r) => {
      const c = randomCard(r, 'A');
      const s = randomSettings(r);
      const dim = dimensionOf(c.unit);
      let perBase: Rat | null = null;
      for (const basis of BASES[dim]) {
        const b = evaluate(c, { ...s, bases: { [dim]: basis.id } });
        expect(b.basis).toBe(basis.id);
        const v = div(b.unitPrice, basis.quantity);
        if (perBase) expect(eq(v, perBase)).toBe(true);
        perBase = v;
      }
      const b = evaluate(c, s);
      expect(eq(mul(perBase!, b.totalQuantity), rat(b.effectiveMinor))).toBe(true);
    });
  });

  it('seed 505: per-group rounding never differs from the exact discount by more than 1 minor unit per group', () => {
    forAll(505, (r) => {
      const P = r.int(1, 5000);
      const q = r.int(1, 40);
      if (r.chance(0.5)) {
        const x = r.int(1, 4);
        const y = r.int(1, 3);
        const pct = r.pick(PCTS);
        const b = evaluate({ id: 'A', priceMinor: P, size: { packCount: 1, itemSize: '1' }, unit: 'pcs', quantity: q, deals: { quantity: { kind: 'buyXGetY', x, y, pct } } }, { currency: 'EUR', taxMode: 'include' });
        const groups = Math.floor(q / (x + y));
        const exact = sub(rat(q * P), mul(rat(groups * y * P), div(fromDecimal(pct)!, rat(100))));
        const diff = sub(rat(b.sMinor), exact);
        expect(cmp(diff, rat(groups)) <= 0 && cmp(diff, rat(-groups)) >= 0).toBe(true);
        expect(cmp(diff, rat(groups, 2)) <= 0 && cmp(diff, rat(-groups, 2)) >= 0).toBe(true); // half a unit per group, in fact
      } else {
        const n = r.int(1, 10);
        const M = r.int(0, 3000);
        const b = evaluate({ id: 'A', priceMinor: P, size: { packCount: 1, itemSize: '1' }, unit: 'pcs', quantity: q, deals: { quantity: { kind: 'multiBuy', n, priceMinor: M, perItem: true } } }, { currency: 'EUR', taxMode: 'include' });
        const diff = sub(rat(b.sMinor), rat(q * M, n));
        expect(cmp(diff, rat(1, 2)) <= 0 && cmp(diff, rat(-1, 2)) >= 0).toBe(true);
      }
    });
  });

  it('seed 606: the deposit is q x D and never changes E or U', () => {
    forAll(606, (r) => {
      const c = randomCard(r, 'A');
      const s = randomSettings(r);
      const D = r.int(1, 500);
      const withDeposit = evaluate({ ...c, depositMinor: D }, s);
      const without = evaluate({ ...c, depositMinor: null }, s);
      expect(withDeposit.depositTotalMinor).toBe(withDeposit.quantity * D);
      expect(withDeposit.effectiveMinor).toBe(without.effectiveMinor);
      expect(eq(withDeposit.unitPrice, without.unitPrice)).toBe(true);
      expect(withDeposit.tillMinor).toBe(withDeposit.paidMinor + withDeposit.quantity * D);
    });
  });
});

describe('ranking properties (2 000 runs each)', () => {
  /** Order-independent view of a comparison: per dimension, with ranks per card id. */
  function canonical(cards: Card[], s: EngineSettings) {
    const c = compareCards(cards, s);
    const sum = summary(c);
    const groups = Object.fromEntries(
      c.groups.map((g) => [
        g.dimension,
        {
          ranks: Object.fromEntries(g.ranking.map((x) => [x.id, x.rank])),
          tied: g.ranking.filter((x) => x.tiedWithBest).map((x) => x.id).sort(),
          winners: [...g.winners].sort(),
          tie: g.tie,
          savings: g.savings && { winnerId: g.savings.winnerId, permille: g.savings.permille, moneyMinor: g.savings.moneyMinor },
          lowestToPay: g.lowestToPay && { ids: [...g.lowestToPay.cardIds].sort(), amount: g.lowestToPay.amountMinor },
        },
      ]),
    );
    return { groups, warnings: sum.warnings, decimals: sum.decimals, display: sum.unitDisplay };
  }

  it('seed 707: ranking, winners, savings, lowest to pay and warnings do not depend on card order', () => {
    forAll(707, (r) => {
      const s = randomSettings(r);
      const sameDim = r.chance(0.6);
      const unit = r.pick(UNITS);
      const dimUnits = UNITS.filter((u) => dimensionOf(u) === dimensionOf(unit));
      const cards = Array.from({ length: r.int(2, 5) }, (_, i) => randomCard(r, String.fromCharCode(65 + i), sameDim ? r.pick(dimUnits) : undefined));
      if (r.chance(0.2)) cards[1] = { ...cards[0], id: 'B' }; // exact duplicates (Duplicate card)
      const shuffled = [...cards];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = r.int(0, i);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(canonical(shuffled, s)).toEqual(canonical(cards, s));
    });
  });

  it('seed 808: the winner never has a higher unit price than any card of its group, and savings are >= 0', () => {
    forAll(808, (r) => {
      const unit = r.pick(UNITS);
      const dimUnits = UNITS.filter((u) => dimensionOf(u) === dimensionOf(unit));
      const cards = Array.from({ length: r.int(2, 5) }, (_, i) => randomCard(r, String.fromCharCode(65 + i), r.pick(dimUnits)));
      const c = compareCards(cards, randomSettings(r));
      for (const g of c.groups) {
        if (g.ranking.length < 2) continue;
        const best = g.ranking[0].unitPrice;
        for (const x of g.ranking) expect(cmp(best, x.unitPrice)).toBeLessThanOrEqual(0);
        expect(g.winners.length).toBeGreaterThanOrEqual(1);
        if (g.savings) {
          expect(g.savings.permille).toBeGreaterThanOrEqual(0);
          expect(g.savings.moneyMinor).toBeGreaterThanOrEqual(0);
          expect(g.winners).toEqual([g.savings.winnerId]);
        }
      }
    });
  });
});
