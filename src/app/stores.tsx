// Stores (SPEC 2, 7): add, rename, archive (hidden from the chips, prices kept), delete (its prices stay as "No store";
// second tap confirms and shows the count).
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LabeledInput } from '@/components/labeled-input';
import { countStorePrices, createStore, deleteStore, listStores, renameStore, setStoreArchived, type StoreResult } from '@/db/stores';
import type { StoreRecord } from '@/engine/backup';
import { useTheme } from '@/hooks/use-theme';
import { fill } from '@/lib/format';
import { strings } from '@/lib/strings';

type Row = StoreRecord & { prices: number };

const message = (r: StoreResult): string | null =>
  r.ok ? null : r.error === 'duplicate' ? strings.stores.duplicate : r.error === 'empty' ? strings.stores.empty : strings.stores.notFound;

export default function StoresScreen() {
  const db = useSQLiteContext();
  const theme = useTheme();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<Row[]> => {
    const stores = await listStores(db, { includeArchived: true });
    return Promise.all(stores.map(async (s) => ({ ...s, prices: await countStorePrices(db, s.id) })));
  }, [db]);
  const reload = async () => setRows(await load());
  useEffect(() => {
    let alive = true;
    load()
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [load]);

  const add = async () => {
    Keyboard.dismiss();
    const r = await createStore(db, newName);
    setError(message(r));
    if (r.ok) {
      setNewName('');
      await reload();
    }
  };
  const rename = async (id: number) => {
    Keyboard.dismiss();
    const r = await renameStore(db, id, editName);
    setError(message(r));
    if (r.ok) {
      setEditing(null);
      await reload();
    }
  };
  const button = (testID: string, label: string, onPress: () => void, danger = false) => (
    <Pressable key={testID} testID={testID} accessibilityRole="button" onPress={() => { Keyboard.dismiss(); onPress(); }} style={[styles.button, { backgroundColor: theme.backgroundSelected }]}>
      <Text style={{ color: danger ? theme.danger : theme.tint, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );

  return (
    <ScrollView testID="stores-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.newRow}>
        <View style={{ flex: 1 }}>
          <LabeledInput testID="stores-new" label={strings.stores.newStore} value={newName} onChangeText={(t) => { setNewName(t); setError(null); }} placeholder={strings.stores.namePlaceholder} autoCapitalize="words" returnKeyType="done" onSubmitEditing={add} />
        </View>
        <Pressable testID="stores-add" accessibilityRole="button" onPress={add} style={[styles.addButton, { backgroundColor: theme.tint }]}>
          <Text style={{ color: theme.onTint, fontWeight: '700', fontSize: 15 }}>{strings.stores.add}</Text>
        </Pressable>
      </View>
      {error ? <Text testID="stores-error" style={{ color: theme.danger }}>{error}</Text> : null}
      {rows && rows.length === 0 ? <Text testID="stores-empty" style={{ color: theme.textSecondary }}>{strings.stores.noneYet}</Text> : null}
      {(rows ?? []).map((s) => (
        <View key={s.id} testID={`store-${s.id}`} style={[styles.row, { borderBottomColor: theme.backgroundSelected }]}>
          {editing === s.id ? (
            <View style={styles.newRow}>
              <TextInput testID={`store-edit-${s.id}`} value={editName} onChangeText={(t) => { setEditName(t); setError(null); }} autoFocus autoCapitalize="words" onSubmitEditing={() => rename(s.id)} style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]} />
              {button(`store-save-${s.id}`, strings.stores.save, () => rename(s.id))}
            </View>
          ) : (
            <>
              <Text style={[styles.name, { color: theme.text }]}>{s.name}{s.archived ? `  ${strings.stores.archivedTag}` : ''}</Text>
              <Text testID={`store-count-${s.id}`} style={{ color: theme.textSecondary, fontSize: 13 }}>{fill(s.prices === 1 ? strings.book.onePrice : strings.book.prices, { count: s.prices })}</Text>
              <View style={styles.buttons}>
                {button(`store-rename-${s.id}`, strings.stores.rename, () => { setEditing(s.id); setEditName(s.name); setError(null); })}
                {button(`store-archive-${s.id}`, s.archived ? strings.stores.unarchive : strings.stores.archive, async () => { await setStoreArchived(db, s.id, !s.archived); await reload(); })}
                {button(
                  `store-delete-${s.id}`,
                  confirmDelete === s.id ? fill(s.prices === 1 ? strings.stores.deleteConfirmOne : strings.stores.deleteConfirm, { count: s.prices }) : strings.stores.delete,
                  async () => {
                    if (confirmDelete !== s.id) return setConfirmDelete(s.id);
                    await deleteStore(db, s.id);
                    setConfirmDelete(null);
                    await reload();
                  },
                  true
                )}
              </View>
            </>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  newRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  addButton: { minHeight: 46, borderRadius: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  row: { gap: 4, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 17, fontWeight: '600' },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  button: { minHeight: 36, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
});
