import type { Comparison, Warning } from '../src/engine/compare';
import { div, fromDecimal, pow10, rat, toDecimalString, type Rat } from '../src/engine/rational';

export type Case<I = unknown, E = unknown> = { id: string; input: I; expected: E; note: string };

/** "453.59237", "1/2" or "-1/200" (any n/d, not necessarily in lowest terms) -> exact Rat. */
export function parseRat(text: string): Rat {
  if (text.includes('/')) {
    const [n, d] = text.split('/');
    return rat(BigInt(n), BigInt(d));
  }
  const value = fromDecimal(text);
  if (!value) throw new Error(`Bad fixture number: ${text}`);
  return value;
}

/** Fails loudly if a fixture file has a case without id/note or two cases with the same id. */
export function checkCases(label: string, cases: readonly Case[]): void {
  const ids = new Set<string>();
  for (const c of cases) {
    if (!c.id || !c.note) throw new Error(`${label}: case without id or note: ${JSON.stringify(c).slice(0, 80)}`);
    if (ids.has(c.id)) throw new Error(`${label}: duplicate id ${c.id}`);
    ids.add(c.id);
  }
}

/** Compare warnings as short keys: 'W1', 'W4:961', 'W5:multiBuy:A', 'W6:takeMore:A', 'W7:price:B', 'W8:B'. */
export function warningKey(w: Warning): string {
  switch (w.code) {
    case 'W1':
    case 'W2':
      return w.code;
    case 'W4':
      return `W4:${w.times}`;
    case 'W5':
      return `W5:${w.reason}:${w.cardId}`;
    case 'W6':
      return `W6:${w.hint.kind}:${w.cardId}`;
    case 'W7':
      return `W7:${w.missing}:${w.cardId}`;
    case 'W9':
      return `W9:${w.what}`;
    default:
      return `${w.code}:${w.cardId}`;
  }
}

/** The comparison in fixture vocabulary. */
export function summary(c: Comparison) {
  const display: Record<string, string> = {};
  for (const g of c.groups) {
    for (const r of g.ranking) display[r.id] = toDecimalString(div(r.unitPrice, rat(pow10(c.exponent))), c.unitPriceDecimals);
  }
  return {
    decimals: c.unitPriceDecimals,
    groups: c.groups.map((g) => ({
      dimension: g.dimension,
      ranking: g.ranking.map((r) => r.id),
      winners: g.winners,
      tie: g.tie,
      savings: g.savings && { winnerId: g.savings.winnerId, runnerUpId: g.savings.runnerUpId, permille: g.savings.permille, moneyMinor: g.savings.moneyMinor },
      lowestToPay: g.lowestToPay,
    })),
    warnings: c.warnings.map(warningKey).sort(),
    unitDisplay: display,
  };
}
