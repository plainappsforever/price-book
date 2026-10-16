// Dev-only engine self-test shown on About (P4, D26): runs SPEC E3 and E8, S1 statistics and the ISO 4217 table
// on whatever JavaScript engine the app runs on — on a phone that is Hermes, which proves BigInt and the exact
// maths there. Maestro asserts the line "engine OK"; Jest runs the same checks on Node.
import { compareCards } from '@/engine/compare';
import { evaluateCard } from '@/engine/deals';
import { currencyExponent, formatMinor, formatUnitPrice } from '@/engine/money';
import { eq, rat, toDecimalString } from '@/engine/rational';
import { gauge, majorToMinorRat, productStats } from '@/engine/stats';
import { toPriceObservation } from '@/db/observations';

import { seedData } from './seeds';

export type SelfTestCheck = { name: string; ok: boolean; detail: string };

function check(name: string, run: () => [boolean, string]): SelfTestCheck {
  try {
    const [ok, detail] = run();
    return { name, ok, detail };
  } catch (e) {
    return { name, ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export function runEngineSelfTest(): SelfTestCheck[] {
  const eur = { currency: 'EUR', taxMode: 'include' as const, measurementSystem: 'metric' as const };
  return [
    check('BigInt', () => {
      const big = BigInt('123456789012345678901234567890') * BigInt(3);
      return [big.toString() === '370370367037037036703703703670', big.toString()];
    }),
    check('E3 400 g €1.89 = €4.73/kg (exact 4.725)', () => {
      const e = evaluateCard({ id: 'A', priceMinor: 189, size: { packCount: 1, itemSize: '400' }, unit: 'g' }, eur);
      if (!e.ok) return [false, e.missing];
      const shown = formatUnitPrice(e.breakdown.unitPrice, 'EUR', 2, 'en-US');
      return [eq(e.breakdown.unitPrice, rat(945, 2)) && shown === '€4.73', shown];
    }),
    check('E8 3 for 2 wins by 33.3 %, saves €2.28', () => {
      const c = compareCards(
        [
          { id: 'A', priceMinor: 229, size: { packCount: 1, itemSize: '500' }, unit: 'g', deals: { quantity: { kind: 'buyXGetY', x: 2, y: 1, pct: '100' } } },
          { id: 'B', priceMinor: 549, size: { packCount: 1, itemSize: '1.2' }, unit: 'kg' },
        ],
        eur
      );
      const s = c.groups[0]?.savings;
      const a = c.cards[0].evaluation;
      const u = a.ok ? toDecimalString(a.breakdown.unitPrice, 2) : '-';
      return [!!s && s.winnerId === 'A' && s.permille === 333 && s.moneyMinor === 228 && u === '305.33', `U_A ${u}, ${s?.permille}‰, ${s?.moneyMinor}`];
    }),
    check('S1 usual €4.98, 4.49 = Good price −10 %', () => {
      const obs = seedData('s1').observations.filter((o) => o.product_id === 1).map(toPriceObservation);
      const stats = productStats(obs, '2026-09-30', { currency: 'EUR', dimension: 'mass', measurementSystem: 'metric' });
      const g = gauge(stats, majorToMinorRat('4.49', 2)!);
      const usual = stats.usual ? toDecimalString(stats.usual.value, 0) : '-';
      return [usual === '498' && g.kind === 'verdict' && g.verdict === 'good' && g.percentVsUsual === -10, `usual ${usual}, ${JSON.stringify(g.kind === 'verdict' ? [g.verdict, g.percentVsUsual] : g)}`];
    }),
    check('ISO 4217 decimals: HUF 2, IQD 3, JPY 0, KWD 3', () => {
      const got = ['HUF', 'IQD', 'JPY', 'KWD'].map((c) => `${c}${currencyExponent(c)}`).join(' ');
      return [got === 'HUF2 IQD3 JPY0 KWD3', got];
    }),
    check('Intl formats HUF and IQD with the table decimals', () => {
      const huf = formatMinor(49900, 'HUF', 'en-US');
      const iqd = formatMinor(12345, 'IQD', 'en-US');
      return [huf.includes('499.00') && iqd.includes('12.345'), `${huf} · ${iqd}`];
    }),
  ];
}
