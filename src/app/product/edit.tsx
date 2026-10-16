// Add / edit a product (SPEC 2.2, 2.3, 7): name, brand, variant, category, what it is measured in, count label, note,
// favourite. A new product goes straight to its first price. Same name as an existing product -> "You already have
// it" with the choice to open it or to create another (variants are legitimate, review #9). Delete = second tap.
// V1.5 P1 (D63): barcodes — typed or scanned, checked at once (check digit, another product's code), saved with the product.
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { LabeledInput } from '@/components/labeled-input';
import { findProductByBarcode, listBarcodes, MAX_BARCODES_PER_PRODUCT } from '@/db/barcodes';
import { countProductPrices, createProduct, deleteProduct, findProductsByName, getProduct, listCategories, updateProduct, type ProductError, type ProductResult } from '@/db/products';
import type { ProductRecord } from '@/engine/backup';
import { displayBarcode, isCanonicalBarcode, parseBarcode } from '@/engine/barcode';
import { DIMENSIONS, isDimension, type Dimension } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { revalidateDraftLinks } from '@/lib/compare-store';
import { fill } from '@/lib/format';
import { barcodeErrorText, takeScannedCode } from '@/lib/scan-handoff';
import { strings } from '@/lib/strings';

const ERRORS: Record<ProductError, string> = {
  empty: strings.productEdit.errorEmpty,
  dimension: strings.productEdit.errorDimension,
  dimensionInUse: strings.productEdit.errorDimensionInUse,
  countLabelInUse: strings.productEdit.errorCountLabelInUse,
  notFound: strings.productEdit.errorNotFound,
  barcode: strings.productEdit.errorBarcode,
  barcodeTaken: strings.productEdit.errorBarcodeTaken,
  tooManyBarcodes: strings.productEdit.errorTooManyBarcodes,
};

export default function ProductEdit() {
  const { id, barcode } = useLocalSearchParams<{ id?: string; barcode?: string }>();
  const editId = id ? Number(id) : null;
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const [loaded, setLoaded] = useState(editId === null);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [variant, setVariant] = useState('');
  const [category, setCategory] = useState('');
  const [dimension, setDimension] = useState<Dimension>('mass');
  const [countLabel, setCountLabel] = useState('');
  const [note, setNote] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [existing, setExisting] = useState<ProductRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmLabel, setConfirmLabel] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState<number | null>(null);
  // A new product started from a scan arrives with its code (scan "New product with this barcode").
  const [barcodes, setBarcodes] = useState<string[]>(() => (editId === null && isCanonicalBarcode(barcode) ? [barcode] : []));
  const [codeText, setCodeText] = useState('');
  const [codeNote, setCodeNote] = useState<{ text: string; bad: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setCategories(await listCategories(db));
      if (editId === null) return;
      const p = await getProduct(db, editId);
      if (!alive || !p) return;
      setName(p.name);
      setBrand(p.brand ?? '');
      setVariant(p.variant ?? '');
      setCategory(p.category ?? '');
      setDimension(isDimension(p.dimension) ? p.dimension : 'mass');
      setCountLabel(p.count_label ?? '');
      setNote(p.note ?? '');
      setFavorite(p.favorite === 1);
      setBarcodes(await listBarcodes(db, editId));
      setLoaded(true);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [db, editId]);

  const input = () => ({ name, brand, variant, category, dimension, countLabel, note, favorite, confirmCountLabelChange: confirmLabel, barcodes });

  /** Adds a typed or scanned code to the list (saved with the product); says at once what is wrong with it. */
  const addCode = async (raw: string) => {
    const parsed = parseBarcode(raw);
    if (!parsed.ok) return setCodeNote({ text: barcodeErrorText(parsed.error), bad: true });
    if (parsed.candidates.some((c) => barcodes.includes(c))) return setCodeNote({ text: fill(strings.productEdit.barcodeAlready, { code: parsed.display }), bad: true });
    if (barcodes.length >= MAX_BARCODES_PER_PRODUCT) return setCodeNote({ text: fill(strings.productEdit.errorTooManyBarcodes, { n: MAX_BARCODES_PER_PRODUCT }), bad: true });
    const owner = await findProductByBarcode(db, parsed.candidates);
    if (owner && owner.product.id !== editId) {
      return setCodeNote({ text: fill(strings.productEdit.errorBarcodeTaken, { code: parsed.display, name: owner.product.name }), bad: true });
    }
    setBarcodes((list) => [...list, parsed.code]);
    setCodeText('');
    setCodeNote(parsed.label === 'storeLabel' ? { text: strings.scan.storeLabel, bad: false } : null);
  };
  // Back from the scan screen (purpose "attach") with a code.
  useFocusEffect(
    useCallback(() => {
      const code = takeScannedCode();
      if (code) void addCode(code);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [barcodes, editId])
  );
  const errorText = (result: Extract<ProductResult, { ok: false }>) => {
    if (result.error === 'barcodeTaken' && result.owner) return fill(ERRORS.barcodeTaken, { code: displayBarcode(result.owner.code), name: result.owner.ownerName });
    if (result.error === 'barcode') return fill(ERRORS.barcode, { code: result.code ?? '' });
    if (result.error === 'tooManyBarcodes') return fill(ERRORS.tooManyBarcodes, { n: MAX_BARCODES_PER_PRODUCT });
    return ERRORS[result.error];
  };

  const save = async (anyway: boolean) => {
    setError(null);
    if (editId === null) {
      if (!anyway) {
        const same = await findProductsByName(db, name);
        if (same.length > 0) {
          setExisting(same);
          return;
        }
      }
      const result = await createProduct(db, input());
      if (!result.ok) return setError(errorText(result));
      router.replace({ pathname: '/product/[id]', params: { id: String(result.id) } });
      router.push({ pathname: '/price/edit', params: { productId: String(result.id) } });
      return;
    }
    const result = await updateProduct(db, editId, input());
    if (!result.ok) {
      if (result.error === 'countLabelInUse') setConfirmLabel(true);
      return setError(errorText(result));
    }
    router.back();
  };

  const remove = async () => {
    if (editId === null) return;
    if (deleteAsk === null) {
      setDeleteAsk(await countProductPrices(db, editId));
      return;
    }
    await deleteProduct(db, editId);
    await revalidateDraftLinks(db); // a Compare card linked to it is unlinked now, before a new product can take its id
    router.dismissAll();
  };

  const chip = (testID: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable key={testID} testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
      <Text style={[styles.chipText, { color: on ? theme.onTint : theme.text }]}>{label}</Text>
    </Pressable>
  );
  if (!loaded) return <View testID="product-edit-screen" style={{ flex: 1, backgroundColor: theme.background }} />;

  return (
    <ScrollView testID="product-edit-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <Stack.Screen options={{ title: editId === null ? strings.productEdit.titleNew : strings.productEdit.titleEdit }} />
      <LabeledInput testID="pe-name" label={strings.productEdit.name} value={name} onChangeText={(t) => { setName(t); setExisting([]); }} autoCapitalize="sentences" autoFocus={editId === null} returnKeyType="next" />
      <LabeledInput testID="pe-brand" label={strings.productEdit.brand} value={brand} onChangeText={setBrand} autoCapitalize="words" />
      <LabeledInput testID="pe-variant" label={strings.productEdit.variant} value={variant} onChangeText={setVariant} />
      <LabeledInput testID="pe-category" label={strings.productEdit.category} value={category} onChangeText={setCategory} autoCapitalize="sentences" />
      {categories.length > 0 ? <View style={styles.wrap}>{categories.slice(0, 8).map((c) => chip(`pe-cat-${c}`, c, category === c, () => setCategory(c)))}</View> : null}

      <Text style={[styles.label, { color: theme.textSecondary }]}>{strings.productEdit.measuredIn}</Text>
      <View style={styles.wrap}>{DIMENSIONS.map((d) => chip(`pe-dim-${d}`, strings.settings.dimensions[d], dimension === d, () => setDimension(d)))}</View>
      {dimension === 'count' ? <LabeledInput testID="pe-label" label={strings.productEdit.countLabel} value={countLabel} onChangeText={setCountLabel} placeholder={strings.productEdit.countLabelHint} /> : null}
      <LabeledInput testID="pe-note" label={strings.productEdit.note} value={note} onChangeText={setNote} multiline />
      <Pressable testID="pe-favourite" accessibilityRole="switch" accessibilityState={{ checked: favorite }} onPress={() => setFavorite((f) => !f)} style={styles.toggle}>
        <Text style={{ fontSize: 22, color: favorite ? theme.tint : theme.textSecondary }}>{favorite ? '★' : '☆'}</Text>
        <Text style={[styles.toggleText, { color: theme.text }]}>{strings.productEdit.favourite}</Text>
      </Pressable>

      <Text style={[styles.label, { color: theme.textSecondary }]}>{strings.productEdit.barcodes}</Text>
      <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{strings.productEdit.barcodesHint}</Text>
      {barcodes.map((code) => (
        <View key={code} style={styles.codeRow}>
          <Text testID={`pe-barcode-${code}`} style={[styles.codeText, { color: theme.text }]}>{displayBarcode(code)}</Text>
          <Pressable
            testID={`pe-barcode-remove-${code}`}
            accessibilityRole="button"
            accessibilityLabel={fill(strings.productEdit.barcodeRemove, { code: displayBarcode(code) })}
            onPress={() => setBarcodes((list) => list.filter((c) => c !== code))}
            hitSlop={10}
            style={styles.codeRemove}>
            <Text style={{ color: theme.textSecondary, fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>
      ))}
      <View style={styles.codeRow}>
        <TextInput
          testID="pe-barcode-input"
          value={codeText}
          onChangeText={(t) => {
            setCodeText(t);
            setCodeNote(null);
          }}
          keyboardType="number-pad"
          accessibilityLabel={strings.productEdit.barcodeInput}
          placeholder={strings.productEdit.barcodeInput}
          placeholderTextColor={theme.textSecondary}
          onSubmitEditing={() => void addCode(codeText)}
          style={[styles.codeInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <Button testID="pe-barcode-add" variant="secondary" label={strings.productEdit.barcodeAdd} onPress={() => void addCode(codeText)} />
        <Button testID="pe-barcode-scan" variant="secondary" label={strings.productEdit.barcodeScan} onPress={() => router.push({ pathname: '/scan', params: { purpose: 'attach' } })} />
      </View>
      {codeNote ? <Text testID="pe-barcode-note" style={{ color: codeNote.bad ? theme.danger : theme.text, fontSize: 14 }}>{codeNote.text}</Text> : null}

      {error ? <Text testID="pe-error" style={{ color: theme.danger, fontSize: 14 }}>{error}</Text> : null}
      {existing.length > 0 ? (
        <View testID="pe-existing" style={[styles.box, { backgroundColor: theme.backgroundElement }]}>
          <Text style={{ color: theme.text, fontSize: 15 }}>{fill(strings.productEdit.alreadyHave, { name: existing[0].name })}</Text>
          <View style={styles.wrap}>
            <Button testID="pe-open-existing" variant="secondary" label={strings.productEdit.openExisting} onPress={() => { router.replace({ pathname: '/product/[id]', params: { id: String(existing[0].id) } }); }} />
            <Button testID="pe-create-anyway" variant="secondary" label={strings.productEdit.createAnyway} onPress={() => save(true)} />
          </View>
        </View>
      ) : null}

      <Button testID="pe-save" label={editId === null ? strings.productEdit.saveNew : strings.productEdit.save} onPress={() => save(false)} />
      {editId !== null ? (
        <Button
          testID="pe-delete"
          variant="secondary"
          label={deleteAsk === null ? strings.productEdit.delete : fill(deleteAsk === 1 ? strings.productEdit.deleteConfirmOne : strings.productEdit.deleteConfirm, { count: deleteAsk })}
          onPress={remove}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '600' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 38, borderRadius: 19, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 15, fontWeight: '600' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  toggleText: { fontSize: 16 },
  box: { borderRadius: 12, padding: 12, gap: 10 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  codeText: { flex: 1, fontSize: 17, letterSpacing: 1 },
  codeRemove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  codeInput: { flex: 1, minHeight: 46, borderRadius: 10, paddingHorizontal: 12, fontSize: 17 },
});
