// One Price Book row (SPEC 2.2): name, brand/variant, latest unit price with store and relative date, gauge chip,
// shrinkflation mark, star.
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { RowView } from '@/lib/book-view';
import { strings } from '@/lib/strings';

type Props = { row: RowView; onPress: (id: number) => void; onToggleFavorite: (id: number, favorite: boolean) => void };

function ProductRowBase({ row, onPress, onToggleFavorite }: Props) {
  const theme = useTheme();
  const chipColor = row.chip?.verdict === 'good' || row.chip?.verdict === 'lowest' ? '#2B8A3E' : row.chip?.verdict === 'above' || row.chip?.verdict === 'highest' ? theme.danger : theme.textSecondary;
  return (
    <View style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}>
      <Pressable testID={`product-${row.id}`} accessibilityRole="button" onPress={() => onPress(row.id)} style={styles.main}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: theme.text }]}>
            {row.title}
          </Text>
          {row.shrink ? (
            <Text testID={`shrink-${row.id}`} style={[styles.shrink, { color: theme.danger, borderColor: theme.danger }]}>
              {strings.book.shrinkMark}
            </Text>
          ) : null}
        </View>
        {row.subtitle ? <Text style={[styles.meta, { color: theme.textSecondary }]}>{row.subtitle}</Text> : null}
        {row.priceLine ? (
          <Text testID={`price-${row.id}`} style={[styles.price, { color: theme.text }]}>
            {row.priceLine}
            {row.whereWhen ? <Text style={[styles.meta, { color: theme.textSecondary }]}>{`  ${row.whereWhen}`}</Text> : null}
          </Text>
        ) : (
          <Text style={[styles.meta, { color: theme.textSecondary }]}>{row.countText}</Text>
        )}
        {row.chip ? (
          <Text testID={`chip-${row.id}`} style={[styles.chip, { color: chipColor, borderColor: chipColor }]}>
            {row.chip.text}
          </Text>
        ) : null}
      </Pressable>
      <Pressable
        testID={`star-${row.id}`}
        accessibilityRole="button"
        accessibilityLabel={row.favorite ? strings.book.unfavourite : strings.book.favourite}
        accessibilityState={{ selected: row.favorite }}
        hitSlop={8}
        onPress={() => onToggleFavorite(row.id, !row.favorite)}
        style={styles.star}>
        <Text style={{ fontSize: 24, color: row.favorite ? theme.tint : theme.textSecondary }}>{row.favorite ? '★' : '☆'}</Text>
      </Pressable>
    </View>
  );
}

export const ProductRow = memo(ProductRowBase);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  main: { flex: 1, paddingVertical: 10, paddingLeft: 16, gap: 2 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, fontWeight: '600' },
  shrink: { fontSize: 11, fontWeight: '700', borderWidth: 1, borderRadius: 6, paddingHorizontal: 5, overflow: 'hidden' },
  meta: { fontSize: 13, fontWeight: '400' },
  price: { fontSize: 15, fontWeight: '600' },
  chip: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden', marginTop: 2 },
  star: { paddingHorizontal: 16, paddingVertical: 12, minWidth: 56, alignItems: 'center' },
});
