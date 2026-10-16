// Price memory statistics for one product (SPEC §5.8, D17, D35). Pure and exact: every unit price is a Rat
// in minor units per display basis, u = (paid ?? pack price) / Q x basis, deposit excluded. Nothing here is
// rounded except the integer positions (permille) and percentages handed to the UI, each half up once.
// Only prices in the book currency count; others are counted and reported, never mixed in.
import { add, clampToInt, cmp, div, eq, fromDecimal, mul, pow10, rat, roundHalfUp, sub, toSafeInt, type Rat } from './rational';
import { basisFor, type Breakdown, type EngineSettings } from './deals';
import { currencyExponent, unitPriceDecimals } from './money';
import { LIMITS } from './parse';
import { basisQuantity, dimensionOf, isUnitId, packQuantity, unitMatchesDimension, type BasisId, type Dimension, type UnitId } from './units';

const B0 = BigInt(0);
const DAY_MS = 86400000;
/** "the 365 days up to today" (D35: a price exactly 365 days old still counts). */
export const USUAL_WINDOW_DAYS = 365;
/** A store's latest price older than this many days is stale (SPEC §5.8). */
export const STALE_AFTER_DAYS = 90;
/** Empty window -> median of this many most recent prices ("older data"). */
export const OLDER_FALLBACK_COUNT = 5;
/** The gauge needs at least this many prices. */
export const GAUGE_MIN_PRICES = 3;

const PERCENT_95 = rat(95, 100);
const PERCENT_105 = rat(105, 100);
const PERCENT_99 = rat(99, 100);
/** D42: a pack more than 30 % smaller than the previous one is reported as a different pack size, not shrinkflation. */
const PERCENT_70 = rat(70, 100);
const THOUSAND = rat(1000);
const HUNDRED = rat(100);
const HALF = rat(1, 2);

// ---------- input ----------

/** One saved price as the engine sees it: integers and decimal text only (rows of `observations`). */
export type PriceObservation = {
  id: number;
  storeId: number | null;
  /** YYYY-MM-DD local date. */
  observedOn: string;
  /** ISO timestamp; breaks ties between prices of the same day. */
  createdAt: string;
  currency: string;
  /** Shelf price per pack (minor units). */
  packPriceMinor: number;
  /** Effective price per pack after deals; null = same as the pack price. */
  paidPriceMinor: number | null;
  packCount: number;
  /** Canonical decimal text of one item's size. */
  itemSize: string;
  unit: string;
  depositMinor: number;
  isPromo: boolean;
};

export type StatsSettings = Pick<EngineSettings, 'currency' | 'measurementSystem' | 'bases'> & { dimension: Dimension };

// ---------- output ----------

export type PricePoint = {
  id: number;
  storeId: number | null;
  observedOn: string;
  createdAt: string;
  isPromo: boolean;
  packPriceMinor: number;
  /** paid ?? pack price. */
  effectiveMinor: number;
  packCount: number;
  itemSize: string;
  unit: UnitId;
  /** Pack quantity Q in base units (g, ml, pcs, m). */
  quantity: Rat;
  /** Exact unit price in minor units per display basis. */
  unitPrice: Rat;
};

export type Usual = {
  value: Rat;
  /** How many prices the median was taken over. */
  basedOn: number;
  /** regular = >= 3 non-promo prices in the window; all = every price in the window; older = last 5 prices. */
  source: 'regular' | 'all' | 'older';
};

export type StoreRow = {
  storeId: number | null;
  latest: PricePoint;
  lowest: PricePoint;
  count: number;
  daysSinceLatest: number;
  stale: boolean;
  /** "Last seen cheapest": lowest latest price among non-stale stores (never "cheapest now", D17). */
  lastSeenCheapest: boolean;
};

export type ShrinkKind = 'samePrice' | 'priceUp' | 'cheaperPackDearerUnit' | 'packSmaller' | 'smallerNotDearer' | 'differentPackSize';

export type ShrinkEvent = {
  kind: ShrinkKind;
  /**
   * false for `smallerNotDearer` (smaller pack, unit price did not rise at the same store, D35) and for
   * `differentPackSize` (more than 30 % smaller: most likely another pack size of the product, D42).
   */
  isShrinkflation: boolean;
  /** The previous non-promo price (any store) — the size change is measured against it. */
  previous: PricePoint;
  current: PricePoint;
  /** Same store's previous non-promo price when there is one, else `previous`; the unit change is against it. */
  reference: PricePoint;
  sameStore: boolean;
  /** (Q_new - Q_prev) / Q_prev in tenths of a percent, half up (-125 = "12.5 % less"). */
  sizeChangePermille: number;
  /** Unit-price change vs `reference` in tenths of a percent (143 = "+14.3 % per kg"). */
  unitChangePermille: number;
};

export type ChartPoint = { id: number; observedOn: string; isPromo: boolean; xPermille: number; yPermille: number; unitPrice: Rat };
export type ChartSeries = { storeId: number | null; points: ChartPoint[] };
/** Plain arrays for a chart drawn with Views (D22): x by date, y between lowest (0) and highest (1000). */
export type ChartData = { firstDay: string; lastDay: string; low: Rat; high: Rat; series: ChartSeries[] };

export type Stats = {
  currency: string;
  exponent: number;
  dimension: Dimension;
  basis: BasisId;
  /** Prices used (book currency, valid size and unit). */
  count: number;
  /** "N prices in other currencies not shown". */
  otherCurrencyCount: number;
  /** Rows the engine could not use (unit of another dimension, bad size) — should be 0. */
  invalidCount: number;
  /** Usable prices, oldest first. */
  points: PricePoint[];
  latest: PricePoint | null;
  lowest: PricePoint | null;
  highest: PricePoint | null;
  usual: Usual | null;
  stores: StoreRow[];
  shrinkflation: ShrinkEvent[];
  chart: ChartData | null;
  /** Unit-price display decimals for this product (SPEC 5.1 rule over every value shown). */
  decimals: number;
};

export type GaugeVerdict = 'lowest' | 'highest' | 'good' | 'usual' | 'above';
export type GaugeResult =
  | { kind: 'building'; count: number }
  | {
      kind: 'verdict';
      verdict: GaugeVerdict;
      /** Whole % vs usual, half up away from zero, saturated at +-PERCENT_MAX; null when the usual price is 0. */
      percentVsUsual: number | null;
      /** The exact % is beyond PERCENT_MAX (UI: "more than …" and a check-the-price hint). */
      percentCapped: boolean;
      basedOn: number;
      /** Bar positions, lowest = 0 and highest = 1000 (clamped). */
      usualPermille: number;
      candidatePermille: number;
    };

// ---------- dates ----------

/** Days since 1970-01-01 for a valid YYYY-MM-DD date, else null. Exact: Date.UTC returns whole days in ms. */
export function dayNumber(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

export function isValidDate(date: unknown): date is string {
  return typeof date === 'string' && dayNumber(date) !== null;
}

// ---------- helpers ----------

/** Oldest first by (observed_on, created_at, id). */
function byOldest(a: { observedOn: string; createdAt: string; id: number }, b: { observedOn: string; createdAt: string; id: number }): number {
  if (a.observedOn !== b.observedOn) return a.observedOn < b.observedOn ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id - b.id;
}

/** The point with the smallest (dir = -1) or largest (dir = 1) unit price; ties -> the most recent. */
function extreme(points: readonly PricePoint[], dir: -1 | 1): PricePoint | null {
  let best: PricePoint | null = null;
  for (const p of points) {
    // points are oldest first, so ">=" / "<=" lets a later equal price win the tie
    if (!best || cmp(p.unitPrice, best.unitPrice) * dir >= 0) best = p;
  }
  return best;
}

/** Exact median; an even count gives the mean of the middle two. */
export function median(values: readonly Rat[]): Rat | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort(cmp);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : mul(add(sorted[mid - 1], sorted[mid]), HALF);
}

/** Display caps (review #4): extreme but accepted input never throws; the UI shows "more than" at the cap. */
export const PERMILLE_MAX = 1000000000;
export const PERCENT_MAX = 1000000;

/** round((value - base) / base x 1000) — a change in tenths of a percent (saturated at +-PERMILLE_MAX); null when base is 0. */
function changePermille(value: Rat, base: Rat): number | null {
  if (base.n === B0) return null;
  return clampToInt(roundHalfUp(mul(div(sub(value, base), base), THOUSAND)), PERMILLE_MAX);
}

/** Bar position 0..1000; clamped BEFORE any conversion, so a far-away value cannot overflow (review #4). */
function position(value: Rat, low: Rat, high: Rat): number {
  if (cmp(high, low) <= 0) return 500;
  if (cmp(value, low) <= 0) return 0;
  if (cmp(value, high) >= 0) return 1000;
  return toSafeInt(roundHalfUp(mul(div(sub(value, low), sub(high, low)), THOUSAND)));
}

function isWhole(value: unknown, lo: number, hi: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= lo && value <= hi;
}

/** An observation as an exact price point in `basis`, or null when it cannot be used. */
export function toPricePoint(o: PriceObservation, dimension: Dimension, basis: Rat): PricePoint | null {
  if (!unitMatchesDimension(o.unit, dimension) || !isUnitId(o.unit)) return null;
  if (!isWhole(o.packCount, 1, LIMITS.packCountMax)) return null;
  if (!isWhole(o.packPriceMinor, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (o.paidPriceMinor !== null && !isWhole(o.paidPriceMinor, 0, Number.MAX_SAFE_INTEGER)) return null;
  const size = fromDecimal(o.itemSize);
  if (!size || size.n <= B0) return null;
  const quantity = packQuantity(o.packCount, size, o.unit);
  const effectiveMinor = o.paidPriceMinor ?? o.packPriceMinor;
  return {
    id: o.id,
    storeId: o.storeId,
    observedOn: o.observedOn,
    createdAt: o.createdAt,
    isPromo: o.isPromo,
    packPriceMinor: o.packPriceMinor,
    effectiveMinor,
    packCount: o.packCount,
    itemSize: o.itemSize,
    unit: o.unit,
    quantity,
    unitPrice: mul(div(rat(effectiveMinor), quantity), basis),
  };
}

// ---------- the parts ----------

/** Usual price (SPEC 5.8): median over the window, non-promo when >= 3 of them, else older data. */
export function usualPrice(points: readonly PricePoint[], todayDay: number): Usual | null {
  const inWindow = points.filter((p) => {
    const day = dayNumber(p.observedOn);
    return day !== null && day >= todayDay - USUAL_WINDOW_DAYS;
  });
  const regular = inWindow.filter((p) => !p.isPromo);
  if (regular.length >= 3) return { value: median(regular.map((p) => p.unitPrice))!, basedOn: regular.length, source: 'regular' };
  if (inWindow.length > 0) return { value: median(inWindow.map((p) => p.unitPrice))!, basedOn: inWindow.length, source: 'all' };
  if (points.length === 0) return null;
  const recent = points.slice(-OLDER_FALLBACK_COUNT);
  return { value: median(recent.map((p) => p.unitPrice))!, basedOn: recent.length, source: 'older' };
}

/** Store table rows: non-stale first, each part ordered by latest unit price, then most recent. */
export function storeTable(points: readonly PricePoint[], todayDay: number): StoreRow[] {
  const keys: (number | null)[] = [];
  for (const p of points) if (!keys.includes(p.storeId)) keys.push(p.storeId);
  const rows: StoreRow[] = keys.map((storeId) => {
    const own = points.filter((p) => p.storeId === storeId);
    const latest = own[own.length - 1];
    const days = todayDay - (dayNumber(latest.observedOn) ?? todayDay);
    return { storeId, latest, lowest: extreme(own, -1)!, count: own.length, daysSinceLatest: days, stale: days > STALE_AFTER_DAYS, lastSeenCheapest: false };
  });
  const candidates = rows.filter((r) => !r.stale && r.storeId !== null);
  const best = candidates.reduce<Rat | null>((m, r) => (m === null || cmp(r.latest.unitPrice, m) < 0 ? r.latest.unitPrice : m), null);
  for (const r of candidates) if (best && eq(r.latest.unitPrice, best)) r.lastSeenCheapest = true;
  return rows.sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    const c = cmp(a.latest.unitPrice, b.latest.unitPrice);
    if (c !== 0) return c;
    return -byOldest(a.latest, b.latest);
  });
}

/**
 * Shrinkflation events over consecutive non-promo prices (SPEC 5.8, D35, D42). Only a NEW pack size counts: a size
 * already seen at an earlier regular price is a switch between pack sizes the product is sold in (review #6), and a
 * drop of more than 30 % is reported as `differentPackSize` without the shrinkflation flag.
 */
export function shrinkflationEvents(points: readonly PricePoint[]): ShrinkEvent[] {
  const regular = points.filter((p) => !p.isPromo);
  const events: ShrinkEvent[] = [];
  for (let i = 1; i < regular.length; i++) {
    const previous = regular[i - 1];
    const current = regular[i];
    if (cmp(current.quantity, mul(previous.quantity, PERCENT_99)) > 0) continue;
    if (regular.slice(0, i).some((p) => eq(p.quantity, current.quantity))) continue;
    let sameStoreRef: PricePoint | null = null;
    if (current.storeId !== null) {
      for (let j = i - 1; j >= 0; j--) {
        if (regular[j].storeId === current.storeId) {
          sameStoreRef = regular[j];
          break;
        }
      }
    }
    const reference = sameStoreRef ?? previous;
    const unitUp = cmp(current.unitPrice, reference.unitPrice) > 0;
    let kind: ShrinkKind;
    if (cmp(current.quantity, mul(previous.quantity, PERCENT_70)) < 0) kind = 'differentPackSize';
    else if (!sameStoreRef) kind = 'packSmaller';
    else if (current.packPriceMinor === sameStoreRef.packPriceMinor) kind = 'samePrice';
    else if (current.packPriceMinor > sameStoreRef.packPriceMinor) kind = 'priceUp';
    else kind = unitUp ? 'cheaperPackDearerUnit' : 'smallerNotDearer';
    events.push({
      kind,
      isShrinkflation: kind !== 'smallerNotDearer' && kind !== 'differentPackSize',
      previous,
      current,
      reference,
      sameStore: sameStoreRef !== null,
      sizeChangePermille: changePermille(current.quantity, previous.quantity) ?? 0,
      unitChangePermille: changePermille(current.unitPrice, reference.unitPrice) ?? 0,
    });
  }
  return events;
}

/** Chart arrays: one series per store (first-seen order), x by date, y between lowest and highest. */
export function chartData(points: readonly PricePoint[]): ChartData | null {
  if (points.length === 0) return null;
  const low = extreme(points, -1)!.unitPrice;
  const high = extreme(points, 1)!.unitPrice;
  const first = points[0].observedOn;
  const last = points[points.length - 1].observedOn;
  const firstDay = rat(dayNumber(first) ?? 0);
  const lastDay = rat(dayNumber(last) ?? 0);
  const series: ChartSeries[] = [];
  for (const p of points) {
    let s = series.find((x) => x.storeId === p.storeId);
    if (!s) {
      s = { storeId: p.storeId, points: [] };
      series.push(s);
    }
    s.points.push({
      id: p.id,
      observedOn: p.observedOn,
      isPromo: p.isPromo,
      xPermille: position(rat(dayNumber(p.observedOn) ?? 0), firstDay, lastDay),
      yPermille: position(p.unitPrice, low, high),
      unitPrice: p.unitPrice,
    });
  }
  return { firstDay: first, lastDay: last, low, high, series };
}

// ---------- public API ----------

/** Everything the Product screen shows, for one product's observations. `today` is YYYY-MM-DD. */
export function productStats(observations: readonly PriceObservation[], today: string, settings: StatsSettings): Stats {
  const currency = settings.currency.toUpperCase();
  const exponent = currencyExponent(currency);
  const basis = basisFor(settings.dimension, { ...settings, taxMode: 'include' });
  const basisQty = basisQuantity(settings.dimension, basis)!;
  const todayDay = dayNumber(today);
  if (todayDay === null) throw new RangeError(`Bad date for today: ${today}`);

  let otherCurrencyCount = 0;
  let invalidCount = 0;
  const points: PricePoint[] = [];
  for (const o of observations) {
    if (typeof o.currency !== 'string' || o.currency.toUpperCase() !== currency) {
      otherCurrencyCount++;
      continue;
    }
    const p = isValidDate(o.observedOn) ? toPricePoint(o, settings.dimension, basisQty) : null;
    if (p) points.push(p);
    else invalidCount++;
  }
  points.sort(byOldest);

  const latest = points.length ? points[points.length - 1] : null;
  const lowest = extreme(points, -1);
  const highest = extreme(points, 1);
  const usual = usualPrice(points, todayDay);
  const stores = storeTable(points, todayDay);
  const shown: Rat[] = [];
  for (const p of [latest, lowest, highest]) if (p) shown.push(p.unitPrice);
  if (usual) shown.push(usual.value);
  for (const r of stores) shown.push(r.latest.unitPrice, r.lowest.unitPrice);

  return {
    currency,
    exponent,
    dimension: settings.dimension,
    basis,
    count: points.length,
    otherCurrencyCount,
    invalidCount,
    points,
    latest,
    lowest,
    highest,
    usual,
    stores,
    shrinkflation: shrinkflationEvents(points),
    chart: chartData(points),
    decimals: unitPriceDecimals(shown, exponent),
  };
}

/** "Is this a good price?" for a candidate unit price x (minor units per the same basis as `stats`). */
export function gauge(stats: Pick<Stats, 'count' | 'lowest' | 'highest' | 'usual'>, x: Rat): GaugeResult {
  const { lowest, highest, usual } = stats;
  if (stats.count < GAUGE_MIN_PRICES || !lowest || !highest || !usual) return { kind: 'building', count: stats.count };
  const u = usual.value;
  let verdict: GaugeVerdict;
  if (cmp(x, lowest.unitPrice) <= 0) verdict = 'lowest';
  else if (cmp(x, highest.unitPrice) >= 0 && cmp(x, mul(u, PERCENT_105)) > 0) verdict = 'highest';
  else if (cmp(x, mul(u, PERCENT_95)) <= 0) verdict = 'good';
  else if (cmp(x, mul(u, PERCENT_105)) <= 0) verdict = 'usual';
  else verdict = 'above';
  const percent = u.n === B0 ? null : roundHalfUp(mul(div(sub(x, u), u), HUNDRED));
  const percentCapped = percent !== null && (percent > BigInt(PERCENT_MAX) || percent < -BigInt(PERCENT_MAX));
  return {
    kind: 'verdict',
    verdict,
    percentVsUsual: percent === null ? null : clampToInt(percent, PERCENT_MAX),
    percentCapped,
    basedOn: stats.count,
    usualPermille: position(u, lowest.unitPrice, highest.unitPrice),
    candidatePermille: position(x, lowest.unitPrice, highest.unitPrice),
  };
}

/**
 * Compare's "Is this a good price?" line (SPEC U5) for an evaluated card: judged on the price-memory basis
 * (`memoryUnitPrice`, before added tax and cashback, D40), converted to the basis of `stats` if the card shows another.
 */
export function compareGauge(
  stats: Pick<Stats, 'count' | 'lowest' | 'highest' | 'usual' | 'basis' | 'dimension'>,
  card: Pick<Breakdown, 'memoryUnitPrice' | 'basis' | 'dimension'>
): GaugeResult | null {
  if (card.dimension !== stats.dimension) return null;
  const from = basisQuantity(card.dimension, card.basis);
  const to = basisQuantity(stats.dimension, stats.basis);
  if (!from || !to) return null;
  return gauge(stats, mul(div(card.memoryUnitPrice, from), to));
}

/** The latest price judged against the history before it (Price Book row chip); null without prices. */
export function latestGauge(observations: readonly PriceObservation[], today: string, settings: StatsSettings): GaugeResult | null {
  const all = productStats(observations, today, settings);
  if (!all.latest) return null;
  const latestId = all.latest.id;
  const before = productStats(observations.filter((o) => o.id !== latestId), today, settings);
  return gauge(before, all.latest.unitPrice);
}

/** A candidate typed in major units ("4.49" per basis) as minor units per basis. */
export function majorToMinorRat(text: string, exponent: number): Rat | null {
  const value = fromDecimal(text);
  return value ? mul(value, rat(pow10(exponent))) : null;
}

// ---------- duplicate guard ----------

export type DuplicateKey = Pick<
  PriceObservation,
  'storeId' | 'observedOn' | 'currency' | 'packPriceMinor' | 'paidPriceMinor' | 'packCount' | 'itemSize' | 'unit'
>;

/** "Already saved today — save again?": same store, date, currency, prices and size (product is the caller's). */
export function isDuplicate(candidate: DuplicateKey, existing: DuplicateKey): boolean {
  const a = fromDecimal(candidate.itemSize);
  const b = fromDecimal(existing.itemSize);
  return (
    candidate.storeId === existing.storeId &&
    candidate.observedOn === existing.observedOn &&
    candidate.currency.toUpperCase() === existing.currency.toUpperCase() &&
    candidate.packPriceMinor === existing.packPriceMinor &&
    (candidate.paidPriceMinor ?? null) === (existing.paidPriceMinor ?? null) &&
    candidate.packCount === existing.packCount &&
    candidate.unit === existing.unit &&
    a !== null &&
    b !== null &&
    eq(a, b)
  );
}

/** R10 (V1.5 P1, D64): a second capture of the same shelf tag is "near" when its unit price is within 5 % of the saved one. */
export const NEAR_DUPLICATE_PERCENT = 5;
const NEAR_TOLERANCE = rat(NEAR_DUPLICATE_PERCENT, 100);

export type DuplicateKind = 'exact' | 'near';

/**
 * The duplicate guard with the near-duplicate rule (R10, D64). `exact` = `isDuplicate`. `near` = same store (or both
 * without a store), same day and currency, the SAME pack quantity in base units (500 g = 0.5 kg = 2 x 250 g), and an
 * effective unit price (paid ?? pack price, per base unit) within 5 % of the saved price's, both ends included. Another
 * pack size of the same product on the same shelf is never "near" (that is a second tag, not a second capture). Exact.
 */
export function duplicateKind(candidate: DuplicateKey, existing: DuplicateKey): DuplicateKind | null {
  if (isDuplicate(candidate, existing)) return 'exact';
  if (candidate.storeId !== existing.storeId || candidate.observedOn !== existing.observedOn) return null;
  if (candidate.currency.toUpperCase() !== existing.currency.toUpperCase()) return null;
  if (!isUnitId(candidate.unit) || !isUnitId(existing.unit)) return null;
  if (dimensionOf(candidate.unit) !== dimensionOf(existing.unit)) return null;
  const sizeA = fromDecimal(candidate.itemSize);
  const sizeB = fromDecimal(existing.itemSize);
  if (!sizeA || !sizeB || sizeA.n <= B0 || sizeB.n <= B0 || candidate.packCount < 1 || existing.packCount < 1) return null;
  const qa = packQuantity(candidate.packCount, sizeA, candidate.unit);
  const qb = packQuantity(existing.packCount, sizeB, existing.unit);
  if (!eq(qa, qb)) return null;
  const pa = rat(candidate.paidPriceMinor ?? candidate.packPriceMinor);
  const pb = rat(existing.paidPriceMinor ?? existing.packPriceMinor);
  // same quantity: comparing pack prices is comparing unit prices
  const diff = cmp(pa, pb) >= 0 ? sub(pa, pb) : sub(pb, pa);
  return cmp(diff, mul(NEAR_TOLERANCE, pb)) <= 0 ? 'near' : null;
}
