// About (SPEC 2, 8): privacy statement, the promotion order, version. Dev builds add the engine self-test line
// (P4: proves the exact BigInt engine on Hermes; Maestro asserts "engine OK").
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMemo } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { runEngineSelfTest } from '@/debug/engine-selftest';
import { useTheme } from '@/hooks/use-theme';
import { DEBUG_ENABLED } from '@/lib/debug';
import { PRIVACY_POLICY_URL } from '@/lib/links';
import { strings } from '@/lib/strings';

export default function AboutScreen() {
  const theme = useTheme();
  const router = useRouter();
  const checks = useMemo(() => (DEBUG_ENABLED ? runEngineSelfTest() : []), []);
  const ok = checks.length > 0 && checks.every((c) => c.ok);
  return (
    <ScrollView testID="about-screen" style={{ backgroundColor: theme.background }} contentContainerStyle={styles.content}>
      <ThemedText testID="about-privacy">{Platform.OS === 'ios' ? strings.about.privacyIos : strings.about.privacyAndroid}</ThemedText>
      <Pressable testID="about-privacy-link" accessibilityRole="link" onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL).catch(() => undefined)} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText themeColor="tint">{strings.about.privacyLink}</ThemedText>
      </Pressable>
      <Pressable testID="about-licenses" accessibilityRole="button" onPress={() => router.push('/licenses')} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText themeColor="tint">{strings.about.licenses}</ThemedText>
      </Pressable>
      <ThemedText>{strings.about.order}</ThemedText>
      <ThemedText testID="about-version" type="small" themeColor="textSecondary">
        {strings.settings.version} {Constants.expoConfig?.version}
      </ThemedText>
      {DEBUG_ENABLED ? (
        <>
          <ThemedText type="smallBold" style={styles.section}>
            {strings.about.selfTest}
          </ThemedText>
          <Text testID="engine-selftest" style={[styles.result, { color: ok ? theme.text : theme.danger }]}>
            {ok ? strings.about.selfTestOk : strings.about.selfTestFail}
          </Text>
          {checks.map((c) => (
            <Text key={c.name} style={[styles.line, { color: c.ok ? theme.textSecondary : theme.danger }]}>
              {c.ok ? '✓' : '✗'} {c.name}: {c.detail}
            </Text>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.three },
  section: { marginTop: Spacing.three },
  row: { minHeight: 48, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  result: { fontSize: 18, fontWeight: '700' },
  line: { fontSize: 13 },
});
