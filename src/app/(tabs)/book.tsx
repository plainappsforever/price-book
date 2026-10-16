// Price Book (SPEC 2.2, U4, U6): search, All / Favourites, store and category filters, sort (recently updated, name,
// biggest rise vs usual). Rows show the latest unit price with store and date, a gauge chip, a shrinkflation mark and the
// star. Statistics are computed per visible row (A17); only the "biggest rise" sort computes every product.
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProductRow } from '@/components/product-row';
import { listAllObservations, toPriceObservation } from '@/db/observations';
import { listCategories, listProducts, setFavorite, type ProductListRow } from '@/db/products';
import { listStores } from '@/db/stores';
import type { StoreRecord } from '@/engine/backup';
import type { PriceObservation } from '@/engine/stats';
import { isDimension, type Dimension } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { buildRowView, computeRowStats, riseKey, rowStatsCache, sortByRise, type RowStats } from '@/lib/book-view';
import { DEBUG_ENABLED } from '@/lib/debug';
import { displayLocale, fill, savedBasisText } from '@/lib/format';
import { elapsedSinceList, markList, markNav } from '@/lib/nav-mark';
import { deviceLocaleTag, useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';
import { today } from '@/lib/today';

type Sort = 'recent' | 'name' | 'rise';
type Base = { obs: Map<number, PriceObservation[]>; stores: StoreRecord[]; categories: string[] };
const NO_BOOK = {};

export default function BookScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const settings = useAppSettings();
  const [search, setSearch] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('recent');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [base, setBase] = useState<Base | null>(null);
  const [products, setProducts] = useState<ProductListRow[] | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [pricesMs, setPricesMs] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      setVersion((v) => v + 1);
    }, [])
  );

  // Everything the rows need except the product query: all prices grouped by product, stores, categories.
  useEffect(() => {
    let alive = true;
    const t0 = Date.now();
    (async () => {
      const [rows, stores, categories] = await Promise.all([listAllObservations(db), listStores(db, { includeArchived: true }), listCategories(db)]);
      const obs = new Map<number, PriceObservation[]>();
      for (const r of rows) {
        const list = obs.get(r.product_id);
        if (list) list.push(toPriceObservation(r));
        else obs.set(r.product_id, [toPriceObservation(r)]);
      }
      if (alive) {
        setBase({ obs, stores, categories });
        setPricesMs(Date.now() - t0);
      }
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [db, version]);

  useEffect(() => {
    let alive = true;
    markList();
    listProducts(db, { search, favoritesOnly, storeId, category, sort: sort === 'name' ? 'name' : 'recent' })
      .then((rows) => alive && setProducts(rows))
      .catch(() => alive && setProducts([]));
    return () => {
      alive = false;
    };
  }, [db, version, search, favoritesOnly, storeId, category, sort]);

  const day = today();
  const locale = useMemo(() => displayLocale(deviceLocaleTag(), settings.decimalSeparator), [settings.decimalSeparator]);
  const statsOf = useCallback(
    (p: ProductListRow): RowStats => {
      const cache = rowStatsCache(base ?? NO_BOOK, settings);
      const key = `${day}|${p.id}`;
      let rs = cache.get(key);
      if (!rs) {
        rs = computeRowStats(base?.obs.get(p.id) ?? [], isDimension(p.dimension) ? p.dimension : ('mass' as Dimension), day, settings);
        cache.set(key, rs);
      }
      return rs;
    },
    [base, settings, day]
  );
  const ordered = useMemo(() => (products && base && sort === 'rise' ? sortByRise(products, (p) => riseKey(statsOf(p))) : products), [products, base, sort, statsOf]);
  const storeNames = useMemo(() => new Map((base?.stores ?? []).map((s) => [s.id, s.name])), [base]);
  const ctx = useMemo(
    () => ({ today: day, locale, sep: settings.decimalSeparator, storeName: (id: number | null) => (id === null ? null : (storeNames.get(id) ?? null)) }),
    [day, locale, settings.decimalSeparator, storeNames]
  );

  // Dev timing (A17): the time from the query until the rows are laid out (the list's content-size event).
  const onListLaid = () => {
    if (ordered && ordered.length > 0) {
      const elapsed = elapsedSinceList();
      if (elapsed !== null) setMs(elapsed);
    }
  };

  const open = useCallback(
    (id: number) => {
      markNav();
      router.push({ pathname: '/product/[id]', params: { id: String(id) } });
    },
    [router]
  );
  const toggleFavorite = useCallback(
    (id: number, favorite: boolean) => {
      setProducts((list) => list && list.map((p) => (p.id === id ? { ...p, favorite: favorite ? 1 : 0 } : p)));
      void setFavorite(db, id, favorite).then(() => setVersion((v) => v + 1));
    },
    [db]
  );

  const chip = (id: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={id}
      testID={id}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
      <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, { color: on ? theme.onTint : theme.text }]}>{label}</Text>
    </Pressable>
  );
  const filtered = storeId !== null || category !== null || sort !== 'recent';

  return (
    <View testID="book-screen" style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={styles.top}>
        <View style={styles.searchRow}>
          <TextInput
            testID="book-search"
            value={search}
            onChangeText={setSearch}
            placeholder={strings.book.search}
            placeholderTextColor={theme.textSecondary}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
            style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <Pressable testID="book-scan" accessibilityRole="button" accessibilityLabel={strings.book.scanLabel} onPress={() => router.push({ pathname: '/scan', params: { purpose: 'find' } })} style={[styles.scan, { backgroundColor: theme.backgroundElement }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.scanText, { color: theme.tint }]}>{strings.book.scan}</Text>
          </Pressable>
          <Pressable testID="book-add" accessibilityRole="button" accessibilityLabel={strings.book.add} onPress={() => router.push('/product/edit')} style={[styles.add, { backgroundColor: theme.tint }]}>
            <Text maxFontSizeMultiplier={1.2} style={[styles.addText, { color: theme.onTint }]}>+</Text>
          </Pressable>
        </View>
        <View style={styles.chips}>
          {chip('chip-all', strings.book.all, !favoritesOnly, () => setFavoritesOnly(false))}
          {chip('chip-favourites', strings.book.favourites, favoritesOnly, () => setFavoritesOnly(true))}
          {chip('book-filters', filtered ? `${strings.book.filters} •` : strings.book.filters, filtersOpen, () => setFiltersOpen((o) => !o))}
        </View>
        {filtersOpen ? (
          <View style={styles.filters}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {chip('filter-store-any', strings.book.anyStore, storeId === null, () => setStoreId(null))}
              {(base?.stores ?? []).filter((s) => !s.archived || s.id === storeId).map((s) => chip(`filter-store-${s.id}`, s.name, storeId === s.id, () => setStoreId(s.id)))}
            </ScrollView>
            {(base?.categories.length ?? 0) > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {chip('filter-category-any', strings.book.anyCategory, category === null, () => setCategory(null))}
                {base!.categories.map((c) => chip(`filter-category-${c}`, c, category === c, () => setCategory(c)))}
              </ScrollView>
            ) : null}
            <View style={styles.chips}>
              {chip('sort-recent', strings.book.sortRecent, sort === 'recent', () => setSort('recent'))}
              {chip('sort-name', strings.book.sortName, sort === 'name', () => setSort('name'))}
              {chip('sort-rise', strings.book.sortRise, sort === 'rise', () => setSort('rise'))}
            </View>
          </View>
        ) : null}
      </View>
      {DEBUG_ENABLED && ms !== null ? (
        <Text testID="book-timing" style={[styles.timing, { color: theme.textSecondary }]}>
          {fill(strings.book.timing, { ms, count: ordered?.length ?? 0 })}
        </Text>
      ) : null}
      {DEBUG_ENABLED && pricesMs !== null ? (
        <Text testID="book-timing-prices" style={[styles.timing, { color: theme.textSecondary }]}>
          {fill(strings.book.timingPrices, { ms: pricesMs })}
        </Text>
      ) : null}
      <FlatList
        key={sort}
        testID="book-list"
        data={ordered ?? []}
        keyExtractor={(p) => String(p.id)}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={onListLaid}
        initialNumToRender={12}
        windowSize={7}
        maxToRenderPerBatch={12}
        renderItem={({ item }) => <ProductRow row={buildRowView(item, statsOf(item), ctx)} onPress={open} onToggleFavorite={toggleFavorite} />}
        ListFooterComponent={
          ordered && ordered.length > 0 ? (
            <Text testID="book-basis" style={[styles.basis, { color: theme.textSecondary }]}>{savedBasisText(settings.taxMode)}</Text>
          ) : null
        }
        ListEmptyComponent={
          ordered ? (
            <Text testID="book-empty" style={[styles.empty, { color: theme.textSecondary }]}>
              {search || favoritesOnly || filtered ? strings.book.emptyFilter : strings.book.empty}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { padding: 12, gap: 8 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { flex: 1, minHeight: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  add: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  scan: { minHeight: 44, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  scanText: { fontSize: 16, fontWeight: '700' },
  addText: { fontSize: 28, lineHeight: 30, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filters: { gap: 8 },
  chip: { minHeight: 36, borderRadius: 18, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontWeight: '600' },
  timing: { fontSize: 11, paddingHorizontal: 12 },
  basis: { fontSize: 13, padding: 12 },
  empty: { padding: 24, textAlign: 'center', fontSize: 15 },
});
