// Header chip on Compare: "Prices incl. tax" or "+ 8.875 % tax" (SPEC 2.1); tap -> tax sheet. "+ tax" when add mode
// has no rate yet (D31).
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { decimal, fill } from '@/lib/format';
import { useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';

export function taxChipText(mode: 'include' | 'add', rate: string | null, sep: '.' | ','): string {
  if (mode === 'include') return strings.tax.chipInclude;
  return rate ? fill(strings.tax.chipAdd, { rate: decimal(rate, sep) }) : strings.tax.chipAddNoRate;
}

export function TaxChip() {
  const theme = useTheme();
  const s = useAppSettings();
  const router = useRouter();
  return (
    <Pressable testID="tax-chip" accessibilityRole="button" hitSlop={6} onPress={() => router.push('/tax')} style={[styles.chip, { backgroundColor: theme.backgroundElement }]}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.text, { color: theme.text }]}>{taxChipText(s.taxMode, s.taxRate, s.decimalSeparator)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { marginLeft: 12, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  text: { fontSize: 13, fontWeight: '600' },
});
