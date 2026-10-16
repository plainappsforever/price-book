// Name normalisation shared by the database (src/db/stores.ts) and backup validation (review #11): one rule, so a
// restored store's `name_key` always matches what `createStore` would compute.

/** Trimmed, inner whitespace collapsed to one space. */
export function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

/** Unique key of a store name: cleaned and lower-cased ("  ALDI  Süd " -> "aldi süd"). */
export function storeNameKey(name: string): string {
  return cleanName(name).toLowerCase();
}
