import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { getLocales } from 'expo-localization';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { useColorScheme } from 'react-native';

import { migrate } from '@/db/migrations';
import { getThemePreference } from '@/db/settings';
import { chipUnits } from '@/engine/units';
import { loadDraft } from '@/lib/compare-store';
import { applyLocaleDefaults, type LocaleLike } from '@/lib/locale-defaults';
import { loadSettings } from '@/lib/settings-store';
import { strings } from '@/lib/strings';
import { applyThemePreference } from '@/lib/theme-preference';

async function initDatabase(db: SQLiteDatabase) {
  await migrate(db);
  // First launch only: currency, number format, units, tax mode from the phone (D38); then the user owns them.
  let locales: LocaleLike[] = [];
  try {
    locales = getLocales();
  } catch {
    locales = [];
  }
  await applyLocaleDefaults(db, locales);
  applyThemePreference(await getThemePreference(db));
  const settings = await loadSettings(db);
  await loadDraft(db, chipUnits(settings.unitSystem)[0]);
}

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="pricebook.db" onInit={initDatabase}>
      <Navigator />
    </SQLiteProvider>
  );
}

function Navigator() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: strings.home.title }} />
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: strings.settings.title }} />
        <Stack.Screen name="about" options={{ title: strings.about.title }} />
        <Stack.Screen name="licenses" options={{ title: strings.licenses.title }} />
        <Stack.Screen name="deal-sheet" options={{ title: strings.deals.title, presentation: 'modal' }} />
        <Stack.Screen name="tax" options={{ title: strings.tax.title, presentation: 'modal' }} />
        <Stack.Screen name="units" options={{ title: strings.unitsSheet.title, presentation: 'modal' }} />
        <Stack.Screen name="pick-product" options={{ title: strings.picker.title, presentation: 'modal' }} />
        <Stack.Screen name="scan" options={{ title: strings.scan.title }} />
        <Stack.Screen name="product/[id]" options={{ title: '', headerBackTitle: strings.tabs.book }} />
        <Stack.Screen name="product/edit" options={{ title: strings.productEdit.titleNew }} />
        <Stack.Screen name="price/edit" options={{ title: strings.price.titleNew }} />
        <Stack.Screen name="stores" options={{ title: strings.stores.title }} />
        <Stack.Screen name="data" options={{ title: strings.data.title }} />
        <Stack.Screen name="save-sheet" options={{ title: strings.save.open, presentation: 'modal' }} />
        <Stack.Screen name="debug/seed" options={{ headerShown: false }} />
        <Stack.Screen name="debug/scan" options={{ headerShown: false }} />
        <Stack.Screen name="debug/db-probe" options={{ title: strings.debug.probeTitle }} />
      </Stack>
    </ThemeProvider>
  );
}
