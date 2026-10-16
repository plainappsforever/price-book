import { useRouter } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, Text, View } from 'react-native';

import { ClearButton } from '@/components/clear-button';

import { useTheme } from '@/hooks/use-theme';
import { strings } from '@/lib/strings';
import { TaxChip } from '@/components/tax-chip';

function SettingsButton() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable testID="open-settings" accessibilityRole="button" accessibilityLabel={strings.settings.open} hitSlop={{ top: 10, bottom: 10, left: 0, right: 10 }} onPress={() => router.push('/settings')} style={{ paddingHorizontal: 16 }}>
      <Text maxFontSizeMultiplier={1.3} style={{ fontSize: 22, color: theme.tint }}>⚙︎</Text>
    </Pressable>
  );
}

// Two JS tabs (SPEC 2: Compare is the start screen · Price Book). Text-only tab buttons; Settings is a gear in both headers.
export default function TabLayout() {
  const theme = useTheme();
  const tab = { tabBarIcon: () => null, tabBarIconStyle: { display: 'none' as const }, tabBarLabelStyle: { fontSize: 15, fontWeight: '600' as const } };
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        headerRight: () => <SettingsButton />,
        // REVIEW_V1 S5: the header has a fixed height; at the largest text size the scaled title ran into the buttons.
        headerTitleAllowFontScaling: false,
      }}>
      <Tabs.Screen
        name="compare"
        options={{
          ...tab,
          title: strings.tabs.compare,
          tabBarButtonTestID: 'tab-compare',
          headerLeft: () => <TaxChip />,
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ClearButton />
              <SettingsButton />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="book" options={{ ...tab, title: strings.tabs.book, tabBarButtonTestID: 'tab-book' }} />
    </Tabs>
  );
}
