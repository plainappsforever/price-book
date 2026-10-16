/** @jest-environment node */
// A12: locale defaults from a mocked getLocales() (expo-localization's shape; the package arrives in P4).
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { getSetting, setSetting } from '@/db/settings';

import { applyLocaleDefaults, localeDefaults, type LocaleLike } from './locale-defaults';

/** What expo-localization's getLocales() returns on a phone set to `tag` (fields this app reads). */
function getLocales(tag: string, currencyCode: string | null, decimalSeparator: string, measurementSystem: LocaleLike['measurementSystem'], regionCode?: string | null): LocaleLike[] {
  return [{ languageTag: tag, regionCode: regionCode === undefined ? tag.split('-')[1] : regionCode, currencyCode, decimalSeparator, measurementSystem }];
}

describe('A12 locale defaults', () => {
  it.each([
    ['de-DE', getLocales('de-DE', 'EUR', ',', 'metric'), { currency: 'EUR', decimalSeparator: ',', unitSystem: 'metric', mass: 'kg', volume: 'l', taxMode: 'include' }],
    ['en-US', getLocales('en-US', 'USD', '.', 'us'), { currency: 'USD', decimalSeparator: '.', unitSystem: 'us', mass: 'oz', volume: 'floz_us', taxMode: 'add' }],
    ['en-GB', getLocales('en-GB', 'GBP', '.', 'uk'), { currency: 'GBP', decimalSeparator: '.', unitSystem: 'uk', mass: 'kg', volume: 'l', taxMode: 'include' }],
    ['ja-JP', getLocales('ja-JP', 'JPY', '.', 'metric'), { currency: 'JPY', decimalSeparator: '.', unitSystem: 'metric', mass: 'kg', volume: 'l', taxMode: 'include' }],
    ['fr-CA', getLocales('fr-CA', 'CAD', ',', 'metric'), { currency: 'CAD', decimalSeparator: ',', unitSystem: 'metric', mass: 'kg', volume: 'l', taxMode: 'add' }],
  ])('%s', (_tag, locales, expected) => {
    const d = localeDefaults(locales);
    expect({ currency: d.currency, decimalSeparator: d.decimalSeparator, unitSystem: d.unitSystem, mass: d.bases.mass, volume: d.bases.volume, taxMode: d.taxMode }).toEqual(expected);
    expect(d.bases.count).toBe('1');
  });
  it('missing fields fall back: region from the tag, measurement system from the region, EUR, point', () => {
    expect(localeDefaults(getLocales('en-US', null, '', null, null))).toMatchObject({ currency: 'EUR', decimalSeparator: '.', unitSystem: 'us', taxMode: 'add' });
    expect(localeDefaults(getLocales('en-GB', null, '.', null, null))).toMatchObject({ unitSystem: 'uk', taxMode: 'include' });
    expect(localeDefaults(getLocales('zh-Hant-TW', 'TWD', '.', null, null))).toMatchObject({ currency: 'TWD', unitSystem: 'metric' });
    expect(localeDefaults([])).toMatchObject({ currency: 'EUR', unitSystem: 'metric', taxMode: 'include' });
  });
  it('first launch writes the defaults once and never overwrites the user', async () => {
    const db = createTestDb();
    await migrate(db);
    await setSetting(db, 'currency', 'CHF'); // user already chose
    expect(await applyLocaleDefaults(db, getLocales('de-DE', 'EUR', ',', 'metric'))).toBe(true);
    expect(await getSetting(db, 'currency')).toBe('CHF');
    expect(await getSetting(db, 'basis.mass')).toBe('kg');
    expect(await getSetting(db, 'taxMode')).toBe('include');
    await setSetting(db, 'basis.mass', '100g');
    expect(await applyLocaleDefaults(db, getLocales('en-US', 'USD', '.', 'us'))).toBe(false);
    expect(await getSetting(db, 'basis.mass')).toBe('100g');
    expect(await getSetting(db, 'unitSystem')).toBe('metric');
  });
});
