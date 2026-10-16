/** @jest-environment node */
import {
  addCard, addDeal, clearDraft, clearNeedsConfirm, duplicateCard, linkProduct, MAX_CARDS, newDraft, nextField, parseDraft, pressKey,
  PRESETS, quantityShown, removeCard, removeDeal, serializeDraft, setUnit, toEngineCards, withDefaultUnit,
} from './compare-draft';

describe('compare draft', () => {
  it('starts with A and B, keypad on A price; Next walks price -> size -> next card', () => {
    let d = newDraft('g');
    expect(d.cards.length).toBe(2);
    expect(d.focus).toEqual({ cardId: 'c1', field: 'price' });
    d = nextField(d);
    expect(d.focus).toEqual({ cardId: 'c1', field: 'size' });
    d = nextField(d);
    expect(d.focus).toEqual({ cardId: 'c2', field: 'price' });
    d = nextField(nextField(d));
    expect(d.focus).toEqual({ cardId: 'c1', field: 'price' });
  });
  it('keys follow the parse limits: second separator and over-limit keys are ignored, × only in sizes', () => {
    let d = newDraft('g');
    for (const k of '2.4.9') d = pressKey(d, k, 2);
    expect(d.cards[0].price).toBe('2.49');
    d = pressKey(d, '1', 2);
    expect(d.cards[0].price).toBe('2.49');
    d = pressKey(d, '×', 2);
    expect(d.cards[0].price).toBe('2.49');
    d = nextField(d);
    for (const k of '6×330') d = pressKey(d, k, 2);
    expect(d.cards[0].size).toBe('6×330');
    expect(toEngineCards(d, 2)[0]).toMatchObject({ priceMinor: 249, size: { packCount: 6, itemSize: '330' } });
  });
  it('a new card inherits the previous unit; at most 5 cards; removing keeps at least 2', () => {
    let d = setUnit(newDraft('g'), 'c2', 'kg');
    d = addCard(d);
    expect(d.cards[2].unit).toBe('kg');
    while (d.cards.length < MAX_CARDS) d = addCard(d);
    expect(addCard(d)).toBe(d);
    expect(duplicateCard(d, 'c1')).toBe(d);
    let two = newDraft('g');
    two = removeCard(two, 'c1');
    expect(two.cards.length).toBe(2);
  });
  it('deals: quantity deal shows "bought", removing it resets the quantity; clear asks twice with deals or links', () => {
    let d = addDeal(newDraft('g'), 'c1', PRESETS.threeForTwo);
    expect(quantityShown(d.cards[0])).toBe(true);
    expect(clearNeedsConfirm(d)).toBe(true);
    d = removeDeal(d, 'c1', { kind: 'quantity' });
    expect(quantityShown(d.cards[0])).toBe(false);
    expect(clearNeedsConfirm(d)).toBe(false);
    expect(clearNeedsConfirm(linkProduct(d, 'c2', { id: 1, uid: 'u1', name: 'Coffee', label: null }))).toBe(true);
    const cleared = clearDraft(d);
    expect(cleared.cards.map((c) => c.id)).toEqual(['c3', 'c4']);
  });
  it('round trip through settings.compareDraft; damaged text gives a new draft, never an exception', () => {
    let d = addDeal(setUnit(newDraft('g'), 'c2', 'kg'), 'c1', PRESETS.bogo);
    d = pressKey(d, '3', 2);
    expect(parseDraft(serializeDraft(d), 'g')).toEqual(d);
    for (const bad of [null, '', '{', '[]', '{"version":2}', '{"version":1,"cards":[{"id":5}]}']) {
      const p = parseDraft(bad, 'oz');
      expect(p.cards.length).toBe(2);
      expect(p.focus?.field).toBe('price');
    }
    const one = parseDraft('{"version":1,"cards":[{"id":"c7","price":"1","size":"2","unit":"zz"}],"nextId":1}', 'g');
    expect(one.cards.map((c) => [c.id, c.unit])).toEqual([['c7', 'g'], ['c8', 'g']]);
  });

  it('changing the unit system switches untouched cards to the new default unit and leaves typed cards alone', () => {
    const empty = newDraft('oz');
    expect(withDefaultUnit(empty, 'g').cards.map((c) => c.unit)).toEqual(['g', 'g']);
    expect(withDefaultUnit(empty, 'oz')).toBe(empty);
    const typed = pressKey(empty, '3', 2);
    expect(withDefaultUnit(typed, 'g')).toBe(typed);
    const withDealCard = addDeal(empty, 'c1', PRESETS.bogo);
    expect(withDefaultUnit(withDealCard, 'g')).toBe(withDealCard);
  });
});
