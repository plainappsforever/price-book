// Files for backup, restore and CSV (SPEC 6): written to the cache folder, offered through the system share sheet
// (save to Files / Drive / mail yourself), read back through the system file picker. No network, no permission.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { MAX_BACKUP_CHARS } from '@/engine/backup';

export type SavedFile = { name: string; uri: string; bytes: number };

/** Writes `text` (UTF-8) to the cache folder, replacing a file of the same name. */
export function writeCacheFile(name: string, text: string): SavedFile {
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(text);
  return { name, uri: file.uri, bytes: file.size };
}

export type ShareOutcome = 'shared' | 'unavailable' | 'failed';

/** Opens the share sheet for a saved file. "unavailable" = no sharing on this device: the file stays in the cache. */
export async function shareSavedFile(file: SavedFile, kind: 'json' | 'csv'): Promise<ShareOutcome> {
  try {
    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    await Sharing.shareAsync(file.uri, kind === 'json'
      ? { mimeType: 'application/json', UTI: 'public.json', dialogTitle: file.name }
      : { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: file.name });
    return 'shared';
  } catch {
    return 'failed';
  }
}

export type PickedText = { canceled: true } | { canceled: false; name: string; text: string } | { canceled: false; error: 'tooBig' | 'unreadable' };

/** The system file picker; reads the chosen file as text (a backup is at most MAX_BACKUP_CHARS characters). */
export async function pickTextFile(): Promise<PickedText> {
  try {
    const picked = await File.pickFileAsync();
    if (picked.canceled || !picked.result) return { canceled: true };
    const file = Array.isArray(picked.result) ? picked.result[0] : picked.result;
    if (!file) return { canceled: true };
    if (file.size > MAX_BACKUP_CHARS * 4) return { canceled: false, error: 'tooBig' };
    return { canceled: false, name: file.name, text: await file.text() };
  } catch {
    return { canceled: false, error: 'unreadable' };
  }
}

/**
 * REVIEW_V1 S7: before a restore replaces anything, the current data is kept as one backup file in the app's own documents
 * folder (overwritten by the next restore), so a mistaken restore can be taken back from the Data screen.
 */
export const BEFORE_RESTORE_FILE = 'price-book-before-restore.json';

export function writeDocumentFile(name: string, text: string): SavedFile {
  const file = new File(Paths.document, name);
  file.create({ overwrite: true });
  file.write(text);
  return { name, uri: file.uri, bytes: file.size };
}

export async function readDocumentFile(name: string): Promise<string | null> {
  try {
    const file = new File(Paths.document, name);
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}

/** Dev builds: a file previously written by `writeCacheFile`, read back as text (Maestro cannot drive the picker). */
export async function readCacheFile(name: string): Promise<string | null> {
  try {
    const file = new File(Paths.cache, name);
    return file.exists ? await file.text() : null;
  } catch {
    return null;
  }
}
