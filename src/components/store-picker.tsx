// Store chips for the add-price sheet and the Save sheet (SPEC 2.4): the 4 most recent stores, "Other…" for the rest,
// "New store" for a name that does not exist yet. Tapping the chosen store again clears it (price without a store).
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { StoreRecord } from '@/engine/backup';
import { useTheme } from '@/hooks/use-theme';
import { strings } from '@/lib/strings';

type Props = {
  recent: StoreRecord[];
  all: StoreRecord[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Creates (or finds) the store and returns its id, or null when the name is empty. */
  onCreate: (name: string) => Promise<number | null>;
};

export function StorePicker({ recent, all, selectedId, onSelect, onCreate }: Props) {
  const theme = useTheme();
  const [other, setOther] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const shown = [...recent];
  const selected = all.find((s) => s.id === selectedId);
  if (selected && !shown.some((s) => s.id === selected.id)) shown.push(selected);
  const rest = all.filter((s) => !shown.some((r) => r.id === s.id));

  const chip = (key: string, id: string, label: string, on: boolean, onPress: () => void, tint = false) => (
    <Pressable
      key={key}
      testID={id}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: on ? theme.tint : theme.backgroundElement }]}>
      <Text style={[styles.chipText, { color: on ? theme.onTint : tint ? theme.tint : theme.text }]}>{label}</Text>
    </Pressable>
  );
  const pick = (s: StoreRecord) => () => onSelect(s.id === selectedId ? null : s.id);
  const create = async () => {
    const id = await onCreate(name);
    if (id !== null) {
      onSelect(id);
      setName('');
      setAdding(false);
    }
  };

  return (
    <View style={styles.box}>
      <View style={styles.wrap}>
        {shown.map((s) => chip(`s${s.id}`, `store-chip-${s.id}`, s.name, s.id === selectedId, pick(s)))}
        {rest.length > 0 ? chip('other', 'store-other', strings.stores.other, other, () => setOther((o) => !o), true) : null}
        {chip('new', 'store-new', strings.stores.newStore, adding, () => setAdding((a) => !a), true)}
      </View>
      {other ? <View style={styles.wrap}>{rest.map((s) => chip(`o${s.id}`, `store-chip-${s.id}`, s.name, s.id === selectedId, pick(s)))}</View> : null}
      {adding ? (
        <View style={styles.newRow}>
          <TextInput
            testID="store-new-input"
            value={name}
            onChangeText={setName}
            placeholder={strings.stores.namePlaceholder}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={create}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />
          <Pressable testID="store-new-add" accessibilityRole="button" onPress={create} style={[styles.chip, { backgroundColor: theme.tint }]}>
            <Text style={[styles.chipText, { color: theme.onTint }]}>{strings.stores.add}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 38, borderRadius: 19, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 15, fontWeight: '600' },
  newRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, minHeight: 44, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
});
