// The license keys: signing and checking (grid/license.js) and the laptop files (core/license.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as L from '../../../grid/license.js';
import * as lic from './license';

const here = __dirname; // dist-test/unit/core
const repo = path.resolve(here, '..', '..', '..', '..');
const DAY = 86400;
const NOW = 1_790_000_000; // 2026-09-21

const { privateKey: key1, publicKey: pub1 } = crypto.generateKeyPairSync('ed25519');
const { privateKey: other } = crypto.generateKeyPairSync('ed25519');
const KEYS = { k1: L.rawFromPublicKey(pub1) };
const issue = (f: Record<string, unknown> = {}, k: crypto.KeyObject = key1) =>
  L.signLicense({ kid: 'k1', sub: 'ab1234', email: 'ab1234@wayne.edu', name: 'A. Student', iat: NOW - DAY, nbf: NOW - DAY, exp: NOW + 30 * DAY, ...f } as never, k);
const check = (key: string, extra: Record<string, unknown> = {}) => L.verifyLicense(key, { keys: KEYS, now: NOW, ...extra });

test('a license issued for a person verifies, and names them', () => {
  const k = issue();
  assert.match(k, L.KEY_PATTERN);
  const c = check(k, { identity: { accessId: 'AB1234' } });
  assert.equal(c.status, 'valid');
  assert.equal(c.ok, true);
  assert.equal(c.identity, true);
  assert.equal(c.payload?.sub, 'ab1234');
  assert.equal(c.daysLeft, 30);
  assert.equal(check(k).identity, null, 'nobody signed in yet: not decided');
});

test('an altered key, a foreign signature or an unknown signing key is refused', () => {
  const k = issue();
  const [p, body, sig] = k.split('.');
  const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  payload.exp += 365 * DAY; // stretch the date
  const forged = `${p}.${Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.${sig}`;
  assert.equal(check(forged).status, 'invalid');
  assert.equal(check(issue({}, other)).status, 'invalid', 'signed by a key nobody trusts under kid k1');
  assert.equal(check(issue({ kid: 'k9' })).status, 'unknown-key');
  assert.equal(check(k.slice(0, -3) + 'AAA').ok, false);
  assert.equal(check('ASHLEY1.nonsense.x').status, 'invalid');
  assert.equal(check('').status, 'missing');
  assert.equal(check('   ').status, 'missing');
});

test('dates: grace after the end, then expired; not before the start', () => {
  const ended = issue({ exp: NOW - 3 * DAY });
  const g = check(ended);
  assert.equal(g.status, 'grace');
  assert.equal(g.ok, true);
  assert.equal(check(issue({ exp: NOW - 15 * DAY })).status, 'expired');
  assert.equal(check(issue({ exp: NOW - 15 * DAY, grace_days: 30 })).status, 'grace', 'a longer grace is honoured');
  assert.equal(check(issue({ exp: NOW - 1 * DAY, grace_days: 0 })).status, 'expired');
  assert.equal(check(issue({ nbf: NOW + 3 * DAY })).status, 'not-yet-valid');
  assert.equal(check(issue({ nbf: NOW + 3600 })).status, 'valid', 'a day of clock skew is tolerated');
});

test('the wrong person is refused', () => {
  assert.equal(check(issue(), { identity: { accessId: 'cd5678' } }).status, 'wrong-person');
  assert.equal(check(issue(), { identity: { email: 'ab1234@wayne.edu' } }).status, 'valid', 'the e-mail alone is enough');
});

test('a key for a whole domain, or one claiming the site edition, is refused for everyone and is not issued', () => {
  // the issuer refuses to make one
  assert.throws(() => L.signLicense({ kid: 'k1', domain: 'wayne.edu', exp: NOW + DAY } as never, key1), /whole domain/);
  assert.throws(() => L.signLicense({ kid: 'k1', sub: 'ab1234', edition: 'site', exp: NOW + DAY } as never, key1), /site edition/);
  // one signed by hand under a trusted key, shaped like the keys issued before 2026-09-29
  const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const handSigned = (extra: Record<string, unknown>) => {
    const body = b64u(JSON.stringify({ v: 1, kid: 'k1', lid: 'L-handsigned01', product: 'ashley', iat: NOW - DAY, exp: NOW + 30 * DAY, ...extra }));
    return `ASHLEY1.${body}.${b64u(crypto.sign(null, Buffer.from(`ASHLEY1.${body}`, 'ascii'), key1))}`;
  };
  const site = handSigned({ edition: 'site', domain: 'wayne.edu', name: 'testers' });
  for (const identity of [{ email: 'x@wayne.edu' }, { email: 'x@med.wayne.edu' }, { accessId: 'ab1234', email: 'ab1234@wayne.edu' }, undefined]) {
    const c = check(site, identity ? { identity } : {});
    assert.equal(c.ok, false, `held by ${JSON.stringify(identity)}`);
    assert.equal(c.status, 'invalid');
    assert.match(c.detail, /one person/);
  }
  assert.equal(check(handSigned({ edition: 'site', sub: 'ab1234' }), { identity: { accessId: 'ab1234' } }).status, 'invalid', 'the site edition alone is enough to refuse');
  assert.equal(check(handSigned({ edition: 'student', sub: 'ab1234', domain: 'wayne.edu' }), { identity: { accessId: 'ab1234' } }).status, 'invalid', 'a domain alone is enough to refuse');
  assert.equal(check(handSigned({ edition: 'student', sub: 'ab1234' }), { identity: { accessId: 'ab1234' } }).status, 'valid', 'the same shape without either is a personal key');
  assert.equal(L.identityMatches({ domain: 'wayne.edu' }, { email: 'x@wayne.edu' }), false, 'a domain matches nobody');
  assert.equal(L.namesAnInstitution({ domain: 'wayne.edu' }), true);
  assert.equal(L.namesAnInstitution({ edition: 'site' }), true);
  assert.equal(L.namesAnInstitution({ edition: 'trial', sub: 'ab1234' }), false);
});

test('a withdrawn license is refused; revocation lists are signed', () => {
  const k = issue();
  const lid = check(k).payload!.lid;
  const list = L.signRevocationList([lid], 'k1', key1, NOW);
  const r = L.verifyRevocationList(list, KEYS);
  assert.equal(r.ok, true);
  assert.deepEqual(r.revoked, [lid]);
  assert.equal(check(k, { revoked: r.revoked }).status, 'revoked');
  assert.equal(L.verifyRevocationList(L.signRevocationList([lid], 'k1', other, NOW), KEYS).ok, false, 'a list signed by someone else is ignored');
  assert.equal(L.verifyRevocationList('', KEYS).ok, true, 'no list is an empty list');
  assert.equal(L.verifyRevocationList(list.replace('ASHLEYREV1', 'ASHLEY1'), KEYS).ok, false);
});

test('the wrong product or version is refused', () => {
  const k = issue();
  const lic = L.signLicense({ kid: 'k1', sub: 'ab1234', exp: NOW + DAY } as never, key1);
  assert.equal(check(lic).ok, true);
  // a token of the right shape for another product
  const body = Buffer.from(JSON.stringify({ ...check(k).payload, product: 'other' })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const sig = crypto.sign(null, Buffer.from(`ASHLEY1.${body}`, 'ascii'), key1).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(check(`ASHLEY1.${body}.${sig}`).status, 'wrong-product');
  assert.throws(() => L.signLicense({ kid: 'k1', exp: NOW } as never, key1), /names a person/);
});

test('keys are found in pasted text; the clock never runs backwards', () => {
  const k = issue();
  assert.equal(L.findKey(`Hello,\n\nyour key:\n${k}\n\nthanks`), k);
  assert.equal(L.findKey('no key here'), null);
  assert.equal(L.effectiveNow(100, 200), 200);
  assert.equal(L.effectiveNow(300, 200), 300);
});

// ---- the laptop files (core/license.ts) ------------------------------------------------------
let dir = '';
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashley-lic-'));
  process.env.ASHLEY_LICENSE_DIR = dir;
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the laptop keeps the key, the identity and the latest time seen', () => {
  const k = issue();
  lic.writeLicenseKey(`key follows\n${k}\n`);
  assert.equal(lic.readLicenseKey(), k);
  lic.writeIdentity({ accessId: 'ab1234', email: 'ab1234@wayne.edu' });
  assert.deepEqual(lic.readIdentity(), { accessId: 'ab1234', email: 'ab1234@wayne.edu' });
  const c = lic.checkLicense({ keys: KEYS, identity: lic.readIdentity(), now: NOW });
  assert.equal(c.status, 'valid');
  // the clock: once 2026-09-21 has been seen, setting the clock back to 2025 changes nothing
  assert.equal(lic.clockNow(NOW), NOW);
  assert.equal(lic.clockNow(NOW - 400 * DAY), NOW);
  // a fetched revocation list is kept only if it verifies and is newer
  const lid = c.payload!.lid;
  assert.equal(lic.storeRevocationList(L.signRevocationList([lid], 'k1', other, NOW), KEYS).ok, false);
  assert.equal(lic.storeRevocationList(L.signRevocationList([lid], 'k1', key1, NOW), KEYS).ok, true);
  assert.equal(lic.checkLicense({ keys: KEYS, now: NOW }).status, 'revoked');
  lic.storeRevocationList(L.signRevocationList([], 'k1', key1, NOW - DAY), KEYS);
  assert.equal(lic.checkLicense({ keys: KEYS, now: NOW }).status, 'revoked', 'an older list does not replace a newer one');
  lic.removeLicenseKey();
  assert.equal(lic.readLicenseKey(), undefined);
});

test('the test signing key is committed only as a fixture, and releases trust the repository keys', () => {
  const pem = fs.readFileSync(path.join(repo, 'extension', 'test-fixtures', 'license', 'test-signing-key.pem'), 'utf8');
  assert.match(pem, /TEST ONLY/);
  const prod = JSON.parse(fs.readFileSync(path.join(repo, 'grid', 'license_keys.json'), 'utf8'));
  const testRaw = L.rawFromPublicKey(crypto.createPublicKey(crypto.createPrivateKey(pem)));
  assert.ok(!Object.values(prod).includes(testRaw), 'the test key must never be a release key');
});
