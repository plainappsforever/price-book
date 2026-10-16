// State of the Add / edit price screen (SPEC 2.4) as plain data, so the key handling, the prefill and the
// conversion into an observation are Jest-tested. Money and sizes stay keypad text until `buildPriceInput`.
import type { ObservationRecord } from '@/engine/backup';
import { maxMinorFor } from '@/engine/deals';
import { currencyExponent, minorToRat, rescaleMinor, unitPriceDecimals } from '@/engine/money';
import { appendKey, deleteLastKey, MULTIPLY_KEY, parsePrice, parseSize } from '@/engine/parse';
import { fromDecimal, type Rat } from '@/engine/rational';
import { basisQuantity, isUnitId, packQuantity, unitPrice, type BasisId, type Dimension, type UnitId } from '@/engine/units';
import type { ObservationInput } from '@/db/observations';

import type { AppSettings } from './app-settings';

export type PriceFormField = 'price' | 'size' | 'deposit';

export type PriceForm = {
  storeId: number | null;
  date: string;
  price: string;
  size: string;
  unit: UnitId;
  deposit: string;
  isPromo: boolean;
  dealText: string;
  note: string;
  focus: PriceFormField;
  /**
   * The price's own currency when editing a saved price (S1: a price kept in another currency stays in it, with its
   * own decimals); null for a new price, which takes the book currency.
   */
  currency: string | null;
  /**
   * B1: the saved after-deal price per pack (D40, from Compare) in the currency's current decimals, and the shelf-price
   * text it belongs to. The form does not show it as a field, so it must survive an edit of the store, date or note.
   */
  paid: { minor: number; forPrice: string } | null;
  /** The user's choice about `paid`: null = automatic (kept while the shelf price is unchanged). */
  keepPaid: boolean | null;
  /**
   * B1: the deal text of a saved price that is not a promotion (a deal that did not change the shelf price, e.g. "3 for 2"
   * when one was bought). The form shows deal text only for promotions, so this one is carried through unchanged.
   */
  hiddenDealText: string | null;
};

/** Integer minor units -> keypad text in major units ("249" -> "2.49", "5" -> "0.05", JPY "150" -> "150"). */
export function minorToText(minor: number, exponent: number): string {
  if (exponent === 0) return String(minor);
  const digits = String(minor).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const frac = digits.slice(digits.length - exponent).replace(/0+$/, '');
  return frac === '' ? whole : `${whole}.${frac}`;
}

/** Keypad text of a pack: "500", "6×330". */
export function sizeText(packCount: number, itemSize: string): string {
  return packCount > 1 ? `${packCount}${MULTIPLY_KEY}${itemSize}` : itemSize;
}

/**
 * A new price: store, size, unit and date prefilled (SPEC 2.4: last store, last pack size and unit, today),
 * the price empty and focused so that U4 is "type the digits, Save".
 */
export function newPriceForm(opts: { last: ObservationRecord | null; lastStoreId: number | null; today: string; defaultUnit: UnitId }): PriceForm {
  const { last } = opts;
  return {
    storeId: last?.store_id ?? opts.lastStoreId,
    date: opts.today,
    price: '',
    size: last ? sizeText(last.pack_count, last.item_size) : '',
    unit: last && isUnitId(last.unit) ? last.unit : opts.defaultUnit,
    deposit: '',
    isPromo: false,
    dealText: '',
    note: '',
    focus: 'price',
    currency: null,
    paid: null,
    keepPaid: null,
    hiddenDealText: null,
  };
}

/** An existing price in the form (money shown in the currency's current decimals, D41). */
export function formFromObservation(o: ObservationRecord): PriceForm {
  const exponent = currencyExponent(o.currency);
  const from = o.minor_digits ?? exponent;
  const text = (minor: number) => minorToText(rescaleMinor(minor, from, exponent), exponent);
  const price = text(o.pack_price_minor);
  return {
    storeId: o.store_id,
    date: o.observed_on,
    price,
    size: sizeText(o.pack_count, o.item_size),
    unit: isUnitId(o.unit) ? o.unit : 'g',
    deposit: o.deposit_minor > 0 ? text(o.deposit_minor) : '',
    isPromo: o.is_promo === 1,
    dealText: o.deal_text ?? '',
    note: o.note ?? '',
    focus: 'price',
    currency: o.currency,
    paid: o.paid_price_minor == null ? null : { minor: rescaleMinor(o.paid_price_minor, from, exponent), forPrice: price },
    keepPaid: null,
    hiddenDealText: o.is_promo === 1 ? null : o.deal_text,
  };
}

/** The currency the form's money is typed in: the saved price's own (editing) or the book currency (new). */
export function formCurrency(form: PriceForm, bookCurrency: string): string {
  return form.currency ?? bookCurrency;
}

/**
 * B1: the after-deal price that will be saved with the form, or null. Kept automatically while the shelf price text is
 * unchanged; after a change of the shelf price it is dropped unless the user chose "Keep" — and never kept above the
 * new shelf price.
 */
export function keptPaidMinor(form: PriceForm, shelfMinor: number | null): number | null {
  if (!form.paid) return null;
  const keep = form.keepPaid ?? form.price === form.paid.forPrice;
  if (!keep) return null;
  if (shelfMinor === null || form.paid.minor > shelfMinor) return null;
  return form.paid.minor;
}

/** One keypad key on the focused field. Over-limit keys are ignored. */
export function pressPriceKey(form: PriceForm, key: string, exponent: number): PriceForm {
  const field = form.focus;
  const text = form[field];
  const next = key === 'del' ? deleteLastKey(text) : appendKey(text, key === 'x' ? MULTIPLY_KEY : key, field === 'size' ? 'size' : 'price', exponent);
  return next === text ? form : { ...form, [field]: next };
}

/** Next: price -> size -> price (deposit is reached by tapping its field). */
export function nextPriceField(form: PriceForm): PriceForm {
  return { ...form, focus: form.focus === 'price' ? 'size' : 'price' };
}

export type PriceFormError = 'price' | 'size' | 'deposit';

/**
 * The form as a saved price. A price edited from the book keeps everything the form does not show (B1: the after-deal
 * price from Compare, the deal text of a non-promo row) and its own currency (S1); `bookCurrency` applies to new prices only.
 * A promo price typed by hand is the shelf price itself (no paid price).
 */
export function buildPriceInput(
  form: PriceForm,
  productId: number,
  bookCurrency: string
): { ok: true; input: ObservationInput } | { ok: false; error: PriceFormError } {
  const currency = formCurrency(form, bookCurrency);
  const exponent = currencyExponent(currency);
  const price = parsePrice(form.price, exponent);
  if (!price.ok) return { ok: false, error: 'price' };
  const size = parseSize(form.size);
  if (!size.ok) return { ok: false, error: 'size' };
  let depositMinor = 0;
  if (form.deposit !== '') {
    const d = parsePrice(form.deposit, exponent);
    if (!d.ok) return { ok: false, error: 'deposit' };
    depositMinor = d.value;
  }
  if (price.value > maxMinorFor(currency)) return { ok: false, error: 'price' };
  return {
    ok: true,
    input: {
      productId,
      storeId: form.storeId,
      observedOn: form.date,
      currency,
      packPriceMinor: price.value,
      paidPriceMinor: keptPaidMinor(form, price.value),
      packCount: size.value.packCount,
      itemSize: size.value.itemSize,
      unit: form.unit,
      depositMinor,
      isPromo: form.isPromo,
      dealText: form.isPromo ? form.dealText : form.hiddenDealText,
      note: form.note,
    },
  };
}

export type LiveUnitPrice = { unitPrice: Rat; basis: BasisId; decimals: number };

/** The unit price of what is typed so far ("= €4.98 per kg"), or null while price or size is incomplete. */
export function liveUnitPrice(form: PriceForm, dimension: Dimension, settings: AppSettings): LiveUnitPrice | null {
  const exponent = currencyExponent(formCurrency(form, settings.currency));
  const price = parsePrice(form.price, exponent);
  const size = parseSize(form.size);
  if (!price.ok || !size.ok) return null;
  const itemSize = fromDecimal(size.value.itemSize);
  const basis = settings.bases[dimension];
  const basisQty = basisQuantity(dimension, basis);
  if (!itemSize || !basisQty) return null;
  const quantity = packQuantity(size.value.packCount, itemSize, form.unit);
  const value = unitPrice(minorToRat(price.value), quantity, basisQty);
  return { unitPrice: value, basis, decimals: unitPriceDecimals([value], exponent) };
}
