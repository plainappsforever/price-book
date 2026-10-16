// Calculator-order keypad pinned at the bottom of Compare (SPEC 2.1, D19): 7 8 9 / 4 5 6 / 1 2 3 / 0 , plus
// delete, × (multipacks, size fields only) and Next. Big keys; the decimal key shows the chosen separator.
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';
import { strings } from '@/lib/strings';

type Props = {
  sep: '.' | ',';
  /** × is only active in a size field. */
  timesEnabled: boolean;
  onKey: (key: string) => void;
  onNext: () => void;
  /** Label of the Next key (deal sheet uses "Add"). */
  nextLabel?: string;
  testIDPrefix?: string;
  /** Stack screens and sheets: keep the bottom row clear of Android's gesture bar / navigation buttons (edge-to-edge). iOS screens already end above the home indicator. */
  safeBottom?: boolean;
};

export function Keypad({ sep, timesEnabled, onKey, onNext, nextLabel, testIDPrefix = 'key', safeBottom = false }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bottom = safeBottom && Platform.OS === 'android' ? insets.bottom : 0;
  const key = (label: string, id: string, onPress: () => void, opts: { flex?: number; disabled?: boolean; primary?: boolean; a11y?: string } = {}) => (
    <Pressable
      key={id}
      testID={`${testIDPrefix}-${id}`}
      accessibilityRole="button"
      accessibilityLabel={opts.a11y ?? label}
      disabled={opts.disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.key,
        { flex: opts.flex ?? 1, backgroundColor: opts.primary ? theme.tint : theme.backgroundElement },
        pressed && { backgroundColor: theme.backgroundSelected },
        opts.disabled && styles.disabled,
      ]}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.label, { color: opts.primary ? theme.onTint : theme.text }]}>{label}</Text>
    </Pressable>
  );
  const digit = (d: string) => key(d, d, () => onKey(d));
  return (
    <View style={[styles.pad, { backgroundColor: theme.background, paddingBottom: GAP + bottom }]} testID={`${testIDPrefix}pad`}>
      <View style={styles.left}>
        <View style={styles.row}>{['7', '8', '9'].map(digit)}</View>
        <View style={styles.row}>{['4', '5', '6'].map(digit)}</View>
        <View style={styles.row}>{['1', '2', '3'].map(digit)}</View>
        <View style={styles.row}>
          {key('0', '0', () => onKey('0'), { flex: 2 })}
          {key(sep, 'sep', () => onKey(sep), { a11y: strings.compare.decimal })}
        </View>
      </View>
      <View style={styles.right}>
        {key('⌫', 'del', () => onKey('del'), { a11y: strings.compare.delete })}
        {key(strings.compare.multiply, 'times', () => onKey('×'), { disabled: !timesEnabled })}
        {key(nextLabel ?? strings.compare.next, 'next', onNext, { flex: 2, primary: true })}
      </View>
    </View>
  );
}

const GAP = 6;
const styles = StyleSheet.create({
  pad: { flexDirection: 'row', gap: GAP, paddingHorizontal: GAP, paddingTop: GAP, paddingBottom: GAP },
  left: { flex: 3, gap: GAP },
  right: { flex: 1, gap: GAP },
  row: { flexDirection: 'row', gap: GAP, height: 50 },
  key: { borderRadius: 10, alignItems: 'center', justifyContent: 'center', minHeight: 50 },
  label: { fontSize: 24, fontWeight: '500' },
  disabled: { opacity: 0.35 },
});
