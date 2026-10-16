// Ranking, savings, ties, "lowest to pay" and warnings W1–W8 across Compare cards (SPEC §5.5–5.6, D16).
// Pure and exact: unit prices are compared as rationals; only the reported savings are rounded (half up).
// Results never depend on card order except where the input order is the only tie-breaker for display
// order (`ranking` lists equal unit prices in card order; ranks, winners and savings do not depend on it).
import { clampToInt, cmp, div, mul, rat, roundHalfUp, sub, toSafeInt, type Rat } from './rational';
import { currencyExponent, unitPriceDecimals } from './money';
import { evaluateCard, type Breakdown, type Card, type CardWarning, type EngineSettings, type Evaluation, type Hint, type Missing } from './deals';
import { basisQuantity, groupByDimension, type BasisId, type Dimension } from './units';

/** Ties: relative difference (U_hi - U_lo) / U_hi below 1/1000 (0.1 %). */
const TIE = rat(1, 1000);
/** W4 "likely typo": max U / min U at or above this within one dimension. */
const TYPO_RATIO = rat(10);
/** Display caps (review #4): extreme but accepted keypad input must never throw; W9 tells the user instead. */
export const SAVINGS_MAX_MINOR = 999999999999999; // < 2^53, so formatting stays exact
export const TIMES_MAX = 1000000;

export type CardOutcome = { id: string; evaluation: Evaluation };

export type RankedCard = {
  id: string;
  /** 1 + number of cards in the group with a strictly lower exact unit price. */
  rank: number;
  unitPrice: Rat;
  /** Within 0.1 % of the lowest unit price ("Same unit price" when more than one). */
  tiedWithBest: boolean;
};

export type Savings = {
  winnerId: string;
  runnerUpId: string;
  /** (U_R - U_W) / U_R in tenths of a percent, half up (81 = 8.1 %). */
  permille: number;
  /** Exact (U_R - U_W) / U_R. */
  fraction: Rat;
  /** What the winner's quantity would cost extra at the runner-up's unit price, rounded half up (at most SAVINGS_MAX_MINOR). */
  moneyMinor: number;
  /** The exact amount is above SAVINGS_MAX_MINOR (UI: "more than …"; W9 is raised). */
  moneyCapped: boolean;
  /** The winner's quantity q x Q in base units (the "on 1.2 kg" part). */
  quantity: Rat;
};

export type GroupResult = {
  dimension: Dimension;
  basis: BasisId;
  /** Complete cards of this dimension, cheapest first (equal exact prices in card order). */
  ranking: RankedCard[];
  /** Best value: the single cheapest card, or every card tied with it; empty when the group has one card. */
  winners: string[];
  tie: boolean;
  /** Present when there is exactly one winner and another card to compare with. */
  savings: Savings | null;
  /** Smallest E + deposit when no winner has it (the "Lowest to pay" badge); null otherwise. */
  lowestToPay: { cardIds: string[]; amountMinor: number } | null;
};

export type Warning =
  | { code: 'W1'; dimensions: Dimension[] }
  | { code: 'W2'; dimension: Dimension; labels: string[] }
  | ({ cardId: string } & Extract<CardWarning, { code: 'W3' }>)
  | { code: 'W4'; dimension: Dimension; lowId: string; highId: string; ratio: Rat; times: number; timesCapped: boolean }
  /** W9: a number is beyond what can be shown (savings or W4 ratio capped) — check the sizes and prices. */
  | { code: 'W9'; dimension: Dimension; what: 'savings' | 'ratio' }
  | ({ cardId: string } & Extract<CardWarning, { code: 'W5' }>)
  | { code: 'W6'; cardId: string; hint: Hint }
  | { code: 'W7'; cardId: string; missing: Missing }
  | { code: 'W8'; cardId: string };

export type Comparison = {
  cards: CardOutcome[];
  groups: GroupResult[];
  warnings: Warning[];
  /** Currency minor-unit exponent used for display. */
  exponent: number;
  /** Decimals for every unit price shown in this comparison (SPEC §5.1, D27). */
  unitPriceDecimals: number;
};

type Complete = { id: string; index: number; card: Card; b: Breakdown };

/** (hi - lo) / hi, exact; 0 when hi is 0. */
function relativeDifference(lo: Rat, hi: Rat): Rat {
  if (hi.n === BigInt(0)) return rat(0);
  return div(sub(hi, lo), hi);
}
function isTie(lo: Rat, hi: Rat): boolean {
  return cmp(relativeDifference(lo, hi), TIE) < 0;
}

function rankGroup(dimension: Dimension, items: Complete[]): { group: GroupResult; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const sorted = [...items].sort((a, b) => cmp(a.b.unitPrice, b.b.unitPrice) || a.index - b.index);
  const best = sorted[0].b.unitPrice;
  const ranking: RankedCard[] = sorted.map((c) => ({
    id: c.id,
    rank: 1 + sorted.filter((o) => cmp(o.b.unitPrice, c.b.unitPrice) < 0).length,
    unitPrice: c.b.unitPrice,
    tiedWithBest: isTie(best, c.b.unitPrice),
  }));
  const basis = sorted[0].b.basis;
  const group: GroupResult = { dimension, basis, ranking, winners: [], tie: false, savings: null, lowestToPay: null };
  if (items.length < 2) return { group, warnings };

  const winners = sorted.filter((c) => isTie(best, c.b.unitPrice));
  group.winners = winners.map((c) => c.id);
  group.tie = winners.length > 1;

  const rest = sorted.filter((c) => !winners.includes(c));
  if (!group.tie && rest.length > 0) {
    const W = winners[0];
    const R = rest[0];
    const fraction = relativeDifference(W.b.unitPrice, R.b.unitPrice);
    const perBaseUnit = div(sub(R.b.unitPrice, W.b.unitPrice), basisQuantity(dimension, basis) as Rat);
    const money = roundHalfUp(mul(perBaseUnit, W.b.totalQuantity));
    const moneyCapped = money > BigInt(SAVINGS_MAX_MINOR);
    if (moneyCapped) warnings.push({ code: 'W9', dimension, what: 'savings' });
    group.savings = {
      winnerId: W.id,
      runnerUpId: R.id,
      permille: toSafeInt(roundHalfUp(mul(fraction, rat(1000)))),
      fraction,
      moneyMinor: clampToInt(money, SAVINGS_MAX_MINOR),
      moneyCapped,
      quantity: W.b.totalQuantity,
    };
  }

  // Lowest to pay: smallest E + deposit, shown only when no winner has it.
  const till = (c: Complete) => c.b.effectiveMinor + c.b.depositTotalMinor;
  let lowest = till(items[0]);
  for (const c of items) if (till(c) < lowest) lowest = till(c);
  const lowestIds = items.filter((c) => till(c) === lowest).map((c) => c.id);
  if (!lowestIds.some((id) => group.winners.includes(id))) group.lowestToPay = { cardIds: lowestIds, amountMinor: lowest };

  // W4 likely typo: max U / min U >= 10 (skipped when something is free: W8 explains that).
  const low = sorted[0];
  const high = sorted[sorted.length - 1];
  if (low.b.unitPrice.n > BigInt(0)) {
    const ratio = div(high.b.unitPrice, low.b.unitPrice);
    if (cmp(ratio, TYPO_RATIO) >= 0) {
      const times = roundHalfUp(ratio);
      const timesCapped = times > BigInt(TIMES_MAX);
      warnings.push({ code: 'W4', dimension, lowId: low.id, highId: high.id, ratio, times: clampToInt(times, TIMES_MAX), timesCapped });
      if (timesCapped) warnings.push({ code: 'W9', dimension, what: 'ratio' });
    }
  }

  // W2 different count labels (rolls vs sheets).
  if (dimension === 'count') {
    const labels: string[] = [];
    for (const c of items) {
      const label = (c.card.label ?? '').trim().toLowerCase();
      if (label && !labels.includes(label)) labels.push(label);
    }
    if (labels.length > 1) warnings.push({ code: 'W2', dimension, labels });
  }
  return { group, warnings };
}

export function compareCards(cards: readonly Card[], settings: EngineSettings): Comparison {
  const exponent = currencyExponent(settings.currency);
  const outcomes: CardOutcome[] = cards.map((card) => ({ id: card.id, evaluation: evaluateCard(card, settings) }));
  const warnings: Warning[] = [];
  const complete: Complete[] = [];
  outcomes.forEach((o, index) => {
    const e = o.evaluation;
    if (!e.ok) {
      warnings.push({ code: 'W7', cardId: o.id, missing: e.missing });
      return;
    }
    complete.push({ id: o.id, index, card: cards[index], b: e.breakdown });
  });

  const grouped = groupByDimension(complete, (c) => c.card.unit);
  if (grouped.length > 1) warnings.push({ code: 'W1', dimensions: grouped.map((g) => g.dimension) });
  const groups: GroupResult[] = [];
  for (const g of grouped) {
    const ranked = rankGroup(g.dimension, g.items);
    groups.push(ranked.group);
    warnings.push(...ranked.warnings);
  }

  for (const c of complete) {
    for (const w of c.b.warnings) warnings.push({ cardId: c.id, ...w });
    for (const hint of c.b.hints) warnings.push({ code: 'W6', cardId: c.id, hint });
  }

  return {
    cards: outcomes,
    groups,
    warnings,
    exponent,
    unitPriceDecimals: unitPriceDecimals(complete.map((c) => c.b.unitPrice), exponent),
  };
}
