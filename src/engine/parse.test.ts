/** @jest-environment node */
import parse from '../../test/fixtures/engine/parse.json';
import { checkCases, type Case } from '../../test/engine-fixtures';
import {
  LIMITS, MULTIPLY_KEY, appendKey, canonicalDecimal, deleteLastKey, parsePrice, parseQuantity, parseSize, type KeyField,
} from './parse';

const sections = parse as unknown as Record<string, Case<any, any>[]>;

describe('fixture hygiene', () => {
  it.each(Object.keys(sections))('%s: every case has an id and a note, ids are unique', (name) => {
    checkCases(name, sections[name]);
  });
});

describe('parsePrice (parse.json)', () => {
  it.each(sections.price.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(parsePrice(c.input.text, c.input.exponent)).toEqual(c.expected);
  });
});

describe('parseSize (parse.json)', () => {
  it.each(sections.size.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(parseSize(c.input.text)).toEqual(c.expected);
  });
});

describe('parseQuantity (parse.json)', () => {
  it.each(sections.quantity.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(parseQuantity(c.input.text)).toEqual(c.expected);
  });
});

describe('canonicalDecimal (parse.json)', () => {
  it.each(sections.canonicalDecimal.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(canonicalDecimal(c.input.text)).toBe(c.expected);
  });
});

describe('keypad key-by-key input (parse.json)', () => {
  function typeKeys(field: KeyField, exponent: number, keys: string): string {
    let text = '';
    for (const key of Array.from(keys)) text = key === '<' ? deleteLastKey(text) : appendKey(text, key, field, exponent);
    return text;
  }
  it.each(sections.keys.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(typeKeys(c.input.field, c.input.exponent, c.input.keys)).toBe(c.expected);
  });

  it('never throws and never produces text that parse would call malformed or over a limit, for any key sequence', () => {
    // Deterministic pseudo-random walks over the whole keypad (own tiny PRNG, no dependency).
    let seed = 20261001;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
    const alphabet = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', ',', 'x', MULTIPLY_KEY, 'z', '-'];
    for (const field of ['price', 'size', 'quantity'] as const) {
      for (const exponent of [0, 2, 3]) {
        for (let run = 0; run < 300; run++) {
          let text = '';
          for (let i = 0; i < 25; i++) {
            text = appendKey(text, alphabet[next() % alphabet.length], field, exponent);
            const result = field === 'price' ? parsePrice(text, exponent) : field === 'size' ? parseSize(text) : parseQuantity(text);
            if (!result.ok) expect(['empty', 'incomplete', 'zero']).toContain(result.error);
          }
        }
      }
    }
  });
});

describe('limits (SPEC 5.3)', () => {
  it('are the documented numbers', () => {
    expect(LIMITS).toEqual({ priceMajorMax: 1_000_000, sizeMax: 1_000_000, sizeDecimalsMax: 3, packCountMax: 999, quantityMax: 999 });
  });
});
