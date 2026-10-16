// One-file JSON backup (SPEC §6, D20, D36): build and strict validation, pure. The database side (read
// everything, replace everything in one transaction) is src/db/restore.ts. Validation never throws: a
// wrong, corrupt or newer file comes back as { ok: false, error } and nothing is touched.
import { isCanonicalBarcode } from './barcode';
import { currencyExponent } from './money';
import { maxMinorFor } from './deals';
import { storeNameKey } from './names';
import { isKeypadItemSize, LIMITS } from './parse';
import { isValidDate } from './stats';
import { isDimension, unitMatchesDimension } from './units';

export const BACKUP_APP = 'price-book';
export const BACKUP_VERSION = 1;
/** Oldest database schema whose backups we can restore (migration 2 created the Price Book tables). */
export const MIN_BACKUP_SCHEMA = 2;
/** SPEC §6: refuse anything over 20 million characters before parsing it. */
export const MAX_BACKUP_CHARS = 20000000;
/** Settings never written to a backup: the in-progress Compare screen belongs to this phone. */
export const UNSAVED_SETTINGS: readonly string[] = ['compareDraft'];

// ---------- rows (snake_case: exactly the SQLite columns, SPEC §4) ----------

export type StoreRecord = {
  id: number;
  name: string;
  name_key: string;
  note: string | null;
  archived: number;
  created_at: string | null;
  updated_at: string | null;
};

export type ProductRecord = {
  id: number;
  name: string;
  brand: string | null;
  variant: string | null;
  category: string | null;
  dimension: string;
  count_label: string | null;
  favorite: number;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ObservationRecord = {
  id: number;
  product_id: number;
  store_id: number | null;
  observed_on: string;
  currency: string;
  pack_price_minor: number;
  paid_price_minor: number | null;
  pack_count: number;
  item_size: string;
  unit: string;
  deposit_minor: number;
  is_promo: number;
  deal_text: string | null;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Decimals of this row's minor units (ISO 4217 when saved; schema 3, D41). */
  minor_digits: number;
};

/** A product's barcode (schema 5, D63): canonical text from src/engine/barcode.ts. */
export type BarcodeRecord = {
  code: string;
  product_id: number;
  created_at: string | null;
};

export type BackupData = {
  settings: Record<string, string>;
  stores: StoreRecord[];
  products: ProductRecord[];
  observations: ObservationRecord[];
  /** Schema 5 (migration 5); a file of schema 2-4 restores with none. */
  barcodes: BarcodeRecord[];
};

/** The data as written in a file: a file of schema 2-4 has no `barcodes` list (a parsed file always has one). */
export type BackupFileData = Omit<BackupData, 'barcodes'> & { barcodes?: BarcodeRecord[] };

export type BackupFile = {
  app: typeof BACKUP_APP;
  backupVersion: number;
  schemaVersion: number;
  exportedAt: string;
  data: BackupFileData;
};

export type BackupCounts = { prices: number; products: number; stores: number };

export type BackupErrorCode =
  | 'tooLarge' // over MAX_BACKUP_CHARS
  | 'notJson' // not parseable (truncated, corrupt, not text)
  | 'notPriceBook' // valid JSON, but not our file
  | 'newerVersion' // made by a newer app version
  | 'unsupported' // made before the Price Book tables existed
  | 'shape' // a field has the wrong type, range or format
  | 'duplicate' // two rows with the same id (or two stores with the same name)
  | 'reference' // a price points at a product or store that is not in the file
  | 'unitDimension'; // a price's unit does not measure what its product measures

export type BackupError = { code: BackupErrorCode; detail: string };
export type BackupParse = { ok: true; file: BackupFile; counts: BackupCounts } | { ok: false; error: BackupError };

// ---------- build ----------

export function backupFileName(date: string): string {
  return `price-book-backup-${date}.json`;
}

/** The backup object in the shape of `schemaVersion` (the app always writes its latest); settings minus the compare draft. */
export function buildBackup(data: BackupData, schemaVersion: number, exportedAt: string): BackupFile {
  const settings: Record<string, string> = {};
  for (const key of Object.keys(data.settings).sort()) {
    if (!UNSAVED_SETTINGS.includes(key)) settings[key] = data.settings[key];
  }
  return {
    app: BACKUP_APP,
    backupVersion: BACKUP_VERSION,
    schemaVersion,
    exportedAt,
    data: {
      settings, stores: data.stores, products: data.products, observations: data.observations,
      ...(schemaVersion >= BARCODES_SCHEMA ? { barcodes: data.barcodes } : {}),
    },
  };
}

export function serializeBackup(file: BackupFile): string {
  return `${JSON.stringify(file, null, 1)}\n`;
}

export function countsOf(data: BackupFileData): BackupCounts {
  return { prices: data.observations.length, products: data.products.length, stores: data.stores.length };
}

// ---------- validate ----------

class Invalid extends Error {
  constructor(readonly code: BackupErrorCode, detail: string) {
    super(detail);
  }
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fields(where: string, row: unknown, keys: readonly string[]): Obj {
  if (!isObj(row)) throw new Invalid('shape', `${where} is not an object`);
  for (const key of Object.keys(row)) if (!keys.includes(key)) throw new Invalid('shape', `${where} has an unknown field "${key}"`);
  for (const key of keys) if (!(key in row)) throw new Invalid('shape', `${where} is missing "${key}"`);
  return row;
}

function int(where: string, v: unknown, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < lo || v > hi) throw new Invalid('shape', `${where} must be a whole number from ${lo} to ${hi}`);
  return v;
}
function intOrNull(where: string, v: unknown, lo: number, hi: number): number | null {
  return v === null ? null : int(where, v, lo, hi);
}
function text(where: string, v: unknown, nonEmpty = false): string {
  if (typeof v !== 'string' || (nonEmpty && v.trim() === '')) throw new Invalid('shape', `${where} must be ${nonEmpty ? 'non-empty ' : ''}text`);
  return v;
}
function textOrNull(where: string, v: unknown): string | null {
  return v === null ? null : text(where, v);
}

const MAX_ID = Number.MAX_SAFE_INTEGER;
const STORE_KEYS = ['id', 'name', 'name_key', 'note', 'archived', 'created_at', 'updated_at'] as const;
const PRODUCT_KEYS = ['id', 'name', 'brand', 'variant', 'category', 'dimension', 'count_label', 'favorite', 'note', 'created_at', 'updated_at'] as const;
/** Price fields of a schema-2 file (frozen: schema-2 backups stay restorable forever, review #12). */
const OBSERVATION_KEYS_V2 = [
  'id', 'product_id', 'store_id', 'observed_on', 'currency', 'pack_price_minor', 'paid_price_minor', 'pack_count', 'item_size',
  'unit', 'deposit_minor', 'is_promo', 'deal_text', 'note', 'created_at', 'updated_at',
] as const;
/** Schema 3 (migration 3) adds `minor_digits`. */
const OBSERVATION_KEYS = [...OBSERVATION_KEYS_V2, 'minor_digits'] as const;
/** Schema 5 (migration 5) adds the `barcodes` list. */
export const BARCODES_SCHEMA = 5;
const BARCODE_KEYS = ['code', 'product_id', 'created_at'] as const;

function store(row: unknown, i: number): StoreRecord {
  const w = `Store ${i + 1}`;
  const r = fields(w, row, STORE_KEYS);
  const name = text(`${w} name`, r.name, true);
  text(`${w} name_key`, r.name_key, true);
  return {
    id: int(`${w} id`, r.id, 1, MAX_ID),
    name,
    // review #11: recomputed from the name, so a hand-edited or stale key cannot let a second "Aldi" in later
    name_key: storeNameKey(name),
    note: textOrNull(`${w} note`, r.note),
    archived: int(`${w} archived`, r.archived, 0, 1),
    created_at: textOrNull(`${w} created_at`, r.created_at),
    updated_at: textOrNull(`${w} updated_at`, r.updated_at),
  };
}

function product(row: unknown, i: number): ProductRecord {
  const w = `Product ${i + 1}`;
  const r = fields(w, row, PRODUCT_KEYS);
  const dimension = text(`${w} dimension`, r.dimension);
  if (!isDimension(dimension)) throw new Invalid('shape', `${w} dimension "${dimension}" is unknown`);
  return {
    id: int(`${w} id`, r.id, 1, MAX_ID),
    name: text(`${w} name`, r.name, true),
    brand: textOrNull(`${w} brand`, r.brand),
    variant: textOrNull(`${w} variant`, r.variant),
    category: textOrNull(`${w} category`, r.category),
    dimension,
    count_label: textOrNull(`${w} count_label`, r.count_label),
    favorite: int(`${w} favorite`, r.favorite, 0, 1),
    note: textOrNull(`${w} note`, r.note),
    created_at: textOrNull(`${w} created_at`, r.created_at),
    updated_at: textOrNull(`${w} updated_at`, r.updated_at),
  };
}

function observation(row: unknown, i: number, schemaVersion: number): ObservationRecord {
  const w = `Price ${i + 1}`;
  const r = fields(w, row, schemaVersion >= 3 ? OBSERVATION_KEYS : OBSERVATION_KEYS_V2);
  const observedOn = text(`${w} observed_on`, r.observed_on);
  if (!isValidDate(observedOn)) throw new Invalid('shape', `${w} date "${observedOn}" is not a YYYY-MM-DD date`);
  const currency = text(`${w} currency`, r.currency);
  if (!/^[A-Z]{3}$/.test(currency)) throw new Invalid('shape', `${w} currency "${currency}" is not a 3-letter code`);
  const itemSize = text(`${w} item_size`, r.item_size);
  if (!isKeypadItemSize(itemSize)) throw new Invalid('shape', `${w} size "${itemSize}" is not a positive number up to ${LIMITS.sizeMax} with at most ${LIMITS.sizeDecimalsMax} decimals`);
  const maxMoney = maxMinorFor(currency); // review #8: the keypad LIMITS hold for restored data too
  return {
    id: int(`${w} id`, r.id, 1, MAX_ID),
    product_id: int(`${w} product_id`, r.product_id, 1, MAX_ID),
    store_id: intOrNull(`${w} store_id`, r.store_id, 1, MAX_ID),
    observed_on: observedOn,
    currency,
    pack_price_minor: int(`${w} pack_price_minor`, r.pack_price_minor, 0, maxMoney),
    paid_price_minor: intOrNull(`${w} paid_price_minor`, r.paid_price_minor, 0, maxMoney),
    pack_count: int(`${w} pack_count`, r.pack_count, 1, LIMITS.packCountMax),
    item_size: itemSize,
    unit: text(`${w} unit`, r.unit),
    deposit_minor: int(`${w} deposit_minor`, r.deposit_minor, 0, maxMoney),
    is_promo: int(`${w} is_promo`, r.is_promo, 0, 1),
    deal_text: textOrNull(`${w} deal_text`, r.deal_text),
    note: textOrNull(`${w} note`, r.note),
    created_at: textOrNull(`${w} created_at`, r.created_at),
    updated_at: textOrNull(`${w} updated_at`, r.updated_at),
    // upgrade step 2 -> 3: a schema-2 price was saved with the ISO 4217 decimals of its currency
    minor_digits: schemaVersion >= 3 ? int(`${w} minor_digits`, r.minor_digits, 0, 4) : currencyExponent(currency),
  };
}

function barcode(row: unknown, i: number): BarcodeRecord {
  const w = `Barcode ${i + 1}`;
  const r = fields(w, row, BARCODE_KEYS);
  if (!isCanonicalBarcode(r.code)) throw new Invalid('shape', `${w} "${String(r.code)}" is not a valid EAN/UPC code in its stored form`);
  return { code: r.code, product_id: int(`${w} product_id`, r.product_id, 1, MAX_ID), created_at: textOrNull(`${w} created_at`, r.created_at) };
}

function list<T>(where: string, v: unknown, each: (row: unknown, i: number) => T): T[] {
  if (!Array.isArray(v)) throw new Invalid('shape', `${where} must be a list`);
  return v.map(each);
}

function uniqueIds(where: string, rows: readonly { id: number }[]): Set<number> {
  const ids = new Set<number>();
  for (const r of rows) {
    if (ids.has(r.id)) throw new Invalid('duplicate', `${where} id ${r.id} appears twice`);
    ids.add(r.id);
  }
  return ids;
}

function validate(source: string, ourSchemaVersion: number): BackupFile {
  if (source.length > MAX_BACKUP_CHARS) throw new Invalid('tooLarge', `The file has ${source.length} characters; the limit is ${MAX_BACKUP_CHARS}`);
  let raw: unknown;
  try {
    raw = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  } catch {
    throw new Invalid('notJson', 'The file is not readable JSON (damaged or cut off)');
  }
  if (!isObj(raw) || raw.app !== BACKUP_APP) throw new Invalid('notPriceBook', 'This is not a Price Book backup');
  const backupVersion = raw.backupVersion;
  const schemaVersion = raw.schemaVersion;
  if (typeof backupVersion !== 'number' || !Number.isSafeInteger(backupVersion) || backupVersion < 1) throw new Invalid('shape', 'backupVersion is missing');
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new Invalid('shape', 'schemaVersion is missing');
  if (backupVersion > BACKUP_VERSION || schemaVersion > ourSchemaVersion) {
    throw new Invalid('newerVersion', `Made by a newer Price Book (backup ${backupVersion}, schema ${schemaVersion}); update the app first`);
  }
  if (schemaVersion < MIN_BACKUP_SCHEMA) throw new Invalid('unsupported', `Schema ${schemaVersion} has no Price Book data`);
  fields('The file', raw, ['app', 'backupVersion', 'schemaVersion', 'exportedAt', 'data']);
  const exportedAt = text('exportedAt', raw.exportedAt);
  const withBarcodes = schemaVersion >= BARCODES_SCHEMA;
  const data = fields('data', raw.data, ['settings', 'stores', 'products', 'observations', ...(withBarcodes ? ['barcodes'] : [])]);

  if (!isObj(data.settings)) throw new Invalid('shape', 'settings must be an object');
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(data.settings)) {
    if (UNSAVED_SETTINGS.includes(key)) continue;
    settings[key] = text(`Setting ${key}`, value);
  }
  const stores = list('stores', data.stores, store);
  const products = list('products', data.products, product);
  const observations = list('observations', data.observations, (row, i) => observation(row, i, schemaVersion));
  // upgrade step 4 -> 5: older files have no barcodes
  const barcodes = withBarcodes ? list('barcodes', data.barcodes, barcode) : [];

  const storeIds = uniqueIds('Store', stores);
  const keys = new Set<string>();
  for (const s of stores) {
    if (keys.has(s.name_key)) throw new Invalid('duplicate', `Two stores are called "${s.name}"`);
    keys.add(s.name_key);
  }
  uniqueIds('Product', products);
  uniqueIds('Price', observations);
  const dimensionOf = new Map(products.map((p) => [p.id, p.dimension]));
  for (const o of observations) {
    const dimension = dimensionOf.get(o.product_id);
    if (dimension === undefined) throw new Invalid('reference', `Price ${o.id} belongs to product ${o.product_id}, which is not in the file`);
    if (o.store_id !== null && !storeIds.has(o.store_id)) throw new Invalid('reference', `Price ${o.id} names store ${o.store_id}, which is not in the file`);
    if (!unitMatchesDimension(o.unit, dimension)) throw new Invalid('unitDimension', `Price ${o.id} is in "${o.unit}", which does not measure ${dimension}`);
  }
  const codes = new Set<string>();
  for (const b of barcodes) {
    if (codes.has(b.code)) throw new Invalid('duplicate', `Barcode ${b.code} appears twice`);
    codes.add(b.code);
    if (!dimensionOf.has(b.product_id)) throw new Invalid('reference', `Barcode ${b.code} belongs to product ${b.product_id}, which is not in the file`);
  }
  return { app: BACKUP_APP, backupVersion, schemaVersion, exportedAt, data: { settings, stores, products, observations, barcodes } };
}

/** Parses and validates a backup file's text against every rule in SPEC §6. Never throws. */
export function parseBackup(source: unknown, ourSchemaVersion: number): BackupParse {
  if (typeof source !== 'string') return { ok: false, error: { code: 'notJson', detail: 'The file is not text' } };
  try {
    const file = validate(source, ourSchemaVersion);
    return { ok: true, file, counts: countsOf(file.data) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: { code: e.code, detail: e.message } };
    return { ok: false, error: { code: 'shape', detail: e instanceof Error ? e.message : 'Unreadable file' } };
  }
}
