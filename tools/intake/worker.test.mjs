// Tests for the access, licence and report service. Run: node --test tools/intake/worker.test.mjs
// An in-memory KV, a fetch stub for Microsoft Graph and GitHub, and the test signing key that test
// builds trust (extension/test-fixtures/license/test-signing-key.pem) as TRIAL_KEY_PKCS8_B64 with key
// id "test". What the Worker signs is checked with grid/license.js, the one verifier Ashley ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import worker from './worker.js';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const L = require(path.join(REPO, 'grid', 'license.js'));
const priv = crypto.createPrivateKey(fs.readFileSync(path.join(REPO, 'extension', 'test-fixtures', 'license', 'test-signing-key.pem'), 'utf8'));
const PKCS8_B64 = priv.export({ type: 'pkcs8', format: 'der' }).toString('base64');
const KEYS = { test: L.rawFromPublicKey(crypto.createPublicKey(priv)) };
const SITE = 'https://openspineconsortium.com';
const ADMIN = { authorization: 'Bearer secret-admin-token' };

// Cloudflare KV, in memory: get/put/delete and a paged list (two keys a page, to exercise the cursor);
// the expirationTtl of each put is kept in ttl so a test can read it (nothing expires on its own)
class FakeKV {
  constructor() {
    this.m = new Map();
    this.ttl = new Map();
  }
  async get(k, type) {
    const v = this.m.get(k);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(k, v, opts) {
    this.m.set(k, String(v));
    this.ttl.set(k, opts && opts.expirationTtl);
  }
  async delete(k) {
    this.m.delete(k);
    this.ttl.delete(k);
  }
  async list({ prefix = '', cursor } = {}) {
    const all = [...this.m.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = Number(cursor || 0);
    const keys = all.slice(start, start + 2).map((name) => ({ name }));
    const done = start + 2 >= all.length;
    return { keys, list_complete: done, cursor: done ? undefined : String(start + 2) };
  }
}

function makeEnv(over = {}) {
  return { ACCESS: new FakeKV(), TRIALS: new FakeKV(), REPORTS: new FakeKV(), TRIAL_KEY_PKCS8_B64: PKCS8_B64, TRIAL_KID: 'test', TRIAL_DAYS: '365', ALLOWED_DOMAINS: 'wayne.edu', SITE_ORIGIN: SITE, ADMIN_TOKEN: 'secret-admin-token', IP_SALT: 'a-salt', GITHUB_TOKEN: 'gh-test', GITHUB_REPO: 'example/ashley', ...over };
}

// Microsoft Graph and GitHub, stubbed: a token names a person; every issue filed is kept for inspection
const people = {
  'tok-ab1234': { id: '1', userPrincipalName: 'ab1234@wayne.edu', mail: 'ab1234@wayne.edu', displayName: 'A. Student' },
  'tok-cd5678': { id: '2', userPrincipalName: 'c.d@wayne.edu', mail: 'c.d@wayne.edu', displayName: 'C. D.', onPremisesSamAccountName: 'CD5678' },
  'tok-outsider': { id: '3', userPrincipalName: 'someone@example.com', mail: 'someone@example.com', displayName: 'Someone' },
};
const issues = [];
// Resend, stubbed: every e-mail is kept; resend.status sets the answer (200, an error status, or 0 for
// "cannot be reached"). fetched is every address the Worker called, to prove when it calls nothing.
const mails = [];
const resend = { status: 200 };
const fetched = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  fetched.push(u);
  if (u === 'https://api.resend.com/emails') {
    mails.push({ headers: init.headers, body: JSON.parse(init.body) });
    if (resend.status === 0) throw new TypeError('fetch failed');
    if (resend.status === 200) return Response.json({ id: `email-${mails.length}` });
    return Response.json({ statusCode: resend.status, name: 'validation_error', message: 'You can only send testing emails to your own email address' }, { status: resend.status });
  }
  if (u.startsWith('https://graph.microsoft.com/')) {
    const me = people[String(init.headers.authorization || '').replace(/^Bearer /, '')];
    return me ? Response.json(me) : new Response('', { status: 401 });
  }
  if (u.startsWith('https://api.github.com/')) {
    issues.push(JSON.parse(init.body));
    return Response.json({ number: issues.length }, { status: 201 });
  }
  throw new Error(`unexpected fetch ${u}`);
};

// the Worker's "mail: ..." lines are kept here instead of printed, so a test can read them
const logs = [];
for (const level of ['log', 'error']) {
  const real = console[level].bind(console);
  console[level] = (...a) => {
    const line = a.map(String).join(' ');
    if (line.startsWith('mail:')) logs.push({ level, line });
    else real(...a);
  };
}

function call(env, method, pathname, { body, headers = {}, origin = SITE, ip = '203.0.113.7' } = {}) {
  const h = { ...(origin ? { origin } : {}), 'cf-connecting-ip': ip, ...headers };
  const init = { method, headers: h };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!h['content-type']) h['content-type'] = 'application/json';
  }
  return worker.fetch(new Request(`https://service.example${pathname}`, init), env);
}
const asJson = async (res) => ({ status: res.status, headers: res.headers, body: await res.json() });
const request = (env, over = {}, opts = {}) => call(env, 'POST', '/request', { body: { accessId: 'ab1234', name: 'A. Student', email: 'ab1234@wayne.edu', note: 'spine segmentation project', ...over }, ...opts }).then(asJson);
const trial = (env, token) => call(env, 'POST', '/trial', { headers: token ? { authorization: `Bearer ${token}` } : {}, body: { product: 'ashley' } }).then(asJson);
const adminPost = (env, route, body) => call(env, 'POST', `/admin/${route}`, { headers: ADMIN, body }).then(asJson);
const adminList = (env) => call(env, 'GET', '/admin/list', { headers: ADMIN }).then(asJson);

test('GET /allowlist has the bundled shape, open CORS and a one-minute cache', async () => {
  const env = makeEnv();
  let r = await call(env, 'GET', '/allowlist', { origin: null }).then(asJson);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { about: 'AccessIDs approved to use Ashley', accessIds: [] });
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'max-age=60');
  for (const id of ['zz9999', 'ab1234', 'cd5678', 'ef0001', 'gh0002']) assert.equal((await adminPost(env, 'add', { accessId: id, name: 'Someone' })).status, 200);
  r = await call(env, 'GET', '/allowlist', { origin: null }).then(asJson);
  assert.deepEqual(r.body.accessIds, ['ab1234', 'cd5678', 'ef0001', 'gh0002', 'zz9999']);
  assert.deepEqual(Object.keys(r.body), ['about', 'accessIds']);
});

test('POST /request validates, stores a pending record and files one issue', async () => {
  const env = makeEnv();
  issues.length = 0;
  assert.equal((await request(env, { accessId: 'abc123' })).status, 400);
  assert.equal((await request(env, { accessId: 'ab1234', email: 'other@wayne.edu' })).status, 400);
  assert.equal((await request(env, { accessId: 'ab1234', email: 'ab1234@gmail.com' })).status, 400);
  assert.equal((await request(env, { name: 'A' })).status, 400);
  assert.equal((await request(env, { name: 'N'.repeat(81) })).status, 400);
  assert.equal((await request(env, { note: 'x'.repeat(501) })).status, 400);
  assert.equal((await request(makeEnv(), { note: 'x'.repeat(500) })).status, 202);
  issues.length = 0;
  assert.equal((await call(env, 'POST', '/request', { body: 'not json' }).then(asJson)).status, 400);
  const r = await request(env, { accessId: 'AB1234', email: 'AB1234@wayne.edu' });
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { status: 'pending' });
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  const rec = await env.ACCESS.get('pending:ab1234', 'json');
  assert.equal(rec.name, 'A. Student');
  assert.equal(rec.email, 'ab1234@wayne.edu');
  assert.equal(rec.note, 'spine segmentation project');
  assert.ok(rec.requested_at);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].title, 'Access request: ab1234');
  assert.deepEqual(issues[0].labels, ['access-request']);
  assert.ok(!issues[0].body.includes('@'), 'the issue body carries no e-mail');
  assert.ok(issues[0].body.includes('spine segmentation project'));
  // a retry keeps the first request time and files no second issue
  const again = await request(env, { note: 'a longer note' });
  assert.equal(again.status, 202);
  assert.equal((await env.ACCESS.get('pending:ab1234', 'json')).requested_at, rec.requested_at);
  assert.equal(issues.length, 1);
  const list = await adminList(env);
  assert.equal(list.body.pending.length, 1);
  assert.equal(list.body.pending[0].accessId, 'ab1234');
  assert.equal(list.body.pending[0].note, 'a longer note');
});

test('POST /request comes from the website only and answers a preflight', async () => {
  const env = makeEnv();
  assert.equal((await request(env, {}, { origin: 'https://evil.example' })).status, 403);
  const pre = await call(env, 'OPTIONS', '/request');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
  assert.match(pre.headers.get('access-control-allow-headers'), /content-type/);
  assert.equal((await call(env, 'OPTIONS', '/request', { origin: 'https://evil.example' })).status, 403);
  // no salt configured: the page is not open, and nothing is stored
  const closed = makeEnv({ IP_SALT: '' });
  assert.equal((await request(closed)).status, 503);
  assert.equal(closed.ACCESS.m.size, 0);
});

test('POST /request is limited per connection and never stores the address', async () => {
  const env = makeEnv();
  for (let i = 0; i < 10; i++) assert.equal((await request(env, { accessId: `ab${1000 + i}`, email: `ab${1000 + i}@wayne.edu` })).status, 202);
  const r = await request(env, { accessId: 'ab2000', email: 'ab2000@wayne.edu' });
  assert.equal(r.status, 429);
  assert.equal((await request(env, { accessId: 'ab2000', email: 'ab2000@wayne.edu' }, { ip: '198.51.100.9' })).status, 202);
  const stored = [...env.ACCESS.m.keys()].join('\n') + [...env.ACCESS.m.values()].join('\n');
  assert.ok(!stored.includes('203.0.113.7') && !stored.includes('198.51.100.9'), 'the IP address is not in KV');
  assert.equal([...env.ACCESS.m.keys()].filter((k) => k.startsWith('req:')).length, 2);
});

test('POST /request says approved or denied plainly, without the reason', async () => {
  const env = makeEnv();
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  let r = await request(env);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'approved' });
  assert.equal(await env.ACCESS.get('pending:ab1234'), null, 'an approved record is not overwritten by a request');
  await request(env, { accessId: 'cd5678', email: 'cd5678@wayne.edu' });
  assert.equal((await adminPost(env, 'deny', { accessId: 'cd5678', reason: 'not in the lab' })).status, 200);
  r = await request(env, { accessId: 'cd5678', email: 'cd5678@wayne.edu' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: 'denied' });
  const list = await adminList(env);
  assert.equal(list.body.pending.length, 0);
  assert.equal(list.body.denied[0].accessId, 'cd5678');
  assert.equal(list.body.denied[0].reason, 'not in the lab');
  assert.ok(list.body.denied[0].denied_at);
});

test('POST /trial refuses a person who is not approved, and points at the request page', async () => {
  const env = makeEnv();
  assert.equal((await trial(env)).status, 401);
  assert.equal((await trial(env, 'tok-unknown')).status, 401);
  assert.equal((await trial(env, 'tok-outsider')).status, 403);
  const r = await trial(env, 'tok-ab1234');
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'not approved');
  assert.equal(r.body.request_page, `${SITE}/ashley/request.html`);
  assert.match(r.body.detail, /ab1234/);
  assert.equal(r.body.key, undefined);
  // pending is not approved either
  await request(env);
  assert.equal((await trial(env, 'tok-ab1234')).status, 403);
});

test('approve, then /trial issues a key grid/license.js accepts for that person, three a day at most', async () => {
  const env = makeEnv();
  await request(env);
  const ap = await adminPost(env, 'approve', { accessId: 'ab1234', note: 'lab member' });
  assert.equal(ap.status, 200);
  assert.equal(ap.body.record.name, 'A. Student');
  assert.equal(ap.body.record.note, 'lab member');
  assert.equal(await env.ACCESS.get('pending:ab1234'), null);
  const r = await trial(env, 'tok-ab1234');
  assert.equal(r.status, 200);
  assert.match(r.body.key, L.KEY_PATTERN);
  const now = Math.floor(Date.now() / 1000);
  const check = L.verifyLicense(r.body.key, { keys: KEYS, now, identity: { accessId: 'ab1234', email: 'ab1234@wayne.edu' } });
  assert.equal(check.ok, true, check.detail);
  assert.equal(check.status, 'valid');
  assert.equal(check.identity, true);
  assert.equal(check.payload.kid, 'test');
  assert.equal(check.payload.edition, 'trial');
  assert.equal(check.payload.sub, 'ab1234');
  assert.equal(check.payload.name, 'A. Student');
  assert.equal(check.payload.grace_days, 3);
  assert.ok(check.daysLeft >= 364 && check.daysLeft <= 365, `daysLeft ${check.daysLeft}`);
  assert.equal(L.verifyLicense(r.body.key, { keys: KEYS, now, identity: { accessId: 'cd5678' } }).status, 'wrong-person');
  assert.equal(L.verifyLicense(r.body.key, { keys: { other: KEYS.test }, now }).status, 'unknown-key');
  const rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.deepEqual(rec.lids, [check.payload.lid]);
  assert.equal((await env.TRIALS.get('ab1234', 'json')).lid, check.payload.lid);
  assert.equal((await trial(env, 'tok-ab1234')).status, 200);
  assert.equal((await trial(env, 'tok-ab1234')).status, 200);
  const fourth = await trial(env, 'tok-ab1234');
  assert.equal(fourth.status, 429);
  assert.equal(fourth.body.key, undefined);
  assert.equal((await env.ACCESS.get('approved:ab1234', 'json')).lids.length, 3);
  // the AccessID may come from the on-premises account name when the e-mail is a display alias
  await adminPost(env, 'add', { accessId: 'cd5678', name: 'C. D.' });
  const cd = await trial(env, 'tok-cd5678');
  assert.equal(cd.status, 200);
  const cdCheck = L.verifyLicense(cd.body.key, { keys: KEYS, now, identity: { accessId: 'cd5678', email: 'c.d@wayne.edu' } });
  assert.equal(cdCheck.ok, true);
  assert.equal(cdCheck.payload.sub, 'cd5678');
  assert.equal(cdCheck.payload.email, 'c.d@wayne.edu');
});

test('/admin answers 401 without the token, with a wrong one, and when none is configured', async () => {
  const env = makeEnv();
  assert.equal((await call(env, 'GET', '/admin/list').then(asJson)).status, 401);
  assert.equal((await call(env, 'GET', '/admin/list', { headers: { authorization: 'Bearer secret-admin-tokem' } }).then(asJson)).status, 401);
  assert.equal((await call(env, 'GET', '/admin/list', { headers: { authorization: 'Bearer secret-admin-token-longer' } }).then(asJson)).status, 401);
  assert.equal((await call(env, 'POST', '/admin/add', { headers: { authorization: 'Bearer ' }, body: { accessId: 'ab1234' } }).then(asJson)).status, 401);
  const none = makeEnv({ ADMIN_TOKEN: undefined });
  assert.equal((await call(none, 'GET', '/admin/list', { headers: ADMIN }).then(asJson)).status, 401);
  const empty = makeEnv({ ADMIN_TOKEN: '' });
  assert.equal((await call(empty, 'GET', '/admin/list', { headers: { authorization: 'Bearer ' } }).then(asJson)).status, 401);
  assert.equal((await call(env, 'GET', '/admin/list', { headers: ADMIN, origin: 'https://evil.example' }).then(asJson)).status, 403);
  const ok = await adminList(env);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { pending: [], approved: [], denied: [], revoked: [], checks: [] });
  assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
  assert.equal((await call(env, 'OPTIONS', '/admin/approve')).status, 204);
  assert.equal((await adminPost(env, 'nothing', { accessId: 'ab1234' })).status, 404);
  assert.equal((await adminPost(env, 'approve', { accessId: 'nope' })).status, 400);
  assert.equal((await adminPost(env, 'approve', { accessId: 'zz0000' })).status, 404);
});

test('remove takes the person off the list and revokes every key they were issued', async () => {
  const env = makeEnv();
  assert.equal(await call(env, 'GET', '/revoked', { origin: null }).then((r) => r.text()), '');
  assert.deepEqual(L.verifyRevocationList('', KEYS).revoked, []);
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  const k1 = (await trial(env, 'tok-ab1234')).body.key;
  const k2 = (await trial(env, 'tok-ab1234')).body.key;
  const lids = [L.peek(k1).lid, L.peek(k2).lid];
  const rm = await adminPost(env, 'remove', { accessId: 'ab1234' });
  assert.equal(rm.status, 200);
  assert.deepEqual(rm.body.revoked, lids);
  assert.deepEqual((await call(env, 'GET', '/allowlist', { origin: null }).then(asJson)).body.accessIds, []);
  assert.equal((await trial(env, 'tok-ab1234')).status, 403);
  const text = await call(env, 'GET', '/revoked', { origin: null }).then((r) => r.text());
  assert.ok(text.startsWith('ASHLEYREV1.'));
  const rev = L.verifyRevocationList(text, KEYS);
  assert.equal(rev.ok, true, rev.detail);
  assert.deepEqual(rev.revoked, [...lids].sort());
  assert.ok(rev.issued > 0);
  assert.equal(L.peek(text).kid, 'test');
  assert.equal(L.verifyRevocationList(text, { other: KEYS.test }).ok, false, 'a list signed by an unknown key is rejected');
  assert.equal(L.verifyLicense(k1, { keys: KEYS, revoked: rev.revoked }).status, 'revoked');
  assert.equal(L.verifyLicense(k2, { keys: KEYS, revoked: new Set(rev.revoked) }).status, 'revoked');
  const list = await adminList(env);
  assert.deepEqual(list.body.approved, []);
  assert.deepEqual(list.body.revoked, [...lids].sort());
  const audits = [...env.ACCESS.m.entries()].filter(([k]) => k.startsWith('audit:')).map(([, v]) => JSON.parse(v));
  assert.deepEqual(audits.map((a) => a.action), ['add', 'remove']);
  assert.ok(audits.every((a) => a.by === 'admin' && a.accessId === 'ab1234'));
  assert.deepEqual(audits[1].lids, lids);
});

test('revoke-lid withdraws one key and keeps the earlier ones on the list', async () => {
  const env = makeEnv();
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  const key = (await trial(env, 'tok-ab1234')).body.key;
  assert.equal((await adminPost(env, 'revoke-lid', { lid: 'nonsense' })).status, 400);
  assert.equal((await adminPost(env, 'revoke-lid', { lid: 'L-3qou7DI5toan' })).status, 200);
  const r = await adminPost(env, 'revoke-lid', { lid: L.peek(key).lid, accessId: 'ab1234' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.revoked, ['L-3qou7DI5toan', L.peek(key).lid].sort());
  const rev = L.verifyRevocationList(await call(env, 'GET', '/revoked', { origin: null }).then((x) => x.text()), KEYS);
  assert.equal(rev.ok, true);
  assert.deepEqual(rev.revoked, ['L-3qou7DI5toan', L.peek(key).lid].sort());
  assert.equal(L.verifyLicense(key, { keys: KEYS, revoked: rev.revoked }).status, 'revoked');
  // the person stays approved: a fresh key still comes, and a repeat of a lid changes nothing
  assert.equal((await trial(env, 'tok-ab1234')).status, 200);
  await adminPost(env, 'revoke-lid', { lid: 'L-3qou7DI5toan' });
  assert.equal((await env.ACCESS.get('revoked', 'json')).length, 2);
  // several at once (what publish.sh sends), in one read-and-write of the list
  const many = await adminPost(env, 'revoke-lid', { lids: ['L-kBUmEepmm5D8', 'L-Dw8z5-3R4RAK', 'L-kBUmEepmm5D8'] });
  assert.equal(many.status, 200);
  assert.deepEqual(many.body.lids, ['L-kBUmEepmm5D8', 'L-Dw8z5-3R4RAK']);
  assert.deepEqual(many.body.revoked, ['L-3qou7DI5toan', 'L-Dw8z5-3R4RAK', 'L-kBUmEepmm5D8', L.peek(key).lid].sort());
  assert.deepEqual(L.verifyRevocationList(await call(env, 'GET', '/revoked', { origin: null }).then((x) => x.text()), KEYS).revoked, many.body.revoked);
  assert.equal((await adminPost(env, 'revoke-lid', { lids: ['L-kBUmEepmm5D8', 'nonsense'] })).status, 400);
  assert.equal((await adminPost(env, 'revoke-lid', { lids: [] })).status, 400);
  assert.equal((await adminPost(env, 'revoke-lid', {})).status, 400);
});

test('deny, then approve and add: the records move and an approved person cannot be denied', async () => {
  const env = makeEnv();
  await request(env);
  assert.equal((await adminPost(env, 'deny', { accessId: 'ab1234', reason: 'ask again next term' })).status, 200);
  assert.equal((await adminList(env)).body.denied.length, 1);
  const ap = await adminPost(env, 'approve', { accessId: 'ab1234' });
  assert.equal(ap.status, 200);
  assert.equal(ap.body.record.note, 'spine segmentation project', 'the student\'s note survives when the admin writes none');
  const list = await adminList(env);
  assert.equal(list.body.denied.length, 0);
  assert.equal(list.body.approved[0].accessId, 'ab1234');
  assert.deepEqual(list.body.approved[0].lids, []);
  assert.equal((await adminPost(env, 'deny', { accessId: 'ab1234' })).status, 409);
  assert.equal((await adminPost(env, 'add', { accessId: 'ab1234', email: 'not an e-mail' })).status, 400);
  const add = await adminPost(env, 'add', { accessId: 'ab1234', note: 'renewed' });
  assert.equal(add.body.record.name, 'A. Student');
  assert.equal(add.body.record.note, 'renewed');
  assert.equal(add.body.record.approved_at, ap.body.record.approved_at);
});

// Ashley Bridge's approval check, sent the way an extension's background page sends it: an extension
// origin, a text/plain body (no preflight), no credentials
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const CHECK = { v: 1, access_id: 'st1234', portal: 'ondemand.grid.wayne.edu', product: 'bridge', version: '4.0.0' };
const check = (env, over = {}, opts = {}) => call(env, 'POST', '/access_check', { origin: EXT, headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: { ...CHECK, ...over }, ...opts }).then(asJson);

test('POST /access_check: open CORS on every answer, one account looked up, the exact answer shapes', async () => {
  const env = makeEnv();
  const pre = await call(env, 'OPTIONS', '/access_check', { origin: EXT });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
  assert.match(pre.headers.get('access-control-allow-headers'), /content-type/);
  assert.equal(pre.headers.get('access-control-allow-credentials'), null);
  assert.equal(pre.headers.get('cache-control'), 'no-store');
  let r = await check(env);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { approved: false, access_id: 'st1234', requestPage: `${SITE}/ashley/request.html` });
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
  // Firefox may send a null origin, a Windows curl none, a page an application/json body: all the same answer
  assert.deepEqual((await check(env, {}, { origin: 'null' })).body.approved, false);
  assert.equal((await check(env, {}, { origin: null })).status, 200);
  assert.equal((await call(env, 'POST', '/access_check', { origin: EXT, body: CHECK }).then(asJson)).body.approved, false);
  await adminPost(env, 'add', { accessId: 'st1234', name: 'Store reviewer (mock portal)', note: 'store-reviewer mock username' });
  r = await check(env);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ['approved', 'access_id', 'checked', 'until']);
  assert.equal(r.body.approved, true);
  assert.equal(r.body.access_id, 'st1234');
  assert.ok(Math.abs(Date.parse(r.body.checked) - Date.now()) < 5000, r.body.checked);
  assert.equal(r.body.until, null);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.ok(!JSON.stringify(r.body).includes('Store reviewer'), 'the approved record itself is not in the answer');
  // the same account in another spelling; a name that is not Wayne-shaped is simply not approved
  assert.equal((await check(env, { access_id: ' ST1234 ' })).body.approved, true);
  assert.equal((await check(env, { access_id: 'john.doe' })).body.approved, false);
  assert.equal((await check(env, { access_id: 'student' })).body.approved, false);
  // an approval with an end date: honoured while it lasts, refused after
  const rec = await env.ACCESS.get('approved:st1234', 'json');
  await env.ACCESS.put('approved:st1234', JSON.stringify({ ...rec, until: '2099-01-01T00:00:00.000Z' }));
  r = await check(env);
  assert.equal(r.body.approved, true);
  assert.equal(r.body.until, '2099-01-01T00:00:00.000Z');
  await env.ACCESS.put('approved:st1234', JSON.stringify({ ...rec, until: '2020-01-01T00:00:00.000Z' }));
  assert.equal((await check(env)).body.approved, false);
  await env.ACCESS.put('approved:st1234', JSON.stringify(rec));
  assert.equal((await check(env)).body.approved, true);
  // withdrawal: removed from the list, and the next check says no and points at the request page
  await adminPost(env, 'remove', { accessId: 'st1234' });
  r = await check(env);
  assert.deepEqual(r.body, { approved: false, access_id: 'st1234', requestPage: `${SITE}/ashley/request.html` });
  // the public allowlist route is what it was
  const al = await call(env, 'GET', '/allowlist', { origin: null }).then(asJson);
  assert.deepEqual(al.body, { about: 'AccessIDs approved to use Ashley', accessIds: [] });
  assert.equal(al.headers.get('cache-control'), 'max-age=60');
});

test('POST /access_check refuses a malformed body with 400 and other methods with 405, CORS on each', async () => {
  const env = makeEnv();
  const cases = [
    [{ v: 2 }, 'v'], [{ v: undefined }, 'no v'], [{ access_id: '' }, 'no account'], [{ access_id: 'a b' }, 'a space'], [{ access_id: 'x'.repeat(65) }, 'too long'], [{ access_id: '-x' }, 'leading dash'],
    [{ portal: '' }, 'no portal'], [{ portal: 'not a host' }, 'not a host'], [{ portal: 'https://ondemand.grid.wayne.edu' }, 'a url, not a host'],
    [{ product: '' }, 'no product'], [{ product: 'Bridge!' }, 'bad product'], [{ version: '' }, 'no version'], [{ version: 'v 4' }, 'bad version'],
  ];
  for (const [over, why] of cases) {
    const r = await check(env, over);
    assert.equal(r.status, 400, why);
    assert.equal(r.headers.get('access-control-allow-origin'), '*', why);
    assert.ok(r.body.error, why);
  }
  let r = await call(env, 'POST', '/access_check', { origin: EXT, headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: 'not json' }).then(asJson);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'not JSON');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal((await call(env, 'POST', '/access_check', { origin: EXT, body: [1, 2] }).then(asJson)).status, 400);
  assert.equal((await call(env, 'POST', '/access_check', { origin: EXT, body: 'x'.repeat(9000) }).then(asJson)).status, 413);
  for (const m of ['GET', 'PUT', 'DELETE']) {
    r = await call(env, m, '/access_check', { origin: EXT }).then(asJson);
    assert.equal(r.status, 405, m);
    assert.equal(r.headers.get('access-control-allow-origin'), '*', m);
  }
  // a mock portal on a local port and a hostname in capitals are fine
  assert.equal((await check(env, { portal: 'localhost:8080' })).status, 200);
  assert.equal((await check(env, { portal: 'OnDemand.Grid.Wayne.EDU' })).status, 200);
  // nothing but the day's counter for the connection is stored for a refused body
  assert.ok([...env.ACCESS.m.keys()].every((k) => k.startsWith('chkip:') || k.startsWith('chk:') || k.startsWith('seen:')));
  // no salt configured: the service is not open, with the CORS header so the caller can read that
  const closed = makeEnv({ IP_SALT: '' });
  const c = await check(closed);
  assert.equal(c.status, 503);
  assert.equal(c.headers.get('access-control-allow-origin'), '*');
  assert.equal(closed.ACCESS.m.size, 0);
});

test('POST /access_check keeps one record per product and account, counts the day, never the address', async () => {
  const env = makeEnv();
  await adminPost(env, 'add', { accessId: 'st1234', name: 'Store reviewer (mock portal)' });
  await check(env, { version: '4.0.0' });
  await check(env, { version: '4.0.1' }, { ip: '198.51.100.9' });
  const seen = await env.ACCESS.get('seen:bridge:st1234', 'json');
  assert.equal(seen.access_id, 'st1234');
  assert.equal(seen.portal, 'ondemand.grid.wayne.edu');
  assert.equal(seen.product, 'bridge');
  assert.equal(seen.version, '4.0.1', 'the last check wins');
  assert.equal(seen.checks, 2);
  assert.equal(seen.approved, true);
  assert.ok(seen.first_seen && seen.last_seen && seen.first_seen <= seen.last_seen);
  assert.match(seen.ip_hash, /^[0-9a-f]{32}$/);
  assert.equal(seen.changed_at, undefined);
  const stored = [...env.ACCESS.m.keys()].join('\n') + [...env.ACCESS.m.values()].join('\n');
  assert.ok(!stored.includes('203.0.113.7') && !stored.includes('198.51.100.9'), 'the IP address is not in KV');
  // the admin sees the checks; the other kinds are untouched by them
  const list = await adminList(env);
  assert.equal(list.body.checks.length, 1);
  assert.equal(list.body.checks[0].access_id, 'st1234');
  assert.equal(list.body.checks[0].product, 'bridge');
  assert.deepEqual(list.body.pending, []);
  assert.deepEqual(list.body.denied, []);
  assert.equal(list.body.approved.length, 1);
  // a withdrawal is recorded with the time the decision changed
  await adminPost(env, 'remove', { accessId: 'st1234' });
  await check(env);
  const after = await env.ACCESS.get('seen:bridge:st1234', 'json');
  assert.equal(after.approved, false);
  assert.equal(after.checks, 3);
  assert.ok(after.changed_at >= after.first_seen);
  // another product is its own record
  await check(env, { product: 'ashley', version: '3.0.0' });
  assert.equal((await env.ACCESS.get('seen:ashley:st1234', 'json')).checks, 1);
  assert.equal((await adminList(env)).body.checks.length, 2);
  // the day's limit is per account: 120 checks pass, the 121st is 429, another account from the same address still passes
  const many = makeEnv();
  let last;
  for (let i = 0; i < 120; i++) last = await check(many, { access_id: 'zz0001' });
  assert.equal(last.status, 200);
  const over = await check(many, { access_id: 'zz0001' });
  assert.equal(over.status, 429);
  assert.equal(over.headers.get('access-control-allow-origin'), '*');
  assert.equal(over.headers.get('cache-control'), 'no-store');
  assert.equal((await check(many, { access_id: 'zz0002' })).status, 200);
  assert.equal((await many.ACCESS.get('seen:bridge:zz0001', 'json')).checks, 120, 'a refused check is not recorded as a check');
});

test('/health and /report still answer', async () => {
  const env = makeEnv();
  issues.length = 0;
  assert.deepEqual((await call(env, 'GET', '/health', { origin: null }).then(asJson)).body, { ok: true });
  const rep = { v: 1, install_id: '0f2a4c6e-1111-2222-3333-444455556666', version: '2.0.0', nodes: [{ id: 'ssh.key', status: 'fail', ms: 5, detail: 'no key <!-- hidden -->' }], signature: '0123456789abcdef' };
  const r = await call(env, 'POST', '/report', { origin: null, body: rep }).then(asJson);
  assert.equal(r.status, 202);
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].labels, ['diagnostic-report']);
  assert.ok(!issues[0].body.includes('hidden'));
  assert.equal((await call(env, 'POST', '/report', { origin: null, body: rep }).then(asJson)).body.issue, 1);
  assert.equal((await call(env, 'GET', '/nowhere', { origin: null }).then(asJson)).status, 404);
});

// Requests by e-mail (README.md): the maintainer's e-mail through Resend, and the /decide links in it.
// No GitHub token here, as in the deployed Worker.
const MAIL = { RESEND_API_KEY: 're_test_key_never_logged', DECIDE_KEY: 'decide-test-key', NOTIFY_TO: 'maintainer@example.edu', MAIL_FROM: 'Ashley access <onboarding@resend.dev>' };
const mailEnv = (over = {}) => makeEnv({ ...MAIL, GITHUB_TOKEN: undefined, GITHUB_REPO: undefined, ...over });
const ADMIN_PAGE = `${SITE}/ashley/admin.html`;
const linksIn = (text) => ({ approve: /^Approve: (\S+)$/m.exec(text)[1], deny: /^Deny: (\S+)$/m.exec(text)[1] });
const tokenOf = (link) => new URL(link).searchParams.get('t');
const claimOf = (t) => JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString('utf8'));
// the link's signature computed with node:crypto, apart from the Worker's WebCrypto code
const sign = (payload, key = MAIL.DECIDE_KEY) => crypto.createHmac('sha256', key).update(payload).digest('base64url');
const mint = (claim, key) => {
  const p = Buffer.from(JSON.stringify(claim)).toString('base64url');
  return `${p}.${sign(p, key)}`;
};
const asPage = async (res) => ({ status: res.status, headers: res.headers, text: await res.text() });
const open = (env, t, method = 'GET') => call(env, method, `/decide?t=${t}`, { origin: null }).then(asPage);
const press = (env, t, form = 'confirm=1') => call(env, 'POST', `/decide?t=${t}`, { origin: null, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }).then(asPage);
const snapshot = (env) => JSON.stringify([...env.ACCESS.m.entries()].sort());
function plainPage(p, why) {
  assert.match(p.headers.get('content-type'), /^text\/html/, why);
  assert.equal(p.headers.get('cache-control'), 'no-store', why);
  assert.equal(p.headers.get('referrer-policy'), 'no-referrer', why);
  assert.match(p.headers.get('content-security-policy'), /default-src 'none'/, why);
  assert.ok(!/<script/i.test(p.text), `${why}: no script`);
}

test('/request e-mails the maintainer once, with an Approve and a Deny link that verify', async () => {
  const env = mailEnv();
  mails.length = 0;
  const r = await request(env);
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { status: 'pending' });
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.headers.authorization, `Bearer ${MAIL.RESEND_API_KEY}`);
  assert.deepEqual(m.body.to, ['maintainer@example.edu']);
  assert.equal(m.body.from, 'Ashley access <onboarding@resend.dev>');
  assert.equal(m.body.subject, 'Ashley access request: ab1234 (A. Student)');
  for (const s of ['A. Student asked for access to Ashley.', 'Name: A. Student', 'AccessID: ab1234', 'E-mail: ab1234@wayne.edu', 'What for: spine segmentation project', 'Asked: ', `The admin page lists every request: ${ADMIN_PAGE}`]) assert.ok(m.body.text.includes(s), s);
  assert.ok(!m.body.text.includes('Asked from'), 'the form did not say which product');
  assert.ok(!m.body.text.includes('Asked again'), 'a first request');
  assert.ok(!JSON.stringify(m.body).includes(MAIL.RESEND_API_KEY), 'the key is only in the header');
  const links = linksIn(m.body.text);
  assert.ok(links.approve.startsWith('https://service.example/decide?t='));
  assert.ok(links.deny.startsWith('https://service.example/decide?t='));
  assert.ok(m.body.html.includes(`href="${links.approve}"`) && m.body.html.includes(`href="${links.deny}"`));
  // the format README.md gives: base64url(JSON) "." base64url(HMAC-SHA256 of the first part with DECIDE_KEY)
  const ta = tokenOf(links.approve);
  const td = tokenOf(links.deny);
  for (const t of [ta, td]) assert.equal(t.split('.')[1], sign(t.split('.')[0]));
  const ca = claimOf(ta);
  const cd = claimOf(td);
  assert.deepEqual(Object.keys(ca), ['v', 'access_id', 'decision', 'nonce', 'exp']);
  assert.deepEqual([ca.v, ca.access_id, ca.decision, cd.decision], [1, 'ab1234', 'approve', 'deny']);
  assert.equal(ca.nonce, cd.nonce, 'one e-mail, one nonce: using either link spends both');
  assert.match(ca.nonce, /^[A-Za-z0-9_-]{22}$/);
  const days = (ca.exp - Date.now() / 1000) / 86400;
  assert.ok(days > 13.99 && days <= 14, `exp is 14 days out, not ${days}`);
  // each link opens its question, with the one button that POSTs back to the same address
  let p = await open(env, ta);
  assert.equal(p.status, 200);
  plainPage(p, 'approve question');
  assert.ok(p.text.includes('Approve access for A. Student (ab1234)?'));
  assert.ok(p.text.includes(`<form method="post" action="/decide?t=${ta}"><input type="hidden" name="confirm" value="1"><button type="submit">Approve</button></form>`));
  assert.ok(p.text.includes('Nothing has changed yet.'));
  p = await open(env, td);
  assert.equal(p.status, 200);
  assert.ok(p.text.includes('Deny access for A. Student (ab1234)?'));
  assert.ok(p.text.includes('<button type="submit">Deny</button>'));
  // the product, when the form names it; what the person typed is shown as text, never as markup
  const env2 = mailEnv();
  mails.length = 0;
  await request(env2, { accessId: 'cd5678', email: 'cd5678@wayne.edu', name: '<b>Eve</b> & co', note: '<img src=x onerror=alert(1)> research', product: 'bridge' });
  assert.ok(mails[0].body.text.includes('Asked from: Ashley Bridge'));
  // a product named like an Object property is shown as typed, not as Object's own members
  const env4 = mailEnv();
  await request(env4, { accessId: 'ef9012', email: 'ef9012@wayne.edu', product: 'constructor' });
  assert.match(mails[1].body.text, /^Asked from: constructor$/m);
  assert.ok(!mails[1].body.text.includes('native code'));
  assert.ok(!mails[0].body.html.includes('<b>Eve') && !mails[0].body.html.includes('<img'));
  assert.ok(mails[0].body.html.includes('&lt;b&gt;Eve&lt;/b&gt; &amp; co'));
  const q = await open(env2, tokenOf(linksIn(mails[0].body.text).approve));
  assert.ok(q.text.includes('Approve access for &lt;b&gt;Eve&lt;/b&gt; &amp; co (cd5678)?'));
  assert.ok(q.text.includes('What for: &lt;img src=x onerror=alert(1)&gt; research'));
  assert.ok(!q.text.includes('<b>Eve') && !q.text.includes('<img'));
  const done = await press(env2, tokenOf(linksIn(mails[0].body.text).approve));
  assert.ok(done.text.includes('&lt;b&gt;Eve&lt;/b&gt; &amp; co can click the Ashley Bridge icon now'));
  assert.ok(!done.text.includes('<b>Eve'));
});

test('one e-mail per AccessID a day; a failed send is logged with its status only and tried again', async () => {
  const env = mailEnv();
  mails.length = 0;
  await request(env);
  await request(env, { note: 'again' });
  await request(env);
  assert.equal(mails.length, 1, 'repeats within the day send nothing');
  assert.ok(env.ACCESS.m.has('notified:ab1234'));
  assert.equal(env.ACCESS.ttl.get('notified:ab1234'), 86400);
  await request(env, { accessId: 'cd5678', email: 'cd5678@wayne.edu' });
  assert.equal(mails.length, 2, 'another person is their own e-mail');
  // a day later KV has dropped the key: a repeat sends one reminder, which says so
  env.ACCESS.m.delete('notified:ab1234');
  await request(env, { note: 'still waiting' });
  assert.equal(mails.length, 3);
  assert.match(mails[2].body.text, /^Asked again: /m);
  assert.match(mails[2].body.text, /^What for: still waiting$/m);
  await request(env);
  assert.equal(mails.length, 3);
  // the provider refuses, then cannot be reached: the request is still stored and answered pending, the
  // log has the status and nothing else, and no day starts until an e-mail actually goes
  const bad = mailEnv();
  mails.length = 0;
  logs.length = 0;
  try {
    resend.status = 403;
    let r = await request(bad);
    assert.equal(r.status, 202);
    assert.deepEqual(r.body, { status: 'pending' });
    assert.ok(await bad.ACCESS.get('pending:ab1234'));
    assert.equal(bad.ACCESS.m.has('notified:ab1234'), false);
    resend.status = 0;
    r = await request(bad);
    assert.equal(r.status, 202);
    assert.equal(mails.length, 2, 'the repeat tried again');
  } finally {
    resend.status = 200;
  }
  assert.deepEqual(logs, [{ level: 'error', line: 'mail: the provider answered 403 (validation_error)' }, { level: 'error', line: 'mail: the provider could not be reached (TypeError)' }]);
  assert.ok(logs.every((l) => !l.line.includes(MAIL.RESEND_API_KEY) && !l.line.includes('@')));
  await request(bad);
  await request(bad);
  assert.equal(mails.length, 3, 'once one goes, the day starts');
});

test('GET /decide never changes anything, however often a scanner opens the links', async () => {
  const env = mailEnv();
  mails.length = 0;
  await request(env);
  const { approve, deny } = linksIn(mails[0].body.text);
  const before = snapshot(env);
  for (let i = 0; i < 3; i++) for (const l of [approve, deny]) assert.equal((await open(env, tokenOf(l))).status, 200);
  // a POST without confirm=1 only asks again; other methods are refused
  const bare = await press(env, tokenOf(approve), '');
  assert.equal(bare.status, 200);
  assert.ok(bare.text.includes('Approve access for A. Student (ab1234)?'));
  assert.equal((await press(env, tokenOf(approve), 'confirm=yes')).status, 200);
  for (const m of ['PUT', 'DELETE', 'HEAD']) assert.equal((await open(env, tokenOf(approve), m)).status, 405, m);
  assert.equal(snapshot(env), before, 'KV is exactly as it was');
  assert.equal((await adminList(env)).body.pending.length, 1);
  assert.deepEqual((await adminList(env)).body.approved, []);
});

test('the button applies the decision once, through the admin code, and spends both links', async () => {
  const env = mailEnv();
  mails.length = 0;
  await request(env);
  const { approve, deny } = linksIn(mails[0].body.text);
  const ta = tokenOf(approve);
  const done = await press(env, ta);
  assert.equal(done.status, 200);
  plainPage(done, 'approved page');
  assert.ok(done.text.includes('<h1>Approved.</h1>'));
  assert.ok(done.text.includes('A. Student can click the Ashley Bridge icon now; the extension re-checks within ten minutes.'));
  assert.ok(done.text.includes(ADMIN_PAGE));
  const rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.deepEqual({ ...rec, approved_at: 'x' }, { name: 'A. Student', email: 'ab1234@wayne.edu', note: 'spine segmentation project', approved_at: 'x', by: 'e-mail link', lids: [] });
  assert.ok(Math.abs(Date.parse(rec.approved_at) - Date.now()) < 5000);
  assert.equal(await env.ACCESS.get('pending:ab1234'), null);
  const audits = [...env.ACCESS.m.entries()].filter(([k]) => k.startsWith('audit:')).map(([, v]) => JSON.parse(v));
  assert.deepEqual(audits, [{ action: 'approve', accessId: 'ab1234', by: 'e-mail link' }]);
  // the admin page writes the same fields, by "admin"
  const viaAdmin = mailEnv();
  await request(viaAdmin);
  const ap = await adminPost(viaAdmin, 'approve', { accessId: 'ab1234' });
  assert.deepEqual(Object.keys(ap.body.record), Object.keys(rec));
  assert.equal(ap.body.record.by, 'admin');
  // the nonce is spent, kept 30 days
  const nonce = claimOf(ta).nonce;
  const spent = await env.ACCESS.get(`decide:${nonce}`, 'json');
  assert.deepEqual([spent.access_id, spent.decision], ['ab1234', 'approve']);
  assert.equal(env.ACCESS.ttl.get(`decide:${nonce}`), 30 * 86400);
  // Ashley Bridge and Ashley in VS Code see the approval
  assert.equal((await check(env, { access_id: 'ab1234' })).body.approved, true);
  assert.ok((await call(env, 'GET', '/allowlist', { origin: null }).then(asJson)).body.accessIds.includes('ab1234'));
  // a second press, the other link, or opening either again: already used, and nothing changes
  const after = snapshot(env);
  for (const [why, p] of [['pressed again', await press(env, ta)], ['the deny link', await press(env, tokenOf(deny))], ['opened again', await open(env, ta)]]) {
    assert.equal(p.status, 410, why);
    plainPage(p, why);
    assert.ok(p.text.includes('This link was already used'), why);
    assert.ok(p.text.includes(ADMIN_PAGE), why);
  }
  assert.equal(snapshot(env), after);
  // Deny: the same denied record the admin page writes, by "e-mail link", the request time kept
  const env2 = mailEnv();
  mails.length = 0;
  await request(env2, { accessId: 'cd5678', email: 'cd5678@wayne.edu' });
  const asked = await env2.ACCESS.get('pending:cd5678', 'json');
  const dn = await press(env2, tokenOf(linksIn(mails[0].body.text).deny));
  assert.equal(dn.status, 200);
  assert.ok(dn.text.includes('<h1>Denied.</h1>'));
  const drec = await env2.ACCESS.get('denied:cd5678', 'json');
  assert.equal(drec.by, 'e-mail link');
  assert.equal(drec.requested_at, asked.requested_at);
  assert.equal(drec.reason, '');
  assert.ok(drec.denied_at);
  assert.equal(await env2.ACCESS.get('pending:cd5678'), null);
  assert.deepEqual((await request(env2, { accessId: 'cd5678', email: 'cd5678@wayne.edu' })).body, { status: 'denied' });
  await request(viaAdmin, { accessId: 'cd5678', email: 'cd5678@wayne.edu' });
  await adminPost(viaAdmin, 'deny', { accessId: 'cd5678', reason: 'no' });
  assert.deepEqual(Object.keys(await viaAdmin.ACCESS.get('denied:cd5678', 'json')), Object.keys(drec));
  // a Deny link for someone approved in the meantime changes nothing and says so
  const env3 = mailEnv();
  mails.length = 0;
  await request(env3);
  await adminPost(env3, 'approve', { accessId: 'ab1234' });
  const late = await press(env3, tokenOf(linksIn(mails[0].body.text).deny));
  assert.equal(late.status, 409);
  assert.ok(late.text.includes('Nothing changed'));
  assert.ok(await env3.ACCESS.get('approved:ab1234'));
});

test('a changed, cut, foreign or expired link decides nothing', async () => {
  const env = mailEnv();
  mails.length = 0;
  await request(env);
  const ta = tokenOf(linksIn(mails[0].body.text).approve);
  const [p, s] = ta.split('.');
  const claim = claimOf(ta);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const before = snapshot(env);
  const invalid = {
    garbage: 'garbage',
    empty: '',
    'cut short': ta.slice(0, -5),
    'one character of the signature changed': `${p}.${s[0] === 'A' ? 'B' : 'A'}${s.slice(1)}`,
    'the decision changed': `${b64({ ...claim, decision: 'deny' })}.${s}`,
    'another AccessID': `${b64({ ...claim, access_id: 'zz9999' })}.${s}`,
    'signed with another key': mint(claim, 'another-key'),
    'v 2': mint({ ...claim, v: 2 }),
    'no nonce': mint({ ...claim, nonce: '' }),
    'a decision that is neither': mint({ ...claim, decision: 'add' }),
  };
  for (const [why, t] of Object.entries(invalid)) {
    for (const res of [await open(env, t), await press(env, t)]) {
      assert.equal(res.status, 400, why);
      plainPage(res, why);
      assert.ok(res.text.includes('This link is not valid'), why);
      assert.ok(res.text.includes(ADMIN_PAGE), why);
    }
  }
  // a link signed here with the right key opens: the format is exactly the one README.md gives
  assert.equal((await open(env, mint({ v: 1, access_id: 'ab1234', decision: 'approve', nonce: 'n'.repeat(22), exp: Math.floor(Date.now() / 1000) + 60 }))).status, 200);
  const old = mint({ ...claim, exp: Math.floor(Date.now() / 1000) - 1 });
  for (const res of [await open(env, old), await press(env, old)]) {
    assert.equal(res.status, 410);
    plainPage(res, 'expired');
    assert.ok(res.text.includes('This link has expired'));
    assert.ok(res.text.includes(ADMIN_PAGE));
  }
  assert.equal(snapshot(env), before, 'nothing was written');
  assert.deepEqual((await adminList(env)).body.approved, []);
  // no DECIDE_KEY: the e-mail carries no links and says to use the admin page; /decide says links are off
  const off = mailEnv({ DECIDE_KEY: undefined });
  mails.length = 0;
  await request(off);
  assert.ok(!mails[0].body.text.includes('/decide'));
  assert.ok(mails[0].body.text.includes('decide on the admin page'));
  assert.equal((await open(off, ta)).status, 503);
});

test('with no mail provider configured nothing is fetched and the request is answered as before', async () => {
  const env = mailEnv({ RESEND_API_KEY: undefined });
  mails.length = 0;
  logs.length = 0;
  fetched.length = 0;
  const r = await request(env);
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { status: 'pending' });
  assert.equal((await request(env)).status, 202);
  assert.deepEqual(fetched, [], 'no call to any address');
  assert.deepEqual(logs, [{ level: 'log', line: 'mail: no provider configured' }, { level: 'log', line: 'mail: no provider configured' }]);
  assert.equal(env.ACCESS.m.has('notified:ab1234'), false);
  assert.equal((await adminList(env)).body.pending.length, 1);
  // approved or denied people are answered before any e-mail step: no line at all
  logs.length = 0;
  await adminPost(env, 'approve', { accessId: 'ab1234' });
  assert.deepEqual((await request(env)).body, { status: 'approved' });
  assert.deepEqual(logs, []);
});

test('/admin/notify-test sends one test e-mail and answers the provider status', async () => {
  const env = mailEnv();
  mails.length = 0;
  assert.equal((await call(env, 'POST', '/admin/notify-test', { body: {} }).then(asJson)).status, 401);
  assert.equal(mails.length, 0);
  const before = snapshot(env);
  let r = await adminPost(env, 'notify-test', {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { sent: true, provider_status: 200 });
  assert.equal(mails.length, 1);
  assert.equal(mails[0].body.subject, 'Ashley access: test e-mail');
  assert.deepEqual(mails[0].body.to, ['maintainer@example.edu']);
  assert.ok(mails[0].body.text.includes(ADMIN_PAGE));
  assert.ok(!mails[0].body.text.includes('/decide'), 'a test carries no working link');
  try {
    resend.status = 403;
    r = await adminPost(env, 'notify-test', {});
  } finally {
    resend.status = 200;
  }
  assert.deepEqual(r.body, { sent: false, provider_status: 403, detail: 'You can only send testing emails to your own email address' });
  r = await adminPost(mailEnv({ RESEND_API_KEY: undefined }), 'notify-test', {});
  assert.deepEqual(r.body, { sent: false, provider_status: null, detail: 'no provider configured' });
  assert.equal(snapshot(env), before, 'a test writes nothing');
});
