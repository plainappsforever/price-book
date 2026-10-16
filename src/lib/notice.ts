// A one-line message shown briefly on Compare after a save from a card ("Saved to Coffee beans"). No dialog, no tap.
import { useSyncExternalStore } from 'react';

export const NOTICE_MS = 5000;

/** An optional one-tap action on the notice (v1.1: "Cleared — Undo"). */
export type NoticeAction = { label: string; run: () => void };
type Notice = { id: number; text: string; action?: NoticeAction };

let current: Notice | null = null;
let counter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function showNotice(text: string, ms: number = NOTICE_MS, action?: NoticeAction): void {
  current = { id: ++counter, text, action };
  emit();
  if (timer) clearTimeout(timer);
  timer = setTimeout(clearNotice, ms);
}

export function clearNotice(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (current) {
    current = null;
    emit();
  }
}

export function useNotice(): Notice | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}
