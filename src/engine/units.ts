// Unit table (SPEC §5.2, D15): every factor is an exact rational. Mass and volume are never converted
// into each other (no densities). Labels live in src/lib/strings.ts (D24).
import { div, fromDecimal, mul, rat, type Rat } from './rational';

export type Dimension = 'mass' | 'volume' | 'count' | 'length';
export const DIMENSIONS: readonly Dimension[] = ['mass', 'volume', 'count', 'length'];

/** Base unit per dimension: g, ml, piece, m. */
export const BASE_UNIT: Record<Dimension, UnitId> = { mass: 'g', volume: 'ml', count: 'pcs', length: 'm' };

function exact(text: string): Rat {
  const value = fromDecimal(text);
  if (!value) throw new Error(`Bad unit factor ${text}`);
  return value;
}

type UnitDef = { dimension: Dimension; factor: Rat };

const UNIT_TABLE = {
  // mass (base g)
  mg: { dimension: 'mass', factor: rat(1, 1000) },
  g: { dimension: 'mass', factor: exact('1') },
  kg: { dimension: 'mass', factor: exact('1000') },
  oz: { dimension: 'mass', factor: exact('28.349523125') },
  lb: { dimension: 'mass', factor: exact('453.59237') },
  // volume (base ml)
  ml: { dimension: 'volume', factor: exact('1') },
  cl: { dimension: 'volume', factor: exact('10') },
  dl: { dimension: 'volume', factor: exact('100') },
  l: { dimension: 'volume', factor: exact('1000') },
  floz_us: { dimension: 'volume', factor: exact('29.5735295625') },
  cup_us: { dimension: 'volume', factor: exact('236.5882365') },
  pt_us: { dimension: 'volume', factor: exact('473.176473') },
  qt_us: { dimension: 'volume', factor: exact('946.352946') },
  gal_us: { dimension: 'volume', factor: exact('3785.411784') },
  floz_uk: { dimension: 'volume', factor: exact('28.4130625') },
  pt_uk: { dimension: 'volume', factor: exact('568.26125') },
  gal_uk: { dimension: 'volume', factor: exact('4546.09') },
  // count (base piece)
  pcs: { dimension: 'count', factor: exact('1') },
  dozen: { dimension: 'count', factor: exact('12') },
  // length (base m)
  mm: { dimension: 'length', factor: rat(1, 1000) },
  cm: { dimension: 'length', factor: rat(1, 100) },
  m: { dimension: 'length', factor: exact('1') },
  in: { dimension: 'length', factor: exact('0.0254') },
  ft: { dimension: 'length', factor: exact('0.3048') },
  yd: { dimension: 'length', factor: exact('0.9144') },
} as const satisfies Record<string, UnitDef>;

export type UnitId = keyof typeof UNIT_TABLE;
export const UNIT_IDS = Object.keys(UNIT_TABLE) as UnitId[];

const TABLE: Record<UnitId, UnitDef> = UNIT_TABLE;

export function isUnitId(value: unknown): value is UnitId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TABLE, value);
}
export function isDimension(value: unknown): value is Dimension {
  return typeof value === 'string' && (DIMENSIONS as readonly string[]).includes(value);
}

export function dimensionOf(unit: UnitId): Dimension {
  return TABLE[unit].dimension;
}
/** Exact size of one `unit` in its dimension's base unit. */
export function factorOf(unit: UnitId): Rat {
  return TABLE[unit].factor;
}
/** All units of a dimension, in table order (the "More" sheet). */
export function unitsOf(dimension: Dimension): UnitId[] {
  return UNIT_IDS.filter((u) => TABLE[u].dimension === dimension);
}
/** Dimension guard used by the database: a price's unit must belong to its product's dimension. */
export function unitMatchesDimension(unit: string, dimension: string): boolean {
  return isUnitId(unit) && dimensionOf(unit) === dimension;
}

/** `size` expressed in the dimension's base unit. */
export function toBase(size: Rat, unit: UnitId): Rat {
  return mul(size, TABLE[unit].factor);
}
export function fromBase(quantity: Rat, unit: UnitId): Rat {
  return div(quantity, TABLE[unit].factor);
}
/** Exact conversion; null when the units measure different things (mass vs volume etc.). */
export function convert(size: Rat, from: UnitId, to: UnitId): Rat | null {
  if (dimensionOf(from) !== dimensionOf(to)) return null;
  return fromBase(toBase(size, from), to);
}
/** Pack quantity Q = n x s x factor(u), in base units (SPEC §5.4). */
export function packQuantity(packCount: number, itemSize: Rat, unit: UnitId): Rat {
  return mul(mul(rat(packCount), itemSize), TABLE[unit].factor);
}

// ---------- mismatch detection ----------

/** Distinct dimensions in first-seen order. */
export function dimensionsOf(units: readonly UnitId[]): Dimension[] {
  const seen: Dimension[] = [];
  for (const u of units) {
    const d = dimensionOf(u);
    if (!seen.includes(d)) seen.push(d);
  }
  return seen;
}
/** True when the units cannot be ranked against each other (W1: weight vs volume etc.). */
export function hasDimensionMismatch(units: readonly UnitId[]): boolean {
  return dimensionsOf(units).length > 1;
}
/** Groups items by the dimension of their unit, keeping first-seen order (used by ranking in P2). */
export function groupByDimension<T>(items: readonly T[], unitOf: (item: T) => UnitId): { dimension: Dimension; items: T[] }[] {
  const groups: { dimension: Dimension; items: T[] }[] = [];
  for (const item of items) {
    const dimension = dimensionOf(unitOf(item));
    const group = groups.find((g) => g.dimension === dimension);
    if (group) group.items.push(item);
    else groups.push({ dimension, items: [item] });
  }
  return groups;
}

// ---------- display bases ----------

export type BasisId = 'kg' | '100g' | 'lb' | 'oz' | 'l' | '100ml' | 'floz_us' | 'qt_us' | 'gal_us' | '1' | '10' | '100' | 'm' | 'ft' | '100ft';

/** Bases a unit price can be shown per, in cycle order; quantity in base units. */
export const BASES: Record<Dimension, readonly { id: BasisId; quantity: Rat }[]> = {
  mass: [
    { id: 'kg', quantity: exact('1000') },
    { id: '100g', quantity: exact('100') },
    { id: 'lb', quantity: exact('453.59237') },
    { id: 'oz', quantity: exact('28.349523125') },
  ],
  volume: [
    { id: 'l', quantity: exact('1000') },
    { id: '100ml', quantity: exact('100') },
    { id: 'floz_us', quantity: exact('29.5735295625') },
    { id: 'qt_us', quantity: exact('946.352946') },
    { id: 'gal_us', quantity: exact('3785.411784') },
  ],
  count: [
    { id: '1', quantity: exact('1') },
    { id: '10', quantity: exact('10') },
    { id: '100', quantity: exact('100') },
  ],
  length: [
    { id: 'm', quantity: exact('1') },
    { id: 'ft', quantity: exact('0.3048') },
    { id: '100ft', quantity: exact('30.48') },
  ],
};

export function basisQuantity(dimension: Dimension, basis: string): Rat | null {
  return BASES[dimension].find((b) => b.id === basis)?.quantity ?? null;
}
/** Next basis in the cycle (tapping the unit-price header). An unknown basis restarts at the first. */
export function nextBasis(dimension: Dimension, current: string): BasisId {
  const list = BASES[dimension];
  const i = list.findIndex((b) => b.id === current);
  return list[(i + 1) % list.length].id;
}

export type MeasurementSystem = 'metric' | 'uk' | 'us';

const DEFAULT_BASES: Record<MeasurementSystem, Record<Dimension, BasisId>> = {
  metric: { mass: 'kg', volume: 'l', count: '1', length: 'm' },
  uk: { mass: 'kg', volume: 'l', count: '1', length: 'm' },
  us: { mass: 'oz', volume: 'floz_us', count: '1', length: 'ft' },
};
export function defaultBasis(dimension: Dimension, system: MeasurementSystem): BasisId {
  return DEFAULT_BASES[system][dimension];
}

const CHIPS: Record<MeasurementSystem, UnitId[]> = {
  metric: ['g', 'kg', 'ml', 'l', 'pcs'],
  uk: ['g', 'kg', 'ml', 'l', 'pcs'],
  us: ['oz', 'lb', 'floz_us', 'pcs'],
};
/** Unit chips shown above the keypad; "More" shows unitsOf(dimension) for all dimensions. */
export function chipUnits(system: MeasurementSystem): UnitId[] {
  return CHIPS[system];
}

/**
 * Unit price as an exact rational: total paid (minor units, exact) for `quantity` base units,
 * expressed per `basisQuantity` base units (U = E / (q x Q) x basis, SPEC §5.4 step 9).
 */
export function unitPrice(totalMinor: Rat, quantity: Rat, basis: Rat): Rat {
  return mul(div(totalMinor, quantity), basis);
}

// ---------- measurement systems (W3 "unit converted" line, SPEC §5.6) ----------

/** Which family a unit belongs to; count units are neutral (never "converted"). */
export type UnitSystem = 'metric' | 'us' | 'uk' | 'neutral';

const UNIT_SYSTEM: Record<UnitId, UnitSystem> = {
  mg: 'metric', g: 'metric', kg: 'metric', oz: 'us', lb: 'us',
  ml: 'metric', cl: 'metric', dl: 'metric', l: 'metric',
  floz_us: 'us', cup_us: 'us', pt_us: 'us', qt_us: 'us', gal_us: 'us',
  floz_uk: 'uk', pt_uk: 'uk', gal_uk: 'uk',
  pcs: 'neutral', dozen: 'neutral',
  mm: 'metric', cm: 'metric', m: 'metric', in: 'us', ft: 'us', yd: 'us',
};
const BASIS_SYSTEM: Record<BasisId, 'metric' | 'us' | 'neutral'> = {
  kg: 'metric', '100g': 'metric', lb: 'us', oz: 'us',
  l: 'metric', '100ml': 'metric', floz_us: 'us', qt_us: 'us', gal_us: 'us',
  '1': 'neutral', '10': 'neutral', '100': 'neutral',
  m: 'metric', ft: 'us', '100ft': 'us',
};
/** Unit a converted size is shown in, per basis family (metric: g / ml / m; US: oz / fl oz / ft). */
const CONVERSION_TARGET: Record<'metric' | 'us', Record<Dimension, UnitId>> = {
  metric: { mass: 'g', volume: 'ml', count: 'pcs', length: 'm' },
  us: { mass: 'oz', volume: 'floz_us', count: 'pcs', length: 'ft' },
};

export function unitSystem(unit: UnitId): UnitSystem {
  return UNIT_SYSTEM[unit];
}

/**
 * W3: the unit a card's size is converted into for the line "16 oz = 453.6 g", or null when the card's
 * unit already belongs to the family of the display basis (or is a count unit).
 */
export function conversionTarget(unit: UnitId, basis: BasisId): UnitId | null {
  const from = UNIT_SYSTEM[unit];
  const to = BASIS_SYSTEM[basis];
  if (from === 'neutral' || to === 'neutral' || from === to) return null;
  return CONVERSION_TARGET[to][dimensionOf(unit)];
}
