#!/usr/bin/env node
/*! Ashley (c) 2026 OpenSpineConsortium. Licensed software. See extension/LICENSE.txt. */
// The license issuer's tool. Runs on the issuer's own computer only.
//
//   node tools/license/ashley-license.mjs init [--kid k1] [--encrypt]      make a signing key (once)
//   node tools/license/ashley-license.mjs issue --access-id ab1234 --name "A. Student" [--email ...]
//        [--edition student|lab|trial|site] [--domain wayne.edu] [--days 365 | --until 2027-09-30]
//        [--grace 14] [--features a,b] [--kid k1] [--note "..."]              print a license key
//   node tools/license/ashley-license.mjs verify <key | --file path> [--access-id ab1234]
//   node tools/license/ashley-license.mjs list
//   node tools/license/ashley-license.mjs revoke --lid L-... [--reason "..."]
//   node tools/license/ashley-license.mjs sign-release <dir>              SHA256SUMS + SHA256SUMS.sig
//   node tools/license/ashley-license.mjs verify-release <dir>
//
// The private signing keys and the ledger of issued licenses (names, e-mails) live in the vendor
// folder, never in the repository: ASHLEY_VENDOR_DIR or ~/.ashley-vendor. Only public keys
// (grid/license_keys.json) and the signed revocation list (extension/media/revoked.txt, license ids
// only) go into the repository.
import { createRequire } from 'node:module';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const L = require(path.join(REPO, 'grid', 'license.js'));
const KEYS_FILE = path.join(REPO, 'grid', 'license_keys.json');
const BUNDLED_REVOKED = path.join(REPO, 'extension', 'media', 'revoked.txt');
const VENDOR = path.resolve(process.env.ASHLEY_VENDOR_DIR || path.join(os.homedir(), '.ashley-vendor'));
const RELEASE_DOMAIN = 'ASHLEY-RELEASE1\n';

function die(msg) {
  process.stderr.write(`ashley-license: ${msg}\n`);
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
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function vendorDir(sub = '') {
  if (inside(VENDOR, REPO)) die(`the vendor folder ${VENDOR} is inside the repository; private keys must never be committed. Set ASHLEY_VENDOR_DIR elsewhere.`);
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
  const passphrase = pem.includes('ENCRYPTED') ? process.env.ASHLEY_VENDOR_PASSPHRASE : undefined;
  if (pem.includes('ENCRYPTED') && !passphrase) die('this signing key is encrypted: set ASHLEY_VENDOR_PASSPHRASE');
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
    if (encrypt && !process.env.ASHLEY_VENDOR_PASSPHRASE) die('--encrypt needs ASHLEY_VENDOR_PASSPHRASE');
    const pem = priv.export(encrypt ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: process.env.ASHLEY_VENDOR_PASSPHRASE } : { type: 'pkcs8', format: 'pem' });
    fs.writeFileSync(f, pem, { mode: 0o600, flag: 'wx' });
    keys[kid] = L.rawFromPublicKey(publicKey);
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 1) + '\n');
    const fp = crypto.createHash('sha256').update(Buffer.from(keys[kid], 'base64')).digest('hex').slice(0, 16);
    console.log(`signing key ${kid} written to ${f}${encrypt ? ' (encrypted)' : ''}`);
    console.log(`public key added to grid/license_keys.json (fingerprint ${fp}); builds from now on trust it`);
    console.log('Back the private key up offline. Losing it means no new licenses for builds that trust only this key.');
    if (/onedrive|dropbox|google drive|icloud/i.test(f)) console.log(`WARNING: ${f} is in a synced folder; move ASHLEY_VENDOR_DIR out of it.`);
    break;
  }
  case 'issue': {
    const sub = flag(args, '--access-id');
    const email = flag(args, '--email');
    const domain = flag(args, '--domain');
    const edition = flag(args, '--edition', domain ? 'site' : 'student');
    // trials are signed with the trial key when there is one, so paid keys and trials are told apart by signer
    const kid = flag(args, '--kid', edition === 'trial' ? trialKid() || newestKid() : newestKid());
    if (!kid) die('no signing key: run init first');
    if (!sub && !email && !domain) die('say who it is for: --access-id (and --email), or --domain for a site license');
    if (sub && !/^[a-z]{2}\d{4}$/i.test(sub)) die('--access-id looks like ab1234');
    const now = Math.floor(Date.now() / 1000);
    const until = flag(args, '--until');
    const days = Number(flag(args, '--days', until ? '0' : '365'));
    const exp = until ? dateEnd(until) : now + days * 86400;
    if (!(exp > now)) die('the license would already be over');
    const features = (flag(args, '--features', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const graceRaw = flag(args, '--grace');
    const key = L.signLicense(
      { kid, sub, email, domain, edition, name: flag(args, '--name'), org: flag(args, '--org', ''), iat: now, nbf: now, exp, ...(graceRaw != null ? { grace_days: Number(graceRaw) } : {}), features },
      privateKey(kid),
    );
    const check = L.verifyLicense(key, { keys: readKeys(), now });
    if (!check.ok) die(`the new key does not verify: ${check.detail}`);
    const p = check.payload;
    const rows = readLedger();
    rows.push({ lid: p.lid, issued_at: new Date().toISOString(), payload: p, note: flag(args, '--note', ''), key });
    writeLedger(rows);
    const who = (sub || email || domain).replace(/[^A-Za-z0-9@._-]/g, '_');
    const out = path.join(vendorDir('licenses'), `${who}-${p.lid}.key`);
    fs.writeFileSync(out, key + '\n', { mode: 0o600 });
    console.log(key);
    console.error(`\n${p.lid}: ${p.edition} license for ${p.name || who}, ${check.detail}. Saved to ${out}; ledger updated.`);
    break;
  }
  case 'verify': {
    const file = flag(args, '--file');
    const key = file ? L.findKey(fs.readFileSync(file, 'utf8')) : args.find((a) => a.startsWith('ASHLEY1.'));
    if (!key) die('give a key or --file');
    const revoked = L.verifyRevocationList(fs.existsSync(BUNDLED_REVOKED) ? fs.readFileSync(BUNDLED_REVOKED, 'utf8') : '', readKeys());
    const accessId = flag(args, '--access-id');
    const r = L.verifyLicense(key, { keys: readKeys(), revoked: revoked.revoked, identity: accessId ? { accessId } : undefined });
    console.log(JSON.stringify({ ok: r.ok, status: r.status, detail: r.detail, payload: r.payload || L.peek(key) }, null, 1));
    process.exit(r.ok ? 0 : 2);
    break;
  }
  case 'list': {
    const rows = readLedger();
    if (!rows.length) console.log('no licenses issued yet');
    for (const r of rows) {
      const p = r.payload;
      const st = r.revoked ? `REVOKED ${r.revoked.at.slice(0, 10)}` : new Date(p.exp * 1000) < new Date() ? 'ended' : 'active';
      console.log(`${p.lid}  ${st.padEnd(18)} ${p.edition.padEnd(8)} ${(p.sub || p.domain || '').padEnd(10)} ${(p.name || '').padEnd(24)} until ${new Date(p.exp * 1000).toISOString().slice(0, 10)}  ${r.note || ''}`);
    }
    break;
  }
  case 'revoke': {
    const lid = flag(args, '--lid');
    if (!lid) die('--lid L-...');
    const rows = readLedger();
    const row = rows.find((r) => r.lid === lid);
    if (!row) die(`no license ${lid} in the ledger`);
    if (!row.revoked) row.revoked = { at: new Date().toISOString(), reason: flag(args, '--reason', '') };
    writeLedger(rows);
    const kid = newestKid();
    const list = L.signRevocationList(rows.filter((r) => r.revoked).map((r) => r.lid), kid, privateKey(kid));
    fs.writeFileSync(path.join(vendorDir(), 'revoked.txt'), list + '\n');
    fs.writeFileSync(BUNDLED_REVOKED, list + '\n');
    console.log(`${lid} revoked. The signed list is in ${path.join(VENDOR, 'revoked.txt')} and extension/media/revoked.txt:`);
    console.log('it takes effect with the next release, or at once where ashley.licenseRevocationUrl points at a published copy.');
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
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(3, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(cmd ? 1 : 0);
}
