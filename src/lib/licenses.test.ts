/** @jest-environment node */
// RELEASE_KIT 1c item 14: the licence notices list every package the lock file installs for the app (not dev tools).
// Fails after a dependency change until `node scripts/gen-licenses.js` is run again.
import * as fs from 'node:fs';
import * as path from 'node:path';

import licenses from '@/constants/licenses.json';

const root = path.join(__dirname, '..', '..');

describe('open-source licence notices', () => {
  it('cover exactly the installed non-dev packages of package-lock.json', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version?: string; dev?: boolean; devOptional?: boolean }> };
    const expected = new Set(
      Object.entries(lock.packages)
        .filter(([key, v]) => key.startsWith('node_modules/') && !v.dev && !v.devOptional && fs.existsSync(path.join(root, key, 'package.json')))
        .map(([key, v]) => `${key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)}@${v.version}`)
    );
    const listed = new Set(licenses.packages.map((p) => `${p.n}@${p.v}`));
    expect([...expected].filter((x) => !listed.has(x))).toEqual([]);
    expect([...listed].filter((x) => !expected.has(x))).toEqual([]);
    for (const name of ['react-native', 'expo', 'expo-sqlite', 'react']) expect(licenses.packages.some((p) => p.n === name && p.t >= 0)).toBe(true);
  });
});
