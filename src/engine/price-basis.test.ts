/** @jest-environment node */
// D40 / review finding #2: one price-memory basis. History, the gauge and prices saved from Compare are all
// "shelf price after deals and coupons, before added tax and cashback"; only the Compare ranking includes tax and
// cashback. Every expected number here is typed by hand from the review's probe, not computed by the engine.
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { addObservation, listObservations, toPriceObservation } from '@/db/observations';
import { createProduct } from '@/db/products';
import { strings } from '@/lib/strings';

import { evaluateCard, memoryPrice, type Breakdown, type Card, type EngineSettings } from './deals';
import { eq, rat } from './rational';
import { compareGauge, gauge, productStats, type PriceObservation, type StatsSettings } from './stats';

const USD_TAX: EngineSettings = { currency: 'USD', taxMode: 'add', taxRate: '8.875', measurementSystem: 'us', bases: { mass: 'oz' } };
const STATS_USD: StatsSettings = { currency: 'USD', dimension: 'mass', measurementSystem: 'us', bases: { mass: 'oz' } };

function shelf(id: number, observedOn: string, packPriceMinor: number): PriceObservation {
  return {
    id, storeId: 1, observedOn, createdAt: `${observedOn}T10:00:00.000Z`, currency: 'USD', packPriceMinor, paidPriceMinor: null,
    packCount: 1, itemSize: '12', unit: 'oz', depositMinor: 0, isPromo: false,
  };
}
// The review's history: four USD shelf prices of 12 oz, usual $4.99.
const HISTORY = [shelf(1, '2026-06-01', 499), shelf(2, '2026-07-01', 499), shelf(3, '2026-08-01', 479), shelf(4, '2026-09-01', 519)];

function evaluate(card: Card, settings: EngineSettings): Breakdown {
  const r = evaluateCard(card, settings);
  if (!r.ok) throw new Error(r.missing);
  return r.breakdown;
}

describe('review probe: the same $4.99 tag in add-tax mode', () => {
  const stats = productStats(HISTORY, '2026-09-30', STATS_USD);
  const b = evaluate({ id: 'A', priceMinor: 499, size: { packCount: 1, itemSize: '12' }, unit: 'oz' }, USD_TAX);

  it('the history usual is $4.99 per 12 oz', () => {
    expect(eq(stats.usual!.value, rat(499, 12))).toBe(true);
  });
  it('was "Highest you\'ve seen, +9 %" on the tax-inclusive Compare price (the bug)', () => {
    expect(eq(b.unitPrice, rat(543, 12))).toBe(true); // 499 + round(44.286) = 543
    expect(gauge(stats, b.unitPrice)).toMatchObject({ kind: 'verdict', verdict: 'highest', percentVsUsual: 9 });
  });
  it('is "Usual price, 0 %" on the price-memory basis', () => {
    expect(eq(b.memoryUnitPrice, rat(499, 12))).toBe(true);
    expect(compareGauge(stats, b)).toMatchObject({ kind: 'verdict', verdict: 'usual', percentVsUsual: 0 });
  });
  it('says what the memory basis leaves out, so the Compare screen can label it', () => {
    expect(b.memoryExcludes).toEqual({ tax: true, cashback: false });
    expect(strings.priceMemory.basisBeforeTax).toMatch(/before tax/);
  });
});

describe('memory basis details', () => {
  it('include-tax mode: the shelf price already holds the tax, nothing is left out', () => {
    const b = evaluate({ id: 'A', priceMinor: 299, size: { packCount: 1, itemSize: '1' }, unit: 'kg' }, {
      currency: 'EUR', taxMode: 'include', taxRate: '7', measurementSystem: 'metric',
    });
    expect(b.memoryExcludes).toEqual({ tax: false, cashback: false });
    expect(eq(b.memoryUnitPrice, b.unitPrice)).toBe(true);
  });
  it('cashback is left out of the memory basis and flagged', () => {
    const b = evaluate(
      { id: 'A', priceMinor: 1999, size: { packCount: 1, itemSize: '12' }, unit: 'pcs', deals: { cashback: { pct: '10' } } },
      { currency: 'USD', taxMode: 'add', taxRate: '6', measurementSystem: 'us' }
    );
    expect(b.memoryExcludes).toEqual({ tax: true, cashback: true });
    expect(eq(b.memoryUnitPrice, rat(1999, 12))).toBe(true);
  });
  it('compareGauge converts a card shown per 100 g to the history basis per kg', () => {
    const eur = (id: number, minor: number): PriceObservation => ({ ...shelf(id, '2026-09-0' + id, minor), currency: 'EUR', itemSize: '1', unit: 'kg' });
    const stats = productStats([eur(1, 500), eur(2, 500), eur(3, 600)], '2026-09-30', { currency: 'EUR', dimension: 'mass', measurementSystem: 'metric' });
    const b = evaluate({ id: 'A', priceMinor: 50, size: { packCount: 1, itemSize: '100' }, unit: 'g' }, {
      currency: 'EUR', taxMode: 'include', measurementSystem: 'metric', bases: { mass: '100g' },
    });
    expect(b.basis).toBe('100g');
    expect(compareGauge(stats, b)).toMatchObject({ verdict: 'lowest', percentVsUsual: 0 });
  });
  it('another dimension has no gauge', () => {
    const stats = productStats(HISTORY, '2026-09-30', STATS_USD);
    const b = evaluate({ id: 'A', priceMinor: 499, size: { packCount: 1, itemSize: '1' }, unit: 'l' }, { currency: 'USD', taxMode: 'add', measurementSystem: 'us' });
    expect(compareGauge(stats, b)).toBeNull();
  });
});

describe('save from Compare stores the same basis as a hand-typed shelf price', () => {
  it('3 for 2 at EUR 2.29 (500 g): pack 229, paid 458/3 = 152.67 -> 153, promo', () => {
    const card: Card = { id: 'A', priceMinor: 229, size: { packCount: 1, itemSize: '500' }, unit: 'g', deals: { quantity: { kind: 'buyXGetY', x: 2, y: 1, pct: '100' } } };
    expect(memoryPrice(card, evaluate(card, { currency: 'EUR', taxMode: 'include', measurementSystem: 'metric' }))).toEqual({
      packPriceMinor: 229, paidPriceMinor: 153, packCount: 1, itemSize: '500', unit: 'g', depositMinor: 0, isPromo: true,
    });
  });
  it('US tax and cashback never reach the saved price; the saved row then reads "Usual price"', async () => {
    const db = createTestDb();
    await migrate(db);
    const p = await createProduct(db, { name: 'Coffee', dimension: 'mass' });
    if (!p.ok) throw new Error('product');
    for (const o of HISTORY) {
      const r = await addObservation(db, { productId: p.id, storeId: null, observedOn: o.observedOn, currency: 'USD', packPriceMinor: o.packPriceMinor, packCount: 1, itemSize: '12', unit: 'oz' }, { today: '2026-09-30' });
      expect(r.ok).toBe(true);
    }
    const card: Card = { id: 'A', priceMinor: 499, size: { packCount: 1, itemSize: '12' }, unit: 'oz', deals: { cashback: { amountMinor: 50 } } };
    const saved = memoryPrice(card, evaluate(card, USD_TAX))!;
    expect(saved).toMatchObject({ packPriceMinor: 499, paidPriceMinor: null, isPromo: false });
    const r = await addObservation(db, { productId: p.id, storeId: null, observedOn: '2026-09-30', currency: 'USD', ...saved }, { today: '2026-09-30' });
    expect(r.ok).toBe(true);
    const rows = (await listObservations(db, p.id)).map(toPriceObservation);
    const all = productStats(rows, '2026-09-30', STATS_USD);
    expect(eq(all.latest!.unitPrice, rat(499, 12))).toBe(true);
    expect(eq(all.usual!.value, rat(499, 12))).toBe(true);
  });
});
