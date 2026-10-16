/** @jest-environment node */
import units from '../../test/fixtures/engine/units.json';
import { checkCases, parseRat, type Case } from '../../test/engine-fixtures';
import { strings } from '../lib/strings';
import { cmp, eq, fromDecimal, rat, roundHalfUp, type Rat } from './rational';
import {
  BASES, BASE_UNIT, DIMENSIONS, UNIT_IDS, basisQuantity, chipUnits, convert, defaultBasis, dimensionOf, dimensionsOf, factorOf, fromBase,
  conversionTarget, groupByDimension, hasDimensionMismatch, isDimension, isUnitId, nextBasis, packQuantity, toBase, unitMatchesDimension, unitPrice, unitSystem, unitsOf,
  type BasisId, type Dimension, type MeasurementSystem, type UnitId,
} from './units';

const sections = units as unknown as Record<string, Case<any, any>[]>;
const dec = (t: string) => fromDecimal(t)!;

describe('fixture hygiene', () => {
  it.each(Object.keys(sections))('%s: every case has an id and a note, ids are unique', (name) => {
    checkCases(name, sections[name]);
  });
});

describe('unit conversion (units.json)', () => {
  it.each(sections.conversions.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const { value, from, to } = c.input;
    const result = convert(dec(value), from as UnitId, to as UnitId);
    if (c.expected === null) expect(result).toBeNull();
    else expect(eq(result!, parseRat(c.expected))).toBe(true);
  });
});

describe('every unit factor', () => {
  it('is a positive exact rational and has a label', () => {
    for (const u of UNIT_IDS) {
      expect(cmp(factorOf(u), rat(0))).toBe(1);
      expect(strings.units[u]).toBeTruthy();
    }
  });
  it('has exactly one dimension and the base unit has factor 1', () => {
    for (const d of DIMENSIONS) {
      expect(eq(factorOf(BASE_UNIT[d]), rat(1))).toBe(true);
      expect(dimensionOf(BASE_UNIT[d])).toBe(d);
      expect(unitsOf(d).length).toBeGreaterThan(0);
    }
    expect(DIMENSIONS.flatMap((d) => unitsOf(d)).sort()).toEqual([...UNIT_IDS].sort());
  });
  it.each(['0.001', '1', '7', '0.33', '123456.789', '1000000'])('round-trips size %s through every unit pair of its dimension, exactly', (size) => {
    for (const d of DIMENSIONS) {
      for (const a of unitsOf(d)) {
        expect(eq(fromBase(toBase(dec(size), a), a), dec(size))).toBe(true);
        for (const b of unitsOf(d)) {
          const there = convert(dec(size), a, b)!;
          expect(eq(convert(there, b, a)!, dec(size))).toBe(true);
        }
      }
    }
  });
  it('returns null for every cross-dimension pair', () => {
    for (const a of UNIT_IDS) for (const b of UNIT_IDS) {
      if (dimensionOf(a) !== dimensionOf(b)) expect(convert(rat(1), a, b)).toBeNull();
    }
  });
  it('type guards', () => {
    expect(isUnitId('kg')).toBe(true);
    expect(isUnitId('stone')).toBe(false);
    expect(isUnitId('toString')).toBe(false); // prototype keys are not units
    expect(isUnitId(5)).toBe(false);
    expect(isDimension('mass')).toBe(true);
    expect(isDimension('area')).toBe(false);
  });
});

describe('pack quantity Q = n x s x factor (units.json)', () => {
  it.each(sections.packQuantity.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const { packCount, itemSize, unit } = c.input;
    expect(eq(packQuantity(packCount, dec(itemSize), unit), parseRat(c.expected))).toBe(true);
  });
});

describe('unit price U = E / (q x Q) x basis (units.json)', () => {
  it.each(sections.unitPrice.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const { totalMinor, packCount, itemSize, unit, basis } = c.input;
    const q = packQuantity(packCount, dec(itemSize), unit);
    const b = basisQuantity(dimensionOf(unit), basis)!;
    const u = unitPrice(parseRat(totalMinor), q, b);
    expect(eq(u, parseRat(c.expected.exact))).toBe(true);
    expect(roundHalfUp(u).toString()).toBe(c.expected.rounded);
  });
  it('is the same price whichever basis it is shown in (basis x U consistency)', () => {
    // 249 cents for 500 g: per kg x 0.5 = per 500 g; per 100 g x 5 = per 500 g.
    const q = packQuantity(1, dec('500'), 'g');
    const perKg = unitPrice(rat(249), q, basisQuantity('mass', 'kg')!);
    const per100g = unitPrice(rat(249), q, basisQuantity('mass', '100g')!);
    expect(eq(perKg, rat(4980, 10))).toBe(true);
    expect(eq(per100g, rat(perKg.n * BigInt(1), perKg.d * BigInt(10)))).toBe(true);
  });
});

describe('display bases', () => {
  it.each(sections.bases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    let current: string = c.input.start;
    const seen: string[] = [];
    for (let i = 0; i < c.input.steps; i++) {
      current = nextBasis(c.input.dimension as Dimension, current);
      seen.push(current);
    }
    expect(seen).toEqual(c.expected);
  });
  it('every basis has a label and a positive exact quantity; unknown bases give null', () => {
    for (const d of DIMENSIONS) {
      for (const b of BASES[d]) {
        expect(strings.bases[b.id as BasisId]).toBeTruthy();
        expect(cmp(b.quantity, rat(0))).toBe(1);
        expect(basisQuantity(d, b.id)).toBe(b.quantity);
      }
      expect(basisQuantity(d, 'nonsense')).toBeNull();
    }
  });
  it('basis quantities agree with the unit table (kg, lb, oz, floz, gal, ft)', () => {
    const q = (d: Dimension, id: string): Rat => basisQuantity(d, id)!;
    expect(eq(q('mass', 'kg'), factorOf('kg'))).toBe(true);
    expect(eq(q('mass', 'lb'), factorOf('lb'))).toBe(true);
    expect(eq(q('mass', 'oz'), factorOf('oz'))).toBe(true);
    expect(eq(q('volume', 'l'), factorOf('l'))).toBe(true);
    expect(eq(q('volume', 'floz_us'), factorOf('floz_us'))).toBe(true);
    expect(eq(q('volume', 'qt_us'), factorOf('qt_us'))).toBe(true);
    expect(eq(q('volume', 'gal_us'), factorOf('gal_us'))).toBe(true);
    expect(eq(q('length', 'ft'), factorOf('ft'))).toBe(true);
    expect(eq(q('length', '100ft'), packQuantity(100, rat(1), 'ft'))).toBe(true);
  });
});

describe('locale defaults by measurement system (units.json)', () => {
  it.each(sections.defaults.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const system = c.input.system as MeasurementSystem;
    const { chips, ...bases } = c.expected;
    for (const d of DIMENSIONS) expect(defaultBasis(d, system)).toBe(bases[d]);
    expect(chipUnits(system)).toEqual(chips);
  });
  it('every default basis and chip exists', () => {
    for (const system of ['metric', 'uk', 'us'] as const) {
      for (const d of DIMENSIONS) expect(basisQuantity(d, defaultBasis(d, system))).not.toBeNull();
      for (const u of chipUnits(system)) expect(isUnitId(u)).toBe(true);
    }
  });
});

describe('dimension mismatch detection (units.json)', () => {
  it.each(sections.mismatch.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const list = c.input.units as UnitId[];
    expect(hasDimensionMismatch(list)).toBe(c.expected.mismatch);
    expect(dimensionsOf(list)).toEqual(c.expected.dimensions);
  });
  it('groups items by dimension in first-seen order (SPEC E19: two groups, no winner across them)', () => {
    const cards = [
      { name: 'A', unit: 'l' as UnitId },
      { name: 'B', unit: 'kg' as UnitId },
      { name: 'C', unit: 'ml' as UnitId },
    ];
    const groups = groupByDimension(cards, (c) => c.unit);
    expect(groups.map((g) => g.dimension)).toEqual(['volume', 'mass']);
    expect(groups[0].items.map((c) => c.name)).toEqual(['A', 'C']);
    expect(groups[1].items.map((c) => c.name)).toEqual(['B']);
  });
  it.each(sections.unitMatchesDimension.map((c) => [c.id, c] as const))('unit/dimension guard %s', (_id, c) => {
    expect(unitMatchesDimension(c.input.unit, c.input.dimension)).toBe(c.expected);
  });
});

describe('W3 conversion target (unit family vs display basis)', () => {
  it.each([
    ['oz', 'kg', 'g'], ['lb', '100g', 'g'], ['g', 'oz', 'oz'], ['kg', 'lb', 'oz'], ['g', 'kg', null], ['oz', 'lb', null],
    ['floz_us', 'l', 'ml'], ['floz_uk', 'l', 'ml'], ['floz_uk', 'floz_us', 'floz_us'], ['l', 'gal_us', 'floz_us'], ['ml', '100ml', null],
    ['pcs', '10', null], ['dozen', '1', null], ['ft', 'm', 'm'], ['m', 'ft', 'ft'], ['in', '100ft', null],
  ] as [UnitId, BasisId, UnitId | null][])('%s on %s -> %s', (unit, basis, target) => {
    expect(conversionTarget(unit, basis)).toBe(target);
  });
  it('every unit has a family and count units are neutral', () => {
    for (const u of UNIT_IDS) expect(['metric', 'us', 'uk', 'neutral']).toContain(unitSystem(u));
    expect(unitSystem('pcs')).toBe('neutral');
    expect(unitSystem('gal_uk')).toBe('uk');
  });
});
