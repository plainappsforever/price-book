/** @jest-environment node */
import { buildDeal, formKey } from './deal-forms';

describe('deal forms', () => {
  it('N for price, must-buy and per item (E10, E12)', () => {
    expect(buildDeal('nForPrice', { n: '3', price: '5' }, {}, 2)).toEqual({ kind: 'quantity', deal: { kind: 'multiBuy', n: 3, priceMinor: 500 } });
    expect(buildDeal('nForPrice', { n: '10', price: '10' }, { perItem: true }, 2)).toEqual({
      kind: 'quantity', deal: { kind: 'multiBuy', n: 10, priceMinor: 1000, perItem: true },
    });
    expect(buildDeal('nForPrice', { n: '', price: '5' }, {}, 2)).toBeNull();
  });
  it('coupon, buy X get Y, % with a minimum', () => {
    expect(buildDeal('coupon', { amount: '1' }, { manufacturer: true }, 2)).toEqual({ kind: 'coupon', deal: { amountMinor: 100, manufacturer: true } });
    expect(buildDeal('buyXGetY', { x: '3', y: '2', pct: '100' }, {}, 2)).toEqual({ kind: 'quantity', deal: { kind: 'buyXGetY', x: 3, y: 2, pct: '100' } });
    expect(buildDeal('percent', { pct: '20', minQty: '2' }, {}, 2)).toEqual({ kind: 'percent', deal: { pct: '20', minQty: 2 } });
    expect(buildDeal('percent', { pct: '12,50', minQty: '' }, {}, 2)).toEqual({ kind: 'percent', deal: { pct: '12.5' } });
    expect(buildDeal('percent', { pct: '101' }, {}, 2)).toBeNull();
  });
  it('spend & save and cashback need exactly one of amount / %', () => {
    expect(buildDeal('spendSave', { threshold: '30', saveAmount: '5', savePct: '' }, {}, 2)).toEqual({ kind: 'spendSave', deal: { thresholdMinor: 3000, saveMinor: 500 } });
    expect(buildDeal('spendSave', { threshold: '30', saveAmount: '5', savePct: '10' }, {}, 2)).toBeNull();
    expect(buildDeal('cashback', { amount: '', pct: '10' }, {}, 2)).toEqual({ kind: 'cashback', deal: { pct: '10' } });
    expect(buildDeal('deposit', { amount: '0.25' }, {}, 2)).toEqual({ kind: 'deposit', depositMinor: 25 });
  });
  it('form keys: no × anywhere, money keeps the currency decimals', () => {
    expect(formKey('6', '×', 'percent', 2)).toBe('6');
    expect(formKey('1.99', '9', 'money', 2)).toBe('1.99');
    expect(formKey('12', 'del', 'whole', 2)).toBe('1');
  });
});
