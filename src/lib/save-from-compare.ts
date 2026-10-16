// "Save" on a Compare card (SPEC 2.4, U3): the card becomes a price in the book on the price-memory basis (D40) —
// the shelf price after in-store deals and coupons, before added tax and cashback — with the deal as text.
import type { ObservationInput } from '@/db/observations';
import { memoryPrice, type MemoryPrice } from '@/engine/deals';
import { currencyExponent } from '@/engine/money';
import { dimensionOf, type Dimension } from '@/engine/units';

import type { AppSettings } from './app-settings';
import { findCard, toEngineCards, type Draft } from './compare-draft';
import { buildCompareView, dealChips } from './compare-view';

export type SaveCandidate = {
  cardId: string;
  memory: MemoryPrice;
  /** "3 for 2, Coupon €0.50" or null when no deal is on the card. */
  dealText: string | null;
  /** The product's dimension, from the card's unit. */
  dimension: Dimension;
  /** The linked product, when the card has one. */
  productId: number | null;
  /** The linked product's uid (migration 4); Save checks it again inside its transaction. */
  productUid: string | null;
  productName: string | null;
};

/** The card as a savable price, or null while it has no complete price and size. */
export function saveCandidate(draft: Draft, cardId: string, settings: AppSettings, locale: string): SaveCandidate | null {
  const card = findCard(draft, cardId);
  if (!card) return null;
  const view = buildCompareView(draft, settings, locale);
  const breakdown = view.breakdowns[cardId];
  if (!breakdown) return null;
  const engineCard = toEngineCards(draft, currencyExponent(settings.currency)).find((c) => c.id === cardId);
  if (!engineCard) return null;
  const memory = memoryPrice(engineCard, breakdown);
  if (!memory) return null;
  const chips = dealChips(card, view.ctx).filter((c) => c.ref.kind !== 'cashback' && c.ref.kind !== 'deposit');
  return {
    cardId,
    memory,
    dealText: chips.length ? chips.map((c) => c.label).join(', ') : null,
    dimension: dimensionOf(card.unit),
    productId: card.productId,
    productUid: card.productUid,
    productName: card.productName,
  };
}

/** The observation to store: today's date, the book currency, the card's store-independent numbers. */
export function candidateInput(c: SaveCandidate, productId: number, storeId: number | null, currency: string, today: string): ObservationInput {
  return {
    productId,
    storeId,
    observedOn: today,
    currency,
    packPriceMinor: c.memory.packPriceMinor,
    paidPriceMinor: c.memory.paidPriceMinor,
    packCount: c.memory.packCount,
    itemSize: c.memory.itemSize,
    unit: c.memory.unit,
    depositMinor: c.memory.depositMinor,
    isPromo: c.memory.isPromo,
    dealText: c.dealText,
  };
}
