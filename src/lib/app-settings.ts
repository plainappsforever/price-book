// Typed view of the settings table for the screens (SPEC 4 settings list, D38). Pure: the raw key -> value map
// comes from `getAllSettings`; anything missing or invalid falls back to a safe default, never throws.
import type { EngineSettings, TaxMode } from '@/engine/deals';
import { fromDecimal, cmp, rat } from '@/engine/rational';
import { basisQuantity, defaultBasis, DIMENSIONS, type BasisId, type Dimension, type MeasurementSystem } from '@/engine/units';

export type DecimalSeparator = '.' | ',';

export type AppSettings = {
  currency: string;
  decimalSeparator: DecimalSeparator;
  unitSystem: MeasurementSystem;
  taxMode: TaxMode;
  /** Percent text ("8.875") or null when no rate is set. */
  taxRate: string | null;
  bases: Record<Dimension, BasisId>;
  haptics: boolean;
};

export const SETTING_KEYS = {
  currency: 'currency',
  decimalSeparator: 'decimalSeparator',
  unitSystem: 'unitSystem',
  taxMode: 'taxMode',
  taxRate: 'taxRate',
  haptics: 'haptics',
  basis: (d: Dimension) => `basis.${d}`,
} as const;

const SYSTEMS: readonly MeasurementSystem[] = ['metric', 'us', 'uk'];

/** "8.875" -> true for a decimal text 0..100 (the engine's rate rule). */
export function isRate(text: string | null | undefined): text is string {
  if (!text) return false;
  const v = fromDecimal(text);
  return !!v && cmp(v, rat(100)) <= 0;
}

export function readAppSettings(raw: Readonly<Record<string, string>>): AppSettings {
  const currency = /^[A-Z]{3}$/.test(raw.currency ?? '') ? raw.currency : 'EUR';
  const unitSystem = SYSTEMS.includes(raw.unitSystem as MeasurementSystem) ? (raw.unitSystem as MeasurementSystem) : 'metric';
  const bases = {} as Record<Dimension, BasisId>;
  for (const d of DIMENSIONS) {
    const chosen = raw[SETTING_KEYS.basis(d)];
    bases[d] = chosen && basisQuantity(d, chosen) ? (chosen as BasisId) : defaultBasis(d, unitSystem);
  }
  return {
    currency,
    decimalSeparator: raw.decimalSeparator === ',' ? ',' : '.',
    unitSystem,
    taxMode: raw.taxMode === 'add' ? 'add' : 'include',
    taxRate: isRate(raw.taxRate) ? raw.taxRate : null,
    bases,
    haptics: raw.haptics !== '0',
  };
}

export function engineSettings(s: AppSettings): EngineSettings {
  return { currency: s.currency, taxMode: s.taxMode, taxRate: s.taxRate, measurementSystem: s.unitSystem, bases: s.bases };
}

/** Choosing a unit system also resets every display basis to that system's default (SPEC 5.2). */
export function unitSystemChange(system: MeasurementSystem): Record<string, string> {
  const out: Record<string, string> = { [SETTING_KEYS.unitSystem]: system };
  for (const d of DIMENSIONS) out[SETTING_KEYS.basis(d)] = defaultBasis(d, system);
  return out;
}
