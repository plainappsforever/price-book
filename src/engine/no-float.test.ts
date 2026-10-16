/** @jest-environment node */
// A3 (SPEC 9): no floating-point value enters money or unit-price computation. This scans the engine
// sources (not tests) for float-producing calls. money.ts may use them only between its
// "@display-only-start" / "@display-only-end" markers (Intl formatting of already-rounded integers).
// It also guards the Hermes-safe subset: no BigInt literals and no `**` (see rational.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const sources = readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ file: f, text: readFileSync(join(dir, f), 'utf8') }));

const FLOAT_PATTERNS: [string, RegExp][] = [
  ['parseFloat', /\bparseFloat\b/],
  ['Number(', /\bNumber\(/],
  ['Math.round', /\bMath\.round\b/],
  ['Math.floor/ceil/trunc', /\bMath\.(floor|ceil|trunc)\b/],
  ['toFixed', /\.toFixed\b/],
  ['toPrecision', /\.toPrecision\b/],
];

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function withoutDisplayBlock(text: string): string {
  return text.replace(/\/\/ @display-only-start[\s\S]*?\/\/ @display-only-end/g, '');
}

describe('A3: no floating point in the engine', () => {
  it('finds the engine files', () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(['rational.ts', 'units.ts', 'parse.ts', 'money.ts', 'deals.ts', 'compare.ts', 'stats.ts', 'backup.ts', 'csv.ts']));
  });
  it.each(sources.map((s) => [s.file, s] as const))('%s has no float calls outside the display block', (_file, s) => {
    const code = withoutComments(withoutDisplayBlock(s.text));
    for (const [name, pattern] of FLOAT_PATTERNS) {
      expect({ file: s.file, pattern: name, found: pattern.test(code) }).toEqual({ file: s.file, pattern: name, found: false });
    }
  });
  it('only money.ts has a display-only block, and it is closed', () => {
    for (const s of sources) {
      const starts = (s.text.match(/@display-only-start/g) ?? []).length;
      const ends = (s.text.match(/@display-only-end/g) ?? []).length;
      expect({ file: s.file, starts, ends }).toEqual({ file: s.file, starts: s.file === 'money.ts' ? 1 : 0, ends: s.file === 'money.ts' ? 1 : 0 });
    }
  });
  it('the display block is the only place money.ts touches Number or Intl formatting', () => {
    const money = sources.find((s) => s.file === 'money.ts')!.text;
    const outside = withoutComments(withoutDisplayBlock(money));
    expect(outside).not.toMatch(/\bNumber\(/);
    expect(outside).not.toMatch(/toLocale|NumberFormat\([^)]*\)\.format/);
  });
  it('the scanner itself catches violations', () => {
    const bad = 'const x = parseFloat("1.5"); const y = Math.round(x); const z = Number(y); x.toFixed(2);';
    const hits = FLOAT_PATTERNS.filter(([, p]) => p.test(bad)).length;
    expect(hits).toBeGreaterThanOrEqual(4);
  });
});

describe('Hermes-safe subset', () => {
  it.each(sources.map((s) => [s.file, s] as const))('%s has no BigInt literals and no ** operator', (_file, s) => {
    const code = withoutComments(s.text).replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""'); // ignore string contents
    expect(code).not.toMatch(/\b\d[\d_]*n\b/);
    expect(code).not.toMatch(/\*\*/);
  });
});
