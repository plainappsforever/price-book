// One Compare draft in memory; saved as JSON in settings.compareDraft 300 ms after the last change and whenever the
// app goes to the background (SPEC 7: "draft saved 300 ms after the last key"; A18). Writes go through the DB
// queue (D39), so a draft save can never join a restore's or seed's transaction.
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { getProduct } from '@/db/products';
import { getSetting, setSetting } from '@/db/settings';
import type { Db } from '@/db/types';
import type { UnitId } from '@/engine/units';

import { newDraft, parseDraft, revalidateLinks, serializeDraft, unlinkAll, withDefaultUnit, type Draft, type LinkTarget } from './compare-draft';

export const DRAFT_KEY = 'compareDraft';
export const DRAFT_SAVE_DELAY_MS = 300;

let draft: Draft = newDraft('g');
let dbRef: Db | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export async function loadDraft(db: Db, fallbackUnit: UnitId): Promise<void> {
  dbRef = db;
  draft = parseDraft(await getSetting(db, DRAFT_KEY), fallbackUnit);
  emit();
}

export function getDraft(): Draft {
  return draft;
}

export function useDraft(): Draft {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => draft
  );
}

export function updateDraft(change: (d: Draft) => Draft): void {
  const next = change(draft);
  if (next === draft) return;
  draft = next;
  dirty = true;
  emit();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushDraft();
  }, DRAFT_SAVE_DELAY_MS);
}

/** Unit system changed in Settings: untouched cards switch to its default unit (a US phone changed to metric shows kg, not oz). */
export function applyDefaultUnit(unit: UnitId): void {
  updateDraft((d) => withDefaultUnit(d, unit));
}

export async function flushDraft(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dbRef || !dirty) return;
  dirty = false;
  try {
    await setSetting(dbRef, DRAFT_KEY, serializeDraft(draft));
  } catch {
    dirty = true; // try again with the next change
  }
}

/**
 * REVIEW_V1 S2: re-checks every linked card against the product now stored under its id (deleted, or another product under
 * a reused id -> unlinked; renamed -> new name). Run when Compare gains focus, before Save, and after a product is deleted.
 */
export async function revalidateDraftLinks(db: Db): Promise<void> {
  const ids = [...new Set(draft.cards.map((c) => c.productId).filter((id): id is number => id !== null))];
  if (ids.length === 0) return;
  const targets = new Map<number, LinkTarget>();
  for (const id of ids) {
    const p = await getProduct(db, id);
    targets.set(id, p ? { id: p.id, uid: p.uid, name: p.name, count_label: p.count_label } : null);
  }
  updateDraft((d) => revalidateLinks(d, targets));
}

/** After a restore: no card stays linked (the restored products are other rows, whatever their ids). */
export function unlinkAllCards(): void {
  updateDraft(unlinkAll);
}

/** Debug seed: start from two empty cards (absolute starting state for Maestro flows). */
export async function resetDraft(db: Db, fallbackUnit: UnitId): Promise<void> {
  dbRef = db;
  draft = newDraft(fallbackUnit);
  dirty = true;
  emit();
  await flushDraft();
}

AppState.addEventListener('change', (state) => {
  if (state !== 'active') void flushDraft();
});
