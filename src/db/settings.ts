import { inTransaction, queued } from './tx';
import type { Db } from './types';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const getSetting = queued(async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
});

export const setSetting = queued(async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value
  );
});

export const getThemePreference = queued(async function getThemePreference(db: Db): Promise<ThemePreference> {
  const value = await getSetting(db, THEME_KEY);
  return THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system';
});

export const setThemePreference = queued(async function setThemePreference(db: Db, theme: ThemePreference): Promise<void> {
  return setSetting(db, THEME_KEY, theme);
});

/** Every setting as a key -> value map (one read). */
export const getAllSettings = queued(async function getAllSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
});

/** Writes several settings in one transaction; a null value deletes the key. */
export function setSettings(db: Db, values: Record<string, string | null>): Promise<void> {
  return inTransaction(db, async (db) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) await db.runAsync('DELETE FROM settings WHERE key = ?', key);
      else await setSetting(db, key, value);
    }
  });
}
