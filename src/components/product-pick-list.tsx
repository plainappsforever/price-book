// Search + product list for picking a product (Compare card link, scan "add it to a product"). Rows: pick-<id>.
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { listProducts, type ProductListRow } from '@/db/products';
import { useTheme } from '@/hooks/use-theme';
import { fill } from '@/lib/format';
import { strings } from '@/lib/strings';

export function ProductPickList({ onPick, header }: { onPick: (row: ProductListRow) => void; header?: React.ReactElement | null }) {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<ProductListRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    listProducts(db, { search, sort: 'name' })
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [db, search]);

  return (
    <View style={styles.screen}>
      {header ?? null}
      <TextInput
        testID="pick-search"
        value={search}
        onChangeText={setSearch}
        placeholder={strings.picker.search}
        placeholderTextColor={theme.textSecondary}
        autoCorrect={false}
        style={[styles.search, { color: theme.text, backgroundColor: theme.backgroundElement }]}
      />
      <FlatList
        data={rows ?? []}
        keyExtractor={(r) => String(r.id)}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={rows ? <Text style={[styles.empty, { color: theme.textSecondary }]}>{strings.picker.empty}</Text> : null}
        renderItem={({ item }) => (
          <Pressable testID={`pick-${item.id}`} onPress={() => onPick(item)} style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}>
            <Text style={[styles.name, { color: theme.text }]}>{item.name}</Text>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              {[item.brand, item.variant].filter(Boolean).join(' · ')} {fill(strings.picker.prices, { count: item.price_count })}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { margin: 12, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
  row: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 17, fontWeight: '600' },
  meta: { fontSize: 13 },
  empty: { padding: 24, textAlign: 'center' },
});
