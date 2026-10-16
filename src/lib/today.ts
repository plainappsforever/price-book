// "Today" as a local YYYY-MM-DD date. The debug seed link can pin it (`&today=2026-09-30`) so the SPEC S1 numbers
// stay exact in Maestro flows however much time passes (dev builds only).
let pinned: string | null = null;

export function setDebugToday(date: string | null): void {
  pinned = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function today(now: Date = new Date()): string {
  if (pinned) return pinned;
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
