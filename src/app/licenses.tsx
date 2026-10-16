// Open-source licence notices (RELEASE_KIT 1c item 14), from src/constants/licenses.json (scripts/gen-licenses.js):
// every package with its version, SPDX licence id and copyright lines, then the distinct licence texts. Offline.
import { FlatList, StyleSheet, Text, View } from 'react-native';

import licenses from '@/constants/licenses.json';
import { useTheme } from '@/hooks/use-theme';
import { fill } from '@/lib/format';
import { strings } from '@/lib/strings';

type Pkg = { n: string; v: string; l: string; c: string[]; t: number };
type Row = { kind: 'pkg'; key: string; pkg: Pkg } | { kind: 'text'; key: string; index: number; text: string } | { kind: 'heading'; key: string };

const ROWS: Row[] = [
  ...(licenses.packages as Pkg[]).map((pkg) => ({ kind: 'pkg' as const, key: `p-${pkg.n}@${pkg.v}`, pkg })),
  { kind: 'heading' as const, key: 'h-texts' },
  ...licenses.texts.map((text, index) => ({ kind: 'text' as const, key: `t-${index}`, index, text })),
];

export default function LicensesScreen() {
  const theme = useTheme();
  return (
    <FlatList
      testID="licenses-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      data={ROWS}
      keyExtractor={(r) => r.key}
      initialNumToRender={20}
      ListHeaderComponent={<Text style={[styles.intro, { color: theme.text }]}>{strings.licenses.intro}</Text>}
      renderItem={({ item }) => {
        if (item.kind === 'heading') return <Text style={[styles.heading, { color: theme.text }]}>{strings.licenses.texts}</Text>;
        if (item.kind === 'text') {
          return (
            <View style={[styles.box, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.name, { color: theme.text }]}>{fill(strings.licenses.textNumber, { n: item.index + 1 })}</Text>
              <Text style={[styles.small, { color: theme.textSecondary }]}>{item.text}</Text>
            </View>
          );
        }
        const p = item.pkg;
        return (
          <View style={[styles.line, { borderBottomColor: theme.backgroundSelected }]}>
            <Text style={[styles.name, { color: theme.text }]}>
              {p.n} {p.v}
            </Text>
            <Text style={[styles.small, { color: theme.textSecondary }]}>
              {p.l}
              {p.t >= 0 ? ` · ${fill(strings.licenses.see, { n: p.t + 1 })}` : ''}
            </Text>
            {p.c.map((c) => (
              <Text key={c} style={[styles.small, { color: theme.textSecondary }]}>
                {c}
              </Text>
            ))}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 4, paddingBottom: 48 },
  intro: { fontSize: 15, marginBottom: 8 },
  heading: { fontSize: 17, fontWeight: '700', marginTop: 16, marginBottom: 4 },
  line: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 12, lineHeight: 16 },
  box: { borderRadius: 10, padding: 10, gap: 4, marginBottom: 8 },
});
