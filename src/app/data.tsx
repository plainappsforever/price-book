// Data (SPEC 6, U7): back up (one JSON file, share sheet), restore (system picker -> counts -> one confirmation ->
// one transaction), CSV export (share sheet). Files are plain and unencrypted; the screen says so. Dev builds add a
// "skip the share sheet" switch and "restore the backup written in this session" because Maestro cannot drive
// the system share sheet or file picker (the real ones are a morning check).
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { listExportRows } from '@/db/observations';
import { countData, exportBackupText, restoreFromText } from '@/db/restore';
import { LATEST_VERSION } from '@/db/migrations';
import { backupFileName, parseBackup, type BackupCounts, type BackupErrorCode } from '@/engine/backup';
import { buildPricesCsv, csvFileName } from '@/engine/csv';
import { useTheme } from '@/hooks/use-theme';
import {
  BEFORE_RESTORE_FILE, pickTextFile, readCacheFile, readDocumentFile, shareSavedFile, writeCacheFile, writeDocumentFile, type SavedFile, type ShareOutcome,
} from '@/lib/data-io';
import { unlinkAllCards } from '@/lib/compare-store';
import { DEBUG_ENABLED } from '@/lib/debug';
import { fill } from '@/lib/format';
import { loadSettings, useAppSettings } from '@/lib/settings-store';
import { applyThemePreference } from '@/lib/theme-preference';
import { getThemePreference } from '@/db/settings';
import { strings } from '@/lib/strings';
import { today } from '@/lib/today';

const countsText = (c: BackupCounts) =>
  fill(strings.data.counts, { prices: c.prices, products: c.products, stores: c.stores });

const ERROR_TEXT: Record<BackupErrorCode, string> = strings.data.errors;

export default function DataScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const settings = useAppSettings();
  const [file, setFile] = useState<{ kind: 'backup' | 'csv'; file: SavedFile; counts: string | null; share: ShareOutcome | 'skipped' } | null>(null);
  const [preview, setPreview] = useState<{ text: string; counts: BackupCounts; now: BackupCounts; name: string } | null>(null);
  const [hasBefore, setHasBefore] = useState(false);
  useEffect(() => {
    readDocumentFile(BEFORE_RESTORE_FILE)
      .then((t) => setHasBefore(t !== null))
      .catch(() => undefined);
  }, []);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipShare, setSkipShare] = useState(false);

  const guard = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } catch {
      setMessage({ text: strings.data.failed, ok: false });
    } finally {
      setBusy(false);
    }
  };

  const offer = async (kind: 'backup' | 'csv', saved: SavedFile, counts: string | null) => {
    // The label is set BEFORE the share sheet opens (a dev check can read it; the sheet itself is a morning check).
    setFile({ kind, file: saved, counts, share: 'skipped' });
    if (skipShare) return;
    const share = await shareSavedFile(saved, kind === 'backup' ? 'json' : 'csv');
    setFile({ kind, file: saved, counts, share });
  };

  const backUp = () =>
    guard(async () => {
      setMessage(null);
      setPreview(null);
      const r = await exportBackupText(db);
      if (!r.ok) return setMessage({ text: ERROR_TEXT[r.error.code], ok: false });
      await offer('backup', writeCacheFile(backupFileName(today()), r.text), countsText(r.counts));
    });

  const exportCsv = () =>
    guard(async () => {
      setMessage(null);
      setPreview(null);
      const rows = await listExportRows(db);
      const csv = buildPricesCsv(rows, { measurementSystem: settings.unitSystem, bases: settings.bases, decimalSeparator: settings.decimalSeparator });
      await offer('csv', writeCacheFile(csvFileName(today()), csv), fill(strings.data.csvRows, { count: rows.length }));
    });

  const review = async (text: string, name: string) => {
    const parsed = parseBackup(text, LATEST_VERSION);
    if (!parsed.ok) return setMessage({ text: ERROR_TEXT[parsed.error.code], ok: false });
    setPreview({ text, counts: parsed.counts, now: await countData(db), name });
  };
  const pick = () =>
    guard(async () => {
      setMessage(null);
      setPreview(null);
      const picked = await pickTextFile();
      if (picked.canceled) return;
      if ('error' in picked) return setMessage({ text: picked.error === 'tooBig' ? ERROR_TEXT.tooLarge : strings.data.unreadable, ok: false });
      await review(picked.text, picked.name);
    });
  const pickLast = () =>
    guard(async () => {
      setMessage(null);
      const name = backupFileName(today());
      const text = await readCacheFile(name);
      if (text === null) return setMessage({ text: strings.data.noLastBackup, ok: false });
      await review(text, name);
    });
  const pickBefore = () =>
    guard(async () => {
      setMessage(null);
      const text = await readDocumentFile(BEFORE_RESTORE_FILE);
      if (text === null) return setMessage({ text: strings.data.unreadable, ok: false });
      await review(text, strings.data.undoRestoreName);
    });
  const confirm = () =>
    guard(async () => {
      if (!preview) return;
      // REVIEW_V1 S7: keep what is on the phone now before replacing it (nothing to keep on an empty book).
      const now = await countData(db);
      let kept = false;
      if (now.prices + now.products + now.stores > 0) {
        const current = await exportBackupText(db);
        if (!current.ok) return setMessage({ text: strings.data.keepFailed, ok: false });
        try {
          writeDocumentFile(BEFORE_RESTORE_FILE, current.text);
          kept = true;
        } catch {
          return setMessage({ text: strings.data.keepFailed, ok: false });
        }
      }
      const r = await restoreFromText(db, preview.text);
      if (!r.ok) {
        setMessage({ text: 'detail' in r.error && r.error.code === 'database' ? strings.data.restoreFailed : ERROR_TEXT[r.error.code as BackupErrorCode], ok: false });
        return;
      }
      unlinkAllCards(); // REVIEW_V1 S2: the restored products are other rows, whatever their ids
      await loadSettings(db);
      applyThemePreference(await getThemePreference(db)); // review N10: the restored theme applies now, not after a relaunch
      setPreview(null);
      if (kept) setHasBefore(true);
      const done = fill(strings.data.restored, { counts: countsText(r.counts) });
      setMessage({ text: kept ? `${done}. ${strings.data.beforeRestoreKept}` : done, ok: true });
    });

  return (
    <ScrollView testID="data-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Text style={[styles.note, { color: theme.textSecondary }]}>{Platform.OS === 'ios' ? strings.data.plainIos : strings.data.plainAndroid}</Text>

      <Text style={[styles.heading, { color: theme.text }]}>{strings.data.backupTitle}</Text>
      <Text style={[styles.note, { color: theme.textSecondary }]}>{strings.data.backupHelp}</Text>
      <Button testID="data-backup" label={strings.data.backup} onPress={backUp} disabled={busy} />

      <Text style={[styles.heading, { color: theme.text }]}>{strings.data.restoreTitle}</Text>
      <Text style={[styles.note, { color: theme.textSecondary }]}>{strings.data.restoreHelp}</Text>
      <Button testID="data-restore" variant="secondary" label={strings.data.restore} onPress={pick} disabled={busy} />
      {DEBUG_ENABLED ? <Button testID="data-restore-last" variant="secondary" label={strings.data.restoreLast} onPress={pickLast} disabled={busy} /> : null}
      {hasBefore ? <Button testID="data-restore-undo" variant="secondary" label={strings.data.undoRestore} onPress={pickBefore} disabled={busy} /> : null}
      {preview ? (
        <View testID="restore-preview" style={[styles.box, { backgroundColor: theme.backgroundElement }]}>
          <Text testID="restore-counts" style={[styles.boxText, { color: theme.text }]}>
            {fill(strings.data.confirmReplace, { counts: countsText(preview.counts), now: countsText(preview.now) })}
          </Text>
          <Text style={[styles.note, { color: theme.textSecondary }]}>{preview.name}</Text>
          <View style={styles.row}>
            <Button testID="restore-confirm" label={strings.data.replace} onPress={confirm} disabled={busy} style={styles.flex} />
            <Button testID="restore-cancel" variant="secondary" label={strings.data.cancel} onPress={() => setPreview(null)} style={styles.flex} />
          </View>
        </View>
      ) : null}

      <Text style={[styles.heading, { color: theme.text }]}>{strings.data.csvTitle}</Text>
      <Text style={[styles.note, { color: theme.textSecondary }]}>{strings.data.csvHelp}</Text>
      <Button testID="data-csv" variant="secondary" label={strings.data.csv} onPress={exportCsv} disabled={busy} />

      {file ? (
        <View testID="data-file" style={[styles.box, { backgroundColor: theme.backgroundElement }]}>
          <Text testID="data-file-name" style={[styles.boxText, { color: theme.text }]}>{file.file.name}</Text>
          {file.counts ? <Text testID="data-file-counts" style={[styles.note, { color: theme.text }]}>{file.counts}</Text> : null}
          <Text testID="data-file-state" style={[styles.note, { color: theme.textSecondary }]}>
            {file.share === 'unavailable' ? strings.data.shareUnavailable : file.share === 'failed' ? strings.data.shareFailed : file.share === 'skipped' ? strings.data.fileReady : strings.data.fileShared}
          </Text>
        </View>
      ) : null}
      {message ? <Text testID="data-message" style={[styles.boxText, { color: message.ok ? theme.text : theme.danger }]}>{message.text}</Text> : null}

      {DEBUG_ENABLED ? (
        <Pressable testID="data-skip-share" accessibilityRole="switch" accessibilityState={{ checked: skipShare }} onPress={() => setSkipShare((s) => !s)} style={styles.toggle}>
          <Text style={{ fontSize: 22, color: skipShare ? theme.tint : theme.textSecondary }}>{skipShare ? '☑' : '☐'}</Text>
          <Text style={[styles.note, { color: theme.text, flex: 1 }]}>{strings.data.skipShare}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  heading: { fontSize: 18, fontWeight: '700', marginTop: 14 },
  note: { fontSize: 14, lineHeight: 20 },
  box: { borderRadius: 12, padding: 12, gap: 6 },
  boxText: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, marginTop: 12 },
});
