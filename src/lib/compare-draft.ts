// The Compare screen's state as plain data (SPEC 2.1, D19): cards with keypad text, deals, the focused field.
// Pure functions only, so the U1 tap sequence and the draft round trip are Jest-tested; the screen keeps one
// Draft in `compare-store.ts` and saves it as JSON in settings.compareDraft 300 ms after the last change.
import type { Card, Cashback, Coupon, Deals, PercentOff, QuantityDeal, SpendSave } from '@/engine/deals';
import { appendKey, deleteLastKey, parsePrice, parseQuantity, parseSize, MULTIPLY_KEY, type KeyField } from '@/engine/parse';
import { isUnitId, type UnitId } from '@/engine/units';

export const MIN_CARDS = 2;
export const MAX_CARDS = 5;

export type FieldKind = KeyField; // 'price' | 'size' | 'quantity'

export type CardDraft = {
  /** Stable id ("c1", "c2" …); the letter A–E is the card's position. */
  id: string;
  price: string;
  size: string;
  unit: UnitId;
  /** Packs bought; '' = the deal's bundle size, else 1. */
  quantity: string;
  deals: Deals;
  depositMinor: number | null;
  /** Linked Price Book product (U5): the gauge line reads its history. */
  productId: number | null;
  /**
   * The linked product's random identity (migration 4). Row ids are reused after a delete and differ after a restore,
   * so a link is valid only while the product with `productId` still has this uid (`revalidateLinks`). Null on a
   * link made by v1.0: such a link is checked by name once and then adopts the uid.
   */
  productUid: string | null;
  productName: string | null;
  /** Count label of the linked product ("rolls"), for W2. */
  label: string | null;
};

export type Focus = { cardId: string; field: FieldKind };

export type Draft = { version: 1; cards: CardDraft[]; focus: Focus | null; nextId: number };

export type DealEntry =
  | { kind: 'quantity'; deal: QuantityDeal }
  | { kind: 'percent'; deal: PercentOff }
  | { kind: 'coupon'; deal: Coupon }
  | { kind: 'spendSave'; deal: SpendSave }
  | { kind: 'cashback'; deal: Cashback }
  | { kind: 'deposit'; depositMinor: number };

export type DealRef =
  | { kind: 'quantity' | 'spendSave' | 'cashback' | 'deposit' }
  | { kind: 'percent' | 'coupon'; index: number };

export const PRESETS = {
  bogo: { kind: 'quantity', deal: { kind: 'buyXGetY', x: 1, y: 1, pct: '100' } },
  threeForTwo: { kind: 'quantity', deal: { kind: 'buyXGetY', x: 2, y: 1, pct: '100' } },
  secondHalf: { kind: 'quantity', deal: { kind: 'buyXGetY', x: 1, y: 1, pct: '50' } },
  pct10: { kind: 'percent', deal: { pct: '10' } },
  pct20: { kind: 'percent', deal: { pct: '20' } },
  pct25: { kind: 'percent', deal: { pct: '25' } },
} as const satisfies Record<string, DealEntry>;

export function cardLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

function emptyCard(id: string, unit: UnitId): CardDraft {
  return { id, price: '', size: '', unit, quantity: '', deals: {}, depositMinor: null, productId: null, productUid: null, productName: null, label: null };
}

/** Cards A and B, keypad on A's price (SPEC 2.1: "keypad ready" at launch). */
export function newDraft(unit: UnitId): Draft {
  return { version: 1, cards: [emptyCard('c1', unit), emptyCard('c2', unit)], focus: { cardId: 'c1', field: 'price' }, nextId: 3 };
}

/** Nothing typed, no deal, no linked product: the cards only hold their default unit. */
export function isPristine(draft: Draft): boolean {
  return draft.cards.every((c) => c.price === '' && c.size === '' && c.quantity === '' && c.depositMinor === null && c.productId === null && Object.keys(c.deals).length === 0);
}

/** Choosing another unit system in Settings: empty cards take that system's first chip unit (typed cards are left alone). */
export function withDefaultUnit(draft: Draft, unit: UnitId): Draft {
  return isPristine(draft) && draft.cards.some((c) => c.unit !== unit) ? newDraft(unit) : draft;
}

function updateCard(draft: Draft, cardId: string, change: (c: CardDraft) => CardDraft): Draft {
  return { ...draft, cards: draft.cards.map((c) => (c.id === cardId ? change(c) : c)) };
}

export function findCard(draft: Draft, cardId: string): CardDraft | undefined {
  return draft.cards.find((c) => c.id === cardId);
}

/** Packs bought is shown only when a deal depends on it (SPEC 2.1). */
export function quantityShown(card: CardDraft): boolean {
  const d = card.deals;
  return (
    !!d.quantity ||
    !!d.spendSave ||
    (d.percents ?? []).some((p) => p.minQty != null) ||
    (d.coupons ?? []).some((c) => c.perPack) ||
    card.quantity !== '' ||
    card.depositMinor != null
  );
}

/** One keypad key on the focused field: digits, "." or ",", "×" (size only), "del". Over-limit keys are ignored. */
export function pressKey(draft: Draft, key: string, exponent: number): Draft {
  const focus = draft.focus;
  if (!focus) return draft;
  const card = findCard(draft, focus.cardId);
  if (!card) return draft;
  const text = card[focus.field];
  const next = key === 'del' ? deleteLastKey(text) : appendKey(text, key === 'x' ? MULTIPLY_KEY : key, focus.field, exponent);
  if (next === text) return draft;
  return updateCard(draft, card.id, (c) => ({ ...c, [focus.field]: next }));
}

export function setFocus(draft: Draft, cardId: string, field: FieldKind): Draft {
  return findCard(draft, cardId) ? { ...draft, focus: { cardId, field } } : draft;
}

/** Next: price -> size -> (bought, when shown) -> next card's price -> … -> back to A. */
export function nextField(draft: Draft): Draft {
  const focus = draft.focus;
  if (!focus) return { ...draft, focus: { cardId: draft.cards[0].id, field: 'price' } };
  const index = draft.cards.findIndex((c) => c.id === focus.cardId);
  const card = draft.cards[index];
  if (!card) return draft;
  if (focus.field === 'price') return { ...draft, focus: { cardId: card.id, field: 'size' } };
  if (focus.field === 'size' && quantityShown(card)) return { ...draft, focus: { cardId: card.id, field: 'quantity' } };
  const following = draft.cards[(index + 1) % draft.cards.length];
  return { ...draft, focus: { cardId: following.id, field: 'price' } };
}

export function setUnit(draft: Draft, cardId: string, unit: UnitId): Draft {
  return updateCard(draft, cardId, (c) => ({ ...c, unit }));
}

/** "+ Add product": a new card inherits the previous card's unit and takes the keypad. */
export function addCard(draft: Draft): Draft {
  if (draft.cards.length >= MAX_CARDS) return draft;
  const last = draft.cards[draft.cards.length - 1];
  const card = emptyCard(`c${draft.nextId}`, last.unit);
  return { ...draft, cards: [...draft.cards, card], nextId: draft.nextId + 1, focus: { cardId: card.id, field: 'price' } };
}

/** "Duplicate card": a copy right after the original (to try another deal on the same product). */
export function duplicateCard(draft: Draft, cardId: string): Draft {
  const index = draft.cards.findIndex((c) => c.id === cardId);
  if (index < 0 || draft.cards.length >= MAX_CARDS) return draft;
  const copy: CardDraft = { ...draft.cards[index], id: `c${draft.nextId}`, deals: JSON.parse(JSON.stringify(draft.cards[index].deals)) };
  const cards = [...draft.cards.slice(0, index + 1), copy, ...draft.cards.slice(index + 1)];
  return { ...draft, cards, nextId: draft.nextId + 1, focus: { cardId: copy.id, field: 'price' } };
}

/** Removes a card; with only two left the card is emptied instead (Compare always shows A and B). */
export function removeCard(draft: Draft, cardId: string): Draft {
  const index = draft.cards.findIndex((c) => c.id === cardId);
  if (index < 0) return draft;
  if (draft.cards.length <= MIN_CARDS) {
    const unit = draft.cards[index].unit;
    return { ...updateCard(draft, cardId, () => emptyCard(cardId, unit)), focus: { cardId, field: 'price' } };
  }
  const cards = draft.cards.filter((c) => c.id !== cardId);
  const focus = draft.focus?.cardId === cardId ? { cardId: cards[Math.min(index, cards.length - 1)].id, field: 'price' as const } : draft.focus;
  return { ...draft, cards, focus };
}

/** "Clear" needs a second tap when it would throw away a link or a deal (SPEC 2.1). */
export function clearNeedsConfirm(draft: Draft): boolean {
  return draft.cards.some((c) => c.productId != null || hasDeals(c));
}

export function hasDeals(card: CardDraft): boolean {
  const d = card.deals;
  return !!d.quantity || !!d.spendSave || !!d.cashback || (d.percents?.length ?? 0) > 0 || (d.coupons?.length ?? 0) > 0 || card.depositMinor != null;
}

/** Two empty cards again (fresh ids, so nothing on screen keeps per-card state), keypad on A's price. */
export function clearDraft(draft: Draft): Draft {
  const unit = draft.cards[0]?.unit ?? 'g';
  const n = draft.nextId;
  const cards = [emptyCard(`c${n}`, unit), emptyCard(`c${n + 1}`, unit)];
  return { version: 1, cards, focus: { cardId: cards[0].id, field: 'price' }, nextId: n + 2 };
}

export function addDeal(draft: Draft, cardId: string, entry: DealEntry): Draft {
  return updateCard(draft, cardId, (c) => {
    const d: Deals = { ...c.deals };
    switch (entry.kind) {
      case 'quantity':
        return { ...c, deals: { ...d, quantity: entry.deal } };
      case 'percent':
        return { ...c, deals: { ...d, percents: [...(d.percents ?? []), entry.deal] } };
      case 'coupon':
        return { ...c, deals: { ...d, coupons: [...(d.coupons ?? []), entry.deal] } };
      case 'spendSave':
        return { ...c, deals: { ...d, spendSave: entry.deal } };
      case 'cashback':
        return { ...c, deals: { ...d, cashback: entry.deal } };
      case 'deposit':
        return { ...c, depositMinor: entry.depositMinor };
    }
  });
}

export function removeDeal(draft: Draft, cardId: string, ref: DealRef): Draft {
  return updateCard(draft, cardId, (c) => {
    const d: Deals = { ...c.deals };
    switch (ref.kind) {
      case 'quantity':
        delete d.quantity;
        return { ...c, deals: d, quantity: '' };
      case 'spendSave':
        delete d.spendSave;
        return { ...c, deals: d };
      case 'cashback':
        delete d.cashback;
        return { ...c, deals: d };
      case 'deposit':
        return { ...c, depositMinor: null };
      case 'percent':
        return { ...c, deals: { ...d, percents: (d.percents ?? []).filter((_, i) => i !== ref.index) } };
      case 'coupon':
        return { ...c, deals: { ...d, coupons: (d.coupons ?? []).filter((_, i) => i !== ref.index) } };
    }
  });
}

export function linkProduct(draft: Draft, cardId: string, product: { id: number; uid: string; name: string; label: string | null }): Draft {
  return updateCard(draft, cardId, (c) => ({ ...c, productId: product.id, productUid: product.uid, productName: product.name, label: product.label }));
}

export function unlinkProduct(draft: Draft, cardId: string): Draft {
  return updateCard(draft, cardId, (c) => ({ ...c, productId: null, productUid: null, productName: null, label: null }));
}

/** After a restore every link is dropped: the restored products are other rows, whatever their ids (REVIEW_V1 S2). */
export function unlinkAll(draft: Draft): Draft {
  if (draft.cards.every((c) => c.productId === null)) return draft;
  return { ...draft, cards: draft.cards.map((c) => ({ ...c, productId: null, productUid: null, productName: null, label: null })) };
}

/** What a link is checked against: the product now stored under the card's id, or null when there is none. */
export type LinkTarget = { id: number; uid: string; name: string; count_label: string | null } | null;

function sameName(a: string | null, b: string): boolean {
  const key = (t: string) => t.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  return a !== null && key(a) === key(b);
}

/**
 * Drops every link whose product is gone or is now a different product under the same id (uid differs; for a v1.0 link
 * without a uid: the name differs). A valid link takes the product's current name and count label (renamed product),
 * and a v1.0 link adopts the uid. Returns the same draft object when nothing changed.
 */
export function revalidateLinks(draft: Draft, targets: ReadonlyMap<number, LinkTarget>): Draft {
  let changed = false;
  const cards = draft.cards.map((c) => {
    if (c.productId === null || !targets.has(c.productId)) return c;
    const p = targets.get(c.productId) ?? null;
    const valid = p !== null && (c.productUid !== null ? p.uid === c.productUid : sameName(c.productName, p.name));
    if (!valid) {
      changed = true;
      return { ...c, productId: null, productUid: null, productName: null, label: null };
    }
    if (c.productUid === p.uid && c.productName === p.name && c.label === p.count_label) return c;
    changed = true;
    return { ...c, productUid: p.uid, productName: p.name, label: p.count_label };
  });
  return changed ? { ...draft, cards } : draft;
}

/** Keypad texts -> engine cards. Unparsable text becomes "not entered" (W7), never an exception. */
export function toEngineCards(draft: Draft, exponent: number): Card[] {
  return draft.cards.map((c) => {
    const price = parsePrice(c.price, exponent);
    const size = parseSize(c.size);
    let quantity: number | null = null;
    if (c.quantity !== '') {
      const q = parseQuantity(c.quantity);
      quantity = q.ok ? q.value : 0; // 0 -> the engine reports 'quantity' (W7)
    }
    return {
      id: c.id,
      priceMinor: price.ok ? price.value : null,
      size: size.ok ? size.value : null,
      unit: c.unit,
      quantity,
      depositMinor: c.depositMinor,
      label: c.label,
      deals: c.deals,
    };
  });
}

// ---------- persistence (settings.compareDraft) ----------

export function serializeDraft(draft: Draft): string {
  return JSON.stringify(draft);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);

/** Deals are kept only in their structural shape; the engine validates the numbers (bad values -> W7 "Check the deal"). */
function readDeals(v: unknown): Deals {
  if (!isObj(v)) return {};
  const out: Deals = {};
  if (isObj(v.quantity) && (v.quantity.kind === 'buyXGetY' || v.quantity.kind === 'multiBuy')) out.quantity = v.quantity as QuantityDeal;
  if (Array.isArray(v.percents)) out.percents = v.percents.filter(isObj) as PercentOff[];
  if (Array.isArray(v.coupons)) out.coupons = v.coupons.filter(isObj) as Coupon[];
  if (isObj(v.spendSave)) out.spendSave = v.spendSave as SpendSave;
  if (isObj(v.cashback)) out.cashback = v.cashback as Cashback;
  return out;
}

/** A saved draft, or a new one when the text is missing or damaged (never throws). */
export function parseDraft(text: string | null | undefined, fallbackUnit: UnitId): Draft {
  if (!text) return newDraft(fallbackUnit);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return newDraft(fallbackUnit);
  }
  if (!isObj(raw) || raw.version !== 1 || !Array.isArray(raw.cards)) return newDraft(fallbackUnit);
  const seen = new Set<string>();
  const cards: CardDraft[] = [];
  for (const c of raw.cards.slice(0, MAX_CARDS)) {
    if (!isObj(c) || typeof c.id !== 'string' || seen.has(c.id)) continue;
    seen.add(c.id);
    cards.push({
      id: c.id,
      price: str(c.price),
      size: str(c.size),
      unit: isUnitId(c.unit) ? c.unit : fallbackUnit,
      quantity: str(c.quantity),
      deals: readDeals(c.deals),
      depositMinor: intOrNull(c.depositMinor),
      productId: intOrNull(c.productId),
      productUid: typeof c.productUid === 'string' ? c.productUid : null,
      productName: typeof c.productName === 'string' ? c.productName : null,
      label: typeof c.label === 'string' ? c.label : null,
    });
  }
  let nextId = intOrNull(raw.nextId) ?? 1;
  for (const c of cards) {
    const n = /^c(\d+)$/.exec(c.id);
    if (n) nextId = Math.max(nextId, Number(n[1]) + 1);
  }
  while (cards.length < MIN_CARDS) cards.push(emptyCard(`c${nextId++}`, cards[cards.length - 1]?.unit ?? fallbackUnit));
  const f = raw.focus;
  const focus: Focus | null =
    isObj(f) && typeof f.cardId === 'string' && seen.has(f.cardId) && (f.field === 'price' || f.field === 'size' || f.field === 'quantity')
      ? { cardId: f.cardId, field: f.field }
      : { cardId: cards[0].id, field: 'price' };
  return { version: 1, cards, focus, nextId };
}
