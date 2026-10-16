// Dev only: `pricebook-dev://debug/db-probe` runs the D39 queue probes on REAL expo-sqlite (P3.5 -> P4 device check):
// on a separate probe database, plain and with forced interleaving, plus the main database's health and one real
// race between the Compare draft autosave and a big seed on the main connection.
import { Redirect } from 'expo-router';
import { openDatabaseAsync, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { LATEST_VERSION } from '@/db/migrations';
import { getSetting } from '@/db/settings';
import { dbHealth, runDbProbes, type ProbeResult } from '@/db/probe';
import { loadSeed } from '@/debug/seeds';
import { useTheme } from '@/hooks/use-theme';
import { serializeDraft } from '@/lib/compare-draft';
import { DRAFT_KEY, flushDraft, getDraft, updateDraft } from '@/lib/compare-store';
import { DEBUG_ENABLED } from '@/lib/debug';
import { strings } from '@/lib/strings';

const PROBE_DB = 'pricebook-probe.db';

async function probeOpener() {
  let current: SQLiteDatabase | null = null;
  return async () => {
    if (current) await current.closeAsync();
    current = await openDatabaseAsync(PROBE_DB, { useNewConnection: true });
    return current;
  };
}

export default function DbProbe() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [lines, setLines] = useState<ProbeResult[]>([]);
  const [done, setDone] = useState<boolean | null>(null);

  useEffect(() => {
    if (!DEBUG_ENABLED) return;
    (async () => {
      const all: ProbeResult[] = [];
      const push = (r: ProbeResult[]) => {
        all.push(...r);
        setLines([...all]);
      };
      for (const slow of [false, true]) {
        const open = await probeOpener();
        const r = await runDbProbes(open, { slow });
        push(r.map((x) => ({ ...x, name: `${slow ? 'slowed' : 'plain'} · ${x.name}` })));
      }
      const t0 = Date.now();
      const h = await dbHealth(db);
      push([{ name: 'main database health', ok: h.userVersion === LATEST_VERSION && h.foreignKeys === 1 && h.hasMinorDigits && h.hasProductUid && h.hasBarcodes, detail: JSON.stringify(h), ms: Date.now() - t0 }]);

      // Real race on the main connection: a draft change schedules its 300 ms autosave, then a 5 000-price seed starts;
      // the save must land (queued behind the seed's transaction), not join or vanish with it.
      const t1 = Date.now();
      updateDraft((d) => ({ ...d, cards: d.cards.map((c, i) => (i === 0 ? { ...c, price: '4.49' } : c)) }));
      await loadSeed(db, 'big5000');
      const seedMs = Date.now() - t1;
      await flushDraft();
      const saved = await getSetting(db, DRAFT_KEY);
      push([{ name: 'main: draft autosave during a big5000 seed', ok: saved === serializeDraft(getDraft()), detail: `seed ${seedMs} ms; draft ${saved === serializeDraft(getDraft()) ? 'kept' : 'LOST'}`, ms: Date.now() - t1 }]);
      await loadSeed(db, 's1');
      setDone(all.every((r) => r.ok));
    })().catch((e) => {
      setLines((l) => [...l, { name: 'probe crashed', ok: false, detail: e instanceof Error ? e.message : String(e), ms: 0 }]);
      setDone(false);
    });
  }, [db]);

  if (!DEBUG_ENABLED) return <Redirect href="/" />;
  return (
    <ScrollView testID="db-probe" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Text testID="probe-result" style={[styles.result, { color: done === false ? theme.danger : theme.text }]}>
        {done === null ? strings.debug.probeRunning : done ? strings.debug.probeOk : strings.debug.probeFail}
      </Text>
      {lines.map((l, i) => (
        <Text key={i} testID={`probe-${i}`} style={[styles.line, { color: l.ok ? theme.textSecondary : theme.danger }]}>
          {l.ok ? '✓' : '✗'} {l.name} — {l.detail} ({l.ms} ms)
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 6 },
  result: { fontSize: 20, fontWeight: '700' },
  line: { fontSize: 12 },
});
