#!/usr/bin/env node
/*! Beethoven for VS Code (c) 2026 OpenSpineConsortium. Licensed software. See extension/LICENSE.txt. */
// The licence issuer's tool. Runs on the issuer's own computer only. (Its old name, ashley-license.mjs, still runs it.)
//
//   node tools/license/beethoven-license.mjs init [--kid k1] [--encrypt]      make a signing key (once)
//   node tools/license/beethoven-license.mjs issue --access-id ab1234 --name "A. Student" [--email ...]
//        [--edition student|lab|trial] [--days 365 | --until 2027-09-30]        (one person per key; no site keys)
//        [--grace 14] [--features a,b] [--kid k1] [--note "..."] [--prefix ashley|beethoven]      print a license key
//   node tools/license/beethoven-license.mjs verify <key | --file path> [--access-id ab1234]      (either prefix)
//   node tools/license/beethoven-license.mjs list
//   node tools/license/beethoven-license.mjs revoke --lid L-... [--reason "..."] [--prefix ashley|beethoven]
//   node tools/license/beethoven-license.mjs sign-release <dir>              SHA256SUMS + SHA256SUMS.sig
//   node tools/license/beethoven-license.mjs verify-release <dir>
//   node tools/license/beethoven-license.mjs sign-killlist [--kid k1] [--revoked-versions 1.0.0,2.0.0] [--revoked-lids L-a,L-b]
//        [--message "..."] [--out path] [--prefix ashley|beethoven]   Beethoven's signed withdrawn-versions list (JSON)
//   node tools/license/beethoven-license.mjs verify-killlist <path>          (either prefix)
//
// --prefix: keys are signed ASHLEY1 and lists ASHLEYREV1 unless --prefix beethoven asks for BEETHOVEN1 and
// BEETHOVENREV1. Flip only after every installed build older than Beethoven 8.0.0 and Beethoven for VS
// Code 4.0.0 is retired: those builds, and the grid scripts before 7, accept the old prefixes only
// (grid/license.js says the same). The verifiers here, license.js's own, accept both. A kill-list is
// never signed with the new prefix into killlist.json or bridge-killlist.json.
//
// The private signing keys and the ledger of issued licenses (names, e-mails) live in the vendor
// folder, never in the repository: BEETHOVEN_VENDOR_DIR, else ~/.beethoven-vendor (vendor.mjs gives the
// whole order, the old ASHLEY_VENDOR_DIR and ~/.ashley-vendor included). Only public keys
// (grid/license_keys.json) and the signed revocation list (extension/media/revoked.txt, license ids
// only) go into the repository.
import { createRequire } from 'node:module';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vendorFolder, vendorPassphrase } from './vendor.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const L = require(path.join(REPO, 'grid', 'license.js'));
// both prefixes, and the issuing switch, arrived in license.js with grid scripts 7
if (typeof L.issuedPrefix !== 'function' || !Array.isArray(L.REV_PREFIXES)) {
  process.stderr.write('beethoven-license: grid/license.js is older than grid scripts 7 (no issuedPrefix, no REV_PREFIXES)\n');
  process.exit(1);
}
const KEYS_FILE = path.join(REPO, 'grid', 'license_keys.json');
const BUNDLED_REVOKED = path.join(REPO, 'extension', 'media', 'revoked.txt');
const VENDOR = vendorFolder();
// the signature domain of every SHA256SUMS.sig: a format tag, not a name, so it never changes (renaming
// it would make every signed release before the rename fail verify-release)
const RELEASE_DOMAIN = 'ASHLEY-RELEASE1\n';
const EDITIONS = ['student', 'lab', 'trial'];

function die(msg) {
  process.stderr.write(`beethoven-license: ${msg}\n`);
  process.exit(1);
}
function flag(args, name, dflt) {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) die(`${name} needs a value`);
  return v;
}
function has(args, name) {
  return args.includes(name);
}
/** --prefix ashley (the default) or beethoven: { name, key, list }, the prefixes a key or a list is signed with */
function prefixFlag(args) {
  const name = String(flag(args, '--prefix', 'ashley')).trim().toLowerCase();
  if (name !== 'ashley' && name !== 'beethoven') die(`--prefix is ashley or beethoven, not ${name}`);
  return { name, key: L.issuedPrefix(name, 'key'), list: L.issuedPrefix(name, 'list') };
}
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function vendorDir(sub = '') {
  if (inside(VENDOR, REPO)) die(`the vendor folder ${VENDOR} is inside the repository; private keys must never be committed. Set BEETHOVEN_VENDOR_DIR elsewhere.`);
  const d = path.join(VENDOR, sub);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}
function readKeys() {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function newestKid() {
  const kids = fs.existsSync(path.join(VENDOR, 'keys')) ? fs.readdirSync(path.join(VENDOR, 'keys')).filter((f) => f.endsWith('.pem')).map((f) => f.slice(0, -4)) : [];
  const trusted = readKeys();
  // the newest RELEASE key: trial keys (kid starting with "trial") sign only trials
  const usable = kids.filter((k) => trusted[k] && !/^trial/.test(k)).sort();
  return usable[usable.length - 1];
}
function trialKid() {
  const trusted = readKeys();
  const kids = Object.keys(trusted).filter((k) => /^trial/.test(k) && fs.existsSync(path.join(VENDOR, 'keys', `${k}.pem`))).sort();
  return kids[kids.length - 1];
}
function privateKey(kid) {
  const f = path.join(VENDOR, 'keys', `${kid}.pem`);
  if (!fs.existsSync(f)) die(`no private key ${f}; run init first`);
  const pem = fs.readFileSync(f, 'utf8');
  const passphrase = pem.includes('ENCRYPTED') ? vendorPassphrase() : undefined;
  if (pem.includes('ENCRYPTED') && !passphrase) die('this signing key is encrypted: set BEETHOVEN_VENDOR_PASSPHRASE');
  const key = crypto.createPrivateKey({ key: pem, format: 'pem', passphrase });
  // the private key must match the public key the release trusts
  const pub = L.rawFromPublicKey(crypto.createPublicKey(key));
  if (readKeys()[kid] !== pub) die(`key ${kid} does not match grid/license_keys.json`);
  return key;
}
function ledgerPath() {
  return path.join(vendorDir(), 'ledger.jsonl');
}
function readLedger() {
  const f = ledgerPath();
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function writeLedger(rows) {
  const f = ledgerPath();
  fs.writeFileSync(`${f}.part`, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), { mode: 0o600 });
  fs.renameSync(`${f}.part`, f);
}
function dateEnd(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) die(`--until wants YYYY-MM-DD, got ${s}`);
  return Math.floor(Date.parse(`${s}T23:59:59Z`) / 1000);
}

// Beethoven's kill-list (the browser edition: extension/src/licensing/killlist.ts): a JSON document whose
// readable fields are repeated inside `sig`, a complete ASHLEYREV1 (or BEETHOVENREV1) token, so the
// extension trusts only what was signed while a person can still read the file. The verifier checks the
// token's own payload part, as license.js open() does, so no canonical key order is involved; the fields
// are written in the order the extension documents. The signing bytes are license.js sign()'s, which it
// does not export, spelled out here.
const KILL_FIELDS = ['v', 'kid', 'issued', 'revoked_versions', 'revoked_lids', 'message'];
// the files Beethoven 4.0.0 to 7.0.0 fetch and verify as ASHLEYREV1 only: never signed with the new prefix
const KILL_FILES_READ_BY_SHIPPED_BUILDS = ['killlist.json', 'bridge-killlist.json'];
function b64u(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(String(s))) throw new Error('not base64url');
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function signKillList(payload, key, prefix) {
  const body = `${prefix}.${b64u(Buffer.from(JSON.stringify(payload), 'utf8'))}`;
  return `${body}.${b64u(crypto.sign(null, Buffer.from(body, 'ascii'), key))}`;
}
/** Returns { ok, detail, payload? }: the signature against the trusted public keys, then the readable copy against the signed one. */
function verifyKillListDoc(doc, keys) {
  if (!doc || typeof doc !== 'object') return { ok: false, detail: 'not a JSON object' };
  if (typeof doc.sig !== 'string') return { ok: false, detail: 'no sig field' };
  const parts = doc.sig.trim().split('.');
  if (parts.length !== 3 || !L.REV_PREFIXES.includes(parts[0])) return { ok: false, detail: `sig is not an ${L.REV_PREFIXES.join(' or ')} token` };
  let payload;
  try {
    payload = JSON.parse(unb64u(parts[1]).toString('utf8'));
  } catch {
    return { ok: false, detail: 'the signed payload is not JSON' };
  }
  const raw = payload && Object.prototype.hasOwnProperty.call(keys, payload.kid) ? keys[payload.kid] : undefined;
  if (!raw) return { ok: false, detail: `unknown signing key ${payload && payload.kid}`, payload };
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), L.publicKeyFromRaw(raw), unb64u(parts[2]));
  } catch {
    ok = false;
  }
  if (!ok) return { ok: false, detail: 'the signature does NOT verify', payload };
  if (payload.v !== 1) return { ok: false, detail: 'the signed payload is malformed (v)', payload };
  const versions = Array.isArray(payload.revoked_versions) ? payload.revoked_versions : [];
  const lids = Array.isArray(payload.revoked_lids) ? payload.revoked_lids : Array.isArray(payload.revoked) ? payload.revoked : [];
  // the extension enforces the signed payload and ignores the readable fields; a person reads the readable ones, so they must agree
  const differ = KILL_FIELDS.filter((k) => k in payload && JSON.stringify(doc[k]) !== JSON.stringify(payload[k]));
  if (differ.length) return { ok: false, detail: `the readable fields differ from the signed payload: ${differ.join(', ')}`, payload };
  return { ok: true, detail: `${parts[0]}, signed by ${payload.kid}, ${versions.length} withdrawn version(s), ${lids.length} withdrawn license(s), list of ${new Date((Number(payload.issued) || 0) * 1000).toISOString().slice(0, 10)}`, payload };
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'init': {
    const kid = flag(args, '--kid', 'k1');
    if (!/^[a-z0-9-]{1,16}$/.test(kid)) die('--kid: lowercase letters, digits, dashes');
    const dir = vendorDir('keys');
    const f = path.join(dir, `${kid}.pem`);
    if (fs.existsSync(f)) die(`${f} exists; a signing key is never overwritten (use a new --kid to rotate)`);
    const keys = readKeys();
    if (keys[kid]) die(`kid ${kid} is already trusted in grid/license_keys.json`);
    const { publicKey, privateKey: priv } = crypto.generateKeyPairSync('ed25519');
    const encrypt = has(args, '--encrypt');
    if (encrypt && !vendorPassphrase()) die('--encrypt needs BEETHOVEN_VENDOR_PASSPHRASE');
    const pem = priv.export(encrypt ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: vendorPassphrase() } : { type: 'pkcs8', format: 'pem' });
    fs.writeFileSync(f, pem, { mode: 0o600, flag: 'wx' });
    keys[kid] = L.rawFromPublicKey(publicKey);
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 1) + '\n');
    const fp = crypto.createHash('sha256').update(Buffer.from(keys[kid], 'base64')).digest('hex').slice(0, 16);
    console.log(`signing key ${kid} written to ${f}${encrypt ? ' (encrypted)' : ''}`);
    console.log(`public key added to grid/license_keys.json (fingerprint ${fp}); builds from now on trust it`);
    console.log('Back the private key up offline. Losing it means no new licenses for builds that trust only this key.');
    if (/onedrive|dropbox|google drive|icloud/i.test(f)) console.log(`WARNING: ${f} is in a synced folder; move BEETHOVEN_VENDOR_DIR out of it.`);
    break;
  }
  case 'issue': {
    // a key names one person: an AccessID, an e-mail, or both. Keys for a whole domain are not issued
    // (and verify refuses one), so no single key can stand in for the approved list.
    if (has(args, '--domain')) die('--domain is gone: a key names one person (--access-id and/or --email); there are no site keys');
    const sub = flag(args, '--access-id');
    const email = flag(args, '--email');
    const edition = flag(args, '--edition', 'student');
    if (!EDITIONS.includes(edition)) die(`--edition is one of ${EDITIONS.join(', ')}`);
    // trials are signed with the trial key when there is one, so paid keys and trials are told apart by signer
    const kid = flag(args, '--kid', edition === 'trial' ? trialKid() || newestKid() : newestKid());
    if (!kid) die('no signing key: run init first');
    if (!sub && !email) die('say who it is for: --access-id (and --email)');
    if (sub && !/^[a-z]{2}\d{4}$/i.test(sub)) die('--access-id looks like ab1234');
    const now = Math.floor(Date.now() / 1000);
    const until = flag(args, '--until');
    const days = Number(flag(args, '--days', until ? '0' : '365'));
    const exp = until ? dateEnd(until) : now + days * 86400;
    if (!(exp > now)) die('the license would already be over');
    const features = (flag(args, '--features', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const graceRaw = flag(args, '--grace');
    const prefix = prefixFlag(args);
    const signer = privateKey(kid);
    // the payload's product field stays "ashley" whatever the prefix: every verifier checks it (license.js)
    const key = L.signLicense(
      { kid, sub, email, edition, name: flag(args, '--name'), org: flag(args, '--org', ''), iat: now, nbf: now, exp, ...(graceRaw != null ? { grace_days: Number(graceRaw) } : {}), features },
      signer,
      { prefix: prefix.name },
    );
    const check = L.verifyLicense(key, { keys: readKeys(), now });
    if (!check.ok) die(`the new key does not verify: ${check.detail}`);
    const p = check.payload;
    if (p.domain) die('refusing to issue a key that names a domain');
    const rows = readLedger();
    rows.push({ lid: p.lid, issued_at: new Date().toISOString(), payload: p, note: flag(args, '--note', ''), key });
    writeLedger(rows);
    const who = (sub || email).replace(/[^A-Za-z0-9@._-]/g, '_');
    const out = path.join(vendorDir('licenses'), `${who}-${p.lid}.key`);
    fs.writeFileSync(out, key + '\n', { mode: 0o600 });
    console.log(key);
    console.error(`\n${p.lid}: ${p.edition} license (${prefix.key}) for ${p.name || who}, ${check.detail}. Saved to ${out}; ledger updated.`);
    break;
  }
  case 'verify': {
    const file = flag(args, '--file');
    // either spelling, ASHLEY1. or BEETHOVEN1. (license.js findKey)
    const key = file ? L.findKey(fs.readFileSync(file, 'utf8')) : args.find((a) => L.findKey(a) === a);
    if (!key) die('give a key or --file');
    // a key that names a domain is refused before anything else: such keys are no longer issued, and one
    // that is still around belongs on the revocation list
    const peeked = L.peek(key);
    if (peeked && peeked.domain) {
      console.log(JSON.stringify({ ok: false, status: 'refused', detail: `this key names a domain (${peeked.domain}) instead of a person; domain keys are not accepted any more. If it was issued, revoke it: revoke --lid ${peeked.lid || '?'}`, payload: peeked }, null, 1));
      process.exit(2);
    }
    const revoked = L.verifyRevocationList(fs.existsSync(BUNDLED_REVOKED) ? fs.readFileSync(BUNDLED_REVOKED, 'utf8') : '', readKeys());
    if (!revoked.ok) die(`extension/media/revoked.txt: ${revoked.detail}`);
    const accessId = flag(args, '--access-id');
    const r = L.verifyLicense(key, { keys: readKeys(), revoked: revoked.revoked, identity: accessId ? { accessId } : undefined });
    console.log(JSON.stringify({ ok: r.ok, status: r.status, detail: r.detail, prefix: key.split('.')[0], payload: r.payload || peeked }, null, 1));
    process.exit(r.ok ? 0 : 2);
    break;
  }
  case 'list': {
    const rows = readLedger();
    if (!rows.length) console.log('no licenses issued yet');
    for (const r of rows) {
      const p = r.payload;
      const st = r.revoked ? `REVOKED ${r.revoked.at.slice(0, 10)}` : new Date(p.exp * 1000) < new Date() ? 'ended' : 'active';
      console.log(`${p.lid}  ${st.padEnd(18)} ${p.edition.padEnd(8)} ${(p.sub || p.email || '').padEnd(10)} ${(p.name || '').padEnd(24)} until ${new Date(p.exp * 1000).toISOString().slice(0, 10)}  ${r.note || ''}`);
    }
    break;
  }
  case 'revoke': {
    const lid = flag(args, '--lid');
    if (!lid) die('--lid L-...');
    const rows = readLedger();
    const row = rows.find((r) => r.lid === lid);
    if (!row) die(`no license ${lid} in the ledger`);
    const prefix = prefixFlag(args);
    if (!row.revoked) row.revoked = { at: new Date().toISOString(), reason: flag(args, '--reason', '') };
    writeLedger(rows);
    const kid = newestKid();
    const signer = privateKey(kid);
    const list = L.signRevocationList(rows.filter((r) => r.revoked).map((r) => r.lid), kid, signer, undefined, { prefix: prefix.name });
    const check = L.verifyRevocationList(list, readKeys());
    if (!check.ok) die(`the new list does not verify: ${check.detail}`);
    fs.writeFileSync(path.join(vendorDir(), 'revoked.txt'), list + '\n');
    fs.writeFileSync(BUNDLED_REVOKED, list + '\n');
    console.log(`${lid} revoked. The signed list (${prefix.list}, ${check.detail}) is in ${path.join(VENDOR, 'revoked.txt')} and extension/media/revoked.txt:`);
    console.log('it takes effect with the next release, or at once where beethoven.licenseRevocationUrl (ashley.licenseRevocationUrl before 4.0.0) points at a published copy.');
    break;
  }
  case 'export-key': {
    // the private key of one kid as base64 PKCS8 DER, for the trial service's secret store (stdout only)
    const kid = flag(args, '--kid');
    if (!kid) die('--kid');
    const k = privateKey(kid);
    process.stdout.write(k.export({ type: 'pkcs8', format: 'der' }).toString('base64') + '\n');
    break;
  }
  case 'sign-release': {
    const dir = args[0];
    if (!dir || !fs.statSync(dir).isDirectory()) die('sign-release <dir>');
    const kid = newestKid();
    const lines = [];
    for (const f of fs.readdirSync(dir).sort()) {
      if (f.startsWith('SHA256SUMS')) continue;
      const p = path.join(dir, f);
      if (!fs.statSync(p).isFile()) continue;
      lines.push(`${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}  ${f}`);
    }
    const sums = lines.join('\n') + '\n';
    fs.writeFileSync(path.join(dir, 'SHA256SUMS'), sums);
    const sig = crypto.sign(null, Buffer.from(RELEASE_DOMAIN + sums, 'utf8'), privateKey(kid));
    fs.writeFileSync(path.join(dir, 'SHA256SUMS.sig'), `${kid} ${sig.toString('base64')}\n`);
    console.log(`signed ${lines.length} files with ${kid}`);
    break;
  }
  case 'verify-release': {
    const dir = args[0];
    if (!dir) die('verify-release <dir>');
    const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8');
    const [kid, b64] = fs.readFileSync(path.join(dir, 'SHA256SUMS.sig'), 'utf8').trim().split(/\s+/);
    const raw = readKeys()[kid];
    if (!raw) die(`unknown signing key ${kid}`);
    if (!crypto.verify(null, Buffer.from(RELEASE_DOMAIN + sums, 'utf8'), L.publicKeyFromRaw(raw), Buffer.from(b64, 'base64'))) die('SHA256SUMS signature does NOT verify');
    let bad = 0;
    for (const line of sums.split('\n').filter(Boolean)) {
      const [h, f] = line.split(/\s+/);
      const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
      if (got !== h) {
        bad++;
        console.log(`MISMATCH ${f}`);
      }
    }
    if (bad) die(`${bad} file(s) differ from SHA256SUMS`);
    console.log(`release verified: signature by ${kid}, ${sums.split('\n').filter(Boolean).length} files match`);
    break;
  }
  case 'sign-killlist': {
    // The list is whole, not a delta: the extension keeps the newest list by `issued`, so every
    // withdrawal that must stay in force is repeated on each signing.
    const kid = flag(args, '--kid', newestKid());
    if (!kid) die('no signing key: run init first');
    const csv = (name) => [...new Set((flag(args, name, '') || '').split(',').map((s) => s.trim()).filter(Boolean))].sort();
    const versions = csv('--revoked-versions');
    const lids = csv('--revoked-lids');
    for (const v of versions) if (!/^\d+\.\d+\.\d+$/.test(v)) die(`--revoked-versions: ${v} is not a version like 1.0.0`);
    for (const l of lids) if (!/^L-[A-Za-z0-9_-]+$/.test(l)) die(`--revoked-lids: ${l} is not a license id like L-...`);
    const prefix = prefixFlag(args);
    const out = flag(args, '--out');
    if (prefix.list !== L.REV_PREFIX) {
      // Beethoven 4.0.0 to 7.0.0 read these two files and verify ASHLEYREV1 only: a new-prefix list there
      // would read as unsigned to every one of them, which keeps the last good list and withdraws nothing
      if (out && KILL_FILES_READ_BY_SHIPPED_BUILDS.includes(path.basename(out))) die(`--prefix beethoven is never written to ${path.basename(out)}: the builds that read it verify ${L.REV_PREFIX} only`);
      process.stderr.write(`note: signed as ${prefix.list}, which only Beethoven 8.0.0 and later read; not for killlist.json or bridge-killlist.json\n`);
    }
    const payload = { v: 1, kid, issued: Math.floor(Date.now() / 1000), revoked_versions: versions, revoked_lids: lids, message: flag(args, '--message', '') };
    const doc = { ...payload, sig: signKillList(payload, privateKey(kid), prefix.list) };
    const check = verifyKillListDoc(doc, readKeys());
    if (!check.ok) die(`the new kill-list does not verify: ${check.detail}`);
    const text = JSON.stringify(doc, null, 1) + '\n';
    if (out) {
      fs.writeFileSync(out, text);
      console.log(`kill-list written to ${out}: ${check.detail}`);
    } else process.stdout.write(text);
    break;
  }
  case 'verify-killlist': {
    const file = args[0];
    if (!file) die('verify-killlist <path>');
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      die(`${file}: not JSON (${e.message})`);
    }
    const r = verifyKillListDoc(doc, readKeys());
    console.log(JSON.stringify({ ok: r.ok, detail: r.detail, payload: r.payload }, null, 1));
    process.exit(r.ok ? 0 : 2);
    break;
  }
  default: {
    // the comment block at the top, from the usage lines to the first import
    const lines = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(lines.slice(3, lines.findIndex((l) => l.startsWith('import '))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 1 : 0);
  }
}
