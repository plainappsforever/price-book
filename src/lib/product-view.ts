// The Product screen (SPEC 2.3) as plain data: tiles, gauge bar, shrinkflation banners, store table, chart summary
// and price list rows. Pure (Jest checks the SPEC S1 and S2 numbers as text).
import type { ObservationRecord } from '@/engine/backup';
import { currencyExponent, formatMinor, rescaleMinor } from '@/engine/money';
import { GAUGE_MIN_PRICES, type ChartPoint, type GaugeResult, type PricePoint, type ShrinkEvent, type Stats, type StoreRow } from '@/engine/stats';
import { isUnitId, type UnitId } from '@/engine/units';

import type { DecimalSeparator } from './app-settings';
import { relativeDate } from './dates';
import { decimal, fill, gaugeText, unitPriceLine, type FormatContext } from './format';
import { strings } from './strings';

export type ProductContext = {
  today: string;
  locale: string;
  sep: DecimalSeparator;
  storeName: (id: number | null) => string | null;
  /** Tax is added at the till (US style): saved amounts are before tax and say so (D40, REVIEW_V1 S3). */
  taxAdded?: boolean;
};

const MULT = strings.compare.multiply;

function fmt(stats: Stats, ctx: ProductContext): FormatContext {
  return { currency: stats.currency, locale: ctx.locale, sep: ctx.sep, unitDecimals: stats.decimals };
}

/** "500 g", "6×330 ml". */
export function packSizeText(packCount: number, itemSize: string, unit: string, sep: DecimalSeparator): string {
  const symbol = isUnitId(unit) ? strings.units[unit as UnitId] : unit;
  return `${packCount > 1 ? `${packCount}${MULT}` : ''}${decimal(itemSize, sep)} ${symbol}`;
}

export type Tile = {
  id: 'latest' | 'lowest' | 'usual' | 'highest';
  label: string;
  /** "€4.98 per kg". */
  unit: string;
  /** "€2.49 · 500 g · Rewe · 2 months ago". */
  detail: string;
  promo: boolean;
  note: string | null;
};

function pointDetail(p: PricePoint, stats: Stats, ctx: ProductContext): string {
  const store = ctx.storeName(p.storeId);
  const money = formatMinor(p.effectiveMinor, stats.currency, ctx.locale);
  return [money, packSizeText(p.packCount, p.itemSize, p.unit, ctx.sep), store, relativeDate(p.observedOn, ctx.today)].filter(Boolean).join(' · ');
}

export function buildTiles(stats: Stats, ctx: ProductContext): Tile[] {
  const f = fmt(stats, ctx);
  const t = strings.product;
  const tiles: Tile[] = [];
  const point = (id: Tile['id'], label: string, p: PricePoint | null, note: string | null) => {
    if (p) tiles.push({ id, label, unit: unitPriceLine(p.unitPrice, stats.basis, f), detail: pointDetail(p, stats, ctx), promo: p.isPromo, note });
  };
  point('latest', t.latest, stats.latest, null);
  point('lowest', t.lowest, stats.lowest, null);
  if (stats.usual) {
    const u = stats.usual;
    const note = u.source === 'regular' ? fill(t.basedOnRegular, { n: u.basedOn }) : u.source === 'all' ? fill(t.basedOnAll, { n: u.basedOn }) : fill(t.basedOnOlder, { n: u.basedOn });
    tiles.push({ id: 'usual', label: t.usual, unit: unitPriceLine(u.value, stats.basis, f), detail: note, promo: false, note });
  }
  point('highest', t.highest, stats.highest, null);
  return tiles;
}

export type GaugeBarView = { text: string; usualPermille: number; latestPermille: number; lowLabel: string; highLabel: string } | { text: string; usualPermille: null };

/** The gauge bar under the tiles: lowest -> highest with the usual marker and the latest dot. */
export function buildGaugeBar(stats: Stats, g: GaugeResult | null, ctx: ProductContext): GaugeBarView | null {
  if (!g || !stats.lowest || !stats.highest) return null;
  // The latest price is judged against the prices before it, but "Building your history" counts every saved price
  // (it read "(0 prices)" under a product with one price, RELEASE_KIT 1c item 17).
  const text = g.kind === 'building' ? fill(strings.gauge.buildingProduct, { count: stats.count, need: GAUGE_MIN_PRICES }) : gaugeText(g);
  if (g.kind !== 'verdict') return { text, usualPermille: null };
  const f = fmt(stats, ctx);
  return {
    text,
    usualPermille: g.usualPermille,
    latestPermille: g.candidatePermille,
    lowLabel: unitPriceLine(stats.lowest.unitPrice, stats.basis, f),
    highLabel: unitPriceLine(stats.highest.unitPrice, stats.basis, f),
  };
}

export type Banner = { kind: ShrinkEvent['kind']; shrink: boolean; headline: string; detail: string };

function signedPermille(permille: number, sep: DecimalSeparator): string {
  const abs = Math.abs(permille);
  return `${permille < 0 ? '−' : '+'}${Math.floor(abs / 10)}${sep}${abs % 10}`;
}
function plainPermille(permille: number, sep: DecimalSeparator): string {
  const abs = Math.abs(permille);
  return `${Math.floor(abs / 10)}${sep}${abs % 10}`;
}

export function buildBanners(stats: Stats, ctx: ProductContext): Banner[] {
  const t = strings.product.shrink;
  const basis = strings.bases[stats.basis];
  return stats.shrinkflation.map((e) => {
    const less = plainPermille(e.sizeChangePermille, ctx.sep);
    const unit = `${signedPermille(e.unitChangePermille, ctx.sep)} % ${basis}`;
    const vars = { less, unit };
    const headline =
      e.kind === 'samePrice' ? fill(t.samePrice, vars)
      : e.kind === 'priceUp' ? fill(t.priceUp, vars)
      : e.kind === 'cheaperPackDearerUnit' ? fill(t.cheaperPack, vars)
      : e.kind === 'packSmaller' ? fill(t.packSmaller, vars)
      : e.kind === 'smallerNotDearer' ? fill(t.smallerNotDearer, vars)
      : fill(t.differentPackSize, vars);
    const from = packSizeText(e.previous.packCount, e.previous.itemSize, e.previous.unit, ctx.sep);
    const to = packSizeText(e.current.packCount, e.current.itemSize, e.current.unit, ctx.sep);
    const store = ctx.storeName(e.current.storeId);
    const detail = fill(t.detail, { from, to, when: e.current.observedOn }) + (store ? ` · ${store}` : '');
    return { kind: e.kind, shrink: e.isShrinkflation, headline, detail };
  });
}

export type StoreLine = { key: string; name: string; latest: string; lowest: string; count: string; stale: string | null; cheapest: boolean };

export function buildStoreTable(stats: Stats, ctx: ProductContext): StoreLine[] {
  const f = fmt(stats, ctx);
  return stats.stores.map((r: StoreRow) => ({
    key: String(r.storeId ?? 'none'),
    name: ctx.storeName(r.storeId) ?? strings.stores.noStore,
    latest: `${unitPriceLine(r.latest.unitPrice, stats.basis, f)} · ${relativeDate(r.latest.observedOn, ctx.today)}`,
    lowest: unitPriceLine(r.lowest.unitPrice, stats.basis, f),
    count: String(r.count),
    stale: r.stale ? strings.product.stale : null,
    cheapest: r.lastSeenCheapest,
  }));
}

export const STORE_COLORS = ['#0A6BD8', '#D9480F', '#2B8A3E', '#9C36B5', '#C2255C', '#E67700', '#0C8599', '#5F3DC4'] as const;

/** One colour per store, in the order the chart's series come (stable for a product). */
export function seriesColor(index: number): string {
  return STORE_COLORS[index % STORE_COLORS.length];
}

/** Text summary of the chart for screen readers (SPEC 2.3). */
export function chartSummary(stats: Stats, ctx: ProductContext): string | null {
  const c = stats.chart;
  if (!c) return null;
  const f = fmt(stats, ctx);
  const pts = c.series.reduce((n, s) => n + s.points.length, 0);
  return fill(strings.product.chartSummary, {
    n: pts, first: c.firstDay, last: c.lastDay, low: unitPriceLine(c.low, stats.basis, f), high: unitPriceLine(c.high, stats.basis, f),
  });
}

export type ChartDot = ChartPoint & { color: string };

export type PriceLine = {
  id: number;
  date: string;
  relative: string;
  store: string;
  pack: string;
  size: string;
  unit: string | null;
  promo: boolean;
  deal: string | null;
  note: string | null;
  other: boolean;
};

/** Newest first; the unit price comes from the statistics (book currency only, else a dash). */
export function buildPriceLines(rows: readonly ObservationRecord[], stats: Stats, ctx: ProductContext): PriceLine[] {
  const f = fmt(stats, ctx);
  const byId = new Map<number, PricePoint>(stats.points.map((p) => [p.id, p]));
  return rows.map((r) => {
    const point = byId.get(r.id);
    const other = r.currency !== stats.currency;
    const exp = currencyExponent(r.currency);
    const scale = r.minor_digits ?? exp;
    const showMinor = (minor: number) => formatMinor(rescaleMinor(minor, scale, exp), r.currency, ctx.locale);
    const shelf = showMinor(r.pack_price_minor);
    const paid = r.paid_price_minor !== null && r.paid_price_minor !== r.pack_price_minor ? showMinor(r.paid_price_minor) : null;
    return {
      id: r.id,
      date: r.observed_on,
      relative: relativeDate(r.observed_on, ctx.today),
      store: ctx.storeName(r.store_id) ?? strings.stores.noStore,
      pack: paid ? fill(ctx.taxAdded ? strings.product.shelfPaidBeforeTax : strings.product.shelfPaid, { shelf, paid }) : shelf,
      size: packSizeText(r.pack_count, r.item_size, r.unit, ctx.sep),
      unit: point ? unitPriceLine(point.unitPrice, stats.basis, f) : null,
      promo: r.is_promo === 1,
      deal: r.deal_text,
      note: r.note,
      other,
    };
  });
}
