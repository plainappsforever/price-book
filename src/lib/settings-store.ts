// The settings as one in-memory snapshot for the screens; reloaded after every change, seed and restore.
import { getLocales } from 'expo-localization';
import { useSyncExternalStore } from 'react';

import { getAllSettings, setSettings } from '@/db/settings';
import type { Db } from '@/db/types';

import { readAppSettings, type AppSettings } from './app-settings';

let current: AppSettings = readAppSettings({});
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export async function loadSettings(db: Db): Promise<AppSettings> {
  current = readAppSettings(await getAllSettings(db));
  emit();
  return current;
}

export async function saveSettings(db: Db, values: Record<string, string | null>): Promise<void> {
  await setSettings(db, values);
  await loadSettings(db);
}

export function getAppSettings(): AppSettings {
  return current;
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current
  );
}

/** The phone's first locale tag ("de-DE"), or null. */
export function deviceLocaleTag(): string | null {
  try {
    return getLocales()[0]?.languageTag ?? null;
  } catch {
    return null;
  }
}
