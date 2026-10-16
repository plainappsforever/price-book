// Dev measurement for A17 (SPEC 9): "the product screen opens in under 1 s". The list row stamps the time of the
// tap; the Product screen reports the time since that stamp once its statistics are on screen.
let stamp: number | null = null;

export function markNav(): void {
  stamp = Date.now();
}

/** Milliseconds since the last `markNav`, or null when there is none (screen opened another way). */
export function elapsedSinceNav(): number | null {
  const ms = stamp === null ? null : Date.now() - stamp;
  stamp = null;
  return ms;
}

let listStamp: number | null = null;

/** The Price Book list started loading (a query was sent). */
export function markList(): void {
  listStamp = Date.now();
}

/** Milliseconds since the last `markList`, once; null when nothing is pending. */
export function elapsedSinceList(): number | null {
  const ms = listStamp === null ? null : Date.now() - listStamp;
  listStamp = null;
  return ms;
}
