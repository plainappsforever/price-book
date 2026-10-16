/** @jest-environment node */
// Ranking, savings, ties, lowest to pay and warnings W1–W8 (SPEC 5.5–5.7). Fixtures come from the
// independent oracle test/oracle/gen_engine_fixtures.py; "examples" carry the SPEC 5.7 numbers.
import compare from '../../test/fixtures/engine/compare.json';
import { checkCases, summary, type Case } from '../../test/engine-fixtures';
import { compareCards } from './compare';
import type { Card, EngineSettings } from './deals';
import { eq, rat } from './rational';

type CompareInput = { cards: Card[]; settings: EngineSettings };
const sections = compare as unknown as Record<string, Case<CompareInput, Record<string, unknown>>[]>;

describe('fixture hygiene', () => {
  it.each(Object.keys(sections))('%s: every case has an id and a note, ids are unique', (name) => {
    checkCases(name, sections[name]);
  });
  it('has every comparison example of SPEC 5.7', () => {
    const ids = sections.examples.map((c) => c.id.split('-')[0]);
    for (const e of ['E1', 'E2', 'E8', 'E18', 'E19', 'E20', 'E21']) expect(ids).toContain(e);
  });
  it('covers every warning W1–W8', () => {
    const all = [...sections.examples, ...sections.generated].flatMap((c) => c.expected.warnings as string[]);
    for (const code of ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8']) expect(all.some((w) => w.startsWith(code))).toBe(true);
  });
});

describe.each(Object.keys(sections))('compare.json %s', (name) => {
  it.each(sections[name].map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(summary(compareCards(c.input.cards, c.input.settings))).toEqual(c.expected);
  });
});

const EUR: EngineSettings = { currency: 'EUR', taxMode: 'include', measurementSystem: 'metric' };
const g = (id: string, price: number | null, size: string, unit: Card['unit'] = 'g'): Card => ({ id, priceMinor: price, size: { packCount: 1, itemSize: size }, unit });

describe('comparison details', () => {
  it('E1: savings carry the exact fraction and the winner quantity (1.2 kg)', () => {
    const s = compareCards([g('A', 249, '500'), g('B', 549, '1.2', 'kg'), g('C', 239, '16', 'oz')], EUR).groups[0].savings!;
    expect(eq(s.fraction, rat(81, 996))).toBe(true); // (498 - 457.5) / 498
    expect(eq(s.quantity, rat(1200))).toBe(true);
  });
  it('E20: W4 names the cheap and the dear card and the exact ratio', () => {
    const w = compareCards([g('A', 249, '500'), g('B', 259, '500', 'kg')], EUR).warnings.find((x) => x.code === 'W4');
    expect(w).toMatchObject({ code: 'W4', dimension: 'mass', lowId: 'B', highId: 'A', times: 961 });
    expect(w && w.code === 'W4' && eq(w.ratio, rat(249000, 259))).toBe(true);
  });
  it('E19: W1 lists both dimensions in card order', () => {
    expect(compareCards([g('A', 119, '1', 'l'), g('B', 129, '1', 'kg')], EUR).warnings).toContainEqual({ code: 'W1', dimensions: ['volume', 'mass'] });
  });
  it('W2 lists the labels', () => {
    const cards: Card[] = [{ ...g('A', 599, '12', 'pcs'), label: 'rolls' }, { ...g('B', 499, '200', 'pcs'), label: 'Sheets' }];
    expect(compareCards(cards, EUR).warnings).toContainEqual({ code: 'W2', dimension: 'count', labels: ['rolls', 'sheets'] });
  });
  it('ranks tied cards with their own exact rank but flags them tied with the best', () => {
    const r = compareCards([g('A', 400, '1', 'kg'), g('B', 1199, '3', 'kg')], EUR).groups[0].ranking;
    expect(r.map((x) => [x.id, x.rank, x.tiedWithBest])).toEqual([['B', 1, true], ['A', 2, true]]);
  });
  it('equal exact prices share a rank', () => {
    const r = compareCards([g('A', 200, '500'), g('B', 400, '1', 'kg'), g('C', 100, '500')], EUR).groups[0].ranking;
    expect(r.map((x) => [x.id, x.rank])).toEqual([['C', 1], ['A', 2], ['B', 2]]);
  });
  it('the per-card evaluations are returned in card order', () => {
    const c = compareCards([g('A', 249, '500'), g('B', null, '1')], EUR);
    expect(c.cards.map((x) => [x.id, x.evaluation.ok])).toEqual([['A', true], ['B', false]]);
  });
  it('an empty comparison is empty', () => {
    expect(compareCards([], EUR)).toEqual({ cards: [], groups: [], warnings: [], exponent: 2, unitPriceDecimals: 2 });
  });
  it('display decimals cover every group (SPEC 5.1: one precision per comparison)', () => {
    const c = compareCards([g('A', 119, '1.5', 'l'), g('B', 549, '1.2', 'kg')], EUR);
    expect(c.unitPriceDecimals).toBe(3);
  });
});
