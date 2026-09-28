#!/usr/bin/env node
// Writes extension/THIRD_PARTY_NOTICES.md from what esbuild actually put into the bundles
// (extension/build-meta/*.json, written by every build): each npm package, its version, its
// licence and the full licence text. Fails when a package's licence is copyleft or unknown,
// because Ashley's own code is not open source. Run after `node esbuild.mjs --production`.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(HERE, '..', 'extension');
const META = path.join(EXT, 'build-meta');
const OUT = path.join(EXT, 'THIRD_PARTY_NOTICES.md');
const PERMISSIVE = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|Unlicense|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|Zlib)$/;
const COPYLEFT = /GPL|MPL|EPL|CDDL|SSPL|EUPL|OSL|CPAL|RPL/i;

if (!fs.existsSync(META)) {
  console.error('no build-meta: run node esbuild.mjs --production first');
  process.exit(1);
}
const pkgDirs = new Map(); // dir -> bundles using it
for (const f of fs.readdirSync(META).filter((f) => f.endsWith('.json'))) {
  const meta = JSON.parse(fs.readFileSync(path.join(META, f), 'utf8'));
  for (const input of Object.keys(meta.inputs)) {
    const norm = input.replace(/\\/g, '/');
    const i = norm.lastIndexOf('node_modules/');
    if (i < 0) continue;
    const rest = norm.slice(i + 'node_modules/'.length).split('/');
    const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
    const dir = path.resolve(EXT, norm.slice(0, i + 'node_modules/'.length) + name);
    if (!pkgDirs.has(dir)) pkgDirs.set(dir, new Set());
    pkgDirs.get(dir).add(f.replace(/\.json$/, ''));
  }
}

function licenseOf(pj) {
  if (typeof pj.license === 'string') return pj.license;
  if (pj.license && pj.license.type) return pj.license.type;
  if (Array.isArray(pj.licenses)) return pj.licenses.map((l) => l.type || l).join(' OR ');
  return 'UNKNOWN';
}
function licenseText(dir) {
  const f = fs.readdirSync(dir).find((x) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(x)) ?? fs.readdirSync(dir).find((x) => /^licen[cs]e/i.test(x));
  return f ? fs.readFileSync(path.join(dir, f), 'utf8').trim() : null;
}
function noticeText(dir) {
  const f = fs.readdirSync(dir).find((x) => /^notice(\.(md|txt))?$/i.test(x));
  return f ? fs.readFileSync(path.join(dir, f), 'utf8').trim() : null;
}

const rows = [];
const problems = [];
for (const [dir, bundles] of [...pkgDirs].sort((a, b) => a[0].localeCompare(b[0]))) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lic = licenseOf(pj);
  const parts = lic.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/);
  const orOnly = !/\sAND\s/.test(lic);
  const acceptable = orOnly ? parts.some((p) => PERMISSIVE.test(p.trim())) : parts.every((p) => PERMISSIVE.test(p.trim()));
  if (COPYLEFT.test(lic) && !acceptable) problems.push(`${pj.name}@${pj.version}: ${lic} (copyleft)`);
  else if (!acceptable) problems.push(`${pj.name}@${pj.version}: ${lic} (not on the permissive list; review by hand)`);
  let text = licenseText(dir);
  if (!text) {
    // a package without its own licence file: read it from the package it belongs to, else say so
    text = `(no licence file in the package; package.json declares ${lic})`;
  }
  rows.push({ name: pj.name, version: pj.version, lic, text, notice: noticeText(dir), bundles: [...bundles].sort(), repo: typeof pj.repository === 'string' ? pj.repository : pj.repository?.url ?? pj.homepage ?? '' });
}

// one entry per package name+version (a package can sit in two node_modules folders)
const seen = new Set();
const unique = rows.filter((r) => (seen.has(`${r.name}@${r.version}`) ? false : seen.add(`${r.name}@${r.version}`)));
const lines = [
  '# Third-party notices',
  '',
  'Ashley includes the open-source packages below, bundled into its JavaScript files. Each is used',
  'under its own licence, reproduced here as that licence requires. Ashley\'s own licence (LICENSE.txt)',
  'does not change the terms of these packages.',
  '',
  'Not distributed by Ashley: Claude Code, Node.js and the container image, which the setup installs on',
  'your own grid account from their public sources under their own terms, and the Visual Studio Code',
  'extensions it asks you to install.',
  '',
  '| Package | Version | Licence | In |',
  '|---|---|---|---|',
  ...unique.map((r) => `| ${r.name} | ${r.version} | ${r.lic} | ${r.bundles.join(', ')} |`),
  '',
];
for (const r of unique) {
  lines.push(`## ${r.name} ${r.version}`, '', `Licence: ${r.lic}${r.repo ? `. Source: ${r.repo.replace(/^git\+/, '')}` : ''}`, '', '```', r.text, '```', '');
  if (r.notice) lines.push('NOTICE:', '', '```', r.notice, '```', '');
}
fs.writeFileSync(OUT, lines.join('\n'));
console.log(`${unique.length} packages -> ${path.relative(process.cwd(), OUT)}`);
if (problems.length) {
  console.error('licence problems:\n  ' + problems.join('\n  '));
  process.exit(2);
}
