// Product (SPEC 2.3, U6): tiles Latest · Lowest · Usual · Highest, gauge bar, shrinkflation banners, store table, chart,
// price list (tap to edit) and "Add price". Everything is computed from the product's prices by the engine (src/engine/stats.ts).
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { UnitPriceText } from '@/components/unit-price-text';
import { GaugeBar } from '@/components/gauge-bar';
import { PriceChart } from '@/components/price-chart';
import { Button } from '@/components/button';
import { listObservations, toPriceObservation } from '@/db/observations';
import { listBarcodes } from '@/db/barcodes';
import { getProduct, setFavorite } from '@/db/products';
import { displayBarcode } from '@/engine/barcode';
import { listStores } from '@/db/stores';
import type { ObservationRecord, ProductRecord, StoreRecord } from '@/engine/backup';
import { isDimension } from '@/engine/units';
import { useTheme } from '@/hooks/use-theme';
import { computeRowStats } from '@/lib/book-view';
import { DEBUG_ENABLED } from '@/lib/debug';
import { displayLocale, fill, savedBasisText, unitPriceLine } from '@/lib/format';
import { elapsedSinceNav } from '@/lib/nav-mark';
import { buildBanners, buildGaugeBar, buildPriceLines, buildStoreTable, buildTiles, chartSummary } from '@/lib/product-view';
import { deviceLocaleTag, useAppSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';
import { today } from '@/lib/today';

type Loaded = { product: ProductRecord | null; rows: ObservationRecord[]; stores: StoreRecord[] ; barcodes: string[] };

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const productId = Number(id);
  const db = useSQLiteContext();
  const router = useRouter();
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const [shown, setShown] = useState(PAGE);
  const settings = useAppSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  const load = useCallback(() => {
    let alive = true;
    (async () => {
      const product = await getProduct(db, productId);
      const rows = product ? await listObservations(db, productId) : [];
      const stores = await listStores(db, { includeArchived: true });
      const barcodes = product ? await listBarcodes(db, productId) : [];
      if (alive) setLoaded({ product, rows, stores, barcodes });
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [db, productId]);
  useFocusEffect(load);

  const day = today();
  const locale = useMemo(() => displayLocale(deviceLocaleTag(), settings.decimalSeparator), [settings.decimalSeparator]);
  const product = loaded?.product ?? null;
  const rs = useMemo(
    () => (product && loaded ? computeRowStats(loaded.rows.map(toPriceObservation), isDimension(product.dimension) ? product.dimension : 'mass', day, settings) : null),
    [product, loaded, day, settings]
  );
  const view = useMemo(() => {
    if (!rs || !loaded) return null;
    const names = new Map(loaded.stores.map((s) => [s.id, s.name]));
    const ctx = { today: day, locale, sep: settings.decimalSeparator, taxAdded: settings.taxMode === 'add', storeName: (sid: number | null) => (sid === null ? null : (names.get(sid) ?? null)) };
    const stats = rs.stats;
    return {
      ctx,
      tiles: buildTiles(stats, ctx),
      gauge: buildGaugeBar(stats, rs.gauge, ctx),
      banners: buildBanners(stats, ctx),
      stores: buildStoreTable(stats, ctx),
      lines: buildPriceLines(loaded.rows, stats, ctx),
      chart: stats.chart
        ? {
            data: stats.chart,
            summary: chartSummary(stats, ctx) ?? '',
            names: stats.chart.series.map((s) => ctx.storeName(s.storeId) ?? strings.stores.noStore),
            // high / low under the chart come from the statistics, not from the gauge (empty while "building", RELEASE_KIT 1c item 17)
            highLabel: stats.highest ? unitPriceLine(stats.highest.unitPrice, stats.basis, { currency: stats.currency, locale, sep: settings.decimalSeparator, unitDecimals: stats.decimals }) : '',
            lowLabel: stats.lowest ? unitPriceLine(stats.lowest.unitPrice, stats.basis, { currency: stats.currency, locale, sep: settings.decimalSeparator, unitDecimals: stats.decimals }) : '',
          }
        : null,
    };
  }, [rs, loaded, day, locale, settings.decimalSeparator, settings.taxMode]);

  // Dev timing (A17): the tap on the row until the tiles are laid out.
  const onTilesLaid = () => setMs((previous) => previous ?? elapsedSinceNav());

  if (!loaded) return <View testID="product-screen" style={[styles.screen, { backgroundColor: theme.background }]} />;
  if (!product || !rs || !view) {
    return (
      <View testID="product-screen" style={[styles.screen, { backgroundColor: theme.background, padding: 24 }]}>
        <Text style={{ color: theme.text }}>{strings.product.missing}</Text>
      </View>
    );
  }
  const stats = rs.stats;
  const star = product.favorite === 1;
  const toggleStar = async () => {
    await setFavorite(db, product.id, !star);
    setLoaded({ ...loaded, product: { ...product, favorite: star ? 0 : 1 } });
  };
  const sub = [product.brand, product.variant, product.category].filter(Boolean).join(' · ');

  return (
    <ScrollView testID="product-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: product.name, headerRight: () => (
        <View style={styles.headerRight}>
          <Pressable testID="product-star" accessibilityRole="button" accessibilityLabel={star ? strings.book.unfavourite : strings.book.favourite} accessibilityState={{ selected: star }} onPress={toggleStar} hitSlop={8}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 24, color: star ? theme.tint : theme.textSecondary }}>{star ? '★' : '☆'}</Text>
          </Pressable>
          <Pressable testID="product-edit" accessibilityRole="button" onPress={() => router.push({ pathname: '/product/edit', params: { id: String(product.id) } })} hitSlop={8}>
            <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 16, fontWeight: '600', color: theme.tint }}>{strings.product.edit}</Text>
          </Pressable>
        </View>
      ) }} />
      <Text testID="product-title" style={[styles.title, { color: theme.text }]}>{product.name}</Text>
      {sub ? <Text style={[styles.sub, { color: theme.textSecondary }]}>{sub}</Text> : null}
      {loaded.barcodes.length > 0 ? (
        <Text testID="product-barcodes" style={[styles.small, { color: theme.textSecondary }]}>
          {fill(strings.product.barcodes, { codes: loaded.barcodes.map(displayBarcode).join(', ') })}
        </Text>
      ) : null}
      {DEBUG_ENABLED && ms !== null ? <Text testID="product-timing" style={[styles.small, { color: theme.textSecondary }]}>{fill(strings.product.timing, { ms })}</Text> : null}

      <Button testID="product-add-price" label={strings.product.addPrice} onPress={() => router.push({ pathname: '/price/edit', params: { productId: String(product.id) } })} />

      {stats.count === 0 ? (
        <Text testID="product-empty" style={[styles.sub, { color: theme.textSecondary }]}>{stats.otherCurrencyCount > 0 ? fill(strings.product.otherCurrency, { n: stats.otherCurrencyCount }) : strings.product.noPrices}</Text>
      ) : (
        <>
          <View style={styles.tiles} onLayout={onTilesLaid}>
            {view.tiles.map((t) => (
              <View key={t.id} testID={`tile-${t.id}-box`} style={[styles.tile, fontScale > 1.5 && styles.tileWide, { backgroundColor: theme.backgroundElement }]}>
                <Text style={[styles.tileLabel, { color: theme.textSecondary }]}>{t.label}{t.promo ? `  ${strings.product.promo}` : ''}</Text>
                {t.id === 'usual' ? (
                  <>
                    <UnitPriceText testID="tile-usual" style={[styles.tileUnit, { color: theme.text }]} text={t.unit} />
                    <Text testID="tile-usual-note" style={[styles.small, { color: theme.textSecondary }]}>{t.detail}</Text>
                  </>
                ) : (
                  <>
                    <UnitPriceText testID={`tile-${t.id}`} style={[styles.tileUnit, { color: theme.text }]} text={t.unit} />
                    <Text testID={`tile-${t.id}-detail`} style={[styles.small, { color: theme.textSecondary }]}>{t.detail}</Text>
                  </>
                )}
              </View>
            ))}
          </View>
          <Text testID="product-basis" style={[styles.small, { color: theme.textSecondary }]}>{savedBasisText(settings.taxMode)}</Text>
          {stats.otherCurrencyCount > 0 ? <Text style={[styles.small, { color: theme.textSecondary }]}>{fill(strings.product.otherCurrency, { n: stats.otherCurrencyCount })}</Text> : null}
          {view.gauge ? <GaugeBar view={view.gauge} /> : null}
        </>
      )}

      {view.banners.map((b, i) => (
        <View key={i} testID={`banner-${i}`} style={[styles.banner, { backgroundColor: b.shrink ? theme.backgroundSelected : theme.backgroundElement, borderColor: b.shrink ? theme.danger : theme.backgroundSelected }]}>
          <Text testID={`banner-${i}-text`} style={[styles.bannerText, { color: b.shrink ? theme.danger : theme.text }]}>{b.headline}</Text>
          <Text style={[styles.small, { color: theme.textSecondary }]}>{b.detail}</Text>
        </View>
      ))}

      {view.stores.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{strings.product.stores}</Text>
          {view.stores.map((s) => (
            <View key={s.key} testID={`store-row-${s.key}`} style={[styles.storeRow, { borderBottomColor: theme.backgroundSelected }]}>
              <Text style={[styles.storeName, { color: theme.text }]}>{s.name}</Text>
              <Text testID={`store-latest-${s.key}`} style={[styles.small, { color: theme.text }]}>{fill(strings.product.storeLatest, { latest: s.latest })}</Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>{fill(strings.product.storeLowest, { lowest: s.lowest, count: s.count })}</Text>
              {s.stale ? <Text testID={`store-stale-${s.key}`} style={[styles.small, { color: theme.danger }]}>{s.stale}</Text> : null}
              {s.cheapest ? <Text testID={`store-cheapest-${s.key}`} style={[styles.badge, { backgroundColor: theme.tint, color: theme.onTint }]}>{strings.product.lastSeenCheapest}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}

      {view.chart ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>{strings.product.chart}</Text>
          <PriceChart chart={view.chart.data} storeNames={view.chart.names} summary={view.chart.summary} lowLabel={view.chart.lowLabel} highLabel={view.chart.highLabel} />
          <Text testID="chart-summary" style={[styles.small, { color: theme.textSecondary }]}>{view.chart.summary}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{fill(strings.product.priceList, { count: view.lines.length })}</Text>
        {view.lines.slice(0, shown).map((l) => (
          <Pressable key={l.id} testID={`price-row-${l.id}`} accessibilityRole="button" onPress={() => router.push({ pathname: '/price/edit', params: { productId: String(product.id), id: String(l.id) } })} style={[styles.line, { borderBottomColor: theme.backgroundSelected }]}>
            <Text style={[styles.lineMain, { color: theme.text }]}>
              {l.date} · {l.store}{l.promo ? `  ${strings.product.promo}` : ''}
            </Text>
            <Text style={[styles.small, { color: theme.text }]}>
              {l.pack} · {l.size}{l.unit ? ` · ${l.unit}` : ''}{l.other ? ` · ${strings.product.otherCurrencyTag}` : ''}
            </Text>
            {l.deal ? <Text style={[styles.small, { color: theme.textSecondary }]}>{l.deal}</Text> : null}
            {l.note ? <Text style={[styles.small, { color: theme.textSecondary }]}>{l.note}</Text> : null}
          </Pressable>
        ))}
        {view.lines.length > shown ? (
          <Button testID="product-more-prices" variant="secondary" label={fill(strings.product.showMore, { n: Math.min(PAGE, view.lines.length - shown) })} onPress={() => setShown((n) => n + PAGE)} />
        ) : null}
      </View>
    </ScrollView>
  );
}

/** REVIEW_V1 N8: years of a staple can be thousands of prices; the list shows them in pages (the statistics use all). */
const PAGE = 50;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 15 },
  small: { fontSize: 13, lineHeight: 18 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', borderRadius: 12, padding: 10, gap: 2 },
  tileWide: { flexBasis: '100%' },
  tileLabel: { fontSize: 13, fontWeight: '600' },
  tileUnit: { fontSize: 20, fontWeight: '700' },
  banner: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
  bannerText: { fontSize: 16, fontWeight: '700' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  storeRow: { paddingVertical: 8, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  storeName: { fontSize: 16, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  line: { paddingVertical: 8, gap: 2, borderBottomWidth: StyleSheet.hairlineWidth },
  lineMain: { fontSize: 15, fontWeight: '600' },
});
