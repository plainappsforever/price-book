// "More" units (SPEC 2.1): every unit of every dimension, incl. imperial and length.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DIMENSIONS, unitsOf } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { findCard, setUnit } from '@/lib/compare-draft';
import { getDraft, updateDraft } from '@/lib/compare-store';
import { strings } from '@/lib/strings';

export default function UnitsSheet() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const selected = findCard(getDraft(), cardId ?? '')?.unit;
  return (
    <ScrollView testID="units-sheet" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      {DIMENSIONS.map((d) => (
        <View key={d} style={styles.section}>
          <Text style={[styles.heading, { color: theme.textSecondary }]}>{strings.settings.dimensions[d]}</Text>
          <View style={styles.grid}>
            {unitsOf(d).map((u) => {
              const on = u === selected;
              return (
                <Pressable
                  key={u}
                  testID={`more-unit-${u}`}
                  onPress={() => {
                    if (cardId) updateDraft((dr) => setUnit(dr, cardId, u));
                    router.back();
                  }}
                  style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
                  <Text style={[styles.chipText, { color: on ? theme.onTint : theme.text }]}>{strings.units[u]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  section: { gap: 8 },
  heading: { fontSize: 13, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 64, minHeight: 40, borderRadius: 20, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 15, fontWeight: '600' },
});
