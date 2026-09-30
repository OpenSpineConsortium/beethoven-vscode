#!/usr/bin/env node
// A release, end to end, on the maintainer's machine:
//   1 production bundles (minified, no maps, release keys only)   node esbuild.mjs --production
//   2 third-party notices                                         tools/third_party_notices.mjs
//   3 package                                                     vsce package
//   4 release checks, and an unpacked copy for the package tests   tools/release_check.mjs
//   5 dist/release/<version>/: the .vsix, SHA256SUMS, SHA256SUMS.sig (the licence signing key)
// Usage: node tools/release.mjs [--no-sign]
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVsix } from './release_check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const EXT = path.join(REPO, 'extension');
const run = (cmd, args, cwd = EXT) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

const pj = JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8'));
const version = pj.version;
const vsix = path.join(REPO, 'dist', `${pj.name}-${version}.vsix`);
fs.rmSync(path.join(REPO, 'dist', 'unpacked'), { recursive: true, force: true });

run('node', ['esbuild.mjs', '--production']);
run('node', [path.join(REPO, 'tools', 'third_party_notices.mjs')]);
run('npx', ['vsce', 'package', '--no-dependencies', '--out', path.join(REPO, 'dist') + path.sep]);
const r = checkVsix(vsix, { unpack: path.join(REPO, 'dist', 'unpacked') });
console.log(`${path.basename(vsix)}: ${r.files} files; ${r.notes.join('; ')}`);
for (const p of r.problems) console.log(`  PROBLEM ${p}`);
if (r.problems.length) {
  console.error(`${r.problems.length} problem(s): not released`);
  process.exit(2);
}
const out = path.join(REPO, 'dist', 'release', version);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(vsix, path.join(out, path.basename(vsix)));
for (const f of ['CHANGELOG.md', 'LICENSE.txt', 'LICENSE-FULL.txt', 'PRIVACY.md', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(EXT, f), path.join(out, f));
if (!process.argv.includes('--no-sign')) {
  try {
    run('node', [path.join(REPO, 'tools', 'license', 'beethoven-license.mjs'), 'sign-release', out], REPO);
  } catch {
    console.log('release not signed (no signing key on this machine); SHA256SUMS.sig missing');
  }
}
console.log(`release ${version} in ${out}`);
