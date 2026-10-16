/** @jest-environment node */
import { readAppSettings } from './app-settings';
import { addDeal, linkProduct, newDraft, nextField, pressKey, PRESETS, setUnit, type Draft } from './compare-draft';
import { candidateInput, saveCandidate } from './save-from-compare';

const EU = readAppSettings({ currency: 'EUR', unitSystem: 'metric', decimalSeparator: '.' });

function type(draft: Draft, keys: string): Draft {
  let d = draft;
  for (const k of keys) d = k === '>' ? nextField(d) : pressKey(d, k, 2);
  return d;
}

describe('Save a Compare card (U3, D40)', () => {
  it('a plain card: shelf price, size, unit, no deal', () => {
    const d = type(newDraft('g'), '2.49>500');
    const c = saveCandidate(d, 'c1', EU, 'en-US')!;
    expect(c.memory).toMatchObject({ packPriceMinor: 249, paidPriceMinor: null, packCount: 1, itemSize: '500', unit: 'g', isPromo: false });
    expect(c.dealText).toBeNull();
    expect(c.dimension).toBe('mass');
    expect(candidateInput(c, 7, 2, 'EUR', '2026-09-30')).toMatchObject({ productId: 7, storeId: 2, observedOn: '2026-09-30', packPriceMinor: 249, isPromo: false });
  });
  it('3 for 2 on €2.29 / 500 g: paid price 153 per pack, promo, deal text', () => {
    const d = addDeal(type(newDraft('g'), '2.29>500'), 'c1', PRESETS.threeForTwo);
    const c = saveCandidate(d, 'c1', EU, 'en-US')!;
    expect(c.memory).toMatchObject({ packPriceMinor: 229, paidPriceMinor: 153, isPromo: true });
    expect(c.dealText).toBe('3 for 2');
  });
  it('tax and cashback are not part of the saved price (D40)', () => {
    const d = type(newDraft('g'), '4.99>1');
    const withTax = saveCandidate(d, 'c1', readAppSettings({ currency: 'USD', taxMode: 'add', taxRate: '8.875' }), 'en-US')!;
    expect(withTax.memory.packPriceMinor).toBe(499);
    expect(withTax.memory.paidPriceMinor).toBeNull();
  });
  it('a multipack and another unit', () => {
    const d = setUnit(type(newDraft('g'), '4.5>6×330'), 'c1', 'ml');
    const c = saveCandidate(d, 'c1', EU, 'en-US')!;
    expect(c.memory).toMatchObject({ packCount: 6, itemSize: '330', unit: 'ml' });
    expect(c.dimension).toBe('volume');
  });
  it('a linked card keeps its product; an incomplete card cannot be saved', () => {
    const d = linkProduct(type(newDraft('g'), '2.49>500'), 'c1', { id: 4, uid: 'u4', name: 'Coffee beans', label: null });
    expect(saveCandidate(d, 'c1', EU, 'en-US')).toMatchObject({ productId: 4, productName: 'Coffee beans' });
    expect(saveCandidate(newDraft('g'), 'c1', EU, 'en-US')).toBeNull();
    expect(saveCandidate(d, 'nope', EU, 'en-US')).toBeNull();
  });
});
