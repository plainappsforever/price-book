// Named seed books (D38): `empty`, `s1` (SPEC 5.8 examples S1 + S2) and `big5000` (5 000 generated prices,
// deterministic). Used by Jest now and by the dev-only deep link pricebook-dev://debug/seed?set=<name>
// from P4 on. Loading a seed replaces stores, products and prices and writes the seed's settings on top
// of the current ones (theme etc. stay; flows set what they depend on through the UI).
import type { BackupData, ObservationRecord, ProductRecord, StoreRecord } from '@/engine/backup';
import { readAllData, replaceAllData } from '@/db/restore';
import { inTransaction } from '@/db/tx';
import type { Db } from '@/db/types';

export type SeedName = 'empty' | 's1' | 'big5000';
export const SEED_NAMES: readonly SeedName[] = ['empty', 's1', 'big5000'];

export function isSeedName(value: unknown): value is SeedName {
  return typeof value === 'string' && (SEED_NAMES as readonly string[]).includes(value);
}

const SEED_SETTINGS = { currency: 'EUR', unitSystem: 'metric' };

function store(id: number, name: string): StoreRecord {
  const at = '2026-01-01T09:00:00.000Z';
  return { id, name, name_key: name.toLowerCase(), note: null, archived: 0, created_at: at, updated_at: at };
}

function product(id: number, name: string, extra: Partial<ProductRecord> = {}): ProductRecord {
  const at = '2026-01-01T09:00:00.000Z';
  return {
    id, name, brand: null, variant: null, category: null, dimension: 'mass', count_label: null, favorite: 0, note: null,
    created_at: at, updated_at: at, ...extra,
  };
}

function price(
  id: number, productId: number, storeId: number | null, on: string, packPriceMinor: number, itemSize: string, unit: string,
  extra: Partial<ObservationRecord> = {}
): ObservationRecord {
  const at = `${on}T10:00:00.000Z`;
  return {
    id, product_id: productId, store_id: storeId, observed_on: on, currency: 'EUR', pack_price_minor: packPriceMinor,
    paid_price_minor: null, pack_count: 1, item_size: itemSize, unit, deposit_minor: 0, is_promo: 0, deal_text: null, note: null,
    created_at: at, updated_at: at, minor_digits: 2, ...extra,
  };
}

/** SPEC 5.8 S1 (coffee, Rewe / Aldi / Edeka, "today" 2026-09-30) and S2 (crisps shrink at Rewe). */
function s1(): BackupData {
  return {
    settings: { ...SEED_SETTINGS },
    stores: [store(1, 'Rewe'), store(2, 'Aldi'), store(3, 'Edeka')],
    products: [
      product(1, 'Coffee beans', { brand: 'Mokka Mill', variant: 'Crema', category: 'Coffee', favorite: 1 }),
      product(2, 'Crisps', { brand: 'Crunchy', variant: 'Paprika', category: 'Snacks' }),
    ],
    observations: [
      price(1, 1, 1, '2026-01-10', 249, '500', 'g'),
      price(2, 1, 2, '2026-02-14', 229, '500', 'g'),
      price(3, 1, 1, '2026-03-20', 399, '1', 'kg', { is_promo: 1, deal_text: 'Weekend offer, "1 kg for 3.99"', note: '=promo week' }),
      price(4, 1, 3, '2026-07-20', 259, '500', 'g'),
      price(5, 1, 1, '2026-08-28', 249, '500', 'g'),
      price(6, 2, 1, '2026-03-01', 199, '200', 'g'),
      price(7, 2, 1, '2026-09-01', 199, '175', 'g', { note: 'Pack looks the same' }),
    ],
    // V1.5 P1: the coffee has a barcode (a made-up EAN-13 with a valid check digit); the crisps have none.
    barcodes: [{ code: '4001234567891', product_id: 1, created_at: '2026-01-01T09:00:00.000Z' }],
  };
}

/** Small deterministic PRNG (mulberry32); no dependency, same book on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

const BIG_STORES = ['Rewe', 'Aldi', 'Edeka', 'Lidl', 'Kaufland', 'Penny', 'Netto', 'dm'];
const BIG_KINDS: { name: string; dimension: string; unit: string; sizes: string[]; category: string; countLabel?: string }[] = [
  { name: 'Coffee', dimension: 'mass', unit: 'g', sizes: ['250', '500', '1000'], category: 'Coffee' },
  { name: 'Pasta', dimension: 'mass', unit: 'g', sizes: ['500', '1000'], category: 'Pantry' },
  { name: 'Milk', dimension: 'volume', unit: 'l', sizes: ['1', '1.5'], category: 'Dairy' },
  { name: 'Juice', dimension: 'volume', unit: 'ml', sizes: ['330', '750', '1000'], category: 'Drinks' },
  { name: 'Toilet paper', dimension: 'count', unit: 'pcs', sizes: ['8', '10', '16'], category: 'Household', countLabel: 'rolls' },
  { name: 'Detergent', dimension: 'count', unit: 'pcs', sizes: ['20', '40'], category: 'Household', countLabel: 'washes' },
  { name: 'Cheese', dimension: 'mass', unit: 'g', sizes: ['150', '200', '400'], category: 'Dairy' },
  { name: 'Foil', dimension: 'length', unit: 'm', sizes: ['10', '30'], category: 'Household' },
];

/** 200 products x 25 prices over two years before 2026-09-30, 8 stores (A17). */
function big5000(): BackupData {
  const next = mulberry32(5000);
  const stores = BIG_STORES.map((name, i) => store(i + 1, name));
  const products: ProductRecord[] = [];
  const observations: ObservationRecord[] = [];
  const end = Date.UTC(2026, 8, 30);
  for (let p = 1; p <= 200; p++) {
    const kind = BIG_KINDS[(p - 1) % BIG_KINDS.length];
    products.push(product(p, `${kind.name} ${String(p).padStart(3, '0')}`, {
      brand: `Brand ${1 + (next() % 20)}`, category: kind.category, dimension: kind.dimension,
      count_label: kind.countLabel ?? null, favorite: p % 10 === 0 ? 1 : 0,
    }));
    const base = 99 + (next() % 900);
    for (let k = 0; k < 25; k++) {
      const id = observations.length + 1;
      const on = new Date(end - (next() % 730) * 86400000).toISOString().slice(0, 10);
      const promo = next() % 6 === 0;
      const swing = (next() % 41) - 20; // -20 .. +20 %
      const pack = base + ((base * swing) - ((base * swing) % 100)) / 100 - (promo ? (base - (base % 4)) / 4 : 0);
      observations.push(price(id, p, 1 + (next() % stores.length), on, pack, kind.sizes[next() % kind.sizes.length], kind.unit, {
        is_promo: promo ? 1 : 0,
        created_at: `${on}T${String(8 + (k % 12)).padStart(2, '0')}:00:00.000Z`,
      }));
    }
  }
  return { settings: { ...SEED_SETTINGS }, stores, products, observations, barcodes: [] };
}

export function seedData(name: SeedName): BackupData {
  if (name === 's1') return s1();
  if (name === 'big5000') return big5000();
  return { settings: { ...SEED_SETTINGS }, stores: [], products: [], observations: [], barcodes: [] };
}

/** Wipes stores/products/prices and loads the named seed in one transaction (one queue unit). */
export function loadSeed(db: Db, name: SeedName): Promise<void> {
  return inTransaction(db, async (db) => {
    const current = await readAllData(db);
    const seed = seedData(name);
    await replaceAllData(db, { ...seed, settings: { ...current.settings, ...seed.settings } });
  });
}
