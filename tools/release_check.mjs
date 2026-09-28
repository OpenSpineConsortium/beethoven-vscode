#!/usr/bin/env node
// Checks a built .vsix the way a student would receive it. Fails (exit 2) on anything that must not
// ship: source maps, test fixtures, the test signing key, a missing licence or notices file, the
// wrong licence field, an unminified bundle, a copyleft dependency, or the old credential capture.
// Usage: node tools/release_check.mjs dist/ashley-2.0.0.vsix [--unpack dist/unpacked]
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** A small zip reader (central directory; stored and deflated entries): no dependency, works everywhere. */
export function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    entries.set(name, () => (method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : (() => { throw new Error(`unsupported zip method ${method} for ${name}`); })()));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function checkVsix(file, opts = {}) {
  const problems = [];
  const notes = [];
  const zip = readZip(fs.readFileSync(file));
  const names = [...zip.keys()];
  const text = (n) => zip.get(n)().toString('utf8');
  const has = (n) => zip.has(n);

  for (const n of names) {
    if (n.endsWith('.map')) problems.push(`source map shipped: ${n}`);
    if (n.startsWith('extension/test-fixtures/')) problems.push(`test fixture shipped: ${n}`);
    if (n.startsWith('extension/src/')) problems.push(`source shipped: ${n}`);
    if (/\.pem$/.test(n)) problems.push(`private key material shipped: ${n}`);
  }
  for (const n of ['extension/package.json', 'extension/LICENSE.txt', 'extension/PRIVACY.md', 'extension/THIRD_PARTY_NOTICES.md', 'extension/dist/extension.js', 'extension/dist/mcp-server.js', 'extension/dist/ashley-cli.js', 'extension/dist/grid/license.js', 'extension/dist/grid/license_keys.json', 'extension/dist/grid/ashley', 'extension/dist/grid/ashleyd.js']) {
    if (!has(n)) problems.push(`missing: ${n}`);
  }
  if (has('extension/package.json')) {
    const pj = JSON.parse(text('extension/package.json'));
    if (pj.license !== 'SEE LICENSE IN LICENSE.txt') problems.push(`package.json license is "${pj.license}", not "SEE LICENSE IN LICENSE.txt"`);
    if (/wsu|wayne/i.test(`${pj.name} ${pj.displayName}`)) problems.push(`extension name or display name carries the university's name: ${pj.name} / ${pj.displayName}`);
    notes.push(`${pj.publisher}.${pj.name} ${pj.version}`);
  }
  // release keys, and never the test key
  let testRaw = '';
  try {
    const pem = fs.readFileSync(path.join(REPO, 'extension', 'test-fixtures', 'license', 'test-signing-key.pem'), 'utf8');
    const der = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ type: 'spki', format: 'der' });
    testRaw = der.subarray(der.length - 32).toString('base64');
  } catch {
    notes.push('no test signing key in this checkout (fine outside the repository)');
  }
  if (has('extension/dist/grid/license_keys.json')) {
    const keys = JSON.parse(text('extension/dist/grid/license_keys.json'));
    const kids = Object.keys(keys);
    if (!kids.length) problems.push('license_keys.json trusts no signing key');
    if (testRaw && Object.values(keys).includes(testRaw)) problems.push('the TEST signing key is trusted by the release');
    notes.push(`trusted signing keys: ${kids.join(', ') || 'none'}`);
  }
  for (const b of ['extension/dist/extension.js', 'extension/dist/mcp-server.js', 'extension/dist/ashley-cli.js']) {
    if (!has(b)) continue;
    const js = text(b);
    if (/sourceMappingURL/.test(js)) problems.push(`${b} references a source map`);
    if (!/Licensed software/.test(js.slice(0, 600))) problems.push(`${b} lacks the licence notice`);
    if (testRaw && js.includes(testRaw)) problems.push(`${b} embeds the TEST signing key`);
    if (js.length / js.split('\n').length < 200) problems.push(`${b} is not minified (average line length ${Math.round(js.length / js.split('\n').length)})`);
    if (/\bsetup-token\b/.test(js)) problems.push(`${b} still contains the setup-token capture (Ashley must not handle Claude credentials)`);
    if (/sk-ant-oat01-[A-Za-z0-9_-]{30,}/.test(js)) problems.push(`${b} contains a token-shaped string`);
  }
  if (has('extension/THIRD_PARTY_NOTICES.md')) {
    const rows = text('extension/THIRD_PARTY_NOTICES.md').split('\n').filter((l) => /^\| [^|]+ \| [^|]+ \| [^|]+ \| [^|]+ \|$/.test(l) && !/^\| Package/.test(l) && !/^\|---/.test(l));
    const allow = /^(MIT|ISC|BSD-2-Clause|BSD-3-Clause|Apache-2\.0|0BSD|Unlicense|CC0-1\.0|BlueOak-1\.0\.0)$/;
    for (const r of rows) {
      const lic = r.split('|')[3].trim();
      const parts = lic.replace(/[()]/g, '').split(/\s+OR\s+/);
      if (!parts.some((p) => allow.test(p.trim()))) problems.push(`dependency licence not on the allowlist: ${r.split('|')[1].trim()} (${lic})`);
    }
    notes.push(`${rows.length} third-party packages listed`);
  }
  if (opts.unpack) {
    for (const [n, get] of zip) {
      const out = path.join(opts.unpack, n);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      if (!n.endsWith('/')) fs.writeFileSync(out, get());
    }
    notes.push(`unpacked to ${opts.unpack}`);
  }
  return { problems, notes, files: names.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const ui = args.indexOf('--unpack');
  const unpack = ui >= 0 ? args[ui + 1] : undefined;
  if (!files.length) {
    console.error('usage: release_check.mjs <file.vsix> [--unpack dir]');
    process.exit(1);
  }
  let bad = 0;
  for (const f of files) {
    const r = checkVsix(f, { unpack });
    console.log(`${path.basename(f)}: ${r.files} files; ${r.notes.join('; ')}`);
    for (const p of r.problems) console.log(`  PROBLEM ${p}`);
    bad += r.problems.length;
  }
  console.log(bad ? `${bad} problem(s): this build must not ship` : 'release checks passed');
  process.exit(bad ? 2 : 0);
}
