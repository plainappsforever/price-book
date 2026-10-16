/** @jest-environment node */
// The device probe (debug/db-probe) must pass on node:sqlite too, plain and with forced interleaving.
import { createTestDb } from '../../test/node-sqlite-db';

import { dbHealth, runDbProbes } from './probe';
import { migrate } from './migrations';

describe('runDbProbes on node:sqlite', () => {
  for (const slow of [false, true]) {
    it(`all probes pass (${slow ? 'slowed' : 'plain'})`, async () => {
      const db = createTestDb();
      const results = await runDbProbes(async () => db, { slow });
      expect(results.filter((r) => !r.ok)).toEqual([]);
      expect(results.length).toBe(8);
    });
  }
  it('dbHealth reports version, foreign keys, the migration-3/4 columns and the migration-5 table', async () => {
    const db = createTestDb();
    await migrate(db);
    expect(await dbHealth(db)).toEqual({ userVersion: 5, foreignKeys: 1, hasMinorDigits: true, hasProductUid: true, hasBarcodes: true });
  });
});
