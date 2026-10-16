// Locale defaults (SPEC 5.2, D14, D15, A12), applied once at first launch into settings; after that the
// settings belong to the user. Pure: takes the array `getLocales()` from expo-localization returns, so it
// is tested without the package (P4 installs expo-localization and passes `getLocales()` in).
import { getSetting, setSetting } from '@/db/settings';
import { inTransaction } from '@/db/tx';
import type { Db } from '@/db/types';
import type { TaxMode } from '@/engine/deals';
import { defaultBasis, DIMENSIONS, type BasisId, type Dimension, type MeasurementSystem } from '@/engine/units';

/** The fields of expo-localization's `Locale` this app reads (all may be null on some devices). */
export type LocaleLike = {
  languageTag: string;
  regionCode?: string | null;
  currencyCode?: string | null;
  decimalSeparator?: string | null;
  measurementSystem?: 'metric' | 'us' | 'uk' | null;
};

export type LocaleDefaults = {
  currency: string;
  decimalSeparator: '.' | ',';
  unitSystem: MeasurementSystem;
  bases: Record<Dimension, BasisId>;
  taxMode: TaxMode;
};

/** Shelf prices exclude sales tax in the US and Canada (tax added at the till); elsewhere they include it (D14). */
const ADD_TAX_REGIONS = ['US', 'CA'];
/** Fallback when the OS gives no measurement system: US customary in the US, Liberia and Myanmar; UK in GB. */
const US_REGIONS = ['US', 'LR', 'MM'];
const FALLBACK_CURRENCY = 'EUR';

function regionOf(locale: LocaleLike): string | null {
  if (locale.regionCode) return locale.regionCode.toUpperCase();
  const m = /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2}|\d{3})\b/i.exec(locale.languageTag);
  return m ? m[1].toUpperCase() : null;
}

export function localeDefaults(locales: readonly LocaleLike[]): LocaleDefaults {
  const locale = locales[0] ?? { languageTag: 'en' };
  const region = regionOf(locale);
  const unitSystem: MeasurementSystem =
    locale.measurementSystem ?? (region && US_REGIONS.includes(region) ? 'us' : region === 'GB' ? 'uk' : 'metric');
  const code = locale.currencyCode?.toUpperCase();
  const bases = {} as Record<Dimension, BasisId>;
  for (const d of DIMENSIONS) bases[d] = defaultBasis(d, unitSystem);
  return {
    currency: code && /^[A-Z]{3}$/.test(code) ? code : FALLBACK_CURRENCY,
    decimalSeparator: locale.decimalSeparator === ',' ? ',' : '.',
    unitSystem,
    bases,
    taxMode: region && ADD_TAX_REGIONS.includes(region) ? 'add' : 'include',
  };
}

/** Settings keys written by `applyLocaleDefaults` (SPEC 4 settings list). */
export function localeSettings(d: LocaleDefaults): Record<string, string> {
  const out: Record<string, string> = {
    currency: d.currency,
    decimalSeparator: d.decimalSeparator,
    unitSystem: d.unitSystem,
    taxMode: d.taxMode,
  };
  for (const dim of DIMENSIONS) out[`basis.${dim}`] = d.bases[dim];
  return out;
}

export const LOCALE_APPLIED_KEY = 'localeDefaultsApplied';

/** First launch only: writes every default the user has not set; later launches change nothing. One transaction. */
export function applyLocaleDefaults(db: Db, locales: readonly LocaleLike[]): Promise<boolean> {
  return inTransaction(db, async (db) => {
    if ((await getSetting(db, LOCALE_APPLIED_KEY)) === '1') return false;
    for (const [key, value] of Object.entries(localeSettings(localeDefaults(locales)))) {
      if ((await getSetting(db, key)) === null) await setSetting(db, key, value);
    }
    await setSetting(db, LOCALE_APPLIED_KEY, '1');
    return true;
  });
}
