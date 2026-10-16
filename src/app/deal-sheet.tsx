// "+ Deal" sheet (U2: preset in one tap, so "+ Deal" -> "3 for 2" = 2 taps). Other deals are small keypad forms.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Keypad } from '@/components/keypad';
import { currencyExponent } from '@/engine/money';
import { useTheme } from '@/hooks/use-theme';
import { addDeal, findCard, PRESETS, type DealEntry } from '@/lib/compare-draft';
import { getDraft, updateDraft } from '@/lib/compare-store';
import { buildDeal, formKey, FORMS, initialValues, type FormId } from '@/lib/deal-forms';
import { keyTick } from '@/lib/haptics';
import { useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';

const PRESET_BUTTONS: { id: keyof typeof PRESETS; label: string }[] = [
  { id: 'bogo', label: strings.deals.bogo },
  { id: 'threeForTwo', label: strings.deals.threeForTwo },
  { id: 'secondHalf', label: strings.deals.secondHalf },
  { id: 'pct10', label: strings.deals.pct10 },
  { id: 'pct20', label: strings.deals.pct20 },
  { id: 'pct25', label: strings.deals.pct25 },
];
const MORE_FORMS: FormId[] = ['buyXGetY', 'percent', 'spendSave', 'cashback', 'deposit'];

export default function DealSheet() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const settings = useAppSettings();
  const exponent = currencyExponent(settings.currency);
  const [more, setMore] = useState(false);
  const [form, setForm] = useState<FormId | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [field, setField] = useState(0);
  const [error, setError] = useState(false);
  const card = findCard(getDraft(), cardId ?? '');

  const add = (entry: DealEntry) => {
    if (card) updateDraft((d) => addDeal(d, card.id, entry));
    router.back();
  };
  const open = (id: FormId) => {
    setForm(id);
    setValues(initialValues(id));
    setToggles({});
    setField(0);
    setError(false);
  };
  const button = (testID: string, label: string, onPress: () => void, primary = false) => (
    <Pressable
      key={testID}
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, { backgroundColor: primary ? theme.tint : theme.backgroundElement }]}>
      <Text style={[styles.buttonText, { color: primary ? theme.onTint : theme.text }]}>{label}</Text>
    </Pressable>
  );

  if (form) {
    const def = FORMS[form];
    const current = def.fields[field];
    const done = () => {
      const entry = buildDeal(form, values, toggles, exponent);
      if (!entry) {
        setError(true);
        return;
      }
      add(entry);
    };
    return (
      <View testID="deal-form" style={[styles.screen, { backgroundColor: theme.background }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.title, { color: theme.text }]}>{def.title}</Text>
          {form === 'buyXGetY' || form === 'nForPrice' ? (card?.deals.quantity ? <Text style={[styles.note, { color: theme.textSecondary }]}>{strings.deals.replaceNote}</Text> : null) : null}
          {def.fields.map((fd, i) => {
            const focused = i === field;
            return (
              <Pressable
                key={fd.key}
                testID={`dealfield-${fd.key}`}
                onPress={() => setField(i)}
                style={[styles.field, { borderColor: focused ? theme.tint : theme.backgroundSelected, backgroundColor: theme.backgroundElement }]}>
                <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{fd.label}</Text>
                <Text testID={`dealfield-${fd.key}-text`} style={[styles.fieldText, { color: theme.text }]}>
                  {values[fd.key] ?? ''}
                  {focused ? <Text style={{ color: theme.tint }}>|</Text> : null}
                </Text>
              </Pressable>
            );
          })}
          {def.toggles.map((t) => {
            const on = !!toggles[t.key];
            return (
              <Pressable
                key={t.key}
                testID={`dealtoggle-${t.key}`}
                accessibilityRole="switch"
                accessibilityState={{ checked: on }}
                onPress={() => setToggles((s) => ({ ...s, [t.key]: !s[t.key] }))}
                style={styles.toggle}>
                <Text style={[styles.box, { color: on ? theme.tint : theme.textSecondary }]}>{on ? '☑' : '☐'}</Text>
                <Text style={[styles.toggleText, { color: theme.text }]}>{t.label}</Text>
              </Pressable>
            );
          })}
          {error ? <Text style={[styles.note, { color: theme.danger }]}>{strings.compare.missing.deal}</Text> : null}
          <View style={styles.row}>
            {button('deal-cancel', strings.deals.cancel, () => setForm(null))}
            {button('deal-done', strings.deals.done, done, true)}
          </View>
        </ScrollView>
        <Keypad
          sep={settings.decimalSeparator}
          timesEnabled={false}
          testIDPrefix="dkey"
          safeBottom
          onKey={(key) => {
            keyTick(settings.haptics);
            setError(false);
            setValues((v) => ({ ...v, [current.key]: formKey(v[current.key] ?? '', key, current.kind, exponent) }));
          }}
          onNext={() => setField((i) => (i + 1) % def.fields.length)}
        />
      </View>
    );
  }

  return (
    <ScrollView testID="deal-sheet" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <View style={styles.grid}>
        {PRESET_BUTTONS.map((p) => button(`preset-${p.id}`, p.label, () => add(PRESETS[p.id])))}
        {button('form-nForPrice', strings.deals.nForPrice, () => open('nForPrice'))}
        {button('form-coupon', strings.deals.coupon, () => open('coupon'))}
        {button('form-more', strings.deals.more, () => setMore((m) => !m))}
      </View>
      {more ? <View style={styles.grid}>{MORE_FORMS.map((id) => button(`form-${id}`, FORMS[id].title, () => open(id)))}</View> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { minWidth: '30%', flexGrow: 1, minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  field: { borderWidth: 2, borderRadius: 10, padding: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  fieldText: { fontSize: 20, fontWeight: '600', minHeight: 26 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
  box: { fontSize: 22 },
  toggleText: { fontSize: 15, flex: 1 },
  note: { fontSize: 14 },
  row: { flexDirection: 'row', gap: 10 },
});
