// Words and numbers for the Compare screen (D24: strings in strings.ts; D27: the engine returns data only).
// Display only: every value arrives exact (integers / Rat) and is rounded here once, half up.
import type { Breakdown, CardWarning, Deals, Hint, Step } from '@/engine/deals';
import type { Warning } from '@/engine/compare';
import type { GaugeResult } from '@/engine/stats';
import { formatMinor, formatUnitPrice } from '@/engine/money';
import { cmp, toDecimalString, type Rat } from '@/engine/rational';
import { DIMENSIONS, fromBase, toBase, type BasisId, type Dimension, type UnitId } from '@/engine/units';
import { rat } from '@/engine/rational';

import type { DecimalSeparator } from './app-settings';
import { strings } from './strings';

export type FormatContext = {
  currency: string;
  /** Intl locale used for money (follows the phone, adjusted to the number-format setting). */
  locale: string;
  sep: DecimalSeparator;
  /** Unit-price decimals of this comparison (SPEC 5.1, D32). */
  unitDecimals: number;
};

/** "{a} and {b}" templates. Unknown keys stay as they are. */
/**
 * Fills {name} placeholders. `{name:word}` writes the number and the word, adding "s" unless the number is 1
 * ("1 price", "3 prices"), so no text reads "1 prices".
 */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)(?::(\w+))?\}/g, (m, k: string, word?: string) => {
    if (!(k in vars)) return m;
    const v = vars[k];
    return word ? `${v} ${word}${Number(v) === 1 ? '' : 's'}` : String(v);
  });
}

/**
 * The phone's locale when its decimal separator matches the number-format setting, else a locale that uses the
 * chosen separator (so tests and users who override the format get consistent text).
 */
export function displayLocale(deviceTag: string | null | undefined, sep: DecimalSeparator): string {
  const fallback = sep === ',' ? 'de-DE' : 'en-US';
  for (const tag of [deviceTag, fallback]) {
    if (!tag) continue;
    try {
      const sample = new Intl.NumberFormat(tag, { minimumFractionDigits: 1 }).format(1);
      if (sample.includes(sep)) return tag;
    } catch {
      // unknown tag: try the next
    }
  }
  return fallback;
}

export function money(minor: number, ctx: Pick<FormatContext, 'currency' | 'locale'>): string {
  return formatMinor(minor, ctx.currency, ctx.locale);
}

/** "−€2.29" / "+€0.62" for a signed step amount. */
export function signedMoney(minor: number, ctx: Pick<FormatContext, 'currency' | 'locale'>): string {
  if (minor === 0) return money(0, ctx);
  return `${minor < 0 ? '−' : '+'}${money(Math.abs(minor), ctx)}`;
}

export function basisLabel(basis: BasisId): string {
  return strings.bases[basis];
}

/** "€4.58 per kg". */
export function unitPriceLine(unitPrice: Rat, basis: BasisId, ctx: FormatContext): string {
  return `${formatUnitPrice(unitPrice, ctx.currency, ctx.unitDecimals, ctx.locale)} ${basisLabel(basis)}`;
}

/**
 * A unit-price line split into the amount and its basis ("€4.98" + "per kg"), so the amount can be kept on one line
 * (shrunk if needed) and the basis wraps before it is ever split (REVIEW_V1 S5). Text without a known basis stays whole.
 */
export function splitUnitPriceLine(line: string): { amount: string; per: string | null } {
  for (const label of Object.values(strings.bases)) {
    if (line.length > label.length + 1 && line.endsWith(` ${label}`)) return { amount: line.slice(0, -label.length - 1), per: label };
  }
  return { amount: line, per: null };
}

/** Decimal text with the chosen separator ("8.875" -> "8,875"). */
export function decimal(text: string, sep: DecimalSeparator): string {
  return sep === ',' ? text.replace('.', ',') : text;
}

/** Tenths of a percent -> "8.1" (half up already done by the engine). */
export function permilleText(permille: number, sep: DecimalSeparator): string {
  const sign = permille < 0 ? '-' : '';
  const p = Math.abs(permille);
  return `${sign}${Math.floor(p / 10)}${sep}${p % 10}`;
}

/** Exact value rounded half up to at most `max` decimals, trailing zeros removed. */
export function shortDecimal(value: Rat, max: number, sep: DecimalSeparator): string {
  const text = toDecimalString(value, max);
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return decimal(trimmed, sep);
}

const QUANTITY_UNITS: Record<Dimension, { metric: [UnitId, UnitId | null]; us: [UnitId, UnitId | null] }> = {
  mass: { metric: ['g', 'kg'], us: ['oz', 'lb'] },
  volume: { metric: ['ml', 'l'], us: ['floz_us', 'gal_us'] },
  count: { metric: ['pcs', null], us: ['pcs', null] },
  length: { metric: ['m', null], us: ['ft', null] },
};
const US_BASES: readonly BasisId[] = ['lb', 'oz', 'floz_us', 'qt_us', 'gal_us', 'ft', '100ft'];

/** A quantity in base units for the savings line: "1.2 kg", "500 g", "24 oz", "6 pcs". */
export function quantityText(baseQuantity: Rat, dimension: Dimension, basis: BasisId, sep: DecimalSeparator): string {
  const family = US_BASES.includes(basis) ? 'us' : 'metric';
  const [small, large] = QUANTITY_UNITS[dimension][family];
  const unit = large && cmp(baseQuantity, toBase(rat(1), large)) >= 0 ? large : small;
  return `${shortDecimal(fromBase(baseQuantity, unit), 3, sep)} ${strings.units[unit]}`;
}

function sizeOf(packCount: number, itemSize: string, unit: UnitId, sep: DecimalSeparator): string {
  return `${packCount > 1 ? `${packCount}${strings.compare.multiply}` : ''}${decimal(itemSize, sep)} ${strings.units[unit]}`;
}

// ---------- breakdown steps ----------

export type StepLine = { label: string; amount: string; total: string };

export function stepLine(step: Step, ctx: FormatContext): StepLine {
  const m = (v: number) => money(v, ctx);
  const total = m(step.totalMinor);
  const amount = signedMoney(step.amountMinor, ctx);
  const s = strings.steps;
  switch (step.kind) {
    case 'base':
      return { label: fill(s.base, { q: step.quantity, price: m(step.priceMinor) }), amount: m(step.amountMinor), total };
    case 'buyXGetY': {
      const off = step.pct === '100' ? s.free : fill(s.pctOff, { pct: decimal(step.pct, ctx.sep) });
      return { label: fill(s.buyXGetY, { x: step.x, y: step.y, off }), amount, total };
    }
    case 'multiBuy':
      return { label: fill(step.perItem ? s.multiBuyPerItem : s.multiBuy, { n: step.n, price: m(step.dealPriceMinor) }), amount, total };
    case 'percent': {
      const base = fill(step.minQty != null ? s.percentFrom : s.percent, { pct: decimal(step.pct, ctx.sep), m: step.minQty ?? '' });
      return { label: step.applied ? base : `${base} ${s.notReached}`, amount, total };
    }
    case 'coupon': {
      const base = fill(step.perPack ? s.couponPerPack : s.coupon, { amount: m(step.couponMinor) });
      return { label: step.manufacturer ? `${base} ${s.manufacturer}` : base, amount, total };
    }
    case 'spendSave': {
      const save = step.saveMinor != null ? m(step.saveMinor) : `${decimal(step.savePct ?? '0', ctx.sep)} %`;
      const base = fill(s.spendSave, { threshold: m(step.thresholdMinor), save });
      return { label: step.reached ? base : `${base} ${s.notReached}`, amount, total };
    }
    case 'taxIncluded':
      return { label: fill(s.taxIncluded, { rate: decimal(step.rate, ctx.sep), tax: m(step.taxMinor), net: m(step.netMinor) }), amount: '', total };
    case 'taxAdded':
      return { label: fill(s.taxAdded, { rate: decimal(step.rate, ctx.sep) }), amount, total };
    case 'cashback':
      return { label: s.cashback, amount, total };
    case 'deposit':
      return { label: fill(s.deposit, { q: step.quantity, amount: m(step.depositMinor) }), amount: `+${m(step.amountMinor)}`, total: '' };
  }
}

// ---------- hints and warnings ----------

/** W6 hint words; `deals` gives the % of a "% off from m" hint. */
export function hintText(hint: Hint, sep: DecimalSeparator, deals?: Deals | null): string {
  const h = strings.hints;
  switch (hint.kind) {
    case 'takeMore':
      return hint.pct === '100' ? fill(h.takeMoreFree, { more: hint.more }) : fill(h.takeMorePct, { more: hint.more, pct: decimal(hint.pct, sep) });
    case 'dealNeedsMore':
      return fill(h.dealNeedsMore, { need: hint.need, more: hint.more });
    case 'outsideDeal':
      return hint.count === 1 ? h.outsideDealOne : fill(h.outsideDealMany, { count: hint.count });
    case 'minimumNotReached':
      return fill(h.minimumNotReached, { pct: decimal(deals?.percents?.[hint.index]?.pct ?? '', sep), min: hint.minQty, more: hint.more });
  }
}

/** Per-card warnings shown on the card itself (W3, W5, W8). */
export function cardWarningText(w: CardWarning, ctx: FormatContext): string {
  const t = strings.warnings;
  switch (w.code) {
    case 'W3':
      return fill(t.w3, { from: sizeOf(w.packCount, w.itemSize, w.unit, ctx.sep), to: `${shortDecimal(w.converted, 1, ctx.sep)} ${strings.units[w.toUnit]}` });
    case 'W5':
      if (w.reason === 'multiBuy') return fill(t.w5MultiBuy, { n: w.n, normal: money(w.normalMinor, ctx) });
      if (w.reason === 'noDiscount') return t.w5NoDiscount;
      return fill(t.w5Coupon, { requested: money(w.requestedMinor, ctx), applied: money(w.appliedMinor, ctx) });
    case 'W8':
      return t.w8;
  }
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')}${strings.warnings.and}${items[items.length - 1]}`;
}

/**
 * Comparison-level warnings for the result strip (W1, W2, W4, W9). Card-level ones (W3, W5, W6, W7, W8) are
 * shown on their card; this returns null for them.
 */
export function stripWarningText(w: Warning, ctx: FormatContext, letterOf: (cardId: string) => string): string | null {
  const t = strings.warnings;
  switch (w.code) {
    case 'W1': {
      const ordered = [...w.dimensions].sort((a, b) => DIMENSIONS.indexOf(a) - DIMENSIONS.indexOf(b));
      const names = ordered.map((d, i) => {
        const name: string = strings.settings.dimensions[d];
        return i === 0 ? name : name.toLowerCase();
      });
      return fill(t.w1, { dimensions: joinList(names) });
    }
    case 'W2':
      return fill(t.w2, { labels: w.labels.join(' / ') });
    case 'W4': {
      const times = new Intl.NumberFormat(ctx.locale, { maximumFractionDigits: 0 }).format(w.times);
      return fill(w.timesCapped ? t.w4Capped : t.w4, { times, low: letterOf(w.lowId), high: letterOf(w.highId) });
    }
    case 'W9':
      return strings.limits.w9;
    default:
      return null;
  }
}

/** The card's own W7 hint ("Enter a size"). */
export function missingText(missing: keyof typeof strings.compare.missing): string {
  return strings.compare.missing[missing];
}

// ---------- gauge line (U5, A8) ----------

export function gaugeText(g: GaugeResult): string {
  const t = strings.gauge;
  if (g.kind === 'building') return fill(t.building, { count: g.count });
  const verdict = t[g.verdict];
  const pct = g.percentVsUsual;
  if (pct === null) return fill(t.noUsual, { verdict });
  if (pct === 0) return fill(t.same, { verdict });
  const template = pct < 0 ? (g.percentCapped ? t.belowCapped : t.below) : g.percentCapped ? t.overCapped : t.over;
  return fill(template, { pct: Math.abs(pct), verdict });
}

/** The D40 basis label under the gauge line, or null. */
/**
 * D40 label for every place that shows remembered prices (product screen, Price Book list, save sheet; REVIEW_V1 S3):
 * saved prices are shelf prices after in-store deals, before cashback — and before tax where tax is added at the till.
 */
export function savedBasisText(taxMode: 'include' | 'add'): string {
  return taxMode === 'add' ? strings.priceMemory.savedBeforeTaxAndCashback : strings.priceMemory.savedBeforeCashback;
}

export function memoryBasisText(b: Pick<Breakdown, 'memoryExcludes'>): string | null {
  const { tax, cashback } = b.memoryExcludes;
  if (tax && cashback) return strings.priceMemory.basisBeforeTaxAndCashback;
  if (tax) return strings.priceMemory.basisBeforeTax;
  if (cashback) return strings.priceMemory.basisBeforeCashback;
  return null;
}
