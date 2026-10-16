// Gauge bar of the Product screen (SPEC 2.3): lowest -> highest, the usual price as a tick, the latest price as a dot.
// Plain Views (D22); the verdict is always also text.
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { GaugeBarView } from '@/lib/product-view';
import { strings } from '@/lib/strings';

export function GaugeBar({ view }: { view: GaugeBarView }) {
  const theme = useTheme();
  const bar = view.usualPermille === null ? null : view;
  return (
    <View testID="gauge-bar" style={styles.box}>
      <Text testID="gauge-bar-text" style={[styles.text, { color: theme.text }]}>
        {strings.product.latestVerdict} {view.text}
      </Text>
      {bar ? (
        <>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.tick, { left: `${bar.usualPermille / 10}%`, backgroundColor: theme.text }]} />
            <View style={[styles.dot, { left: `${bar.latestPermille / 10}%`, backgroundColor: theme.tint, borderColor: theme.background }]} />
          </View>
          <View style={styles.labels}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>{bar.lowLabel}</Text>
            <Text style={[styles.label, { color: theme.textSecondary }]}>{bar.highLabel}</Text>
          </View>
          <Text style={[styles.label, { color: theme.textSecondary }]}>{strings.product.gaugeLegend}</Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  text: { fontSize: 15, fontWeight: '600' },
  track: { height: 10, borderRadius: 5, marginHorizontal: 8, justifyContent: 'center' },
  tick: { position: 'absolute', width: 3, height: 22, top: -6, marginLeft: -1 },
  dot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, top: -4, marginLeft: -9, borderWidth: 2 },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontSize: 12 },
});
