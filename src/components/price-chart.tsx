// Unit price over time (SPEC 2.3): one colour per store, plain Views (D22), no chart library. x = date between the
// first and the last price, y = between the lowest (bottom) and highest (top). The chart has a text summary
// for screen readers and a store legend; it is decoration, the numbers are in the tiles and the price list.
import { StyleSheet, Text, View } from 'react-native';

import type { ChartData } from '@/engine/stats';
import { useTheme } from '@/hooks/use-theme';
import { seriesColor } from '@/lib/product-view';

type Props = { chart: ChartData; storeNames: (string | null)[]; summary: string; lowLabel: string; highLabel: string };

const HEIGHT = 140;

export function PriceChart({ chart, storeNames, summary, lowLabel, highLabel }: Props) {
  const theme = useTheme();
  return (
    <View testID="price-chart" accessible accessibilityLabel={summary} style={styles.box}>
      <View style={[styles.plot, { backgroundColor: theme.backgroundElement }]}>
        {/* dots are placed inside an inset area so the lowest / highest / first / last ones are not cut by the edge */}
        <View style={styles.inset}>
        {chart.series.map((s, si) =>
          s.points.map((p) => (
            <View
              key={p.id}
              style={[
                styles.dot,
                {
                  left: `${p.xPermille / 10}%`,
                  top: `${(1000 - p.yPermille) / 10}%`,
                  backgroundColor: seriesColor(si),
                  borderRadius: p.isPromo ? 2 : 6,
                },
              ]}
            />
          ))
        )}
        </View>
      </View>
      <View style={styles.row}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{chart.firstDay}</Text>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{chart.lastDay}</Text>
      </View>
      {highLabel && lowLabel ? (
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          {highLabel} · {lowLabel}
        </Text>
      ) : null}
      <View style={styles.legend}>
        {chart.series.map((s, si) => (
          <View key={String(s.storeId ?? 'none')} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: seriesColor(si) }]} />
            <Text style={[styles.label, { color: theme.text }]}>{storeNames[si] ?? ''}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 4 },
  plot: { height: HEIGHT, borderRadius: 10, marginHorizontal: 6 },
  inset: { position: 'absolute', top: 10, bottom: 10, left: 10, right: 10 },
  dot: { position: 'absolute', width: 12, height: 12, marginLeft: -6, marginTop: -6 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 12 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
});
