/** @jest-environment node */
import { addDays, daysBetween, monthGrid, relativeDate, shiftMonth } from './dates';

describe('addDays / daysBetween', () => {
  it('crosses month, year and leap day', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
  it('leaves an invalid date alone', () => {
    expect(addDays('nope', 1)).toBe('nope');
    expect(daysBetween('2026-09-01', 'bad')).toBeNull();
    expect(daysBetween('2026-09-01', '2026-09-30')).toBe(29);
  });
});

describe('relativeDate', () => {
  const t = '2026-09-30';
  it('words by distance', () => {
    expect(relativeDate('2026-09-30', t)).toBe('today');
    expect(relativeDate('2026-09-29', t)).toBe('yesterday');
    expect(relativeDate('2026-09-25', t)).toBe('5 days ago');
    expect(relativeDate('2026-09-02', t)).toBe('4 weeks ago');
    expect(relativeDate('2026-03-01', t)).toBe('7 months ago');
    expect(relativeDate('2023-01-01', t)).toBe('3 years ago');
  });
  it('a future date shows as the date', () => {
    expect(relativeDate('2026-10-05', t)).toBe('2026-10-05');
  });
});

describe('month panel', () => {
  it('September 2026 starts on a Tuesday (Monday-first grid)', () => {
    const weeks = monthGrid('2026-09-15');
    expect(weeks[0]).toEqual([null, '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']);
    expect(weeks[weeks.length - 1].filter(Boolean).pop()).toBe('2026-09-30');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
  it('shifts by months and clamps the day', () => {
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonth('2026-03-15', -3)).toBe('2025-12-15');
    expect(shiftMonth('2026-12-10', 1)).toBe('2027-01-10');
  });
});
