/** @jest-environment node */
// Price Book rows and the Product screen words for the SPEC S1 and S2 books (A7), from the same seed the Maestro flows load.
import type { ObservationRecord } from '@/engine/backup';
import type { ProductListRow } from '@/db/products';
import { toPriceObservation } from '@/db/observations';
import { seedData } from '@/debug/seeds';
import { readAppSettings } from './app-settings';
import { savedBasisText } from './format';
import { buildRowView, computeRowStats, gaugeChip, riseKey, sortByRise } from './book-view';
import { buildBanners, buildGaugeBar, buildPriceLines, buildStoreTable, buildTiles, chartSummary, packSizeText } from './product-view';

const TODAY = '2026-09-30';
const EU = readAppSettings({ currency: 'EUR', unitSystem: 'metric', decimalSeparator: '.' });
const book = seedData('s1');
const names = new Map(book.stores.map((s) => [s.id, s.name]));
const ctx = { today: TODAY, locale: 'en-US', sep: '.' as const, storeName: (id: number | null) => (id === null ? null : (names.get(id) ?? null)) };
const rowsOf = (productId: number): ObservationRecord[] => book.observations.filter((o) => o.product_id === productId);
const statsOf = (productId: number) => {
  const p = book.products.find((x) => x.id === productId)!;
  return computeRowStats(rowsOf(productId).map(toPriceObservation), p.dimension as 'mass', TODAY, EU);
};
const listRow = (productId: number): ProductListRow => ({ ...book.products.find((x) => x.id === productId)!, uid: `u${productId}`, price_count: rowsOf(productId).length, last_observed_on: null, store_names: null });

describe('Price Book rows (SPEC 2.2)', () => {
  it('Coffee: latest €4.98 per kg at Rewe, a month ago, usual price, star', () => {
    const v = buildRowView(listRow(1), statsOf(1), ctx);
    expect(v.title).toBe('Coffee beans');
    expect(v.subtitle).toBe('Mokka Mill · Crema · Coffee');
    expect(v.priceLine).toBe('€4.98 per kg');
    expect(v.whereWhen).toBe('Rewe · 4 weeks ago');
    expect(v.chip?.text).toBe('Usual price');
    expect(v.favorite).toBe(true);
    expect(v.shrink).toBe(false);
    expect(v.countText).toBe('5 prices');
  });
  it('Crisps: shrinkflation mark, €11.37 per kg, no chip while the history is building', () => {
    const v = buildRowView(listRow(2), statsOf(2), ctx);
    expect(v.priceLine).toBe('€11.37 per kg');
    expect(v.shrink).toBe(true);
    expect(v.chip).toBeNull();
  });
  it('a product without prices says so', () => {
    const empty = { ...listRow(1), price_count: 0 };
    const rs = computeRowStats([], 'mass', TODAY, EU);
    const v = buildRowView(empty, rs, ctx);
    expect(v.priceLine).toBeNull();
    expect(v.countText).toBe('No prices yet');
  });
  it('gauge chip words', () => {
    expect(gaugeChip(null)).toBeNull();
    expect(gaugeChip({ kind: 'building', count: 2 })).toBeNull();
    const g = (verdict: 'good' | 'above', pct: number | null) => ({ kind: 'verdict' as const, verdict, percentVsUsual: pct, percentCapped: false, basedOn: 4, usualPermille: 500, candidatePermille: 500 });
    expect(gaugeChip(g('good', -10))?.text).toBe('Good price −10 %');
    expect(gaugeChip(g('above', 12))?.text).toBe('Above usual +12 %');
    expect(gaugeChip(g('above', null))?.text).toBe('Above usual');
  });
});

describe('sort by biggest rise vs usual', () => {
  it('biggest first, unknown last, ties keep their order', () => {
    const items = [{ k: 3 }, { k: null }, { k: 12 }, { k: 3 }, { k: -5 }];
    const sorted = sortByRise(items.map((x, i) => ({ ...x, i })), (x) => x.k);
    expect(sorted.map((x) => x.i)).toEqual([2, 0, 3, 4, 1]);
  });
  it('riseKey reads the gauge percent', () => {
    expect(riseKey(statsOf(1))).toBe(0);
    expect(riseKey(statsOf(2))).toBeNull();
  });
});

describe('Product screen (SPEC 5.8 S1, A7)', () => {
  const s = statsOf(1);
  it('tiles: Usual €4.98, Lowest €3.99 (promo), Highest €5.18, Latest €4.98 at Rewe', () => {
    const t = Object.fromEntries(buildTiles(s.stats, ctx).map((x) => [x.id, x]));
    expect(t.usual.unit).toBe('€4.98 per kg');
    expect(t.usual.note).toBe('based on 4 regular prices');
    expect(t.lowest.unit).toBe('€3.99 per kg');
    expect(t.lowest.promo).toBe(true);
    expect(t.highest.unit).toBe('€5.18 per kg');
    expect(t.latest.unit).toBe('€4.98 per kg');
    expect(t.latest.detail).toBe('€2.49 · 500 g · Rewe · 4 weeks ago');
    expect(t.lowest.detail).toBe('€3.99 · 1 kg · Rewe · 6 months ago');
  });
  it('store table: Rewe latest, Aldi stale, last seen cheapest = Rewe', () => {
    const rows = buildStoreTable(s.stats, ctx);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.Rewe.cheapest).toBe(true);
    expect(byName.Rewe.count).toBe('3');
    expect(byName.Rewe.lowest).toBe('€3.99 per kg');
    expect(byName.Aldi.stale).toBe('Older than 90 days');
    expect(byName.Aldi.cheapest).toBe(false);
    expect(byName.Edeka.stale).toBeNull();
  });
  it('gauge bar and chart summary', () => {
    const bar = buildGaugeBar(s.stats, s.gauge, ctx);
    expect(bar).toMatchObject({ text: 'Same as your usual — Usual price' });
    expect(chartSummary(s.stats, ctx)).toBe('5 prices from 2026-01-10 to 2026-08-28, between €3.99 per kg and €5.18 per kg');
  });
  it('price list: newest first, promo deal text, store names', () => {
    const rows = [...rowsOf(1)].sort((a, b) => b.observed_on.localeCompare(a.observed_on));
    const lines = buildPriceLines(rows, s.stats, ctx);
    expect(lines[0]).toMatchObject({ date: '2026-08-28', store: 'Rewe', pack: '€2.49', size: '500 g', unit: '€4.98 per kg', promo: false });
    const promo = lines.find((l) => l.promo)!;
    expect(promo.deal).toContain('1 kg for 3.99');
    expect(promo.size).toBe('1 kg');
  });
  it('REVIEW_V1 S3: a price saved after a deal never says "paid"; in add-tax mode it says "before tax"', () => {
    const row: ObservationRecord = { ...rowsOf(1)[0], id: 99, pack_price_minor: 229, paid_price_minor: 153, is_promo: 1, deal_text: '3 for 2' };
    const st = computeRowStats([row].map(toPriceObservation), 'mass', TODAY, EU).stats;
    const include = buildPriceLines([row], st, ctx)[0].pack;
    const add = buildPriceLines([row], st, { ...ctx, taxAdded: true })[0].pack;
    expect(include).toBe('€2.29 (after deal €1.53)');
    expect(add).toBe('€2.29 (after deal €1.53, before tax)');
    for (const t of [include, add]) expect(t).not.toMatch(/paid/i);
    expect(savedBasisText('add')).toBe('Saved prices are shelf prices after in-store deals, before tax and cashback.');
    expect(savedBasisText('include')).toBe('Saved prices are shelf prices after in-store deals, before cashback.');
  });
  it('"Building your history" counts every saved price (it read "(0 prices)" under one price)', () => {
    const one = computeRowStats(rowsOf(1).slice(0, 1).map(toPriceObservation), 'mass', TODAY, EU);
    expect(buildGaugeBar(one.stats, one.gauge, ctx)?.text).toBe('Building your history: 1 price so far; the latest gets a verdict after 3 earlier prices');
  });
  it('S2: crisps banner reads "Same price, 12.5 % less — +14.3 % per kg"', () => {
    const c = statsOf(2);
    const banners = buildBanners(c.stats, ctx);
    expect(banners).toHaveLength(1);
    expect(banners[0].headline).toBe('Same price, 12.5 % less — +14.3 % per kg');
    expect(banners[0].shrink).toBe(true);
    expect(banners[0].detail).toBe('200 g → 175 g · since 2026-09-01 · Rewe');
  });
  it('comma format', () => {
    expect(packSizeText(6, '0.33', 'l', ',')).toBe('6×0,33 L');
  });
});
