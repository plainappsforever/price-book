import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(__dirname, 'golden');

/**
 * Byte-for-byte golden file check. Run with UPDATE_GOLDEN=1 to (re)write the file after a deliberate
 * change, then review the diff before committing.
 */
export function expectGolden(name: string, actual: string): void {
  const path = join(DIR, name);
  if (process.env.UPDATE_GOLDEN === '1' || !existsSync(path)) {
    if (process.env.UPDATE_GOLDEN !== '1') throw new Error(`Golden file ${name} is missing; run with UPDATE_GOLDEN=1`);
    writeFileSync(path, actual, 'utf8');
  }
  expect(readFileSync(path, 'utf8')).toBe(actual);
}
