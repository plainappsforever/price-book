// Unit chips above the keypad for the focused size field (SPEC 2.1): metric g kg ml L pcs · More; US oz lb fl oz pcs ·
// More. "More" opens every unit (incl. imperial and length).
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { UnitId } from '@/engine/units';
import { strings } from '@/lib/strings';

type Props = { units: UnitId[]; selected: UnitId; onSelect: (unit: UnitId) => void; onMore?: () => void };

export function UnitChips({ units, selected, onSelect, onMore }: Props) {
  const theme = useTheme();
  const list = units.includes(selected) ? units : [...units, selected];
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={styles.row} testID="unit-chips" showsHorizontalScrollIndicator={false}>
      {list.map((u) => {
        const on = u === selected;
        return (
          <Pressable
            key={u}
            testID={`unit-${u}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onSelect(u)}
            style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.text, { color: on ? theme.onTint : theme.text }]}>{strings.units[u]}</Text>
          </Pressable>
        );
      })}
      {onMore ? (
        <Pressable testID="unit-more" accessibilityRole="button" onPress={onMore} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
          <Text maxFontSizeMultiplier={1.3} style={[styles.text, { color: theme.tint }]}>{strings.compare.moreUnits}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 8, paddingVertical: 6 },
  chip: { minWidth: 52, height: 38, borderRadius: 19, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 16, fontWeight: '600' },
});
