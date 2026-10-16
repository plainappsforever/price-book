// Save a Compare card to the book (SPEC 2.4, U3): product name (type 2-3 letters, pick the match) -> store (the last used
// one is preselected) -> Save. A linked card starts with its product, so linked = store + Save. The price saved is the
// shelf price after in-store deals, before added tax and cashback (D40), with the deal as text. Product and price are
// created in one transaction.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LabeledInput } from '@/components/labeled-input';
import { StorePicker } from '@/components/store-picker';
import { addObservation, findDuplicate, type DuplicateHit } from '@/db/observations';
import { createProduct, findProductsByName, getProduct, listProducts, type ProductListRow } from '@/db/products';
import { findOrCreateStore, listStores, recentStores } from '@/db/stores';
import { inTransaction } from '@/db/tx';
import type { StoreRecord } from '@/engine/backup';
import { formatMinor } from '@/engine/money';
import { useTheme } from '@/hooks/use-theme';
import { unlinkProduct } from '@/lib/compare-draft';
import { getDraft, revalidateDraftLinks, updateDraft } from '@/lib/compare-store';
import { duplicateText } from '@/lib/duplicate-text';
import { displayLocale, fill, savedBasisText } from '@/lib/format';
import { showNotice } from '@/lib/notice';
import { packSizeText } from '@/lib/product-view';
import { candidateInput, saveCandidate } from '@/lib/save-from-compare';
import { deviceLocaleTag, useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';
import { today } from '@/lib/today';

class Refused extends Error {}
class LinkGone extends Error {}

export default function SaveSheet() {
  const { cardId } = useLocalSearchParams<{ cardId: string }>();
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const settings = useAppSettings();
  const locale = useMemo(() => displayLocale(deviceLocaleTag(), settings.decimalSeparator), [settings.decimalSeparator]);
  const candidate = useMemo(() => saveCandidate(getDraft(), cardId ?? '', settings, locale), [cardId, settings, locale]);
  const [name, setName] = useState(candidate?.productName ?? '');
  const [selected, setSelected] = useState<{ id: number; uid: string | null; name: string } | null>(
    candidate?.productId != null && candidate.productName ? { id: candidate.productId, uid: candidate.productUid, name: candidate.productName } : null
  );
  const [found, setSuggestions] = useState<ProductListRow[]>([]);
  const [recent, setRecent] = useState<StoreRecord[]>([]);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateHit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const day = today();

  // REVIEW_V1 S2: a linked card's product may be gone or be another product under a reused id: then start unlinked.
  useEffect(() => {
    if (!candidate || candidate.productId === null) return;
    let alive = true;
    (async () => {
      await revalidateDraftLinks(db);
      const card = getDraft().cards.find((c) => c.id === candidate.cardId);
      if (!alive || card?.productId === candidate.productId) return;
      setSelected(null);
      setName('');
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [rec, all] = await Promise.all([recentStores(db, 4), listStores(db)]);
      if (!alive) return;
      setRecent(rec);
      setStores(all);
      setStoreId(rec[0]?.id ?? null);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [db]);

  const query = candidate && !selected && name.trim() !== '' ? name : null;
  const dimension = candidate?.dimension;
  useEffect(() => {
    if (query === null) return;
    let alive = true;
    listProducts(db, { search: query, sort: 'name' })
      .then((rows) => alive && setSuggestions(rows.filter((p) => p.dimension === dimension).slice(0, 5)))
      .catch(() => alive && setSuggestions([]));
    return () => {
      alive = false;
    };
  }, [db, query, dimension]);

  const suggestions = query === null ? [] : found;
  if (!candidate) {
    return (
      <View testID="save-sheet" style={[styles.screen, { backgroundColor: theme.background }]}>
        <Text style={[styles.note, { color: theme.text }]}>{strings.save.nothing}</Text>
      </View>
    );
  }
  const m = candidate.memory;
  const price = formatMinor(m.paidPriceMinor ?? m.packPriceMinor, settings.currency, locale);
  const summary = [price, packSizeText(m.packCount, m.itemSize, m.unit, settings.decimalSeparator), candidate.dealText].filter(Boolean).join(' · ');
  const canSave = !!selected || name.trim() !== '';

  const save = async () => {
    if (busy || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      if (selected && !duplicate) {
        const dup = await findDuplicate(db, candidateInput(candidate, selected.id, storeId, settings.currency, day));
        if (dup !== null) {
          setDuplicate(dup);
          return;
        }
      }
      const saved = await inTransaction(db, async (tx) => {
        let productId = selected?.id ?? null;
        let productName = selected?.name ?? name.trim();
        if (selected) {
          // The product must still be the one that was picked or linked (same uid), never another one under its id.
          const current = await getProduct(tx, selected.id);
          if (!current || (selected.uid !== null && current.uid !== selected.uid)) throw new LinkGone();
          productName = current.name;
        }
        if (productId === null) {
          const same = (await findProductsByName(tx, name)).find((p) => p.dimension === candidate.dimension);
          if (same) {
            productId = same.id;
            productName = same.name;
          } else {
            const created = await createProduct(tx, { name, dimension: candidate.dimension });
            if (!created.ok) throw new Refused(strings.productEdit.errorEmpty);
            productId = created.id;
          }
        }
        const result = await addObservation(tx, candidateInput(candidate, productId, storeId, settings.currency, day), { today: day });
        if (!result.ok) throw new Refused(result.error === 'unit' ? strings.price.errorUnit : strings.price.errorGeneric);
        return productName;
      });
      showNotice(fill(strings.save.saved, { name: saved }));
      router.back();
    } catch (e) {
      if (e instanceof LinkGone) {
        if (candidate.productId !== null) updateDraft((d) => unlinkProduct(d, candidate.cardId));
        setSelected(null);
        setName('');
        setError(strings.save.linkGone);
        return;
      }
      setError(e instanceof Refused ? e.message : strings.price.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="save-sheet" style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Text testID="save-summary" style={[styles.summary, { color: theme.text }]}>{summary}</Text>
        <Text testID="save-basis" style={[styles.note, { color: theme.textSecondary }]}>{savedBasisText(settings.taxMode)}</Text>
        {selected ? (
          <View style={styles.selectedRow}>
            <Text testID="save-selected" style={[styles.selected, { color: theme.text }]}>{selected.name}</Text>
            <Pressable testID="save-change" accessibilityRole="button" onPress={() => { setSelected(null); setDuplicate(null); }}>
              <Text style={{ color: theme.tint, fontSize: 15, fontWeight: '600' }}>{strings.save.change}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <LabeledInput testID="save-name" label={strings.save.productName} value={name} onChangeText={(t) => { setName(t); setDuplicate(null); }} autoFocus autoCapitalize="sentences" returnKeyType="done" />
            {suggestions.map((p) => (
              <Pressable key={p.id} testID={`save-pick-${p.id}`} accessibilityRole="button" onPress={() => { setSelected({ id: p.id, uid: p.uid, name: p.name }); setName(p.name); }} style={[styles.suggestion, { backgroundColor: theme.backgroundElement }]}>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{p.name}</Text>
                <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{[p.brand, p.variant].filter(Boolean).join(' · ')}</Text>
              </Pressable>
            ))}
            {name.trim() !== '' && suggestions.length === 0 ? <Text style={[styles.note, { color: theme.textSecondary }]}>{fill(strings.save.newProduct, { name: name.trim() })}</Text> : null}
          </>
        )}
        <Text style={[styles.label, { color: theme.textSecondary }]}>{strings.price.store}</Text>
        <StorePicker
          recent={recent}
          all={stores.filter((s) => !s.archived || s.id === storeId)}
          selectedId={storeId}
          onSelect={setStoreId}
          onCreate={async (n) => {
            const r = await findOrCreateStore(db, n);
            if (!r.ok) return null;
            setStores(await listStores(db));
            return r.id;
          }}
        />
        {error ? <Text testID="save-error" style={{ color: theme.danger }}>{error}</Text> : null}
        <Pressable
          testID="save-confirm"
          accessibilityRole="button"
          disabled={!canSave}
          onPress={save}
          style={[styles.save, { backgroundColor: duplicate ? theme.danger : theme.tint }, !canSave && { opacity: 0.4 }]}>
          <Text style={[styles.saveText, { color: theme.onTint }]}>{duplicate ? duplicateText(duplicate, locale) : strings.save.save}</Text>
        </Pressable>
        {duplicate ? (
          <Pressable testID="save-dup-keep" accessibilityRole="button" onPress={() => router.back()} style={styles.keep}>
            <Text style={[styles.keepText, { color: theme.tint }]}>{strings.price.keepSaved}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12 },
  summary: { fontSize: 18, fontWeight: '700' },
  selectedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46 },
  selected: { fontSize: 20, fontWeight: '700', flex: 1 },
  suggestion: { borderRadius: 10, padding: 10, gap: 2 },
  label: { fontSize: 13, fontWeight: '600' },
  note: { fontSize: 14, padding: 4 },
  save: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveText: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  keep: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  keepText: { fontSize: 16, fontWeight: '600' },
});
