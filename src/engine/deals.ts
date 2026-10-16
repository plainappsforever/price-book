// Promotion pipeline for one Compare card (SPEC §5.4, D13, D14). Pure and exact: money is bigint minor
// units inside and safe-integer minor units at the edges (D27); rates are decimal text ("8.875"); the unit
// price is an exact Rat in minor units per display basis. Money is rounded half up at every named step,
// the unit price is never rounded here (display only). Never throws on user input: an unusable card
// comes back as { ok: false, missing }.
// Fixed order (D13): quantity deal -> percent discounts -> coupons -> spend-and-save -> tax -> cashback;
// the deposit stays outside the unit price. Breakdown steps are data; the UI turns them into words.
import { currencyExponent } from './money';
import { cmp, div, fromDecimal, mul, pow10, rat, roundHalfUp, toSafeInt, type Rat } from './rational';
import { isKeypadItemSize, LIMITS } from './parse';
import {
  basisQuantity, conversionTarget, convert, defaultBasis, dimensionOf, isUnitId, packQuantity,
  type BasisId, type Dimension, type MeasurementSystem, type UnitId,
} from './units';

const B0 = BigInt(0);
const B1000 = BigInt(1000);

// ---------- input ----------

/** Buy X get Y at z % off (BOGO = 1/1/100, "3 for 2" = 2/1/100, "2nd half price" = 1/1/50). */
export type BuyXGetY = { kind: 'buyXGetY'; x: number; y: number; pct: string };
/** N for M (multi-buy fixed price). Must-buy by default; `perItem` = US "10 for $10" (each rings up at M/N). */
export type MultiBuy = { kind: 'multiBuy'; n: number; priceMinor: number; perItem?: boolean };
export type QuantityDeal = BuyXGetY | MultiBuy;
/** p % off, optionally only "when you buy minQty or more". */
export type PercentOff = { pct: string; minQty?: number | null };
/** Amount-off coupon, once or per pack; `manufacturer` = taxed on the pre-coupon price in add-tax mode. */
export type Coupon = { amountMinor: number; perPack?: boolean; manufacturer?: boolean };
/** Spend T, save V (amount) or v % — exactly one of saveMinor / savePct. */
export type SpendSave = { thresholdMinor: number; saveMinor?: number | null; savePct?: string | null };
/** Cashback / store credit: an amount or a % of S — exactly one. */
export type Cashback = { amountMinor?: number | null; pct?: string | null };

export type Deals = {
  quantity?: QuantityDeal | null;
  percents?: readonly PercentOff[];
  coupons?: readonly Coupon[];
  spendSave?: SpendSave | null;
  cashback?: Cashback | null;
};

export type Card = {
  id: string;
  /** Pack price P in minor units; null = not entered yet. 0 = free. */
  priceMinor: number | null;
  /** From parseSize: packs per multipack n and one item's size s (canonical decimal text); null = not entered. */
  size: { packCount: number; itemSize: string } | null;
  unit: UnitId;
  /** Packs bought q; null/undefined = the quantity deal's bundle size (X+Y or N), else 1. */
  quantity?: number | null;
  /** Deposit per pack D in minor units. */
  depositMinor?: number | null;
  /** Count label ("rolls", "sheets") for W2. */
  label?: string | null;
  deals?: Deals | null;
};

export type TaxMode = 'include' | 'add';

export type EngineSettings = {
  currency: string;
  /** include = shelf prices include tax (default outside US/CA); add = tax is added at the till (D14). */
  taxMode: TaxMode;
  /** Percent text, e.g. "8.875". Include mode: optional, only to show net and VAT. */
  taxRate?: string | null;
  measurementSystem?: MeasurementSystem;
  /** Display basis per dimension (the user's choice); falls back to the measurement-system default. */
  bases?: Partial<Record<Dimension, BasisId>>;
};

// ---------- output ----------

type Amounts = {
  /** Signed change of the running total made by this step (discounts are negative). */
  amountMinor: number;
  /** Running total after this step (S, then Paid, then E; unchanged by taxIncluded and deposit). */
  totalMinor: number;
};

export type Step =
  | ({ kind: 'base'; quantity: number; priceMinor: number } & Amounts)
  | ({ kind: 'buyXGetY'; x: number; y: number; pct: string; groups: number; discountPerGroupMinor: number } & Amounts)
  | ({ kind: 'multiBuy'; n: number; dealPriceMinor: number; perItem: boolean; groups: number; outside: number } & Amounts)
  | ({ kind: 'percent'; index: number; pct: string; minQty: number | null; applied: boolean } & Amounts)
  | ({ kind: 'coupon'; index: number; couponMinor: number; perPack: boolean; manufacturer: boolean; requestedMinor: number; clamped: boolean } & Amounts)
  | ({ kind: 'spendSave'; thresholdMinor: number; saveMinor: number | null; savePct: string | null; reached: boolean } & Amounts)
  | ({ kind: 'taxIncluded'; rate: string; netMinor: number; taxMinor: number } & Amounts)
  | ({ kind: 'taxAdded'; rate: string; baseMinor: number; taxMinor: number } & Amounts)
  | ({ kind: 'cashback'; cashbackAmountMinor: number | null; pct: string | null; cashbackMinor: number } & Amounts)
  | ({ kind: 'deposit'; quantity: number; depositMinor: number } & Amounts);

/** W6 hints: an incomplete deal group or a deal that cannot apply yet. */
export type Hint =
  | { kind: 'takeMore'; more: number; pct: string } // "Take 1 more — free" / "— at 50 % off"
  | { kind: 'dealNeedsMore'; need: number; more: number } // "Deal needs 10 — 7 more"
  | { kind: 'outsideDeal'; count: number } // "1 item outside the deal pays the normal price"
  | { kind: 'minimumNotReached'; index: number; minQty: number; more: number }; // "20 % off from 2 — 1 more"

export type CardWarning =
  /** W3: size shown converted, e.g. "16 oz = 453.6 g" (`converted` is exact; the UI rounds it). */
  | { code: 'W3'; packCount: number; itemSize: string; unit: UnitId; toUnit: UnitId; converted: Rat }
  /** W5 multiBuy: "Not a saving: 3 at the normal price cost €5.97". */
  | { code: 'W5'; reason: 'multiBuy'; n: number; normalMinor: number; dealPriceMinor: number }
  /** W5 noDiscount: a buy-X-get-Y deal at 0 % off. */
  | { code: 'W5'; reason: 'noDiscount' }
  /** W5 coupon: the coupon is at least the running total, so it clamps (to 0). */
  | { code: 'W5'; reason: 'coupon'; index: number; requestedMinor: number; appliedMinor: number }
  /** W8: the result is free (E = 0). */
  | { code: 'W8' };

export type Breakdown = {
  /** Packs bought q (after the default). */
  quantity: number;
  /** Q = n x s x factor(u), base units per pack. */
  packQuantity: Rat;
  /** q x Q, base units bought. */
  totalQuantity: Rat;
  dimension: Dimension;
  basis: BasisId;
  steps: Step[];
  s0Minor: number;
  /** S after deals, percents, coupons and spend-and-save (before tax). */
  sMinor: number;
  /** (S0 - S) / S0 in tenths of a percent, half up (362 = 36.2 %); 0 when S0 = 0. */
  discountPermille: number;
  /** Manufacturer coupons applied (MC). */
  manufacturerCouponMinor: number;
  /** Amount at the till without deposit. */
  paidMinor: number;
  /** Tax: added (add mode) or contained (include mode with a rate); 0 otherwise. */
  taxMinor: number;
  /** Paid minus tax. */
  netMinor: number;
  cashbackMinor: number;
  /** E = Paid - cashback: what the purchase really costs. */
  effectiveMinor: number;
  depositTotalMinor: number;
  /** Paid + deposit. */
  tillMinor: number;
  /** U = E / (q x Q) x basis, exact, minor units per basis. */
  unitPrice: Rat;
  /** E / q, exact, minor units per pack. */
  perPack: Rat;
  /**
   * Price-memory basis (D40, review #2): S / (q x Q) x basis — the shelf price after in-store deals and coupons,
   * BEFORE added tax and cashback. History, the gauge and prices saved from Compare all use this basis; only the
   * Compare ranking (`unitPrice`) includes tax and cashback. In include-tax mode the shelf price already holds the tax.
   */
  memoryUnitPrice: Rat;
  /** What `memoryUnitPrice` leaves out compared with `unitPrice` (the UI labels the gauge line when either is true). */
  memoryExcludes: { tax: boolean; cashback: boolean };
  free: boolean;
  hints: Hint[];
  warnings: CardWarning[];
};

export type Missing = 'price' | 'size' | 'quantity' | 'deposit' | 'deal' | 'tax';
export type Evaluation = { ok: true; breakdown: Breakdown } | { ok: false; missing: Missing };

// ---------- validation helpers ----------

function isWhole(value: unknown, minValue: number, maxValue: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minValue && value <= maxValue;
}
function isMinor(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
}
/** Largest amount the keypad accepts in this currency (LIMITS.priceMajorMax major units): every money input of a card. */
export function maxMinorFor(currency: string): number {
  return toSafeInt(BigInt(LIMITS.priceMajorMax) * pow10(currencyExponent(currency)));
}
/** Percent text 0..100 -> exact fraction p/100, or null. */
function fraction(pct: unknown): Rat | null {
  if (typeof pct !== 'string') return null;
  const value = fromDecimal(pct);
  if (!value || cmp(value, rat(100)) > 0) return null;
  return mul(value, rat(1, 100));
}
const big = (value: number): bigint => BigInt(value);
const out = (value: bigint): number => toSafeInt(value);
const minBig = (a: bigint, b: bigint): bigint => (a < b ? a : b);

/** round(amount x fraction), half up. */
function share(amount: bigint, frac: Rat): bigint {
  return roundHalfUp(mul(rat(amount), frac));
}

export function basisFor(dimension: Dimension, settings: EngineSettings): BasisId {
  const chosen = settings.bases?.[dimension];
  if (chosen && basisQuantity(dimension, chosen)) return chosen;
  return defaultBasis(dimension, settings.measurementSystem ?? 'metric');
}

/** q when the user has not typed one: the quantity deal's bundle size, else 1 (SPEC §5.4). */
export function defaultQuantity(deals: Deals | null | undefined): number {
  const deal = deals?.quantity;
  if (!deal) return 1;
  return deal.kind === 'buyXGetY' ? deal.x + deal.y : deal.n;
}

// ---------- the pipeline ----------

export function evaluateCard(card: Card, settings: EngineSettings): Evaluation {
  // Inputs beyond the keypad range make the card incomplete instead of overflowing later (review #4).
  const maxMinor = maxMinorFor(settings.currency);
  const money = (value: unknown): value is number => isMinor(value, maxMinor);
  if (!money(card.priceMinor)) return { ok: false, missing: 'price' };
  const size = card.size;
  // Sizes must be what the keypad stores (D44 + oracle review M2): canonical, 0 < s <= 1,000,000, <= 3 decimals, so a
  // stale or hand-edited draft shows "Enter a size" (W7) instead of a 1,000,000x W4.
  const itemSize = size && isKeypadItemSize(size.itemSize) ? fromDecimal(size.itemSize) : null;
  if (!size || !itemSize || itemSize.n <= B0 || !isWhole(size.packCount, 1, LIMITS.packCountMax) || !isUnitId(card.unit)) {
    return { ok: false, missing: 'size' };
  }
  const deals = card.deals ?? {};
  const qty = card.quantity ?? defaultQuantity(deals);
  if (!isWhole(qty, 1, LIMITS.quantityMax)) return { ok: false, missing: card.quantity == null && deals.quantity ? 'deal' : 'quantity' };
  const deposit = card.depositMinor ?? 0;
  if (!money(deposit)) return { ok: false, missing: 'deposit' };

  let taxFrac: Rat | null = null;
  if (settings.taxRate != null && settings.taxRate !== '') {
    taxFrac = fraction(settings.taxRate);
    if (!taxFrac) return { ok: false, missing: 'tax' };
  }

  const P = big(card.priceMinor);
  const q = big(qty);
  const steps: Step[] = [];
  const hints: Hint[] = [];
  const warnings: CardWarning[] = [];

  // 1. S0 = q x P
  const S0 = q * P;
  let S = S0;
  steps.push({ kind: 'base', quantity: qty, priceMinor: card.priceMinor, amountMinor: out(S0), totalMinor: out(S0) });

  // 2. quantity deal (at most one)
  const qd = deals.quantity;
  if (qd) {
    if (qd.kind === 'buyXGetY') {
      const z = fraction(qd.pct);
      if (!isWhole(qd.x, 1, LIMITS.quantityMax) || !isWhole(qd.y, 1, LIMITS.quantityMax) || !z) return { ok: false, missing: 'deal' };
      const groupSize = qd.x + qd.y;
      const G = q / big(groupSize); // complete groups only
      const d = share(big(qd.y) * P, z); // discount per group, rounded per group
      const before = S;
      S = S - G * d;
      steps.push({
        kind: 'buyXGetY', x: qd.x, y: qd.y, pct: qd.pct, groups: out(G), discountPerGroupMinor: out(d),
        amountMinor: out(S - before), totalMinor: out(S),
      });
      if (d <= B0) warnings.push({ code: 'W5', reason: 'noDiscount' });
      const r = qty % groupSize;
      if (G === B0 && r < qd.x) hints.push({ kind: 'dealNeedsMore', need: groupSize, more: groupSize - qty });
      else if (r >= qd.x) hints.push({ kind: 'takeMore', more: groupSize - r, pct: qd.pct });
    } else {
      if (!isWhole(qd.n, 1, LIMITS.quantityMax) || !money(qd.priceMinor)) return { ok: false, missing: 'deal' };
      const N = big(qd.n);
      const M = big(qd.priceMinor);
      const before = S;
      let groups = 0;
      let outside = 0;
      if (qd.perItem) {
        S = roundHalfUp(rat(q * M, N));
      } else {
        const G = q / N;
        S = G * M + (q - G * N) * P;
        groups = out(G);
        outside = qty - groups * qd.n;
        if (G === B0) hints.push({ kind: 'dealNeedsMore', need: qd.n, more: qd.n - qty });
        else if (outside > 0) hints.push({ kind: 'outsideDeal', count: outside });
      }
      steps.push({
        kind: 'multiBuy', n: qd.n, dealPriceMinor: qd.priceMinor, perItem: !!qd.perItem, groups, outside,
        amountMinor: out(S - before), totalMinor: out(S),
      });
      if (M >= N * P) warnings.push({ code: 'W5', reason: 'multiBuy', n: qd.n, normalMinor: out(N * P), dealPriceMinor: qd.priceMinor });
    }
  }

  // 3. percent discounts, in entered order, sequential
  const percents = deals.percents ?? [];
  for (let i = 0; i < percents.length; i++) {
    const p = percents[i];
    const frac = fraction(p.pct);
    const minQty = p.minQty ?? null;
    if (!frac || (minQty !== null && !isWhole(minQty, 1, LIMITS.quantityMax))) return { ok: false, missing: 'deal' };
    const applied = minQty === null || qty >= minQty;
    const off = applied ? share(S, frac) : B0;
    S = S - off;
    steps.push({ kind: 'percent', index: i, pct: p.pct, minQty, applied, amountMinor: out(-off), totalMinor: out(S) });
    if (!applied && minQty !== null) hints.push({ kind: 'minimumNotReached', index: i, minQty, more: minQty - qty });
  }

  // 4. amount-off coupons, in entered order, clamped at 0
  let MC = B0;
  const coupons = deals.coupons ?? [];
  for (let i = 0; i < coupons.length; i++) {
    const c = coupons[i];
    if (!money(c.amountMinor)) return { ok: false, missing: 'deal' };
    const requested = big(c.amountMinor) * (c.perPack ? q : BigInt(1));
    const applied = minBig(requested, S);
    if (requested > B0 && requested >= S) {
      warnings.push({ code: 'W5', reason: 'coupon', index: i, requestedMinor: out(requested), appliedMinor: out(applied) });
    }
    S = S - applied;
    if (c.manufacturer) MC = MC + applied;
    steps.push({
      kind: 'coupon', index: i, couponMinor: c.amountMinor, perPack: !!c.perPack, manufacturer: !!c.manufacturer,
      requestedMinor: out(requested), clamped: applied < requested, amountMinor: out(-applied), totalMinor: out(S),
    });
  }

  // 5. spend-and-save (once)
  const ss = deals.spendSave;
  if (ss) {
    const hasAmount = ss.saveMinor != null;
    const hasPct = ss.savePct != null;
    const pct = hasPct ? fraction(ss.savePct) : null;
    if (!money(ss.thresholdMinor) || hasAmount === hasPct || (hasAmount && !money(ss.saveMinor)) || (hasPct && !pct)) {
      return { ok: false, missing: 'deal' };
    }
    const reached = S >= big(ss.thresholdMinor);
    const off = !reached ? B0 : pct ? share(S, pct) : minBig(big(ss.saveMinor as number), S);
    S = S - off;
    steps.push({
      kind: 'spendSave', thresholdMinor: ss.thresholdMinor, saveMinor: hasAmount ? (ss.saveMinor as number) : null,
      savePct: hasPct ? (ss.savePct as string) : null, reached, amountMinor: out(-off), totalMinor: out(S),
    });
  }

  // 6. tax
  let paid = S;
  let tax = B0;
  if (settings.taxMode === 'add') {
    if (taxFrac) {
      const base = S + MC;
      tax = share(base, taxFrac);
      paid = S + tax;
      steps.push({ kind: 'taxAdded', rate: settings.taxRate as string, baseMinor: out(base), taxMinor: out(tax), amountMinor: out(tax), totalMinor: out(paid) });
    }
  } else if (taxFrac) {
    const net = roundHalfUp(div(rat(S), rat(taxFrac.n + taxFrac.d, taxFrac.d))); // round(S / (1 + r))
    tax = S - net;
    steps.push({ kind: 'taxIncluded', rate: settings.taxRate as string, netMinor: out(net), taxMinor: out(tax), amountMinor: 0, totalMinor: out(paid) });
  }

  // 7. cashback / store credit (deferred benefit)
  let cashback = B0;
  const cb = deals.cashback;
  if (cb) {
    const hasAmount = cb.amountMinor != null;
    const hasPct = cb.pct != null;
    const pct = hasPct ? fraction(cb.pct) : null;
    if (hasAmount === hasPct || (hasAmount && !money(cb.amountMinor)) || (hasPct && !pct)) return { ok: false, missing: 'deal' };
    const CB = pct ? share(S, pct) : big(cb.amountMinor as number);
    cashback = minBig(CB, paid);
    steps.push({
      kind: 'cashback', cashbackAmountMinor: hasAmount ? (cb.amountMinor as number) : null, pct: hasPct ? (cb.pct as string) : null,
      cashbackMinor: out(cashback), amountMinor: out(-cashback), totalMinor: out(paid - cashback),
    });
  }
  const E = paid - cashback;

  // 8. deposit: outside the unit price, paid at the till
  const depositTotal = q * big(deposit);
  if (depositTotal > B0) {
    steps.push({ kind: 'deposit', quantity: qty, depositMinor: deposit, amountMinor: out(depositTotal), totalMinor: out(E) });
  }

  // 9. effective unit price U = E / (q x Q) x basis
  const dimension = dimensionOf(card.unit);
  const basis = basisFor(dimension, settings);
  const Q = packQuantity(size.packCount, itemSize, card.unit);
  const total = mul(rat(q), Q);
  const unitPrice = mul(div(rat(E), total), basisQuantity(dimension, basis) as Rat);
  const memoryUnitPrice = mul(div(rat(S), total), basisQuantity(dimension, basis) as Rat);

  const target = conversionTarget(card.unit, basis);
  if (target) {
    warnings.push({ code: 'W3', packCount: size.packCount, itemSize: size.itemSize, unit: card.unit, toUnit: target, converted: convert(itemSize, card.unit, target) as Rat });
  }
  if (E === B0) warnings.push({ code: 'W8' });

  return {
    ok: true,
    breakdown: {
      quantity: qty,
      packQuantity: Q,
      totalQuantity: total,
      dimension,
      basis,
      steps,
      s0Minor: out(S0),
      sMinor: out(S),
      discountPermille: S0 === B0 ? 0 : out(roundHalfUp(rat((S0 - S) * B1000, S0))),
      manufacturerCouponMinor: out(MC),
      paidMinor: out(paid),
      taxMinor: out(tax),
      netMinor: out(paid - tax),
      cashbackMinor: out(cashback),
      effectiveMinor: out(E),
      depositTotalMinor: out(depositTotal),
      tillMinor: out(paid + depositTotal),
      unitPrice,
      perPack: rat(E, q),
      memoryUnitPrice,
      memoryExcludes: { tax: settings.taxMode === 'add' && tax > B0, cashback: cashback > B0 },
      free: E === B0,
      hints,
      warnings,
    },
  };
}

/** The fields of a saved price (src/db/observations.ts ObservationInput) for a Compare card. */
export type MemoryPrice = {
  /** Shelf price per pack P. */
  packPriceMinor: number;
  /** S / q rounded half up (3 for 2 at 2.29: 458 / 3 = 152.67 -> 153); null when no deal changed the price. */
  paidPriceMinor: number | null;
  packCount: number;
  itemSize: string;
  unit: UnitId;
  depositMinor: number;
  /** A deal changed the shelf total (S differs from S0). */
  isPromo: boolean;
};

/**
 * "Save from Compare" (SPEC 2.4, U3) on the price-memory basis (D40): the per-pack price after deals and coupons,
 * before added tax and cashback — the same basis as a price typed by hand from the shelf tag.
 */
export function memoryPrice(card: Card, b: Breakdown): MemoryPrice | null {
  if (card.priceMinor === null || !card.size) return null;
  const changed = b.sMinor !== b.s0Minor;
  return {
    packPriceMinor: card.priceMinor,
    paidPriceMinor: changed ? out(roundHalfUp(rat(b.sMinor, b.quantity))) : null,
    packCount: card.size.packCount,
    itemSize: card.size.itemSize,
    unit: card.unit,
    depositMinor: card.depositMinor ?? 0,
    isPromo: changed,
  };
}

/** Exact percent of a fraction in tenths (permille), half up: used for savings and the stacked-discount total. */
export function permille(value: Rat): number {
  return out(roundHalfUp(mul(value, rat(B1000))));
}
