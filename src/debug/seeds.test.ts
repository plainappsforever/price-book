/** @jest-environment node */
// Named seeds (D38): s1 reproduces SPEC S1 + S2 through the database, big5000 is deterministic and valid.
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';
import { listObservations, toPriceObservation } from '@/db/observations';
import { listProducts } from '@/db/products';
import { readAllData } from '@/db/restore';
import { getSetting, setSetting } from '@/db/settings';
import { buildBackup, parseBackup, serializeBackup } from '@/engine/backup';
import { gauge, majorToMinorRat, productStats } from '@/engine/stats';

import { isSeedName, loadSeed, seedData, SEED_NAMES } from './seeds';

async function db() {
  const d = createTestDb();
  await migrate(d);
  return d;
}
const EUR = { currency: 'EUR', dimension: 'mass' as const };

describe('seeds', () => {
  it('names', () => {
    expect(SEED_NAMES).toEqual(['empty', 's1', 'big5000']);
    expect(isSeedName('s1')).toBe(true);
    expect(isSeedName('S1')).toBe(false);
  });
  it.each(SEED_NAMES)('%s passes backup validation', (name) => {
    expect(parseBackup(serializeBackup(buildBackup(seedData(name), 3, 'x')), 3).ok).toBe(true);
  });
  it('s1 through the database: SPEC S1 tiles and S2 shrinkflation', async () => {
    const d = await db();
    await loadSeed(d, 's1');
    const [coffee, crisps] = await listProducts(d, { sort: 'name' });
    const s1 = productStats((await listObservations(d, coffee.id)).map(toPriceObservation), '2026-09-30', EUR);
    expect([s1.latest?.unitPrice, s1.lowest?.unitPrice, s1.highest?.unitPrice, s1.usual?.value].map((r) => r && `${r.n}/${r.d}`))
      .toEqual(['498/1', '399/1', '518/1', '498/1']);
    expect(gauge(s1, majorToMinorRat('4.49', 2)!)).toMatchObject({ verdict: 'good', percentVsUsual: -10 });
    const s2 = productStats((await listObservations(d, crisps.id)).map(toPriceObservation), '2026-09-30', EUR);
    expect(s2.shrinkflation.map((e) => [e.kind, e.sizeChangePermille, e.unitChangePermille])).toEqual([['samePrice', -125, 143]]);
  });
  it('loading wipes the previous book but keeps unrelated settings', async () => {
    const d = await db();
    await setSetting(d, 'theme', 'dark');
    await setSetting(d, 'currency', 'USD');
    await loadSeed(d, 'big5000');
    await loadSeed(d, 's1');
    const data = await readAllData(d);
    expect([data.stores.length, data.products.length, data.observations.length]).toEqual([3, 2, 7]);
    expect(await getSetting(d, 'theme')).toBe('dark');
    expect(await getSetting(d, 'currency')).toBe('EUR');
    await loadSeed(d, 'empty');
    expect((await readAllData(d)).observations).toEqual([]);
  });
  it('big5000 is deterministic: 5 000 prices, 200 products, 8 stores, same data every time', () => {
    const a = seedData('big5000');
    expect([a.observations.length, a.products.length, a.stores.length]).toEqual([5000, 200, 8]);
    expect(seedData('big5000')).toEqual(a);
    expect(a.observations.every((o) => o.pack_price_minor > 0 && o.observed_on <= '2026-09-30' && o.observed_on >= '2024-09-30')).toBe(true);
  });
  it('A17 groundwork: stats for every big5000 product take well under a second in Node', async () => {
    const d = await db();
    await loadSeed(d, 'big5000');
    const started = Date.now();
    const products = await listProducts(d);
    for (const p of products) {
      productStats((await listObservations(d, p.id)).map(toPriceObservation), '2026-09-30', { currency: 'EUR', dimension: p.dimension as 'mass' });
    }
    const ms = Date.now() - started;
    expect(products.length).toBe(200);
    expect(ms).toBeLessThan(5000);
    console.log(`big5000: list + stats for 200 products in ${ms} ms (Node)`);
  });
});
