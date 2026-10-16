// The deal sheet's forms (U2, SPEC 5.4): presets add in one tap; the rest are small keypad forms turned into a
// DealEntry here. Pure; returns null when the numbers are not usable (the sheet then says "Check the deal").
import { appendKey, deleteLastKey, parsePrice, parseQuantity, type KeyField } from '@/engine/parse';

import { isRate } from './app-settings';
import type { DealEntry } from './compare-draft';
import { strings } from './strings';

export type FormId = 'nForPrice' | 'coupon' | 'buyXGetY' | 'percent' | 'spendSave' | 'cashback' | 'deposit';
export type FieldKindForm = 'money' | 'whole' | 'percent';
export type FieldDef = { key: string; label: string; kind: FieldKindForm; initial?: string };
export type ToggleDef = { key: string; label: string };
export type FormDef = { title: string; fields: FieldDef[]; toggles: ToggleDef[] };

const f = strings.deals.fields;
export const FORMS: Record<FormId, FormDef> = {
  nForPrice: { title: strings.deals.nForPrice, fields: [{ key: 'n', label: f.n, kind: 'whole' }, { key: 'price', label: f.price, kind: 'money' }], toggles: [{ key: 'perItem', label: strings.deals.perItem }] },
  coupon: {
    title: strings.deals.coupon,
    fields: [{ key: 'amount', label: f.amount, kind: 'money' }],
    toggles: [{ key: 'perPack', label: strings.deals.perPack }, { key: 'manufacturer', label: strings.deals.manufacturer }],
  },
  buyXGetY: {
    title: strings.deals.buyXGetY,
    fields: [{ key: 'x', label: f.x, kind: 'whole' }, { key: 'y', label: f.y, kind: 'whole' }, { key: 'pct', label: f.pct, kind: 'percent', initial: '100' }],
    toggles: [],
  },
  percent: { title: strings.deals.percent, fields: [{ key: 'pct', label: f.pct, kind: 'percent' }, { key: 'minQty', label: f.minQty, kind: 'whole' }], toggles: [] },
  spendSave: {
    title: strings.deals.spendSave,
    fields: [{ key: 'threshold', label: f.threshold, kind: 'money' }, { key: 'saveAmount', label: f.saveAmount, kind: 'money' }, { key: 'savePct', label: f.savePct, kind: 'percent' }],
    toggles: [],
  },
  cashback: { title: strings.deals.cashback, fields: [{ key: 'amount', label: f.cashbackAmount, kind: 'money' }, { key: 'pct', label: f.cashbackPct, kind: 'percent' }], toggles: [] },
  deposit: { title: strings.deals.deposit, fields: [{ key: 'amount', label: f.deposit, kind: 'money' }], toggles: [] },
};

const KEY_FIELD: Record<FieldKindForm, KeyField> = { money: 'price', whole: 'quantity', percent: 'size' };

/** One keypad key on a form field ("×" never applies here). */
export function formKey(text: string, key: string, kind: FieldKindForm, exponent: number): string {
  if (key === 'del') return deleteLastKey(text);
  if (key === '×' || key === 'x') return text;
  return appendKey(text, key, KEY_FIELD[kind], exponent);
}

export function initialValues(form: FormId): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fd of FORMS[form].fields) out[fd.key] = fd.initial ?? '';
  return out;
}

const money = (t: string | undefined, exponent: number): number | null => {
  const r = parsePrice(t ?? '', exponent);
  return r.ok ? r.value : null;
};
const whole = (t: string | undefined): number | null => {
  const r = parseQuantity(t ?? '');
  return r.ok ? r.value : null;
};
/** Canonical percent text ("12.50" -> "12.5", ",5" -> "0.5") or null. */
const percent = (t: string | undefined): string | null => {
  const text = (t ?? '').replace(',', '.');
  if (text === '' || text === '.') return null;
  const canonical = text.startsWith('.') ? `0${text}` : text;
  const trimmed = canonical.includes('.') ? canonical.replace(/0+$/, '').replace(/\.$/, '') : canonical.replace(/^0+(?=\d)/, '');
  return isRate(trimmed) ? trimmed : null;
};

export function buildDeal(form: FormId, v: Record<string, string>, toggles: Record<string, boolean>, exponent: number): DealEntry | null {
  switch (form) {
    case 'nForPrice': {
      const n = whole(v.n);
      const price = money(v.price, exponent);
      return n && price !== null ? { kind: 'quantity', deal: { kind: 'multiBuy', n, priceMinor: price, ...(toggles.perItem ? { perItem: true } : {}) } } : null;
    }
    case 'coupon': {
      const amount = money(v.amount, exponent);
      return amount !== null ? { kind: 'coupon', deal: { amountMinor: amount, ...(toggles.perPack ? { perPack: true } : {}), ...(toggles.manufacturer ? { manufacturer: true } : {}) } } : null;
    }
    case 'buyXGetY': {
      const x = whole(v.x);
      const y = whole(v.y);
      const pct = percent(v.pct);
      return x && y && pct ? { kind: 'quantity', deal: { kind: 'buyXGetY', x, y, pct } } : null;
    }
    case 'percent': {
      const pct = percent(v.pct);
      if (!pct) return null;
      if (!v.minQty) return { kind: 'percent', deal: { pct } };
      const m = whole(v.minQty);
      return m ? { kind: 'percent', deal: { pct, minQty: m } } : null;
    }
    case 'spendSave': {
      const threshold = money(v.threshold, exponent);
      const amount = v.saveAmount ? money(v.saveAmount, exponent) : null;
      const pct = v.savePct ? percent(v.savePct) : null;
      if (threshold === null || (amount === null) === (pct === null)) return null;
      return { kind: 'spendSave', deal: amount !== null ? { thresholdMinor: threshold, saveMinor: amount } : { thresholdMinor: threshold, savePct: pct } };
    }
    case 'cashback': {
      const amount = v.amount ? money(v.amount, exponent) : null;
      const pct = v.pct ? percent(v.pct) : null;
      if ((amount === null) === (pct === null)) return null;
      return { kind: 'cashback', deal: amount !== null ? { amountMinor: amount } : { pct } };
    }
    case 'deposit': {
      const amount = money(v.amount, exponent);
      return amount !== null ? { kind: 'deposit', depositMinor: amount } : null;
    }
  }
}
