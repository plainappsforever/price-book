/** @jest-environment node */
// Price memory statistics (SPEC 5.8, D17, D35). Fixtures come from the independent oracle
// test/oracle/gen_stats_fixtures.py, which asserts the SPEC S1/S2 numbers before writing them.
import stats from '../../test/fixtures/engine/stats.json';
import { checkCases, type Case } from '../../test/engine-fixtures';
import { cmp, div, eq, pow10, rat, toDecimalString, type Rat } from './rational';
import {
  dayNumber, duplicateKind, gauge, isDuplicate, latestGauge, majorToMinorRat, median, productStats,
  type GaugeResult, type PriceObservation, type Stats, type StatsSettings,
} from './stats';

type StatsInput = { today: string; settings: StatsSettings; observations: PriceObservation[]; candidates: string[] };
const cases = (stats as unknown as { cases: Case<StatsInput, Record<string, unknown>>[] }).cases;

const fr = (r: Rat) => (r.d === BigInt(1) ? r.n.toString() : `${r.n}/${r.d}`);

function gaugeKey(g: GaugeResult | null) {
  if (!g) return null;
  if (g.kind === 'building') return { building: g.count };
  return { verdict: g.verdict, pct: g.percentVsUsual, usualAt: g.usualPermille, at: g.candidatePermille };
}

/** The statistics in fixture vocabulary (same shape as the oracle's summary()). */
function summary(s: Stats, input: StatsInput) {
  const disp = (u: Rat) => toDecimalString(div(u, rat(pow10(s.exponent))), s.decimals);
  const gauges: Record<string, unknown> = {};
  for (const c of input.candidates) gauges[c] = gaugeKey(gauge(s, majorToMinorRat(c, s.exponent)!));
  return {
    count: s.count,
    otherCurrency: s.otherCurrencyCount,
    invalid: s.invalidCount,
    basis: s.basis,
    decimals: s.decimals,
    latest: s.latest?.id ?? null,
    lowest: s.lowest ? [s.lowest.id, s.lowest.isPromo] : null,
    highest: s.highest ? [s.highest.id, s.highest.isPromo] : null,
    usual: s.usual ? { value: fr(s.usual.value), basedOn: s.usual.basedOn, source: s.usual.source } : null,
    display: s.latest
      ? { latest: disp(s.latest.unitPrice), lowest: disp(s.lowest!.unitPrice), highest: disp(s.highest!.unitPrice), usual: disp(s.usual!.value) }
      : null,
    stores: s.stores.map((r) => ({
      store: r.storeId, latest: r.latest.id, lowest: r.lowest.id, count: r.count, days: r.daysSinceLatest,
      stale: r.stale, cheapest: r.lastSeenCheapest, display: disp(r.latest.unitPrice),
    })),
    shrink: s.shrinkflation.map((e) => ({
      kind: e.kind, shrink: e.isShrinkflation, prev: e.previous.id, cur: e.current.id, ref: e.reference.id,
      same: e.sameStore, size: e.sizeChangePermille, unit: e.unitChangePermille,
    })),
    gauge: gauges,
    latestGauge: gaugeKey(latestGauge(input.observations, input.today, input.settings)),
    chart: (s.chart?.series ?? []).map((ser) => [ser.storeId, ser.points.map((p) => [p.id, p.xPermille, p.yPermille])]),
  };
}

describe('fixture hygiene', () => {
  it('every case has an id and a note, ids are unique', () => checkCases('stats', cases));
  it('covers the plan list (S1, S2, four classifications, promo, other store, windows, medians, currency, gauge < 3)', () => {
    const ids = cases.map((c) => c.id);
    for (const id of ['S1', 'S2', 'shrink-price-up', 'shrink-cheaper-pack-dearer-unit', 'shrink-other-store', 'shrink-promo-ignored',
      'usual-few-regular', 'usual-older', 'usual-odd-median', 'usual-even-median-exact', 'S1-other-currency', 'gauge-two-prices',
      'shrink-two-pack-sizes', 'shrink-two-pack-counts', 'shrink-known-then-new', 'shrink-30-percent-edge']) {
      expect(ids).toContain(id);
    }
    const kinds = new Set(cases.flatMap((c) => (c.expected.shrink as { kind: string }[]).map((e) => e.kind)));
    expect([...kinds].sort()).toEqual(['cheaperPackDearerUnit', 'differentPackSize', 'packSmaller', 'priceUp', 'samePrice', 'smallerNotDearer']);
  });
});

describe('stats.json', () => {
  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const s = productStats(c.input.observations, c.input.today, c.input.settings);
    expect(summary(s, c.input)).toEqual(c.expected);
  });
});

const EUR: StatsSettings = { currency: 'EUR', dimension: 'mass', measurementSystem: 'metric' };
const S1 = cases.find((c) => c.id === 'S1')!.input;

describe('SPEC S1/S2 read straight from the engine', () => {
  it('S1: usual 4.98 is exact, Rewe is "last seen cheapest", Aldi is stale', () => {
    const s = productStats(S1.observations, S1.today, EUR);
    expect(eq(s.usual!.value, rat(498))).toBe(true);
    expect(s.stores.filter((r) => r.lastSeenCheapest).map((r) => r.storeId)).toEqual([1]);
    expect(s.stores.find((r) => r.storeId === 2)!.stale).toBe(true);
  });
  it('A8: 4.49 against the S1 book is "Good price, -10 %"', () => {
    const s = productStats(S1.observations, S1.today, EUR);
    expect(gauge(s, majorToMinorRat('4.49', 2)!)).toMatchObject({ kind: 'verdict', verdict: 'good', percentVsUsual: -10, basedOn: 5 });
  });
  it('S2: same price, 12.5 % less, +14.3 % per kg', () => {
    const c = cases.find((x) => x.id === 'S2')!.input;
    const [e] = productStats(c.observations, c.today, EUR).shrinkflation;
    expect(e).toMatchObject({ kind: 'samePrice', isShrinkflation: true, sizeChangePermille: -125, unitChangePermille: 143 });
  });
});

describe('details', () => {
  it('median: empty, odd, even exact', () => {
    expect(median([])).toBeNull();
    expect(eq(median([rat(3), rat(1), rat(2)])!, rat(2))).toBe(true);
    expect(eq(median([rat(1), rat(2)])!, rat(3, 2))).toBe(true);
  });
  it('dayNumber accepts real dates only', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2026-09-30')! - dayNumber('2025-09-30')!).toBe(365);
    expect(dayNumber('2024-02-29')).not.toBeNull();
    for (const bad of ['2026-02-29', '2026-13-01', '2026-1-1', '26-01-01', '2026-01-01T00:00', '', 'today']) expect(dayNumber(bad)).toBeNull();
  });
  it('a bad "today" is a programming error, not user input', () => {
    expect(() => productStats([], 'yesterday', EUR)).toThrow(RangeError);
  });
  it('chart points carry the exact unit price', () => {
    const s = productStats(S1.observations, S1.today, EUR);
    const promo = s.chart!.series[0].points.find((p) => p.isPromo)!;
    expect(eq(promo.unitPrice, rat(399))).toBe(true);
    expect(s.chart!.firstDay).toBe('2026-01-10');
    expect(s.chart!.lastDay).toBe('2026-08-28');
  });
});

describe('duplicate guard', () => {
  const base = {
    storeId: 1, observedOn: '2026-09-30', currency: 'EUR', packPriceMinor: 249, paidPriceMinor: null,
    packCount: 1, itemSize: '500', unit: 'g',
  };
  it('identical, also with an equal size written differently and lower-case currency', () => {
    expect(isDuplicate(base, { ...base })).toBe(true);
    expect(isDuplicate(base, { ...base, itemSize: '500.0', currency: 'eur' })).toBe(true);
  });
  it.each([
    ['store', { storeId: 2 }], ['no store', { storeId: null }], ['date', { observedOn: '2026-09-29' }],
    ['currency', { currency: 'USD' }], ['pack price', { packPriceMinor: 250 }], ['paid price', { paidPriceMinor: 199 }],
    ['pack count', { packCount: 2 }], ['size', { itemSize: '501' }], ['unit', { unit: 'kg' }],
  ])('differs by %s', (_label, change) => {
    expect(isDuplicate(base, { ...base, ...change })).toBe(false);
  });
});

describe('near-duplicate rule (R10, D64)', () => {
  const saved = {
    storeId: 1, observedOn: '2026-09-30', currency: 'EUR', packPriceMinor: 200, paidPriceMinor: null as number | null,
    packCount: 1, itemSize: '500', unit: 'g',
  };
  // [label, change to the new capture, expected]
  it.each([
    ['identical', {}, 'exact'],
    ['same tag written 0.5 kg', { itemSize: '0.5', unit: 'kg' }, 'near'],
    ['same tag written 2 x 250 g', { packCount: 2, itemSize: '250' }, 'near'],
    ['typo 1 cent up', { packPriceMinor: 201 }, 'near'],
    ['typo 1 cent down', { packPriceMinor: 199 }, 'near'],
    ['exactly +5 %', { packPriceMinor: 210 }, 'near'],
    ['exactly -5 %', { packPriceMinor: 190 }, 'near'],
    ['+5.5 %', { packPriceMinor: 211 }, null],
    ['-5.5 %', { packPriceMinor: 189 }, null],
    ['promotion price (-20 %)', { packPriceMinor: 160, isPromo: true }, null],
    ['after-deal price within 5 %', { paidPriceMinor: 195 }, 'near'],
    ['after-deal price 3 for 2', { paidPriceMinor: 133 }, null],
    ['other pack size, same unit price', { itemSize: '1', unit: 'kg', packPriceMinor: 400 }, null],
    ['size typo 50 g', { itemSize: '50' }, null],
    ['other store', { storeId: 2 }, null],
    ['no store vs store', { storeId: null }, null],
    ['other day', { observedOn: '2026-09-29' }, null],
    ['other currency', { currency: 'USD' }, null],
    ['lower-case currency', { currency: 'eur', packPriceMinor: 205 }, 'near'],
    ['other dimension, same number', { unit: 'ml' }, null],
    ['unknown unit', { unit: 'stone' }, null],
  ] as const)('%s', (_label, change, expected) => {
    expect(duplicateKind({ ...saved, ...change }, saved)).toBe(expected);
  });
  it('free items: only another free capture is near', () => {
    const free = { ...saved, packPriceMinor: 0 };
    expect(duplicateKind({ ...free, itemSize: '0.5', unit: 'kg' }, free)).toBe('near');
    expect(duplicateKind({ ...free, packPriceMinor: 1 }, free)).toBeNull();
  });
  it('both without a store on the same day count as the same place', () => {
    const none = { ...saved, storeId: null };
    expect(duplicateKind({ ...none, packPriceMinor: 202 }, none)).toBe('near');
  });
  it('the tolerance is measured against the saved price (not symmetric at the edge)', () => {
    expect(duplicateKind({ ...saved, packPriceMinor: 210 }, saved)).toBe('near'); // 10 <= 5 % of 200
    expect(duplicateKind(saved, { ...saved, packPriceMinor: 210 })).toBe('near'); // 10 <= 5 % of 210 = 10.5
    expect(duplicateKind({ ...saved, packPriceMinor: 2100 }, { ...saved, packPriceMinor: 2000 })).toBe('near');
    expect(duplicateKind({ ...saved, packPriceMinor: 2000 }, { ...saved, packPriceMinor: 2100 })).toBe('near'); // 100 <= 105
    expect(duplicateKind({ ...saved, packPriceMinor: 1995 }, { ...saved, packPriceMinor: 2100 })).toBe('near'); // 105 <= 105
    expect(duplicateKind({ ...saved, packPriceMinor: 1994 }, { ...saved, packPriceMinor: 2100 })).toBeNull(); // 106 > 105
  });
});

// ---------- seeded property tests (own PRNG, no dependency) ----------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

function randomBook(next: () => number): PriceObservation[] {
  const n = 1 + (next() % 14);
  const units = ['g', 'kg', 'oz', 'lb'];
  return Array.from({ length: n }, (_, i) => {
    const month = 1 + (next() % 12);
    const dayOfMonth = 1 + (next() % 28);
    return {
      id: i + 1,
      storeId: next() % 4 === 0 ? null : 1 + (next() % 3),
      observedOn: `${2024 + (next() % 3)}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`,
      createdAt: `2026-01-01T00:00:${String(next() % 60).padStart(2, '0')}.000Z`,
      currency: 'EUR',
      packPriceMinor: next() % 2000,
      paidPriceMinor: next() % 5 === 0 ? next() % 1000 : null,
      packCount: 1 + (next() % 3),
      itemSize: String(50 + (next() % 950)),
      unit: units[next() % units.length],
      depositMinor: 0,
      isPromo: next() % 4 === 0,
    };
  });
}

describe('properties (2 000 random books each)', () => {
  const RUNS = 2000;
  it('lowest <= usual <= highest, latest is the newest, counts add up', () => {
    const next = mulberry32(31);
    for (let i = 0; i < RUNS; i++) {
      const book = randomBook(next);
      const s = productStats(book, '2026-09-30', EUR);
      expect(s.count).toBe(book.length);
      expect(cmp(s.lowest!.unitPrice, s.usual!.value)).toBeLessThanOrEqual(0);
      expect(cmp(s.usual!.value, s.highest!.unitPrice)).toBeLessThanOrEqual(0);
      const newest = [...book].sort((a, b) => (a.observedOn + a.createdAt + String(a.id).padStart(3, '0') < b.observedOn + b.createdAt + String(b.id).padStart(3, '0') ? 1 : -1))[0];
      expect(s.latest!.id).toBe(newest.id);
      expect(s.stores.reduce((t, r) => t + r.count, 0)).toBe(book.length);
    }
  });
  it('results do not depend on the order observations arrive in', () => {
    const next = mulberry32(32);
    for (let i = 0; i < RUNS; i++) {
      const book = randomBook(next);
      const shuffled = [...book].reverse();
      const a = productStats(book, '2026-09-30', EUR);
      const b = productStats(shuffled, '2026-09-30', EUR);
      expect(summary(b, { today: '2026-09-30', settings: EUR, observations: shuffled, candidates: ['5'] }))
        .toEqual(summary(a, { today: '2026-09-30', settings: EUR, observations: book, candidates: ['5'] }));
    }
  });
  it('the gauge verdict and % do not depend on the display basis', () => {
    const next = mulberry32(33);
    const perOz: StatsSettings = { ...EUR, bases: { mass: 'oz' } };
    for (let i = 0; i < RUNS; i++) {
      const book = randomBook(next);
      const kg = productStats(book, '2026-09-30', EUR);
      const oz = productStats(book, '2026-09-30', perOz);
      const xKg = rat(next() % 3000);
      const xOz = div(rat(xKg.n * BigInt(28349523125)), rat(BigInt(1000) * pow10(9))); // same price per oz (28.349523125 g)
      expect(gauge(oz, xOz)).toEqual(gauge(kg, xKg));
    }
  });
  it('every shrinkflation event has a pack at least 1 % smaller than the previous regular price', () => {
    const next = mulberry32(34);
    let seen = 0;
    for (let i = 0; i < RUNS; i++) {
      for (const e of productStats(randomBook(next), '2026-09-30', EUR).shrinkflation) {
        seen++;
        expect(e.previous.isPromo || e.current.isPromo).toBe(false);
        expect(cmp(e.current.quantity, e.previous.quantity)).toBeLessThan(0);
        expect(e.sizeChangePermille).toBeLessThanOrEqual(-10);
      }
    }
    expect(seen).toBeGreaterThan(100);
  });
});
