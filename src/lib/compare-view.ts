// Comparison -> the words and badges on the Compare screen. Pure (Jest checks SPEC E1/E8/E10/E12 text).
import { compareCards, type Comparison } from '@/engine/compare';
import { defaultQuantity, type Breakdown, type QuantityDeal } from '@/engine/deals';
import { currencyExponent, formatUnitPrice } from '@/engine/money';
import { rat } from '@/engine/rational';
import type { BasisId, Dimension } from '@/engine/units';

import { engineSettings, type AppSettings } from './app-settings';
import { cardLetter, quantityShown, toEngineCards, type CardDraft, type Draft } from './compare-draft';
import type { CardView, DealChip } from '@/components/compare-card';
import {
  basisLabel, cardWarningText, decimal, fill, hintText, missingText, money, permilleText, quantityText, stepLine,
  stripWarningText, unitPriceLine, type FormatContext,
} from './format';
import { strings } from './strings';

export type GroupView = { dimension: Dimension; basis: BasisId; header: string; summary: string | null; lowestToPay: string | null };
export type CompareView = {
  comparison: Comparison;
  ctx: FormatContext;
  groups: GroupView[];
  warnings: string[];
  cards: Record<string, CardView>;
  breakdowns: Record<string, Breakdown>;
};

export type GaugeLine = { text: string; basis: string | null };

function quantityDealChip(deal: QuantityDeal, ctx: FormatContext): string {
  const c = strings.deals.chip;
  if (deal.kind === 'multiBuy') return fill(deal.perItem ? c.multiBuyPerItem : c.multiBuy, { n: deal.n, price: money(deal.priceMinor, ctx) });
  if (deal.pct === '100' && deal.x === 1 && deal.y === 1) return c.bogo;
  if (deal.pct === '100' && deal.x === 2 && deal.y === 1) return strings.deals.threeForTwo;
  if (deal.pct === '50' && deal.x === 1 && deal.y === 1) return strings.deals.secondHalf;
  const off = deal.pct === '100' ? strings.steps.free : fill(strings.steps.pctOff, { pct: decimal(deal.pct, ctx.sep) });
  return fill(c.buyXGetY, { x: deal.x, y: deal.y, off });
}

export function dealChips(card: CardDraft, ctx: FormatContext): DealChip[] {
  const c = strings.deals.chip;
  const d = card.deals;
  const out: DealChip[] = [];
  if (d.quantity) out.push({ ref: { kind: 'quantity' }, label: quantityDealChip(d.quantity, ctx) });
  (d.percents ?? []).forEach((p, index) =>
    out.push({ ref: { kind: 'percent', index }, label: fill(p.minQty != null ? c.percentFrom : c.percent, { pct: decimal(p.pct, ctx.sep), m: p.minQty ?? '' }) })
  );
  (d.coupons ?? []).forEach((cp, index) =>
    out.push({ ref: { kind: 'coupon', index }, label: fill(cp.perPack ? c.couponPerPack : c.coupon, { amount: money(cp.amountMinor, ctx) }) })
  );
  if (d.spendSave) {
    const save = d.spendSave.saveMinor != null ? money(d.spendSave.saveMinor, ctx) : `${decimal(d.spendSave.savePct ?? '0', ctx.sep)} %`;
    out.push({ ref: { kind: 'spendSave' }, label: fill(c.spendSave, { threshold: money(d.spendSave.thresholdMinor, ctx), save }) });
  }
  if (d.cashback) {
    const amount = d.cashback.amountMinor != null ? money(d.cashback.amountMinor, ctx) : `${decimal(d.cashback.pct ?? '0', ctx.sep)} %`;
    out.push({ ref: { kind: 'cashback' }, label: fill(c.cashback, { amount }) });
  }
  if (card.depositMinor != null) out.push({ ref: { kind: 'deposit' }, label: fill(c.deposit, { amount: money(card.depositMinor, ctx) }) });
  return out;
}

function hasAnyDeal(card: CardDraft): boolean {
  const d = card.deals;
  return !!d.quantity || (d.percents?.length ?? 0) > 0 || (d.coupons?.length ?? 0) > 0 || !!d.spendSave || !!d.cashback;
}

export function buildCompareView(
  draft: Draft,
  settings: AppSettings,
  locale: string,
  gaugeFor: (card: CardDraft, breakdown: Breakdown) => GaugeLine | null = () => null
): CompareView {
  const exponent = currencyExponent(settings.currency);
  const comparison = compareCards(toEngineCards(draft, exponent), engineSettings(settings));
  const ctx: FormatContext = { currency: settings.currency, locale, sep: settings.decimalSeparator, unitDecimals: comparison.unitPriceDecimals };
  const letters: Record<string, string> = {};
  draft.cards.forEach((c, i) => (letters[c.id] = cardLetter(i)));
  const letterOf = (id: string) => letters[id] ?? '?';

  const groups: GroupView[] = comparison.groups.map((g) => {
    let summary: string | null = null;
    if (g.tie) summary = fill(strings.compare.tieLine, { cards: g.winners.map(letterOf).join(', ') });
    else if (g.savings) {
      const s = g.savings;
      summary = fill(s.moneyCapped ? strings.compare.savingsCapped : strings.compare.savings, {
        pct: permilleText(s.permille, ctx.sep),
        basis: basisLabel(g.basis),
        money: money(s.moneyMinor, ctx),
        quantity: quantityText(s.quantity, g.dimension, g.basis, ctx.sep),
      });
    }
    const lowestToPay = g.lowestToPay
      ? fill(strings.compare.lowestToPayLine, { cards: g.lowestToPay.cardIds.map(letterOf).join(', '), amount: money(g.lowestToPay.amountMinor, ctx) })
      : null;
    const header = fill(strings.compare.groupHeader, { dimension: strings.settings.dimensions[g.dimension], basis: basisLabel(g.basis) });
    return { dimension: g.dimension, basis: g.basis, header, summary, lowestToPay };
  });

  const warnings: string[] = [];
  for (const w of comparison.warnings) {
    const text = stripWarningText(w, ctx, letterOf);
    if (text && !warnings.includes(text)) warnings.push(text);
  }

  const cards: Record<string, CardView> = {};
  const breakdowns: Record<string, Breakdown> = {};
  draft.cards.forEach((card, i) => {
    const outcome = comparison.cards[i].evaluation;
    const group = outcome.ok ? comparison.groups.find((g) => g.ranking.some((r) => r.id === card.id)) : undefined;
    const view: CardView = {
      letter: cardLetter(i),
      resultLine: null,
      perPackLine: null,
      best: !!group?.winners.includes(card.id),
      tie: !!group?.tie,
      lowestToPay: !!group?.lowestToPay?.cardIds.includes(card.id),
      missing: null,
      notes: [],
      chips: dealChips(card, ctx),
      showQuantity: quantityShown(card),
      quantityPlaceholder: String(defaultQuantity(card.deals)),
      steps: null,
      gauge: null,
    };
    if (!outcome.ok) {
      view.missing = missingText(outcome.missing);
    } else {
      const b = outcome.breakdown;
      breakdowns[card.id] = b;
      view.resultLine = b.free ? strings.compare.free : unitPriceLine(b.unitPrice, b.basis, ctx);
      // REVIEW_V1 S3: "You pay" is the till amount (after deals and added tax, before cashback); cashback that comes back
      // later is its own line with the real cost. Without cashback both are the same number.
      if (b.quantity > 1 || hasAnyDeal(card)) {
        const each = fill(strings.compare.perPack, { amount: formatUnitPrice(rat(b.paidMinor, b.quantity), ctx.currency, exponent, ctx.locale) });
        view.perPackLine = `${fill(strings.compare.payLine, { amount: money(b.paidMinor, ctx), q: b.quantity })} · ${each}`;
      }
      for (const w of b.warnings) if (w.code !== 'W8') view.notes.push(cardWarningText(w, ctx));
      for (const h of b.hints) view.notes.push(hintText(h, ctx.sep, card.deals));
      if (b.cashbackMinor > 0) {
        const effectiveEach = fill(strings.compare.perPack, { amount: formatUnitPrice(b.perPack, ctx.currency, exponent, ctx.locale) });
        view.notes.push(`${fill(strings.compare.cashbackLine, { amount: money(b.cashbackMinor, ctx), effective: money(b.effectiveMinor, ctx) })} · ${effectiveEach}`);
      }
      if (b.depositTotalMinor > 0) view.notes.push(fill(strings.compare.depositLine, { amount: money(b.depositTotalMinor, ctx) }));
      view.steps = b.steps.map((s) => stepLine(s, ctx));
      view.gauge = gaugeFor(card, b);
    }
    cards[card.id] = view;
  });
  return { comparison, ctx, groups, warnings, cards, breakdowns };
}
