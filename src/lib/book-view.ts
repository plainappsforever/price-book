// Price Book list rows (SPEC 2.2): one product -> the words on its row. Pure; the screen computes the statistics
// lazily per visible row (A17) and only computes every row when sorting by "biggest rise vs usual".
import type { ProductListRow } from '@/db/products';
import { gauge, productStats, type GaugeResult, type GaugeVerdict, type PriceObservation, type Stats } from '@/engine/stats';
import type { Dimension } from '@/engine/units';

import type { AppSettings, DecimalSeparator } from './app-settings';
import { relativeDate } from './dates';
import { fill, unitPriceLine } from './format';
import { strings } from './strings';

export type RowStats = { stats: Stats; /** The latest price judged against the history before it (null without prices). */ gauge: GaugeResult | null };

/** Statistics of one product plus its latest price judged against the earlier history. */
export function computeRowStats(observations: readonly PriceObservation[], dimension: Dimension, today: string, s: AppSettings): RowStats {
  const settings = { currency: s.currency, measurementSystem: s.unitSystem, bases: s.bases, dimension };
  const stats = productStats(observations, today, settings);
  if (!stats.latest) return { stats, gauge: null };
  const latestId = stats.latest.id;
  const before = productStats(observations.filter((o) => o.id !== latestId), today, settings);
  return { stats, gauge: gauge(before, stats.latest.unitPrice) };
}

const caches = new WeakMap<object, WeakMap<object, Map<string, RowStats>>>();

/** Statistics already computed for this loaded book and these settings, keyed by day and product (rows scroll in lazily). */
export function rowStatsCache(book: object, settings: object): Map<string, RowStats> {
  let bySettings = caches.get(book);
  if (!bySettings) caches.set(book, (bySettings = new WeakMap()));
  let map = bySettings.get(settings);
  if (!map) bySettings.set(settings, (map = new Map()));
  return map;
}

export type RowContext = { today: string; locale: string; sep: DecimalSeparator; storeName: (id: number | null) => string | null };

export type RowView = {
  id: number;
  title: string;
  subtitle: string;
  priceLine: string | null;
  whereWhen: string | null;
  chip: { text: string; verdict: GaugeVerdict } | null;
  shrink: boolean;
  favorite: boolean;
  countText: string;
};

/** "Good price −10 %" / "Above usual +12 %" / "Usual price"; null while the history is still building. */
export function gaugeChip(g: GaugeResult | null): { text: string; verdict: GaugeVerdict } | null {
  if (!g || g.kind !== 'verdict') return null;
  const verdict = strings.gauge[g.verdict];
  const pct = g.percentVsUsual;
  if (pct === null || pct === 0) return { text: verdict, verdict: g.verdict };
  return { text: fill(strings.book.chipDelta, { verdict, delta: `${pct < 0 ? '−' : '+'}${Math.abs(pct)}` }), verdict: g.verdict };
}

export function buildRowView(p: ProductListRow, rs: RowStats, ctx: RowContext): RowView {
  const { stats } = rs;
  const latest = stats.latest;
  const when = latest ? relativeDate(latest.observedOn, ctx.today) : null;
  const store = latest ? ctx.storeName(latest.storeId) : null;
  return {
    id: p.id,
    title: p.name,
    subtitle: [p.brand, p.variant, p.category].filter(Boolean).join(' · '),
    priceLine: latest ? unitPriceLine(latest.unitPrice, stats.basis, { currency: stats.currency, locale: ctx.locale, sep: ctx.sep, unitDecimals: stats.decimals }) : null,
    whereWhen: latest ? [store, when].filter(Boolean).join(' · ') : null,
    chip: gaugeChip(rs.gauge),
    shrink: stats.shrinkflation.some((e) => e.isShrinkflation),
    favorite: p.favorite === 1,
    countText: p.price_count === 0 ? strings.book.noPrices : fill(p.price_count === 1 ? strings.book.onePrice : strings.book.prices, { count: p.price_count }),
  };
}

/** Sort key of "biggest rise vs usual": whole % of the latest price over the usual price; null when unknown. */
export function riseKey(rs: RowStats): number | null {
  const g = rs.gauge;
  return g && g.kind === 'verdict' ? g.percentVsUsual : null;
}

/** Orders rows by rise vs usual, biggest first; rows without a figure last, ties keep their incoming order. */
export function sortByRise<T>(items: readonly T[], key: (item: T) => number | null): T[] {
  return items
    .map((item, index) => ({ item, index, k: key(item) }))
    .sort((a, b) => (a.k === null ? 1 : 0) - (b.k === null ? 1 : 0) || (b.k ?? 0) - (a.k ?? 0) || a.index - b.index)
    .map((x) => x.item);
}
