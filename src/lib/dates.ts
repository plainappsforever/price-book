// Calendar-date helpers for the Price Book screens (SPEC 2.2-2.4). Dates are local YYYY-MM-DD text; day maths is
// done on whole UTC days, so there is no time zone or daylight-saving error.
import { dayNumber, isValidDate } from '@/engine/stats';

import { fill } from './format';
import { strings } from './strings';

const DAY_MS = 86400000;

/** The date `delta` days from `date` (negative = earlier). Invalid input is returned unchanged. */
export function addDays(date: string, delta: number): string {
  const day = dayNumber(date);
  if (day === null) return date;
  return new Date((day + delta) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later); null when either date is invalid. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago", "1 year ago". Falls back to the date itself. */
export function relativeDate(date: string, today: string): string {
  const d = daysBetween(date, today);
  const t = strings.dates;
  if (d === null || !isValidDate(date)) return date;
  if (d < 0) return date;
  if (d === 0) return t.today;
  if (d === 1) return t.yesterday;
  if (d < 14) return fill(t.daysAgo, { n: d });
  if (d < 60) return fill(t.weeksAgo, { n: Math.floor(d / 7) });
  if (d < 730) return fill(t.monthsAgo, { n: Math.floor(d / 30) });
  return fill(t.yearsAgo, { n: Math.floor(d / 365) });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The month of `date` as weeks (Monday first) of 7 cells; a cell is a YYYY-MM-DD date or null outside the month. */
export function monthGrid(date: string): (string | null)[][] {
  const [y, m] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(`${y}-${pad(m)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The same day of the month `delta` months later (or earlier), clamped to the length of that month. */
export function shiftMonth(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + delta;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, last))}`;
}

/** "September 2026" in the display locale. */
export function monthLabel(date: string, locale: string): string {
  const [y, m] = date.split('-').map(Number);
  try {
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return date.slice(0, 7);
  }
}
