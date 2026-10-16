// Tax setting sheet (SPEC 2.1 tax chip, 5.4 step 6, D14, D31): prices include tax, or tax is added at the till.
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Keypad } from '@/components/keypad';
import type { TaxMode } from '@/engine/deals';
import { useTheme } from '@/hooks/use-theme';
import { isRate, SETTING_KEYS } from '@/lib/app-settings';
import { formKey } from '@/lib/deal-forms';
import { decimal } from '@/lib/format';
import { keyTick } from '@/lib/haptics';
import { getAppSettings, saveSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';

export default function TaxSheet() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const initial = getAppSettings();
  const [mode, setMode] = useState<TaxMode>(initial.taxMode);
  const [rate, setRate] = useState(initial.taxRate ? decimal(initial.taxRate, initial.decimalSeparator) : '');

  const done = async () => {
    const canonical = rate.replace(',', '.').replace(/\.$/, '');
    await saveSettings(db, { [SETTING_KEYS.taxMode]: mode, [SETTING_KEYS.taxRate]: isRate(canonical) ? canonical : null });
    router.back();
  };
  const option = (value: TaxMode, label: string) => {
    const on = mode === value;
    return (
      <Pressable
        testID={`tax-${value}`}
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        onPress={() => setMode(value)}
        style={[styles.option, { backgroundColor: on ? theme.backgroundSelected : theme.backgroundElement }]}>
        <Text style={[styles.optionText, { color: theme.text }]}>
          {on ? '● ' : '○ '}
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <View testID="tax-sheet" style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {option('include', strings.tax.include)}
        {option('add', strings.tax.add)}
        <View style={[styles.field, { borderColor: theme.tint, backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>{strings.tax.rate} (%)</Text>
          <Text testID="tax-rate-text" style={[styles.rate, { color: theme.text }]}>
            {rate}
            <Text style={{ color: theme.tint }}>|</Text>
          </Text>
        </View>
        <Text style={[styles.hint, { color: theme.textSecondary }]}>{strings.tax.rateHint}</Text>
        <View style={styles.row}>
          <Pressable testID="tax-clear" onPress={() => setRate('')} style={[styles.button, { backgroundColor: theme.backgroundElement }]}>
            <Text style={[styles.buttonText, { color: theme.text }]}>{strings.tax.clear}</Text>
          </Pressable>
          <Pressable testID="tax-done" onPress={done} style={[styles.button, { backgroundColor: theme.tint }]}>
            <Text style={[styles.buttonText, { color: theme.onTint }]}>{strings.tax.done}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <Keypad
        sep={initial.decimalSeparator}
        timesEnabled={false}
        testIDPrefix="tkey"
        safeBottom
        nextLabel={strings.tax.done}
        onKey={(key) => {
          keyTick(initial.haptics);
          setRate((r) => formKey(r, key, 'percent', 2));
        }}
        onNext={done}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 10 },
  option: { minHeight: 48, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 14 },
  optionText: { fontSize: 16, fontWeight: '600' },
  field: { borderWidth: 2, borderRadius: 10, padding: 8 },
  label: { fontSize: 12, fontWeight: '600' },
  rate: { fontSize: 22, fontWeight: '600' },
  hint: { fontSize: 13 },
  row: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
});
