// Add / edit a price (SPEC 2.4, U4): store chips, date (Today, ‹ ›, month panel), pack price and size on the keypad, unit
// chips, "More" (deposit, on promotion + deal text, note). A new price is prefilled from the product's last price (store,
// pack size, unit) and today, so U4 is: type the price digits, Save. An identical price on the same day asks first.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Keypad } from '@/components/keypad';
import { LabeledInput } from '@/components/labeled-input';
import { StorePicker } from '@/components/store-picker';
import { UnitChips } from '@/components/unit-chips';
import { UnitPriceText } from '@/components/unit-price-text';
import { addObservation, deleteObservation, findDuplicate, getObservation, lastObservation, updateObservation, type DuplicateHit, type ObservationError } from '@/db/observations';
import { getProduct } from '@/db/products';
import { findOrCreateStore, listStores, recentStores } from '@/db/stores';
import type { ProductRecord, StoreRecord } from '@/engine/backup';
import { currencyExponent, formatMinor } from '@/engine/money';
import { parsePrice } from '@/engine/parse';
import { chipUnits, isDimension, unitsOf, type Dimension, type UnitId } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { addDays, monthGrid, monthLabel, relativeDate, shiftMonth } from '@/lib/dates';
import { duplicateText } from '@/lib/duplicate-text';
import { displayLocale, fill, unitPriceLine } from '@/lib/format';
import { keyTick } from '@/lib/haptics';
import {
  buildPriceInput, formCurrency, formFromObservation, keptPaidMinor, liveUnitPrice, newPriceForm, nextPriceField, pressPriceKey, type PriceForm,
} from '@/lib/price-form';
import { deviceLocaleTag, useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';
import { today } from '@/lib/today';

const ERRORS: Partial<Record<ObservationError, string>> = {
  price: strings.price.errorPrice,
  paid: strings.price.errorPrice,
  size: strings.price.errorSize,
  unit: strings.price.errorUnit,
  future: strings.price.errorFuture,
  date: strings.price.errorDate,
  deposit: strings.price.errorDeposit,
};

export default function PriceEdit() {
  const { productId, id } = useLocalSearchParams<{ productId: string; id?: string }>();
  const pid = Number(productId);
  const editId = id ? Number(id) : null;
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const settings = useAppSettings();
  const locale = useMemo(() => displayLocale(deviceLocaleTag(), settings.decimalSeparator), [settings.decimalSeparator]);
  const day = today();

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [form, setForm] = useState<PriceForm | null>(null);
  const [recent, setRecent] = useState<StoreRecord[]>([]);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [more, setMore] = useState(false);
  const [typing, setTyping] = useState(false);
  const [panel, setPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const [deleteAsk, setDeleteAsk] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await getProduct(db, pid);
      const [rec, all] = await Promise.all([recentStores(db, 4), listStores(db)]);
      let f: PriceForm | null = null;
      if (p) {
        if (editId !== null) {
          const o = await getObservation(db, editId);
          f = o ? formFromObservation(o) : null;
        } else {
          const last = await lastObservation(db, pid);
          const dim: Dimension = isDimension(p.dimension) ? p.dimension : 'mass';
          const preferred = chipUnits(settings.unitSystem).find((u) => unitsOf(dim).includes(u)) ?? unitsOf(dim)[0];
          f = newPriceForm({ last, lastStoreId: rec[0]?.id ?? null, today: day, defaultUnit: preferred });
        }
      }
      if (!alive) return;
      setProduct(p);
      setRecent(rec);
      setStores(all);
      setForm(f);
      if (f && (f.deposit || f.isPromo || f.note)) setMore(true);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, pid, editId]);

  const dimension: Dimension = product && isDimension(product.dimension) ? product.dimension : 'mass';
  const live = useMemo(() => (form && product ? liveUnitPrice(form, dimension, settings) : null), [form, product, dimension, settings]);

  if (!product || !form) return <View testID="price-edit-screen" style={{ flex: 1, backgroundColor: theme.background }} />;
  // S1: an edited price keeps its own currency and decimals; only a new price uses the book currency.
  const currency = formCurrency(form, settings.currency);
  const exponent = currencyExponent(currency);
  const shelf = parsePrice(form.price, exponent);
  const paidKept = keptPaidMinor(form, shelf.ok ? shelf.value : null);
  const change = (patch: Partial<PriceForm>) => {
    setError(null);
    setDuplicate(null);
    setForm((f) => (f ? { ...f, ...patch } : f));
  };
  const units = [...chipUnits(settings.unitSystem).filter((u) => unitsOf(dimension).includes(u)), ...unitsOf(dimension).filter((u) => !chipUnits(settings.unitSystem).includes(u))];

  const save = async () => {
    if (saving) return;
    const built = buildPriceInput(form, pid, settings.currency);
    if (!built.ok) return setError(ERRORS[built.error] ?? strings.price.errorPrice);
    setSaving(true);
    try {
      if (!duplicate) {
        const dup = await findDuplicate(db, built.input, editId ?? undefined);
        if (dup !== null) {
          setDuplicate(dup);
          return;
        }
      }
      const clock = { today: day };
      const result = editId === null ? await addObservation(db, built.input, clock) : await updateObservation(db, editId, built.input, clock);
      if (!result.ok) return setError(ERRORS[result.error] ?? strings.price.errorGeneric);
      router.back();
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (editId === null) return;
    if (!deleteAsk) return setDeleteAsk(true);
    await deleteObservation(db, editId);
    router.back();
  };
  const onKey = (key: string) => {
    keyTick(settings.haptics);
    setError(null);
    setDuplicate(null);
    setForm((f) => (f ? pressPriceKey(f, key, exponent) : f));
  };

  const field = (kind: 'price' | 'size' | 'deposit', label: string, text: string, flex: number) => {
    const focused = form.focus === kind && !typing;
    return (
      <Pressable
        testID={`pf-${kind}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: focused }}
        onPress={() => change({ focus: kind })}
        style={[styles.field, { flex, borderColor: focused ? theme.tint : theme.backgroundSelected, backgroundColor: theme.background }]}>
        <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{label}</Text>
        <Text testID={`pf-${kind}-text`} style={[styles.fieldText, { color: text ? theme.text : theme.textSecondary }]} numberOfLines={1}>
          {text || '0'}
          {focused ? <Text style={{ color: theme.tint }}>|</Text> : null}
        </Text>
      </Pressable>
    );
  };
  const textChip = (testID: string, label: string, onPress: () => void, on = false) => (
    <Pressable key={testID} testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
      <Text style={[styles.chipText, { color: on ? theme.onTint : theme.tint }]}>{label}</Text>
    </Pressable>
  );
  const weeks = panel ? monthGrid(form.date) : [];

  return (
    <View testID="price-edit-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: editId === null ? strings.price.titleNew : strings.price.titleEdit }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text testID="price-product" style={[styles.product, { color: theme.text }]}>{product.name}</Text>
        {currency !== settings.currency ? (
          <Text testID="price-currency" style={[styles.small, { color: theme.textSecondary }]}>
            {fill(strings.price.otherCurrency, { currency, book: settings.currency })}
          </Text>
        ) : null}
        {form.paid ? (
          <View style={styles.dateRow}>
            <Text testID="price-paid" style={[styles.small, { flex: 1, color: theme.text }]}>
              {fill(paidKept !== null ? strings.price.paidKept : strings.price.paidDropped, { paid: formatMinor(form.paid.minor, currency, locale) })}
            </Text>
            {paidKept !== null
              ? textChip('price-paid-toggle', strings.price.paidRemove, () => change({ keepPaid: false }))
              : shelf.ok && form.paid.minor <= shelf.value
                ? textChip('price-paid-toggle', strings.price.paidKeep, () => change({ keepPaid: true }))
                : null}
          </View>
        ) : null}

        <Text style={[styles.label, { color: theme.textSecondary }]}>{strings.price.store}</Text>
        <StorePicker
          recent={recent}
          all={stores.filter((s) => !s.archived || s.id === form.storeId)}
          selectedId={form.storeId}
          onSelect={(sid) => change({ storeId: sid })}
          onCreate={async (name) => {
            const r = await findOrCreateStore(db, name);
            if (!r.ok) return null;
            setStores(await listStores(db));
            return r.id;
          }}
        />

        <Text style={[styles.label, { color: theme.textSecondary }]}>{strings.price.date}</Text>
        <View style={styles.dateRow}>
          {textChip('date-prev', '‹', () => change({ date: addDays(form.date, -1) }))}
          <Pressable testID="date-text" accessibilityRole="button" onPress={() => setPanel((p) => !p)} style={styles.dateText}>
            <Text style={[styles.fieldText, { color: theme.text }]}>{form.date}</Text>
            <Text style={[styles.small, { color: theme.textSecondary }]}>{relativeDate(form.date, day)}</Text>
          </Pressable>
          {textChip('date-next', '›', () => change({ date: form.date < day ? addDays(form.date, 1) : form.date }))}
          {form.date !== day ? textChip('date-today', strings.price.today, () => change({ date: day })) : null}
        </View>
        {panel ? (
          <View testID="date-panel" style={[styles.panel, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.dateRow}>
              {textChip('month-prev', '‹', () => change({ date: shiftMonth(form.date, -1) }))}
              <Text style={[styles.monthText, { color: theme.text }]}>{monthLabel(form.date, locale)}</Text>
              {textChip('month-next', '›', () => change({ date: shiftMonth(form.date, 1) > day ? day : shiftMonth(form.date, 1) }))}
            </View>
            {weeks.map((week, wi) => (
              <View key={wi} style={styles.week}>
                {week.map((cell, ci) =>
                  cell ? (
                    <Pressable
                      key={cell}
                      testID={`day-${cell}`}
                      disabled={cell > day}
                      onPress={() => {
                        change({ date: cell });
                        setPanel(false);
                      }}
                      style={[styles.day, cell === form.date && { backgroundColor: theme.tint }, cell > day && { opacity: 0.3 }]}>
                      <Text style={{ color: cell === form.date ? theme.onTint : theme.text, fontSize: 15 }}>{Number(cell.slice(8))}</Text>
                    </Pressable>
                  ) : (
                    <View key={`e${ci}`} style={styles.day} />
                  )
                )}
              </View>
            ))}
          </View>
        ) : null}

        <Pressable testID="price-more" accessibilityRole="button" onPress={() => setMore((m) => !m)}>
          <Text style={[styles.small, { color: theme.tint, fontSize: 15 }]}>{more ? strings.price.lessOptions : strings.price.moreOptions}</Text>
        </Pressable>
        {more ? (
          <View style={styles.more}>
            {field('deposit', `${strings.price.deposit} (${currency})`, form.deposit, 1)}
            <Pressable testID="price-promo" accessibilityRole="switch" accessibilityState={{ checked: form.isPromo }} onPress={() => change({ isPromo: !form.isPromo })} style={styles.toggle}>
              <Text style={{ fontSize: 22, color: form.isPromo ? theme.tint : theme.textSecondary }}>{form.isPromo ? '☑' : '☐'}</Text>
              <Text style={[styles.toggleText, { color: theme.text }]}>{strings.price.onPromotion}</Text>
            </Pressable>
            {form.isPromo ? (
              <LabeledInput testID="price-deal" label={strings.price.dealText} value={form.dealText} onChangeText={(t) => change({ dealText: t })} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} placeholder={strings.price.dealHint} />
            ) : null}
            <LabeledInput testID="price-note" label={strings.price.note} value={form.note} onChangeText={(t) => change({ note: t })} onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} />
          </View>
        ) : null}

        {error ? <Text testID="price-error" style={{ color: theme.danger, fontSize: 14 }}>{error}</Text> : null}
        {editId !== null ? (
          <Pressable testID="price-delete" accessibilityRole="button" onPress={remove} style={[styles.chip, { backgroundColor: theme.backgroundElement, alignSelf: 'flex-start' }]}>
            <Text style={[styles.chipText, { color: theme.danger }]}>{deleteAsk ? strings.price.deleteConfirm : strings.price.delete}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={[styles.bottom, { borderTopColor: theme.backgroundSelected }]}>
      <View style={styles.pinned}>
        <View style={styles.fields}>
          {field('price', `${strings.price.packPrice} (${currency})`, form.price, 5)}
          {field('size', `${strings.compare.size} (${strings.units[form.unit]})`, form.size, 5)}
        </View>
        {live ? (
          <UnitPriceText
            testID="price-live"
            style={[styles.live, { color: theme.text }]}
            text={unitPriceLine(live.unitPrice, live.basis, { currency, locale, sep: settings.decimalSeparator, unitDecimals: live.decimals })}
          />
        ) : null}
      </View>
        {duplicate ? (
          <Pressable testID="price-dup-keep" accessibilityRole="button" onPress={() => router.back()} style={styles.keep}>
            <Text maxFontSizeMultiplier={1.4} style={[styles.keepText, { color: theme.tint }]}>{strings.price.keepSaved}</Text>
          </Pressable>
        ) : null}
        <Pressable testID="price-save" accessibilityRole="button" onPress={save} style={[styles.save, { backgroundColor: duplicate ? theme.danger : theme.tint }]}>
          <Text maxFontSizeMultiplier={1.4} style={[styles.saveText, { color: theme.onTint }]}>{duplicate ? duplicateText(duplicate, locale) : strings.price.save}</Text>
        </Pressable>
        {!typing && form.focus === 'size' ? (
          <UnitChips units={units} selected={form.unit} onSelect={(u: UnitId) => change({ unit: u })} />
        ) : null}
        {!typing ? (
          <Keypad
            sep={settings.decimalSeparator}
            timesEnabled={form.focus === 'size'}
            testIDPrefix="pkey"
            safeBottom
            onKey={onKey}
            onNext={() => {
              keyTick(settings.haptics);
              setForm((f) => (f ? nextPriceField(f) : f));
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 14, gap: 10, paddingBottom: 24 },
  product: { fontSize: 22, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600' },
  small: { fontSize: 13 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateText: { flex: 1, alignItems: 'center' },
  chip: { minHeight: 40, minWidth: 40, borderRadius: 20, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 15, fontWeight: '600' },
  panel: { borderRadius: 12, padding: 8, gap: 4 },
  monthText: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700' },
  week: { flexDirection: 'row' },
  day: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19 },
  pinned: { paddingHorizontal: 8, paddingTop: 8, gap: 4 },
  fields: { flexDirection: 'row', gap: 8 },
  field: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, minHeight: 56 },
  fieldLabel: { fontSize: 11, fontWeight: '600' },
  fieldText: { fontSize: 22, fontWeight: '600' },
  live: { fontSize: 18, fontWeight: '700' },
  more: { gap: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  toggleText: { fontSize: 16, flex: 1 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth },
  save: { margin: 8, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  saveText: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  keep: { marginHorizontal: 8, marginTop: 8, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  keepText: { fontSize: 16, fontWeight: '600' },
});
