/** @jest-environment node */
// The Compare screen's words for SPEC examples, built from the same draft operations the keypad uses (U1, E8, E10, E12).
import { readAppSettings } from './app-settings';
import { addDeal, newDraft, nextField, pressKey, setUnit, PRESETS, type Draft } from './compare-draft';
import { buildCompareView } from './compare-view';

const EU = readAppSettings({ currency: 'EUR', unitSystem: 'metric', taxMode: 'include', decimalSeparator: '.' });
const US = readAppSettings({ currency: 'USD', unitSystem: 'us', taxMode: 'add', decimalSeparator: '.' });

function type(draft: Draft, keys: string): Draft {
  let d = draft;
  for (const k of keys) d = k === '>' ? nextField(d) : pressKey(d, k, 2);
  return d;
}

describe('U1 on the keypad (SPEC 3, A4)', () => {
  it('A 2.49 / 500 g, B 5.49 / 1.2 kg: B is best value at €4.58 per kg, 8.1 % cheaper, in 18 taps', () => {
    let d = newDraft('g');
    let taps = 0;
    for (const k of '2.49>500>5.49>1.2') {
      d = k === '>' ? nextField(d) : pressKey(d, k, 2);
      taps++;
    }
    d = setUnit(d, d.focus!.cardId, 'kg');
    taps++;
    expect(taps).toBe(18);
    const v = buildCompareView(d, EU, 'en-US');
    const [a, b] = d.cards.map((c) => v.cards[c.id]);
    expect(a.resultLine).toBe('€4.98 per kg');
    expect(b.resultLine).toBe('€4.58 per kg');
    expect(b.best && !a.best).toBe(true);
    expect(v.groups[0].summary).toBe('8.1 % cheaper per kg · saves €0.49 on 1.2 kg');
    expect(v.groups[0].header).toBe('Weight · per kg');
  });
  it('decimal comma and de-DE money', () => {
    const de = readAppSettings({ currency: 'EUR', decimalSeparator: ',' });
    const d = setUnit(type(newDraft('g'), '2,49>500>5,49>1,2'), 'c2', 'kg');
    const v = buildCompareView(d, de, 'de-DE');
    expect(v.cards.c2.resultLine).toBe('4,58\u00a0€ per kg');
    expect(v.groups[0].summary).toBe('8,1 % cheaper per kg · saves 0,49\u00a0€ on 1,2 kg');
  });
});

describe('deals on screen (SPEC E8, E10, E12)', () => {
  it('E8: 3 for 2 on A beats B by 33.3 %, saves €2.28 on 1.5 kg', () => {
    let d = setUnit(type(newDraft('g'), '2.29>500>5.49>1.2'), 'c2', 'kg');
    d = addDeal(d, 'c1', PRESETS.threeForTwo);
    const v = buildCompareView(d, EU, 'en-US');
    expect(v.cards.c1.resultLine).toBe('€3.05 per kg');
    expect(v.cards.c1.chips.map((c) => c.label)).toEqual(['3 for 2']);
    expect(v.cards.c1.perPackLine).toBe('You pay €4.58 for 3 · €1.53 each');
    expect(v.groups[0].summary).toBe('33.3 % cheaper per kg · saves €2.28 on 1.5 kg');
  });
  it('E10: 3 for €5 at €1.99, bought 4 -> €6.99 and the outside-the-deal hint', () => {
    let d = type(newDraft('pcs'), '1.99>1');
    d = addDeal(d, 'c1', { kind: 'quantity', deal: { kind: 'multiBuy', n: 3, priceMinor: 500 } });
    d = type({ ...d, focus: { cardId: 'c1', field: 'quantity' } }, '4');
    const v = buildCompareView(d, EU, 'en-US');
    expect(v.cards.c1.perPackLine).toBe('You pay €6.99 for 4 · €1.75 each');
    expect(v.cards.c1.notes).toContain('1 item outside the deal pays the normal price');
  });
  it('E12: 10 for $10 at $1.29 — per item q1 $1.00; must buy q3 $3.87 + "Deal needs 10 — 7 more"', () => {
    let d = type(newDraft('pcs'), '1.29>1');
    d = addDeal(d, 'c1', { kind: 'quantity', deal: { kind: 'multiBuy', n: 10, priceMinor: 1000, perItem: true } });
    d = type({ ...d, focus: { cardId: 'c1', field: 'quantity' } }, '1');
    expect(buildCompareView(d, US, 'en-US').cards.c1.perPackLine).toBe('You pay $1.00 for 1 · $1.00 each');
    d = addDeal(d, 'c1', { kind: 'quantity', deal: { kind: 'multiBuy', n: 10, priceMinor: 1000 } });
    d = type({ ...d, cards: d.cards.map((c) => (c.id === 'c1' ? { ...c, quantity: '' } : c)), focus: { cardId: 'c1', field: 'quantity' } }, '3');
    const v = buildCompareView(d, US, 'en-US');
    expect(v.cards.c1.perPackLine).toBe('You pay $3.87 for 3 · $1.29 each');
    expect(v.cards.c1.notes).toContain('Deal needs 10 — 7 more');
  });
});

describe('warnings on screen (W1, W4, W6, W9)', () => {
  it('W1 weight vs volume, W4 961×', () => {
    let d = setUnit(type(newDraft('l'), '1.19>1>1.29>1'), 'c2', 'kg');
    expect(buildCompareView(d, EU, 'en-US').warnings).toEqual(["Weight and volume can't be compared"]);
    d = setUnit(type(newDraft('g'), '2.49>500>2.59>500'), 'c2', 'kg');
    expect(buildCompareView(d, EU, 'en-US').warnings).toEqual(['Check the sizes: one unit price is 961× another']);
  });
  it('W9 when a number is too large to show, without throwing', () => {
    let d = type(newDraft('mg'), '1000000>0.001>0.01>1000000');
    d = setUnit(d, 'c2', 'kg');
    const v = buildCompareView(d, EU, 'en-US');
    expect(v.warnings.some((w) => w.startsWith('Some numbers are too large'))).toBe(true);
  });
});

describe('REVIEW_V1 S3: "You pay" is the till amount; cashback is its own line', () => {
  it('€10.00 with €2.00 cashback: you pay €10.00 at the till, €8.00 in the end', () => {
    const d = addDeal(type(newDraft('g'), '10>1'), 'c1', { kind: 'cashback', deal: { amountMinor: 200 } });
    const v = buildCompareView(setUnit(d, 'c1', 'kg'), EU, 'en-US').cards.c1;
    expect(v.perPackLine).toBe('You pay €10.00 for 1 · €10.00 each');
    expect(v.notes).toContain('€2.00 back later as cashback: €8.00 in the end · €8.00 each');
  });
  it('US add-tax mode: the till amount includes the tax (4.99 + 8.875 % = 5.43), cashback after it', () => {
    const us = readAppSettings({ currency: 'USD', unitSystem: 'us', taxMode: 'add', taxRate: '8.875', decimalSeparator: '.' });
    const d = addDeal(type(newDraft('oz'), '4.99>12'), 'c1', { kind: 'cashback', deal: { amountMinor: 100 } });
    const v = buildCompareView(d, us, 'en-US').cards.c1;
    expect(v.perPackLine).toBe('You pay $5.43 for 1 · $5.43 each');
    expect(v.notes).toContain('$1.00 back later as cashback: $4.43 in the end · $4.43 each');
  });
  it('without cashback the line is unchanged (E8: You pay €4.58 for 3 · €1.53 each)', () => {
    const d = addDeal(type(newDraft('g'), '2.29>500'), 'c1', PRESETS.threeForTwo);
    expect(buildCompareView(d, EU, 'en-US').cards.c1.perPackLine).toBe('You pay €4.58 for 3 · €1.53 each');
  });
});
