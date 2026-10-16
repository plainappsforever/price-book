// Settings (SPEC 2: currency, units shown, bases, tax, haptics, theme). Locale defaults were written at first
// launch (D38); everything here is the user's. Maestro flows set what they depend on here.
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { taxChipText } from '@/components/tax-chip';
import { Spacing } from '@/constants/theme';
import { countPricesInCurrency } from '@/db/observations';
import { getThemePreference, setThemePreference, type ThemePreference } from '@/db/settings';
import { BASES, chipUnits, DIMENSIONS, type MeasurementSystem } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { SETTING_KEYS, unitSystemChange } from '@/lib/app-settings';
import { applyDefaultUnit } from '@/lib/compare-store';
import { fill } from '@/lib/format';
import { saveSettings, useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';
import { applyThemePreference } from '@/lib/theme-preference';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: strings.settings.themeSystem },
  { value: 'light', label: strings.settings.themeLight },
  { value: 'dark', label: strings.settings.themeDark },
];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF'];
const SYSTEMS: { value: MeasurementSystem; label: string }[] = [
  { value: 'metric', label: strings.settings.unitsMetric },
  { value: 'us', label: strings.settings.unitsUs },
  { value: 'uk', label: strings.settings.unitsUk },
];

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const router = useRouter();
  const s = useAppSettings();
  const [themePreference, setThemeState] = useState<ThemePreference>('system');
  const [otherCode, setOtherCode] = useState('');
  const [codeError, setCodeError] = useState(false);
  // REVIEW_V1 N7: a currency change hides every price in the old currency from the statistics; with prices saved, the first
  // tap says so and the second tap changes it.
  const [currencyAsk, setCurrencyAsk] = useState<{ code: string; count: number } | null>(null);
  const chooseCurrency = async (code: string) => {
    if (code === s.currency) return setCurrencyAsk(null);
    if (currencyAsk?.code !== code) {
      const count = await countPricesInCurrency(db, s.currency);
      if (count > 0) return setCurrencyAsk({ code, count });
    }
    setCurrencyAsk(null);
    save({ [SETTING_KEYS.currency]: code });
  };

  useEffect(() => {
    getThemePreference(db).then(setThemeState);
  }, [db]);

  async function chooseTheme(value: ThemePreference) {
    setThemeState(value);
    applyThemePreference(value);
    await setThemePreference(db, value);
  }
  const save = (values: Record<string, string>) => void saveSettings(db, values);

  const segmented = <T extends string>(prefix: string, options: { value: T; label: string }[], selected: T, onPick: (v: T) => void) => (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {options.map((o) => {
        const on = o.value === selected;
        return (
          <Pressable
            key={o.value}
            testID={`${prefix}-${o.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onPick(o.value)}
            style={[styles.segment, on && { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type={on ? 'smallBold' : 'small'}>{o.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <ScrollView
      testID="settings-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled">
      <ThemedText type="smallBold">{strings.settings.currency}</ThemedText>
      <View style={styles.wrap}>
        {CURRENCIES.map((c) => {
          const on = c === s.currency;
          return (
            <Pressable
              key={c}
              testID={`currency-${c}`}
              accessibilityState={{ selected: on }}
              onPress={() => void chooseCurrency(c)}
              style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
              <Text style={[styles.chipText, { color: on ? theme.onTint : theme.text }]}>{c}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        testID="currency-other"
        value={otherCode}
        onChangeText={(t) => {
          setCodeError(false);
          setOtherCode(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3));
        }}
        onSubmitEditing={() => {
          if (/^[A-Z]{3}$/.test(otherCode)) void chooseCurrency(otherCode);
          else setCodeError(true);
        }}
        placeholder={`${strings.settings.currencyOther} (${s.currency})`}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      {codeError ? <ThemedText type="small" themeColor="danger">{strings.settings.currencyInvalid}</ThemedText> : null}
      {currencyAsk ? (
        <ThemedText testID="currency-ask" type="small" themeColor="danger">
          {fill(strings.settings.currencyAsk, { n: currencyAsk.count, old: s.currency, code: currencyAsk.code })}
        </ThemedText>
      ) : null}

      <ThemedText type="smallBold" style={styles.section}>{strings.settings.numberFormat}</ThemedText>
      {segmented(
        'format',
        [
          { value: 'point', label: strings.settings.numberPoint },
          { value: 'comma', label: strings.settings.numberComma },
        ],
        s.decimalSeparator === ',' ? 'comma' : 'point',
        (v) => save({ [SETTING_KEYS.decimalSeparator]: v === 'comma' ? ',' : '.' })
      )}

      <ThemedText type="smallBold" style={styles.section}>{strings.settings.units}</ThemedText>
      {segmented('units', SYSTEMS, s.unitSystem, (v) => {
        save(unitSystemChange(v));
        applyDefaultUnit(chipUnits(v)[0]);
      })}
      <ThemedText type="small" themeColor="textSecondary">{strings.settings.unitsNote}</ThemedText>

      <ThemedText type="smallBold" style={styles.section}>{strings.settings.bases}</ThemedText>
      {DIMENSIONS.map((d) => (
        <View key={d} style={styles.basisRow}>
          <ThemedText type="small" style={styles.basisLabel}>{strings.settings.dimensions[d]}</ThemedText>
          <View style={styles.wrap}>
            {BASES[d].map((b) => {
              const on = s.bases[d] === b.id;
              return (
                <Pressable
                  key={b.id}
                  testID={`basis-${d}-${b.id}`}
                  accessibilityState={{ selected: on }}
                  onPress={() => save({ [SETTING_KEYS.basis(d)]: b.id })}
                  style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
                  <Text style={[styles.chipText, { color: on ? theme.onTint : theme.text }]}>{strings.bases[b.id]}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      <ThemedText type="smallBold" style={styles.section}>{strings.settings.tax}</ThemedText>
      <Pressable testID="settings-tax" onPress={() => router.push('/tax')} style={[styles.rowButton, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText>{taxChipText(s.taxMode, s.taxRate, s.decimalSeparator)}</ThemedText>
      </Pressable>

      <ThemedText type="smallBold" style={styles.section}>{strings.settings.haptics}</ThemedText>
      {segmented(
        'haptics',
        [
          { value: 'on', label: strings.settings.on },
          { value: 'off', label: strings.settings.off },
        ],
        s.haptics ? 'on' : 'off',
        (v) => save({ [SETTING_KEYS.haptics]: v === 'on' ? '1' : '0' })
      )}

      <ThemedText type="smallBold" style={styles.section}>{strings.settings.appearance}</ThemedText>
      {segmented('theme', THEME_OPTIONS, themePreference, chooseTheme)}

      <Pressable testID="open-stores" onPress={() => router.push('/stores')} style={[styles.rowButton, styles.section, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText themeColor="tint">{strings.stores.title}</ThemedText>
      </Pressable>
      <Pressable testID="open-data" onPress={() => router.push('/data')} style={[styles.rowButton, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText themeColor="tint">{strings.data.title}</ThemedText>
      </Pressable>
      <Pressable testID="open-about" onPress={() => router.push('/about')} style={[styles.rowButton, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText themeColor="tint">{strings.settings.about}</ThemedText>
      </Pressable>

      <ThemedText type="small" themeColor="textSecondary" style={styles.section}>
        {strings.settings.version} {Constants.expoConfig?.version} ({String(Constants.expoConfig?.extra?.appVariant)})
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two, paddingBottom: Spacing.six },
  section: { marginTop: Spacing.three },
  segmented: { flexDirection: 'row', borderRadius: 12, padding: Spacing.one },
  segment: { flex: 1, minHeight: 40, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  chip: { minHeight: 36, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  input: { minHeight: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  basisRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  basisLabel: { width: 64 },
  rowButton: { minHeight: 48, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 14 },
});
