// V1.5 P1 (R10, D64): what the Save button says when the price looks already saved.
import { toPriceObservation, type DuplicateHit } from '@/db/observations';
import { formatMinor } from '@/engine/money';

import { fill } from './format';
import { strings } from './strings';

/** The Save button's text while a duplicate is pending (exact: SPEC 5.8; near: R10, D64). */
export function duplicateText(hit: DuplicateHit, locale: string): string {
  if (hit.kind === 'exact') return strings.price.duplicate;
  const o = toPriceObservation(hit.row);
  return fill(strings.price.nearDuplicate, { price: formatMinor(o.paidPriceMinor ?? o.packPriceMinor, o.currency, locale) });
}
