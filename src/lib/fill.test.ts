/** @jest-environment node */
import { fill, splitUnitPriceLine } from './format';
import { strings } from './strings';

describe('fill', () => {
  it('replaces {name} and leaves unknown names alone', () => {
    expect(fill('a {x} b {y}', { x: 3 })).toBe('a 3 b {y}');
  });

  it('{name:word} reads "1 price", "0 prices", "2 prices" - never "1 prices"', () => {
    expect(fill('{n:price}', { n: 1 })).toBe('1 price');
    expect(fill('{n:price}', { n: 0 })).toBe('0 prices');
    expect(fill('{n:price}', { n: 2 })).toBe('2 prices');
    expect(fill(strings.product.storeLowest, { lowest: '€1', count: 1 })).toBe('Lowest €1 · 1 price');
    expect(fill(strings.gauge.building, { count: 1 })).toBe('Building your history (1 price)');
    expect(fill(strings.data.counts, { prices: 1, products: 1, stores: 1 })).toBe('1 price, 1 product, 1 store');
    expect(fill(strings.data.counts, { prices: 7, products: 2, stores: 3 })).toBe('7 prices, 2 products, 3 stores');
  });
});

describe('splitUnitPriceLine (REVIEW_V1 S5)', () => {
  it('splits the amount from its basis, never inside the amount', () => {
    expect(splitUnitPriceLine('€4.98 per kg')).toEqual({ amount: '€4.98', per: 'per kg' });
    expect(splitUnitPriceLine('4,98 € per 100 g')).toEqual({ amount: '4,98 €', per: 'per 100 g' });
    expect(splitUnitPriceLine('$0.312 per fl oz')).toEqual({ amount: '$0.312', per: 'per fl oz' });
    expect(splitUnitPriceLine('€0.25 each')).toEqual({ amount: '€0.25', per: 'each' });
    expect(splitUnitPriceLine('Free')).toEqual({ amount: 'Free', per: null });
  });
});

describe('REVIEW_V1 N1: no text can read "1 prices"', () => {
  it('every "{n} prices" template has a "...One" sibling; the rest use {n:price}', () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string, parent: Record<string, unknown> | null, key: string) => {
      if (typeof node === 'string') {
        if (/\{\w+\} (prices|price lines)\b/.test(node) && !(parent && typeof parent[`${key}One`] === 'string')) offenders.push(`${path}: ${node}`);
        return;
      }
      if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, node as Record<string, unknown>, k);
    };
    walk(strings, 'strings', null, '');
    expect(offenders).toEqual([]);
    expect(fill(strings.picker.prices, { count: 1 })).toBe('1 price');
    expect(fill(strings.data.csvRows, { count: 1 })).toBe('1 price, one per line');
  });
});
