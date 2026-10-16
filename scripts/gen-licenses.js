#!/usr/bin/env node
// Open-source licence notices for Settings > About > Licences (RELEASE_KIT 1c item 14).
// Reads every non-dev package in package-lock.json (over-inclusive: build-time packages are listed too) and its licence
// file in node_modules, and writes src/constants/licenses.json: one entry per package (name, version, SPDX id, copyright
// lines) plus the distinct licence texts with copyright lines taken out (packages point at their text by index).
// Run after any dependency change: node scripts/gen-licenses.js  (a Jest test fails when the list is out of date).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const FILES = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown|mit|bsd))?$/i;

function licenseFile(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const hit = names.filter((n) => FILES.test(n)).sort((a, b) => a.length - b.length)[0];
  return hit ? fs.readFileSync(path.join(dir, hit), 'utf8') : null;
}

const isCopyright = (line) => /^\s*(\(c\)|©|copyright\b)/i.test(line) && !/copyright (notice|holders?|owner)/i.test(line) && line.length < 200;
const spdx = (l) => (typeof l === 'string' ? l : l && typeof l === 'object' && l.type ? l.type : 'UNKNOWN');

const packages = [];
const texts = [];
const textIndex = new Map();
const entries = Object.entries(lock.packages)
  // Installed on this Mac only: optional platform packages for other systems (e.g. @esbuild/linux-*) never ship.
  .filter(([key, v]) => key.startsWith('node_modules/') && !v.dev && !v.devOptional && fs.existsSync(path.join(root, key, 'package.json')))
  .map(([key, v]) => ({ key, name: key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length), version: v.version, license: spdx(v.license) }))
  .sort((a, b) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version)));

const seen = new Set();
for (const e of entries) {
  const id = `${e.name}@${e.version}`;
  if (seen.has(id)) continue;
  seen.add(id);
  const raw = licenseFile(path.join(root, e.key));
  let t = -1;
  let copyright = [];
  if (raw) {
    const lines = raw.replace(/\r\n?/g, '\n').split('\n');
    copyright = [...new Set(lines.filter(isCopyright).map((l) => l.trim()))].slice(0, 4);
    const body = lines.filter((l) => !isCopyright(l)).join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!textIndex.has(body)) {
      textIndex.set(body, texts.length);
      texts.push(body);
    }
    t = textIndex.get(body);
  }
  packages.push({ n: e.name, v: e.version, l: e.license, c: copyright, t });
}

// A package that ships no licence file (e.g. @react-native/*, metro: the licence sits at the root of their repository)
// points at the text most packages with the same SPDX id use.
const usual = new Map();
for (const id of new Set(packages.map((p) => p.l))) {
  const counts = new Map();
  for (const p of packages) if (p.l === id && p.t >= 0) counts.set(p.t, (counts.get(p.t) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) usual.set(id, best[0]);
}
for (const p of packages) if (p.t < 0 && usual.has(p.l)) p.t = usual.get(p.l);

const out = { generatedFrom: 'package-lock.json', count: packages.length, packages, texts };
fs.writeFileSync(path.join(root, 'src/constants/licenses.json'), `${JSON.stringify(out)}\n`);
console.log(`licenses.json: ${packages.length} packages, ${texts.length} distinct licence texts, ${packages.filter((p) => p.t < 0).length} without a licence file`);
