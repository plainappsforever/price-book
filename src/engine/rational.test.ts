/** @jest-environment node */
import {
  add, cmp, div, eq, floor, fromDecimal, isZero, max, min, mul, neg, pow10, rat, roundHalfUp, sign, sub, toDecimalString, toSafeInt, ONE, ZERO,
} from './rational';

const r = (n: number, d = 1) => rat(n, d);

describe('rat()', () => {
  it('normalises to lowest terms with a positive denominator', () => {
    expect(rat(6, 8)).toEqual({ n: BigInt(3), d: BigInt(4) });
    expect(rat(3, -6)).toEqual({ n: BigInt(-1), d: BigInt(2) });
    expect(rat(0, 5)).toEqual({ n: BigInt(0), d: BigInt(1) });
    expect(rat(-4, -2)).toEqual({ n: BigInt(2), d: BigInt(1) });
  });
  it('accepts bigints and refuses a zero denominator', () => {
    expect(rat(BigInt(10), BigInt(4))).toEqual(rat(5, 2));
    expect(() => rat(1, 0)).toThrow(RangeError);
  });
});

describe('fromDecimal()', () => {
  it.each([
    ['2.49', '249/100'],
    ['500', '500/1'],
    ['0.33', '33/100'],
    ['.5', '1/2'],
    ['7.', '7/1'],
    ['0', '0/1'],
    ['0.000', '0/1'],
    ['28.349523125', '28349523125/1000000000'],
    ['007.50', '15/2'],
  ])('reads %s exactly', (text, expected) => {
    const v = fromDecimal(text)!;
    const [n, d] = expected.split('/');
    expect(eq(v, rat(BigInt(n), BigInt(d)))).toBe(true);
  });
  it.each(['', '.', '-1', '1,5', '1e3', 'abc', '1.2.3', ' 1', '1 '])('rejects %p', (text) => {
    expect(fromDecimal(text)).toBeNull();
  });
});

describe('arithmetic', () => {
  it('adds, subtracts, multiplies and divides exactly', () => {
    expect(add(r(1, 3), r(1, 6))).toEqual(r(1, 2));
    expect(sub(r(1, 3), r(1, 2))).toEqual(r(-1, 6));
    expect(mul(r(2, 3), r(3, 4))).toEqual(r(1, 2));
    expect(div(r(1, 2), r(3, 4))).toEqual(r(2, 3));
    expect(neg(r(1, 2))).toEqual(r(-1, 2));
  });
  it('shows what floats get wrong: 0.1 + 0.2 is exactly 0.3', () => {
    expect(eq(add(fromDecimal('0.1')!, fromDecimal('0.2')!), fromDecimal('0.3')!)).toBe(true);
  });
  it('refuses to divide by zero', () => {
    expect(() => div(ONE, ZERO)).toThrow(RangeError);
  });
  it('compares, signs, min and max', () => {
    expect(cmp(r(1, 3), r(1, 2))).toBe(-1);
    expect(cmp(r(2, 4), r(1, 2))).toBe(0);
    expect(cmp(r(-1, 3), r(-1, 4))).toBe(-1);
    expect(cmp(r(3), r(2))).toBe(1);
    expect(sign(r(-3))).toBe(-1);
    expect(sign(ZERO)).toBe(0);
    expect(sign(r(1, 9))).toBe(1);
    expect(isZero(sub(r(1, 3), r(1, 3)))).toBe(true);
    expect(min(r(1, 3), r(1, 2))).toEqual(r(1, 3));
    expect(max(r(1, 3), r(1, 2))).toEqual(r(1, 2));
  });
  it('handles numbers far beyond 2^53 exactly', () => {
    const big = rat(BigInt('123456789012345678901234567890'), BigInt(7));
    expect(eq(mul(div(big, rat(3)), rat(3)), big)).toBe(true);
  });
});

describe('floor() and roundHalfUp()', () => {
  it.each([
    [7, 2, 3],
    [-7, 2, -4],
    [4, 2, 2],
    [-4, 2, -2],
    [0, 3, 0],
    [1, 3, 0],
    [-1, 3, -1],
  ])('floor(%i/%i) = %i', (n, d, expected) => {
    expect(floor(r(n, d))).toBe(BigInt(expected));
  });
  it('rounds .5 up and below .5 down for every tenth up to 20', () => {
    for (let k = 0; k <= 200; k++) {
      const expected = BigInt(Math.floor(k / 10) + (k % 10 >= 5 ? 1 : 0));
      expect(roundHalfUp(r(k, 10))).toBe(expected);
    }
  });
  it('rounds negatives half away from zero', () => {
    expect(roundHalfUp(r(-1, 2))).toBe(BigInt(-1));
    expect(roundHalfUp(r(-3, 2))).toBe(BigInt(-2));
    expect(roundHalfUp(r(-49, 100))).toBe(BigInt(0));
  });
});

describe('toDecimalString()', () => {
  it.each([
    ['4725/1000', 2, '4.73'],
    ['1/3', 3, '0.333'],
    ['2/3', 3, '0.667'],
    ['1/200', 2, '0.01'],
    ['999/1000', 2, '1.00'],
    ['5', 0, '5'],
    ['1/2', 0, '1'],
    ['-1/200', 2, '-0.01'],
    ['0/1', 2, '0.00'],
    ['12345/10', 1, '1234.5'],
  ])('%s to %i decimals is %s', (value, decimals, expected) => {
    const [n, d = '1'] = value.split('/');
    expect(toDecimalString(rat(BigInt(n), BigInt(d)), decimals)).toBe(expected);
  });
});

describe('pow10() and toSafeInt()', () => {
  it('computes powers of ten with a loop', () => {
    expect(pow10(0)).toBe(BigInt(1));
    expect(pow10(3)).toBe(BigInt(1000));
    expect(pow10(30).toString()).toBe(`1${'0'.repeat(30)}`);
    expect(() => pow10(-1)).toThrow(RangeError);
    expect(() => pow10(1.5)).toThrow(RangeError);
  });
  it('converts bigints that fit and refuses the rest', () => {
    expect(toSafeInt(BigInt(100000000))).toBe(100000000);
    expect(toSafeInt(BigInt(-5))).toBe(-5);
    expect(() => toSafeInt(BigInt('9007199254740993'))).toThrow(RangeError);
  });
});
