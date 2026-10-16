// Dev only: `pricebook-dev://debug/seed?set=<empty|s1|big5000>[&today=YYYY-MM-DD]` wipes stores/products/prices,
// loads the named seed, starts Compare from two empty cards and opens Compare — the absolute starting state of
// every Maestro flow (V1_PLAN rule 10). `today` pins the date the statistics use (SPEC S1 is "today 2026-09-30").
// `nonce` (v1.1, REVIEW_V1 S8): when the seed is in, Compare shows "Seed loaded: s1 #<nonce>"; the subflow waits for exactly
// that text, so a dropped link can never let a flow run on the previous flow's data.
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { isSeedName, loadSeed } from '@/debug/seeds';
import { chipUnits } from '@/engine/units';
import { resetDraft } from '@/lib/compare-store';
import { DEBUG_ENABLED } from '@/lib/debug';
import { fill } from '@/lib/format';
import { showNotice } from '@/lib/notice';
import { strings } from '@/lib/strings';
import { loadSettings } from '@/lib/settings-store';
import { setDebugToday } from '@/lib/today';

export default function DebugSeed() {
  const db = useSQLiteContext();
  const router = useRouter();
  const { set, today, nonce } = useLocalSearchParams<{ set?: string; today?: string; nonce?: string }>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!DEBUG_ENABLED) return;
    (async () => {
      const name = isSeedName(set) ? set : 'empty';
      await loadSeed(db, name);
      setDebugToday(today ?? null);
      const settings = await loadSettings(db);
      await resetDraft(db, chipUnits(settings.unitSystem)[0]);
      showNotice(fill(strings.debug.seedDone, { name: nonce ? `${name} #${nonce}` : name }), 10000);
      if (router.canDismiss()) router.dismissAll();
      router.replace('/compare');
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [db, router, set, today, nonce]);

  if (!DEBUG_ENABLED) return <Redirect href="/" />;
  return <View testID="debug-seed">{error ? <Text testID="debug-seed-error">{error}</Text> : null}</View>;
}
