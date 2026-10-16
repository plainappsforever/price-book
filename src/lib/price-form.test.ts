/** @jest-environment node */
import type { ObservationRecord } from '@/engine/backup';
import { readAppSettings } from './app-settings';
import { buildPriceInput, formFromObservation, liveUnitPrice, minorToText, newPriceForm, nextPriceField, pressPriceKey, sizeText } from './price-form';

const EU = readAppSettings({ currency: 'EUR', unitSystem: 'metric' });

const last: ObservationRecord = {
  id: 5, product_id: 1, store_id: 1, observed_on: '2026-08-28', currency: 'EUR', pack_price_minor: 249, paid_price_minor: null,
  pack_count: 6, item_size: '330', unit: 'ml', deposit_minor: 25, is_promo: 0, deal_text: null, note: 'n', created_at: '2026-08-28T10:00:00.000Z',
  updated_at: null, minor_digits: 2,
};

function type(form: ReturnType<typeof newPriceForm>, keys: string) {
  let f = form;
  for (const k of keys) f = k === '>' ? nextPriceField(f) : pressPriceKey(f, k, 2);
  return f;
}

describe('text conversions', () => {
  it('minor units <-> keypad text', () => {
    expect(minorToText(249, 2)).toBe('2.49');
    expect(minorToText(5, 2)).toBe('0.05');
    expect(minorToText(200, 2)).toBe('2');
    expect(minorToText(150, 0)).toBe('150');
    expect(minorToText(1234, 3)).toBe('1.234');
    expect(sizeText(6, '330')).toBe('6×330');
    expect(sizeText(1, '500')).toBe('500');
  });
});

describe('new price (U4): prefilled, type digits, save', () => {
  it('takes store, pack size and unit from the last price and today', () => {
    const f = newPriceForm({ last, lastStoreId: 9, today: '2026-09-30', defaultUnit: 'g' });
    expect(f).toMatchObject({ storeId: 1, date: '2026-09-30', price: '', size: '6×330', unit: 'ml', focus: 'price', isPromo: false });
  });
  it('without a last price uses the recent store and the default unit, empty size', () => {
    const f = newPriceForm({ last: null, lastStoreId: 9, today: '2026-09-30', defaultUnit: 'g' });
    expect(f).toMatchObject({ storeId: 9, size: '', unit: 'g' });
  });
  it('digits go to the price, Next moves to the size, over-limit keys are ignored', () => {
    let f = newPriceForm({ last: null, lastStoreId: null, today: '2026-09-30', defaultUnit: 'g' });
    f = type(f, '2.49>500');
    expect(f.price).toBe('2.49');
    expect(f.size).toBe('500');
    expect(pressPriceKey(f, '9', 2)).toMatchObject({ size: '5009' });
    f = type({ ...f, focus: 'price' }, '9');
    expect(f.price).toBe('2.49'); // third decimal refused
    expect(pressPriceKey(f, '×', 2).price).toBe('2.49'); // × only in the size field
    expect(pressPriceKey({ ...f, focus: 'size' }, '×', 2).size).toBe('500×');
    expect(pressPriceKey(f, 'del', 2).price).toBe('2.4');
  });
});

describe('buildPriceInput', () => {
  it('turns the form into an observation', () => {
    const f = { ...newPriceForm({ last, lastStoreId: null, today: '2026-09-30', defaultUnit: 'g' }), price: '2.49', note: ' hi ', deposit: '0.25' };
    const r = buildPriceInput(f, 1, 'EUR');
    expect(r).toEqual({
      ok: true,
      input: {
        productId: 1, storeId: 1, observedOn: '2026-09-30', currency: 'EUR', packPriceMinor: 249, paidPriceMinor: null, packCount: 6,
        itemSize: '330', unit: 'ml', depositMinor: 25, isPromo: false, dealText: null, note: ' hi ',
      },
    });
  });
  it('refuses missing price, size and a bad deposit', () => {
    const base = newPriceForm({ last, lastStoreId: null, today: '2026-09-30', defaultUnit: 'g' });
    expect(buildPriceInput(base, 1, 'EUR')).toEqual({ ok: false, error: 'price' });
    expect(buildPriceInput({ ...base, price: '1', size: '' }, 1, 'EUR')).toEqual({ ok: false, error: 'size' });
    expect(buildPriceInput({ ...base, price: '1', deposit: '1.234' }, 1, 'EUR')).toEqual({ ok: false, error: 'deposit' });
  });
  it('a free item (price 0) is allowed; JPY has no decimals', () => {
    const f = { ...newPriceForm({ last: null, lastStoreId: null, today: '2026-09-30', defaultUnit: 'g' }), price: '0', size: '100' };
    expect(buildPriceInput(f, 1, 'EUR')).toMatchObject({ ok: true });
    expect(buildPriceInput({ ...f, price: '150' }, 1, 'JPY')).toMatchObject({ ok: true, input: { packPriceMinor: 150 } });
    expect(buildPriceInput({ ...f, price: '1.5' }, 1, 'JPY')).toEqual({ ok: false, error: 'price' });
  });
  it('promo keeps the deal text, otherwise none is stored', () => {
    const f = { ...newPriceForm({ last: null, lastStoreId: null, today: '2026-09-30', defaultUnit: 'g' }), price: '3.99', size: '1', unit: 'kg' as const, dealText: '1 kg for 3.99' };
    expect(buildPriceInput(f, 1, 'EUR')).toMatchObject({ input: { isPromo: false, dealText: null } });
    expect(buildPriceInput({ ...f, isPromo: true }, 1, 'EUR')).toMatchObject({ input: { isPromo: true, dealText: '1 kg for 3.99' } });
  });
});

describe('editing an existing price', () => {
  it('round-trips through the form', () => {
    const f = formFromObservation({ ...last, is_promo: 1, deal_text: '6 for 5' });
    expect(f).toMatchObject({ price: '2.49', size: '6×330', deposit: '0.25', isPromo: true, dealText: '6 for 5', note: 'n' });
    const r = buildPriceInput(f, 1, 'EUR');
    expect(r.ok && r.input.packPriceMinor).toBe(249);
    expect(r.ok && r.input.depositMinor).toBe(25);
  });
  it('shows a row saved with other decimals in the current ones (D41)', () => {
    const f = formFromObservation({ ...last, currency: 'JPY', pack_price_minor: 15000, minor_digits: 2, deposit_minor: 0 });
    expect(f.price).toBe('150');
  });
});

describe('live unit price', () => {
  it('2.49 for 500 g is 4.98 per kg', () => {
    const f = type(newPriceForm({ last: null, lastStoreId: null, today: '2026-09-30', defaultUnit: 'g' }), '2.49>500');
    const live = liveUnitPrice(f, 'mass', EU);
    expect(live).not.toBeNull();
    expect(live!.basis).toBe('kg');
    expect(live!.unitPrice).toEqual({ n: BigInt(498), d: BigInt(1) });
  });
  it('null while incomplete', () => {
    expect(liveUnitPrice(newPriceForm({ last: null, lastStoreId: null, today: '2026-09-30', defaultUnit: 'g' }), 'mass', EU)).toBeNull();
  });
});
