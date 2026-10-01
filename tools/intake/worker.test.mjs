// Tests for the access, licence and report service. Run: node --test tools/intake/worker.test.mjs
// An in-memory KV, a fetch stub for Microsoft Graph and GitHub, and the test signing key that test
// builds trust (extension/test-fixtures/license/test-signing-key.pem) as TRIAL_KEY_PKCS8_B64 with key
// id "test". What the Worker signs is checked with grid/license.js, the verifier the VS Code edition and
// the grid ship (it takes both spellings of the prefixes, ASHLEY1 and BEETHOVEN1).
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
// the expirationTtl of each put is kept in ttl so a test can read it (nothing expires on its own). A
// string is kept as a string; an ArrayBuffer or a typed array as a copy of its bytes, as KV keeps binary
// values, and read back as text, JSON or an ArrayBuffer; the metadata of a put is kept beside the value.
class FakeKV {
  constructor() {
    this.m = new Map();
    this.ttl = new Map();
    this.meta = new Map();
  }
  async get(k, type) {
    const v = this.m.get(k);
    if (v === undefined) return null;
    const t = type && typeof type === 'object' ? type.type : type;
    const text = v instanceof Uint8Array ? new TextDecoder().decode(v) : v;
    if (t === 'arrayBuffer') return v instanceof Uint8Array ? v.slice().buffer : new TextEncoder().encode(v).buffer;
    return t === 'json' ? JSON.parse(text) : text;
  }
  async getWithMetadata(k, type) {
    return { value: await this.get(k, type), metadata: this.meta.has(k) ? this.meta.get(k) : null };
  }
  async put(k, v, opts) {
    if (v instanceof ArrayBuffer) this.m.set(k, new Uint8Array(v.slice(0)));
    else if (ArrayBuffer.isView(v)) this.m.set(k, new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
    else this.m.set(k, String(v));
    this.ttl.set(k, opts && opts.expirationTtl);
    if (opts && opts.metadata !== undefined) this.meta.set(k, JSON.parse(JSON.stringify(opts.metadata)));
    else this.meta.delete(k);
  }
  async delete(k) {
    this.m.delete(k);
    this.ttl.delete(k);
    this.meta.delete(k);
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
  return { ACCESS: new FakeKV(), TRIALS: new FakeKV(), REPORTS: new FakeKV(), TRIAL_KEY_PKCS8_B64: PKCS8_B64, TRIAL_KID: 'test', TRIAL_DAYS: '365', ALLOWED_DOMAINS: 'wayne.edu', SITE_ORIGIN: SITE, ADMIN_TOKEN: 'secret-admin-token', IP_SALT: 'a-salt', GITHUB_TOKEN: 'gh-test', GITHUB_REPO: 'example/beethoven-vscode', ...over };
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
// resend.refuseTo, when set, is one address the stub refuses (403) while it sends to every other, the way
// Resend refuses a student's address until the domain is verified.
const mails = [];
const resend = { status: 200, refuseTo: null };
const fetched = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  fetched.push(u);
  if (u === 'https://api.resend.com/emails') {
    const body = JSON.parse(init.body);
    mails.push({ headers: init.headers, body });
    if (resend.status === 0) throw new TypeError('fetch failed');
    if (resend.status === 200 && !(resend.refuseTo && body.to.includes(resend.refuseTo))) return Response.json({ id: `email-${mails.length}` });
    return Response.json({ statusCode: resend.status === 200 ? 403 : resend.status, name: 'validation_error', message: 'You can only send testing emails to your own email address' }, { status: resend.status === 200 ? 403 : resend.status });
  }
  if (u.startsWith('https://graph.microsoft.com/')) {
    const me = people[String(init.headers.authorization || '').replace(/^Bearer /, '')];
    return me ? Response.json(me) : new Response('', { status: 401 });
  }
  if (u.startsWith('https://api.github.com/')) {
    issues.push(JSON.parse(init.body));
    return Response.json({ number: issues.length }, { status: 201 });
  }
  // Google's token endpoint and the Directory API (GROUP_MODE "workspace"), stubbed: never called live
  if (u === 'https://oauth2.googleapis.com/token') {
    google.calls.push({ url: u, headers: init.headers, body: String(init.body) });
    if (google.tokenStatus !== 200) return Response.json({ error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method.' }, { status: google.tokenStatus });
    return Response.json({ access_token: 'ya29.test-access-token', token_type: 'Bearer', expires_in: 3600 });
  }
  if (u.startsWith('https://admin.googleapis.com/')) {
    google.calls.push({ url: u, headers: init.headers, body: JSON.parse(init.body) });
    if (google.insertStatus === 200) return Response.json({ kind: 'admin#directory#member', email: JSON.parse(init.body).email, role: 'MEMBER' });
    if (google.insertStatus === 409) return Response.json({ error: { code: 409, message: 'Member already exists.' } }, { status: 409 });
    return Response.json({ error: { code: google.insertStatus, message: 'Not Authorized to access this resource/api' } }, { status: google.insertStatus });
  }
  throw new Error(`unexpected fetch ${u}`);
};
const google = { tokenStatus: 200, insertStatus: 200, calls: [] };

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
  assert.deepEqual(r.body, { about: 'AccessIDs approved to use Beethoven', accessIds: [] });
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
  assert.deepEqual(issues[0].labels, ['beethoven-access-request']);
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
  const refused = await request(env, {}, { origin: 'https://evil.example' });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, `requests are taken from the request page at ${SITE} only`);
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
  assert.equal(r.body.request_page, `${SITE}/beethoven/request.html`);
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
  assert.deepEqual(ok.body, { now: ok.body.now, group: { name: 'Beethoven-users', members_url: 'https://groups.google.com/g/beethoven-users/members', mode: 'manual' }, pending: [], approved: [], denied: [], revoked: [], checks: [], seats: [], conflicts: [] });
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

// Beethoven's approval check (its builds send product "bridge", the name it had as Ashley Bridge), sent the way
// an extension's background page sends it: an extension
// origin, a text/plain body (no preflight), no credentials. Beethoven 8.0.0 on also sends install_id, the
// random identifier it makes when it is installed (32 hexadecimal characters); IA, IB and IC are three
// installations, and short() is the fingerprint the service shows for one (SHA-256, first 8 characters)
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const IA = '0123456789abcdef0123456789abcdef';
const IB = 'fedcba9876543210fedcba9876543210';
const IC = 'aaaaaaaabbbbbbbbccccccccdddddddd';
const short = (id) => crypto.createHash('sha256').update(id).digest('hex').slice(0, 8);
const CHECK = { v: 1, access_id: 'st1234', portal: 'ondemand.grid.wayne.edu', product: 'bridge', version: '8.0.0', install_id: IA };
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
  assert.deepEqual(r.body, { approved: false, access_id: 'st1234', requestPage: `${SITE}/beethoven/request.html` });
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
  assert.deepEqual(r.body, { approved: false, access_id: 'st1234', requestPage: `${SITE}/beethoven/request.html` });
  // the public allowlist route is what it was
  const al = await call(env, 'GET', '/allowlist', { origin: null }).then(asJson);
  assert.deepEqual(al.body, { about: 'AccessIDs approved to use Beethoven', accessIds: [] });
  assert.equal(al.headers.get('cache-control'), 'max-age=60');
});

test('POST /access_check refuses a malformed body with 400 and other methods with 405, CORS on each', async () => {
  const env = makeEnv();
  const cases = [
    [{ v: 2 }, 'v'], [{ v: undefined }, 'no v'], [{ access_id: '' }, 'no account'], [{ access_id: 'a b' }, 'a space'], [{ access_id: 'x'.repeat(65) }, 'too long'], [{ access_id: '-x' }, 'leading dash'],
    [{ portal: '' }, 'no portal'], [{ portal: 'not a host' }, 'not a host'], [{ portal: 'https://ondemand.grid.wayne.edu' }, 'a url, not a host'],
    [{ product: '' }, 'no product'], [{ product: 'Bridge!' }, 'bad product'], [{ version: '' }, 'no version'], [{ version: 'v 4' }, 'bad version'],
    [{ install_id: 'xyz' }, 'install_id too short'], [{ install_id: 'g'.repeat(32) }, 'install_id not hexadecimal'], [{ install_id: '0'.repeat(65) }, 'install_id too long'],
    [{ install_id: `-${'0'.repeat(31)}` }, 'install_id leading dash'], [{ install_id: 12345 }, 'install_id a number'], [{ install_id: { a: 1 } }, 'install_id an object'],
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
  // a change of decision is recorded with the time it changed (here: lab membership only from now on)
  await adminPost(env, 'grant', { accessId: 'st1234', grants: ['lab'] });
  await check(env);
  const after = await env.ACCESS.get('seen:bridge:st1234', 'json');
  assert.equal(after.approved, false);
  assert.equal(after.checks, 3);
  assert.ok(after.changed_at >= after.first_seen);
  // a removal deletes the account's check records with everything else (F1 d); the next check starts a new one
  await adminPost(env, 'remove', { accessId: 'st1234' });
  assert.equal(await env.ACCESS.get('seen:bridge:st1234'), null);
  await check(env);
  const fresh = await env.ACCESS.get('seen:bridge:st1234', 'json');
  assert.deepEqual([fresh.approved, fresh.checks, fresh.changed_at], [false, 1, undefined]);
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

test('POST /access_check: a no carries the request page, one page for both editions unless moved', async () => {
  const env = makeEnv();
  const PAGE = 'https://openspineconsortium.com/beethoven/request.html';
  // the browser edition's builds send "bridge" (4.0.0 on) and "beethoven" is the same product; the VS Code
  // edition sent "ashley" before 4.0.0; case and spaces are ignored
  const cases = ['bridge', 'beethoven', ' Beethoven ', 'BRIDGE', 'ashley', 'vscode', 'beethoven-vscode', 'something-else'];
  for (const product of cases) {
    const r = await check(env, { product, access_id: 'zz9876' });
    assert.equal(r.status, 200, product);
    assert.deepEqual(r.body, { approved: false, access_id: 'zz9876', requestPage: PAGE }, product);
    assert.equal(r.headers.get('access-control-allow-origin'), '*', product);
  }
  // each product keeps its own record of the checks (bridge and BRIDGE are one, beethoven and Beethoven one)
  assert.equal((await env.ACCESS.get('seen:bridge:zz9876', 'json')).checks, 2);
  assert.equal((await env.ACCESS.get('seen:beethoven:zz9876', 'json')).checks, 2);
  assert.equal((await env.ACCESS.get('seen:ashley:zz9876', 'json')).checks, 1);
  // an approved account is approved whichever product asks, and a yes names no request page
  await adminPost(env, 'add', { accessId: 'st1234', name: 'Store reviewer (mock portal)', note: 'store-reviewer mock username' });
  for (const product of ['bridge', 'beethoven', 'ashley']) {
    const r = await check(env, { product });
    assert.equal(r.body.approved, true, product);
    assert.deepEqual(Object.keys(r.body), ['approved', 'access_id', 'checked', 'until'], product);
  }
  // each page can still be moved on its own: BEETHOVEN_REQUEST_PAGE for the browser edition, REQUEST_PAGE
  // for every other product and for the VS Code edition's key route
  const moved = makeEnv({ REQUEST_PAGE: 'https://example.org/a.html', BEETHOVEN_REQUEST_PAGE: 'https://example.org/b.html' });
  assert.equal((await check(moved, { product: 'bridge' })).body.requestPage, 'https://example.org/b.html');
  assert.equal((await check(moved, { product: 'beethoven' })).body.requestPage, 'https://example.org/b.html');
  assert.equal((await check(moved, { product: 'ashley' })).body.requestPage, 'https://example.org/a.html');
  const vscode = await trial(makeEnv({ BEETHOVEN_REQUEST_PAGE: 'https://example.org/b.html' }), 'tok-ab1234');
  assert.equal(vscode.body.request_page, PAGE);
  assert.equal((await trial(makeEnv({ REQUEST_PAGE: 'https://example.org/a.html' }), 'tok-ab1234')).body.request_page, 'https://example.org/a.html');
  // wrangler.toml, which both Worker names deploy with: the primary name, the published addresses, the
  // old signing prefixes
  const toml = fs.readFileSync(path.join(HERE, 'wrangler.toml'), 'utf8');
  assert.match(toml, /^name = "beethoven-access"$/m);
  assert.match(toml, /^REQUEST_PAGE = "https:\/\/openspineconsortium\.com\/beethoven\/request\.html"$/m);
  assert.match(toml, /^BEETHOVEN_REQUEST_PAGE = "https:\/\/openspineconsortium\.com\/beethoven\/request\.html"$/m);
  assert.match(toml, /^ADMIN_PAGE = "https:\/\/openspineconsortium\.com\/beethoven\/admin\.html"$/m);
  assert.match(toml, /^SITE_ORIGIN = "https:\/\/openspineconsortium\.com"$/m);
  assert.match(toml, /^KEY_PREFIX = "ashley"$/m);
});

test('KEY_PREFIX: keys and the revocation list are signed ASHLEY1 and ASHLEYREV1 unless it says beethoven', async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const [value, key, list] of [[undefined, 'ASHLEY1', 'ASHLEYREV1'], ['ashley', 'ASHLEY1', 'ASHLEYREV1'], ['beethoven', 'BEETHOVEN1', 'BEETHOVENREV1'], [' Beethoven ', 'BEETHOVEN1', 'BEETHOVENREV1'], ['something-else', 'ASHLEY1', 'ASHLEYREV1']]) {
    const why = String(value);
    const env = makeEnv(value === undefined ? {} : { KEY_PREFIX: value });
    await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
    const k = (await trial(env, 'tok-ab1234')).body.key;
    assert.ok(k.startsWith(`${key}.`), `${why}: ${k.slice(0, 12)}`);
    const c = L.verifyLicense(k, { keys: KEYS, now, identity: { accessId: 'ab1234' } });
    assert.equal(c.status, 'valid', `${why}: ${c.detail}`);
    // the payload is the same whatever the prefix: the product field every verifier checks stays "ashley"
    assert.equal(c.payload.product, 'ashley', why);
    assert.equal(c.payload.edition, 'trial', why);
    await adminPost(env, 'remove', { accessId: 'ab1234' });
    const text = await call(env, 'GET', '/revoked', { origin: null }).then((r) => r.text());
    assert.ok(text.startsWith(`${list}.`), why);
    const rev = L.verifyRevocationList(text, KEYS);
    assert.equal(rev.ok, true, `${why}: ${rev.detail}`);
    assert.deepEqual(rev.revoked, [c.payload.lid], why);
    assert.equal(L.verifyLicense(k, { keys: KEYS, now, revoked: rev.revoked }).status, 'revoked', why);
  }
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
const MAIL = { RESEND_API_KEY: 're_test_key_never_logged', DECIDE_KEY: 'decide-test-key', NOTIFY_TO: 'maintainer@example.edu', MAIL_FROM: 'Beethoven access <onboarding@resend.dev>' };
const mailEnv = (over = {}) => makeEnv({ ...MAIL, GITHUB_TOKEN: undefined, GITHUB_REPO: undefined, ...over });
const ADMIN_PAGE = `${SITE}/beethoven/admin.html`;
// the links in an e-mail's text, by the label on their line (null when the e-mail has none)
const LINK_LABELS = { approve: 'Approve for Beethoven', lab: 'Lab membership only', deny: 'Deny', cv: 'View the CV', move: 'Move the approval to the new installation', withdraw: 'Withdraw approval', confirm: 'Confirm it is you' };
const linksIn = (text) => Object.fromEntries(Object.entries(LINK_LABELS).map(([k, label]) => {
  const m = new RegExp(`^${label}: (\\S+)$`, 'm').exec(text);
  return [k, m ? m[1] : null];
}));
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

test('/request e-mails the maintainer once, with three decision links that verify', async () => {
  const env = mailEnv();
  mails.length = 0;
  const r = await request(env);
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { status: 'pending' });
  assert.equal(mails.length, 1);
  const m = mails[0];
  assert.equal(m.headers.authorization, `Bearer ${MAIL.RESEND_API_KEY}`);
  assert.deepEqual(m.body.to, ['maintainer@example.edu']);
  assert.equal(m.body.from, 'Beethoven access <onboarding@resend.dev>');
  assert.equal(m.headers['user-agent'], 'beethoven-access');
  assert.equal(m.body.subject, 'Beethoven access request: ab1234 (A. Student)');
  for (const s of ['A. Student asked for access to Beethoven.', 'Name: A. Student', 'AccessID: ab1234', 'E-mail: ab1234@wayne.edu', 'What for: spine segmentation project', 'Mailbox: not verified', 'Asked: ', `The admin page lists every request: ${ADMIN_PAGE}`]) assert.ok(m.body.text.includes(s), s);
  assert.ok(!m.body.text.includes('Asked from'), 'the form did not say which product');
  assert.ok(!m.body.text.includes('Asked again'), 'a first request');
  assert.ok(!m.body.text.includes('Google account:'), 'the old form sends none');
  assert.ok(!m.body.text.includes('CV'), 'no CV, no CV line');
  assert.ok(!JSON.stringify(m.body).includes(MAIL.RESEND_API_KEY), 'the key is only in the header');
  const links = linksIn(m.body.text);
  for (const k of ['approve', 'lab', 'deny']) {
    assert.ok(links[k].startsWith('https://service.example/decide?t='), k);
    assert.ok(m.body.html.includes(`href="${links[k]}"`), k);
  }
  assert.equal(links.cv, null);
  // the format README.md gives: base64url(JSON) "." base64url(HMAC-SHA256 of the first part with DECIDE_KEY)
  const ta = tokenOf(links.approve);
  const tl = tokenOf(links.lab);
  const td = tokenOf(links.deny);
  for (const t of [ta, tl, td]) assert.equal(t.split('.')[1], sign(t.split('.')[0]));
  const ca = claimOf(ta);
  const cl = claimOf(tl);
  const cd = claimOf(td);
  assert.deepEqual(Object.keys(ca), ['v', 'access_id', 'decision', 'nonce', 'exp', 'ref']);
  assert.deepEqual([ca.v, ca.access_id, ca.decision, cl.decision, cd.decision], [1, 'ab1234', 'approve', 'lab', 'deny']);
  // each link names the version of the request it was sent for (F1 c)
  const version = (await env.ACCESS.get('pending:ab1234', 'json')).ref;
  assert.ok(ca.ref === version && cl.ref === version && cd.ref === version, 'the links carry the request\'s ref');
  assert.ok(ca.nonce === cd.nonce && ca.nonce === cl.nonce, 'one e-mail, one nonce: using any of the three spends all three');
  assert.match(ca.nonce, /^[A-Za-z0-9_-]{22}$/);
  const days = (ca.exp - Date.now() / 1000) / 86400;
  assert.ok(days > 13.99 && days <= 14, `exp is 14 days out, not ${days}`);
  // each link opens its question, with the one button that POSTs back to the same address
  let p = await open(env, ta);
  assert.equal(p.status, 200);
  plainPage(p, 'approve question');
  assert.ok(p.text.includes('Approve A. Student (ab1234) for Beethoven?'));
  assert.ok(p.text.includes(`<form method="post" action="/decide?t=${ta}"><input type="hidden" name="confirm" value="1"><button type="submit">Approve for Beethoven</button></form>`));
  assert.ok(p.text.includes('Nothing has changed yet.'));
  p = await open(env, tl);
  assert.equal(p.status, 200);
  assert.ok(p.text.includes('Approve A. Student (ab1234) for lab membership only?'));
  assert.ok(p.text.includes('<button type="submit">Lab membership only</button>'));
  p = await open(env, td);
  assert.equal(p.status, 200);
  assert.ok(p.text.includes('Deny access for A. Student (ab1234)?'));
  assert.ok(p.text.includes('<button type="submit">Deny</button>'));
  // the product, when the form names it; what the person typed is shown as text, never as markup
  const env2 = mailEnv();
  mails.length = 0;
  await request(env2, { accessId: 'cd5678', email: 'cd5678@wayne.edu', name: '<b>Eve</b> & co', note: '<img src=x onerror=alert(1)> research', product: 'bridge' });
  assert.ok(mails[0].body.text.includes('Asked from: Beethoven'));
  // a product named like an Object property is shown as typed, not as Object's own members
  const env4 = mailEnv();
  await request(env4, { accessId: 'ef9012', email: 'ef9012@wayne.edu', product: 'constructor' });
  assert.match(mails[1].body.text, /^Asked from: constructor$/m);
  assert.ok(!mails[1].body.text.includes('native code'));
  assert.ok(!mails[0].body.html.includes('<b>Eve') && !mails[0].body.html.includes('<img'));
  assert.ok(mails[0].body.html.includes('&lt;b&gt;Eve&lt;/b&gt; &amp; co'));
  const q = await open(env2, tokenOf(linksIn(mails[0].body.text).approve));
  assert.ok(q.text.includes('Approve &lt;b&gt;Eve&lt;/b&gt; &amp; co (cd5678) for Beethoven?'));
  assert.ok(q.text.includes('What for: &lt;img src=x onerror=alert(1)&gt; research'));
  assert.ok(!q.text.includes('<b>Eve') && !q.text.includes('<img'));
  const done = await press(env2, tokenOf(linksIn(mails[0].body.text).approve));
  assert.ok(done.text.includes('&lt;b&gt;Eve&lt;/b&gt; &amp; co can click the Beethoven icon now'));
  assert.ok(!done.text.includes('<b>Eve'));
});

test('the e-mail says Beethoven access request; its headline names the edition the form named', async () => {
  // [what the form sends, what the headline says, what "Asked from" says (null: no line)]
  const VS = 'Beethoven for VS Code';
  const cases = [['bridge', 'Beethoven', 'Beethoven'], ['beethoven', 'Beethoven', 'Beethoven'], ['Beethoven', 'Beethoven', 'Beethoven'], ['ashley', VS, VS], ['vscode', VS, VS], ['beethoven-vscode', VS, VS], ['other-thing', 'Beethoven', 'other-thing'], [undefined, 'Beethoven', null]];
  for (const [product, headline, from] of cases) {
    const env = mailEnv();
    mails.length = 0;
    const r = await request(env, product === undefined ? {} : { product });
    assert.equal(r.status, 202, String(product));
    assert.equal(mails.length, 1, String(product));
    const m = mails[0].body;
    assert.equal(m.subject, 'Beethoven access request: ab1234 (A. Student)', String(product));
    assert.match(m.text, new RegExp(`^A\\. Student asked for access to ${headline}\\.$`, 'm'), String(product));
    assert.ok(m.html.includes(`<p>A. Student asked for access to ${headline}.</p>`), String(product));
    if (from) {
      assert.match(m.text, new RegExp(`^Asked from: ${from}$`, 'm'), String(product));
      assert.ok(m.html.includes(`>Asked from</td><td style="padding:2px 0">${from}</td>`), String(product));
    } else {
      assert.ok(!m.text.includes('Asked from') && !m.html.includes('Asked from'), 'the form did not say which product');
    }
    assert.ok(!JSON.stringify(m).includes('Ashley'), 'the old name is gone from the e-mail');
    assert.ok(m.text.includes('Sent by the Beethoven access service'), String(product));
  }
  // with no MAIL_FROM secret the sender is still Beethoven's
  mails.length = 0;
  await request(mailEnv({ MAIL_FROM: undefined }));
  assert.equal(mails[0].body.from, 'Beethoven access <onboarding@resend.dev>');
  // Beethoven's request page posts to the second Worker name: the links carry that host, and either name
  // decides them, because both names share DECIDE_KEY and the KV namespaces
  const env = mailEnv();
  mails.length = 0;
  const posted = await worker.fetch(new Request('https://beethoven-access.example.workers.dev/request', { method: 'POST', headers: { origin: SITE, 'cf-connecting-ip': '203.0.113.7', 'content-type': 'application/json' }, body: JSON.stringify({ accessId: 'ab1234', name: 'A. Student', email: 'ab1234@wayne.edu', note: 'spine segmentation project', product: 'bridge' }) }), env);
  assert.equal(posted.status, 202);
  assert.equal(posted.headers.get('access-control-allow-origin'), SITE);
  const { approve } = linksIn(mails[0].body.text);
  assert.ok(approve.startsWith('https://beethoven-access.example.workers.dev/decide?t='), approve);
  const done = await press(env, tokenOf(approve)); // pressed at the other name (https://service.example)
  assert.equal(done.status, 200);
  assert.ok(done.text.includes('A. Student can click the Beethoven icon now; the extension re-checks within ten minutes.'));
  assert.ok(!done.text.includes('Ashley Bridge'));
  assert.equal((await check(env, { access_id: 'ab1234' })).body.approved, true);
});

test('one e-mail per AccessID a day for the same request; a changed one is e-mailed at once; a failed send is logged with its status only and tried again', async () => {
  const env = mailEnv();
  mails.length = 0;
  await request(env);
  await request(env);
  await request(env);
  assert.equal(mails.length, 1, 'the same request again within the day sends nothing');
  assert.ok(env.ACCESS.m.has('notified:ab1234'));
  assert.equal(env.ACCESS.ttl.get('notified:ab1234'), 86400);
  await request(env, { accessId: 'cd5678', email: 'cd5678@wayne.edu' });
  assert.equal(mails.length, 2, 'another person is their own e-mail');
  // a day later KV has dropped the key: the same request sends one reminder, which says so, with links to the same version
  const ref = (await env.ACCESS.get('pending:ab1234', 'json')).ref;
  env.ACCESS.m.delete('notified:ab1234');
  await request(env);
  assert.equal(mails.length, 3);
  assert.match(mails[2].body.text, /^Asked again: /m);
  assert.equal(claimOf(tokenOf(linksIn(mails[2].body.text).approve)).ref, ref, 'the same version');
  await request(env);
  assert.equal(mails.length, 3);
  // changed: a new version, e-mailed at once (the older e-mail's links stop working), three a day at most
  await request(env, { note: 'still waiting' });
  assert.equal(mails.length, 4);
  assert.match(mails[3].body.text, /^What for: still waiting$/m);
  assert.match(mails[3].body.text, /^Asked again: .*links in an earlier e-mail about ab1234 no longer work/m);
  assert.notEqual(claimOf(tokenOf(linksIn(mails[3].body.text).approve)).ref, ref);
  await request(env, { note: 'third version' });
  assert.equal(mails.length, 5);
  logs.length = 0;
  await request(env, { note: 'fourth version' });
  assert.equal(mails.length, 5, 'the fourth version of the day is on the admin page only');
  assert.deepEqual(logs, [{ level: 'log', line: 'mail: three e-mails about this AccessID today already; the newest request is on the admin page' }]);
  assert.equal((await adminList(env)).body.pending.find((p) => p.accessId === 'ab1234').note, 'fourth version');
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
  assert.ok(bare.text.includes('Approve A. Student (ab1234) for Beethoven?'));
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
  assert.ok(done.text.includes('A. Student can click the Beethoven icon now; the extension re-checks within ten minutes.'));
  assert.ok(done.text.includes(ADMIN_PAGE));
  const rec = await env.ACCESS.get('approved:ab1234', 'json');
  // the lifecycle rides along: when the request was sent, its mailbox, the decision and when, and the version decided
  const version = claimOf(ta).ref;
  assert.deepEqual({ ...rec, approved_at: 'x', submitted_at: 'x', decided_at: 'x' }, { name: 'A. Student', email: 'ab1234@wayne.edu', note: 'spine segmentation project', approved_at: 'x', by: 'e-mail link', lids: [], submitted_at: 'x', mailbox: 'not_verified', ref: version, decided_at: 'x', decision: 'approve', grants: ['extension', 'lab'] });
  assert.ok(Math.abs(Date.parse(rec.approved_at) - Date.now()) < 5000);
  assert.equal(rec.decided_at, rec.approved_at);
  assert.equal(await env.ACCESS.get('pending:ab1234'), null);
  const audits = [...env.ACCESS.m.entries()].filter(([k]) => k.startsWith('audit:')).map(([, v]) => JSON.parse(v));
  assert.deepEqual(audits, [{ action: 'approve', accessId: 'ab1234', by: 'e-mail link', grants: ['extension', 'lab'] }]);
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
  // both editions see the approval
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
  assert.ok(late.text.includes('This request was decided already'));
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
    'a ref that is not one': mint({ ...claim, ref: 'x' }),
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
  assert.equal((await open(env, mint({ v: 1, access_id: 'ab1234', decision: 'approve', nonce: 'n'.repeat(22), exp: Math.floor(Date.now() / 1000) + 60, ref: claim.ref }))).status, 200);
  // a good signature without a ref: a link from an e-mail sent before links named a version; it decides nothing
  const legacy = mint({ v: 1, access_id: 'ab1234', decision: 'approve', nonce: 'm'.repeat(22), exp: Math.floor(Date.now() / 1000) + 60 });
  for (const res of [await open(env, legacy), await press(env, legacy)]) {
    assert.equal(res.status, 410);
    plainPage(res, 'out of date');
    assert.ok(res.text.includes('This link is out of date'));
    assert.ok(res.text.includes(ADMIN_PAGE));
  }
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
  assert.equal(mails[0].body.subject, 'Beethoven access: test e-mail');
  assert.ok(mails[0].body.text.startsWith('This is a test from the Beethoven access service'));
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

// ---- One approved account, one installation (ACCESS_CHECK.md, "Installations") ----

const auditsOf = (env) => [...env.ACCESS.m.entries()].filter(([k]) => k.startsWith('audit:')).map(([, v]) => JSON.parse(v));
const pause = () => new Promise((res) => setTimeout(res, 5));

test('POST /access_check: the first installation binds the account, the same one repeats, another is refused', async () => {
  const env = makeEnv();
  await adminPost(env, 'add', { accessId: 'st1234', name: 'Store reviewer (mock portal)' });
  let r = await check(env);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ['approved', 'access_id', 'checked', 'until']);
  assert.equal(r.body.approved, true);
  const seat = await env.ACCESS.get('seat:st1234', 'json');
  assert.deepEqual(Object.keys(seat), ['install_id', 'first_seen', 'last_seen', 'product', 'version']);
  assert.deepEqual([seat.install_id, seat.product, seat.version], [IA, 'bridge', '8.0.0']);
  assert.equal(seat.first_seen, seat.last_seen);
  assert.equal(env.ACCESS.ttl.get('seat:st1234'), undefined, 'a seat is kept until it is moved, reset or removed');
  const index = await env.ACCESS.get(`install:${IA}`, 'json');
  assert.deepEqual(Object.keys(index), ['access_id', 'bound_at']);
  assert.equal(index.access_id, 'st1234');
  // the same installation later, in capitals and with a new version: yes, and the seat keeps its first time
  await pause();
  r = await check(env, { install_id: IA.toUpperCase(), version: '8.0.1' });
  assert.equal(r.body.approved, true);
  const again = await env.ACCESS.get('seat:st1234', 'json');
  assert.equal(again.install_id, IA);
  assert.equal(again.first_seen, seat.first_seen);
  assert.ok(again.last_seen > seat.last_seen);
  assert.equal(again.version, '8.0.1');
  // another installation: refused with the reason, the seat unchanged, the refusal counted
  r = await check(env, { install_id: IB });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { approved: false, access_id: 'st1234', reason: 'other_installation', requestPage: `${SITE}/beethoven/request.html` });
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await env.ACCESS.get('seat:st1234', 'json'), again);
  assert.equal(await env.ACCESS.get(`install:${IB}`), null, 'a refused installation is bound to nothing');
  let conflict = await env.ACCESS.get('conflict:st1234', 'json');
  assert.deepEqual(Object.keys(conflict), ['kind', 'count', 'first_at', 'last_at', 'other_install_short']);
  assert.deepEqual([conflict.kind, conflict.count, conflict.other_install_short], ['other_installation', 1, short(IB)]);
  assert.equal(conflict.first_at, conflict.last_at);
  assert.equal(env.ACCESS.ttl.get('conflict:st1234'), 365 * 86400);
  const seen = await env.ACCESS.get('seen:bridge:st1234', 'json');
  assert.deepEqual([seen.approved, seen.reason], [false, 'other_installation']);
  await pause();
  r = await check(env, { install_id: IC });
  assert.equal(r.body.reason, 'other_installation');
  conflict = await env.ACCESS.get('conflict:st1234', 'json');
  assert.deepEqual([conflict.count, conflict.other_install_short], [2, short(IC)]);
  assert.ok(conflict.last_at > conflict.first_at);
  // the first installation is not disturbed by the refusals
  r = await check(env);
  assert.equal(r.body.approved, true);
  const seen2 = await env.ACCESS.get('seen:bridge:st1234', 'json');
  assert.deepEqual([seen2.approved, seen2.reason], [true, undefined]);
  // a refused identifier is kept nowhere, not even in a key; only its fingerprint is
  const where = [...env.ACCESS.m.entries()].filter(([k, v]) => [IB, IC].some((x) => k.includes(x) || String(v).includes(x))).map(([k]) => k);
  assert.deepEqual(where, []);
});

test('POST /access_check: without install_id an approved account is refused update_required, unless REQUIRE_INSTALL_ID is "0"', async () => {
  const PAGE = `${SITE}/beethoven/request.html`;
  const env = makeEnv();
  // not approved: the plain no, whatever the build sends
  let r = await check(env, { install_id: undefined, version: '7.0.0' });
  assert.deepEqual(r.body, { approved: false, access_id: 'st1234', requestPage: PAGE });
  await adminPost(env, 'add', { accessId: 'st1234', name: 'Store reviewer (mock portal)' });
  for (const none of [undefined, null, '']) {
    r = await check(env, { install_id: none, version: '7.0.0' });
    assert.equal(r.status, 200, String(none));
    assert.deepEqual(r.body, { approved: false, access_id: 'st1234', reason: 'update_required', requestPage: PAGE }, String(none));
  }
  assert.equal(await env.ACCESS.get('seat:st1234'), null, 'nothing is bound');
  assert.equal(await env.ACCESS.get('conflict:st1234'), null, 'an old build is not a conflict');
  assert.equal((await env.ACCESS.get('seen:bridge:st1234', 'json')).reason, 'update_required');
  // any value but "0" keeps the rule
  for (const value of ['1', 'yes', 'false', '']) {
    const e = makeEnv({ REQUIRE_INSTALL_ID: value });
    await adminPost(e, 'add', { accessId: 'st1234', name: 'x' });
    assert.equal((await check(e, { install_id: undefined })).body.reason, 'update_required', value);
  }
  // "0": the builds before 8.0.0 keep working while the new ones bind as usual
  for (const value of ['0', ' 0 ']) {
    const e = makeEnv({ REQUIRE_INSTALL_ID: value });
    await adminPost(e, 'add', { accessId: 'st1234', name: 'x' });
    r = await check(e, { install_id: undefined, version: '7.0.0' });
    assert.deepEqual(Object.keys(r.body), ['approved', 'access_id', 'checked', 'until'], value);
    assert.equal(r.body.approved, true, value);
    assert.equal(await e.ACCESS.get('seat:st1234'), null, value);
    assert.equal((await check(e)).body.approved, true, value);
    assert.equal((await e.ACCESS.get('seat:st1234', 'json')).install_id, IA, value);
    assert.equal((await check(e, { install_id: IB })).body.reason, 'other_installation', value);
    assert.equal((await check(e, { install_id: undefined })).body.approved, true, `${value}: an old build is let through`);
  }
  // wrangler.toml deploys with the rule off until Beethoven 8.0.0 is on the private listing, and with the
  // student e-mail off until the domain is verified at Resend
  const toml = fs.readFileSync(path.join(HERE, 'wrangler.toml'), 'utf8');
  assert.match(toml, /^REQUIRE_INSTALL_ID = "0"$/m);
  assert.match(toml, /^MAIL_STUDENTS = "0"$/m);
});

test('grants: the check, /allowlist and /trial need "extension"; a record without grants counts as both', async () => {
  const env = makeEnv();
  const PAGE = `${SITE}/beethoven/request.html`;
  const add = await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  assert.deepEqual(add.body.record.grants, ['extension', 'lab']);
  assert.deepEqual((await adminPost(env, 'add', { accessId: 'ef9012', name: 'E. F.', grants: ['lab'] })).body.record.grants, ['lab']);
  assert.equal((await adminPost(env, 'add', { accessId: 'ef9013', name: 'E. G.', grants: ['boss'] })).status, 400);
  // a record written before grants existed
  await env.ACCESS.put('approved:cd5678', JSON.stringify({ name: 'C. D.', email: 'cd5678@wayne.edu', note: '', approved_at: '2026-09-01T00:00:00.000Z', by: 'admin', lids: [] }));
  assert.equal((await check(env, { access_id: 'cd5678', install_id: IB })).body.approved, true);
  // lab membership only: a plain no (nothing bound), off the allowlist, no key
  let g = await adminPost(env, 'grant', { accessId: 'ab1234', grants: ['lab'] });
  assert.equal(g.status, 200);
  assert.deepEqual(g.body, { status: 'granted', accessId: 'ab1234', grants: ['lab'] });
  const r = await check(env, { access_id: 'ab1234' });
  assert.deepEqual(r.body, { approved: false, access_id: 'ab1234', requestPage: PAGE });
  assert.equal(await env.ACCESS.get('seat:ab1234'), null);
  assert.deepEqual((await call(env, 'GET', '/allowlist', { origin: null }).then(asJson)).body.accessIds, ['cd5678']);
  const t = await trial(env, 'tok-ab1234');
  assert.equal(t.status, 403);
  assert.equal(t.body.error, 'not approved');
  assert.equal(t.body.key, undefined);
  const list = await adminList(env);
  assert.deepEqual(list.body.approved.map((a) => [a.accessId, a.grants]), [['ab1234', ['lab']], ['cd5678', ['extension', 'lab']], ['ef9012', ['lab']]]);
  // grants are set exactly, in one order, and only these two words
  for (const bad of [[], ['admin'], 'lab', ['lab', 'x'], undefined]) assert.equal((await adminPost(env, 'grant', { accessId: 'ab1234', grants: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await adminPost(env, 'grant', { accessId: 'zz0000', grants: ['lab'] })).status, 404);
  // /admin/approve takes the grants to add as well (the admin page's "Lab membership only")
  await requestV2(env, { access_id: 'kl0001', email: 'kl0001@wayne.edu' });
  assert.equal((await adminPost(env, 'approve', { accessId: 'kl0001', grants: ['nope'] })).status, 400);
  assert.deepEqual((await adminPost(env, 'approve', { accessId: 'kl0001', grants: ['lab'] })).body.record.grants, ['lab']);
  assert.deepEqual((await adminPost(env, 'approve', { accessId: 'kl0001' })).body.record.grants, ['extension', 'lab'], 'an approval adds to what they had');
  g = await adminPost(env, 'grant', { accessId: 'ab1234', grants: ['lab', 'extension', 'lab'] });
  assert.deepEqual(g.body.grants, ['extension', 'lab']);
  assert.equal((await check(env, { access_id: 'ab1234' })).body.approved, true);
  assert.equal((await trial(env, 'tok-ab1234')).status, 200);
  assert.ok(auditsOf(env).some((a) => a.action === 'grant' && a.accessId === 'ab1234'));
});

test('one installation serves one account: another approved account is refused there, and a freed installation binds again', async () => {
  const env = makeEnv();
  const PAGE = `${SITE}/beethoven/request.html`;
  for (const id of ['aa0001', 'bb0002', 'cc0003', 'dd0004']) await adminPost(env, 'add', { accessId: id, name: id });
  assert.equal((await check(env, { access_id: 'aa0001' })).body.approved, true);
  let r = await check(env, { access_id: 'bb0002' });
  assert.deepEqual(r.body, { approved: false, access_id: 'bb0002', reason: 'other_account', requestPage: PAGE });
  assert.equal(await env.ACCESS.get('seat:bb0002'), null);
  const c = await env.ACCESS.get('conflict:bb0002', 'json');
  assert.deepEqual([c.kind, c.count, c.other_install_short], ['other_account', 1, short(IA)]);
  assert.equal((await env.ACCESS.get(`install:${IA}`, 'json')).access_id, 'aa0001', 'the installation stays with the first account');
  // bb0002 on its own installation is fine
  assert.equal((await check(env, { access_id: 'bb0002', install_id: IB })).body.approved, true);
  // reset-seat frees the installation: the next account to check from it binds it
  assert.equal((await adminPost(env, 'reset-seat', { accessId: 'aa0001' })).status, 200);
  assert.equal(await env.ACCESS.get(`install:${IA}`), null);
  r = await check(env, { access_id: 'cc0003' });
  assert.equal(r.body.approved, true);
  assert.equal((await env.ACCESS.get(`install:${IA}`, 'json')).access_id, 'cc0003');
  // and aa0001, now without a seat, is the second account there
  assert.equal((await check(env, { access_id: 'aa0001' })).body.reason, 'other_account');
  // an index left behind by a seat that has moved on blocks nothing
  await env.ACCESS.put(`install:${IC}`, JSON.stringify({ access_id: 'aa0001', bound_at: '2026-09-01T00:00:00.000Z' }));
  assert.equal((await check(env, { access_id: 'dd0004', install_id: IC })).body.approved, true);
  assert.equal((await env.ACCESS.get(`install:${IC}`, 'json')).access_id, 'dd0004');
});

test('seat-rule any: an account every installation may use binds nothing (the store reviewers\' mock account)', async () => {
  const env = makeEnv();
  await adminPost(env, 'add', { accessId: 'st1234', name: 'Store reviewer (mock portal)' });
  const s = await adminPost(env, 'seat-rule', { accessId: 'st1234', any: true });
  assert.equal(s.status, 200);
  assert.deepEqual(s.body, { status: 'seat-rule', accessId: 'st1234', any_installation: true });
  assert.equal((await env.ACCESS.get('approved:st1234', 'json')).any_installation, true);
  // the reviewers' mock portal runs on localhost: there, every installation (and a build without an identifier) gets in
  const LOCAL = 'localhost:8080';
  for (const install_id of [IA, IB, IC, undefined]) assert.equal((await check(env, { install_id, portal: LOCAL })).body.approved, true, String(install_id));
  assert.equal(await env.ACCESS.get('seat:st1234'), null);
  assert.equal(await env.ACCESS.get(`install:${IA}`), null);
  // re-adding the account keeps the rule
  await adminPost(env, 'add', { accessId: 'st1234', note: 'store-reviewer mock username' });
  assert.equal((await env.ACCESS.get('approved:st1234', 'json')).any_installation, true);
  // an installation bound to another account serves it too, and takes nothing from that account
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  assert.equal((await check(env, { access_id: 'ab1234', install_id: IC })).body.approved, true);
  assert.equal((await check(env, { install_id: IC, portal: LOCAL })).body.approved, true);
  assert.equal((await env.ACCESS.get(`install:${IC}`, 'json')).access_id, 'ab1234');
  // back to one installation: the next check binds
  const off = await adminPost(env, 'seat-rule', { accessId: 'st1234', any: false });
  assert.equal(off.body.any_installation, false);
  assert.equal('any_installation' in (await env.ACCESS.get('approved:st1234', 'json')), false);
  assert.equal((await check(env, { install_id: IB })).body.approved, true);
  assert.equal((await check(env, { install_id: IA })).body.reason, 'other_installation');
  assert.equal((await adminPost(env, 'seat-rule', { accessId: 'zz0000', any: true })).status, 404);
  assert.equal((await adminPost(env, 'seat-rule', { accessId: 'st1234', any: 'yes' })).status, 400);
});

test('a second installation e-mails the maintainer once a day, with a Move and a Withdraw link', async () => {
  const env = mailEnv();
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  mails.length = 0;
  assert.equal((await check(env, { access_id: 'ab1234' })).body.approved, true);
  assert.equal(mails.length, 0);
  assert.equal((await check(env, { access_id: 'ab1234', install_id: IB, version: '8.0.1' })).body.reason, 'other_installation');
  assert.equal(mails.length, 1);
  const m = mails[0].body;
  assert.deepEqual(m.to, ['maintainer@example.edu']);
  assert.equal(m.subject, 'Beethoven: ab1234 asked from a second installation');
  assert.ok(m.text.startsWith('A. Student (ab1234) asked from a second installation; it was refused.\n'), m.text.slice(0, 90));
  for (const s of [`Installation in use: ${short(IA)}`, `Refused installation: ${short(IB)}`, 'version 8.0.1', 'Refusals: 1']) assert.ok(m.text.includes(s), s);
  assert.ok(!m.text.includes(IA) && !m.text.includes(IB) && !m.html.includes(IA), 'only fingerprints in the e-mail');
  const links = linksIn(m.text);
  for (const k of ['move', 'withdraw']) {
    assert.ok(links[k].startsWith('https://service.example/decide?t='), k);
    assert.ok(m.html.includes(`href="${links[k]}"`), k);
  }
  assert.equal(links.approve, null);
  const cm = claimOf(tokenOf(links.move));
  const cw = claimOf(tokenOf(links.withdraw));
  assert.deepEqual(Object.keys(cm), ['v', 'access_id', 'decision', 'nonce', 'exp', 'install_id', 'ref']);
  // both name the refusal e-mail they came in (the conflict record's ref, written once the e-mail went)
  const cref = (await env.ACCESS.get('conflict:ab1234', 'json')).ref;
  assert.ok(cref && cm.ref === cref && cw.ref === cref);
  assert.deepEqual([cm.decision, cm.install_id, cw.decision, cw.install_id], ['move', IB, 'withdraw', undefined]);
  assert.equal(cm.nonce, cw.nonce);
  assert.ok((cm.exp - Date.now() / 1000) / 86400 > 13.99);
  assert.equal(env.ACCESS.ttl.get('conflict_notified:ab1234'), 86400);
  // more refusals the same day: counted, no second e-mail
  await check(env, { access_id: 'ab1234', install_id: IB });
  await check(env, { access_id: 'ab1234', install_id: IC });
  assert.equal(mails.length, 1);
  assert.equal((await env.ACCESS.get('conflict:ab1234', 'json')).count, 3);
  // opening either link changes nothing
  const before = snapshot(env);
  let p = await open(env, tokenOf(links.move));
  assert.equal(p.status, 200);
  plainPage(p, 'move question');
  assert.ok(p.text.includes('Move the approval of A. Student (ab1234) to the new installation?'));
  assert.ok(p.text.includes(short(IB)));
  assert.ok(p.text.includes('<button type="submit">Move the approval</button>'));
  p = await open(env, tokenOf(links.withdraw));
  assert.ok(p.text.includes('Withdraw the approval of A. Student (ab1234)?'));
  assert.ok(p.text.includes('<button type="submit">Withdraw approval</button>'));
  assert.equal(snapshot(env), before);
  // Move: the refused installation becomes the one; the old one is refused from now on
  p = await press(env, tokenOf(links.move));
  assert.equal(p.status, 200);
  plainPage(p, 'moved');
  assert.ok(p.text.includes('<h1>Moved.</h1>'));
  const seat = await env.ACCESS.get('seat:ab1234', 'json');
  assert.equal(seat.install_id, IB);
  assert.equal(seat.by, 'e-mail link');
  assert.ok(seat.moved_at);
  assert.equal(await env.ACCESS.get('conflict:ab1234'), null);
  assert.equal(await env.ACCESS.get(`install:${IA}`), null);
  assert.equal((await env.ACCESS.get(`install:${IB}`, 'json')).access_id, 'ab1234');
  assert.equal((await check(env, { access_id: 'ab1234', install_id: IB })).body.approved, true);
  assert.equal((await check(env, { access_id: 'ab1234' })).body.reason, 'other_installation');
  assert.equal(mails.length, 1, 'still one e-mail today');
  assert.ok(auditsOf(env).some((a) => a.action === 'move-seat' && a.accessId === 'ab1234' && a.by === 'e-mail link'));
  // the other link of the e-mail is spent
  p = await press(env, tokenOf(links.withdraw));
  assert.equal(p.status, 410);
  assert.ok(p.text.includes('This link was already used'));
  assert.ok(await env.ACCESS.get('approved:ab1234'), 'still approved');
});

test('Withdraw approval from that e-mail removes the person and their keys; a late or failed step changes nothing', async () => {
  const env = mailEnv();
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  const key = (await trial(env, 'tok-ab1234')).body.key;
  mails.length = 0;
  await check(env, { access_id: 'ab1234' });
  await check(env, { access_id: 'ab1234', install_id: IB });
  const p = await press(env, tokenOf(linksIn(mails[0].body.text).withdraw));
  assert.equal(p.status, 200);
  assert.ok(p.text.includes('<h1>Withdrawn.</h1>'));
  for (const k of ['approved:ab1234', 'seat:ab1234', 'conflict:ab1234', `install:${IA}`]) assert.equal(await env.ACCESS.get(k), null, k);
  assert.deepEqual((await check(env, { access_id: 'ab1234' })).body, { approved: false, access_id: 'ab1234', requestPage: `${SITE}/beethoven/request.html` });
  const rev = L.verifyRevocationList(await call(env, 'GET', '/revoked', { origin: null }).then((x) => x.text()), KEYS);
  assert.deepEqual(rev.revoked, [L.peek(key).lid]);
  assert.ok(auditsOf(env).some((a) => a.action === 'remove' && a.by === 'e-mail link'));
  // a Move link for someone removed in the meantime changes nothing
  const env2 = mailEnv();
  await adminPost(env2, 'add', { accessId: 'ab1234', name: 'A. Student' });
  mails.length = 0;
  await check(env2, { access_id: 'ab1234' });
  await check(env2, { access_id: 'ab1234', install_id: IB });
  await adminPost(env2, 'remove', { accessId: 'ab1234' });
  const late = await press(env2, tokenOf(linksIn(mails[0].body.text).move));
  assert.equal(late.status, 409);
  assert.ok(late.text.includes('Nothing changed'));
  assert.equal(await env2.ACCESS.get('seat:ab1234'), null);
  // a failed send starts no day: the next refusal tries again
  const env3 = mailEnv();
  await adminPost(env3, 'add', { accessId: 'ab1234', name: 'A. Student' });
  mails.length = 0;
  await check(env3, { access_id: 'ab1234' });
  try {
    resend.status = 403;
    await check(env3, { access_id: 'ab1234', install_id: IB });
  } finally {
    resend.status = 200;
  }
  assert.equal(env3.ACCESS.m.has('conflict_notified:ab1234'), false);
  await check(env3, { access_id: 'ab1234', install_id: IB });
  assert.equal(mails.length, 2);
  assert.ok(env3.ACCESS.m.has('conflict_notified:ab1234'));
});

test('admin: seat shows the binding by fingerprint, reset-seat clears it, list shows seats and conflicts with no identifier', async () => {
  const env = makeEnv();
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  await check(env, { access_id: 'ab1234' });
  await check(env, { access_id: 'ab1234', install_id: IB });
  let s = await adminPost(env, 'seat', { accessId: 'ab1234' });
  assert.equal(s.status, 200);
  assert.deepEqual(Object.keys(s.body), ['accessId', 'any_installation', 'seat', 'conflict']);
  assert.deepEqual(Object.keys(s.body.seat), ['install_short', 'first_seen', 'last_seen', 'product', 'version']);
  assert.equal(s.body.seat.install_short, short(IA));
  assert.deepEqual([s.body.conflict.kind, s.body.conflict.count, s.body.conflict.other_install_short], ['other_installation', 1, short(IB)]);
  assert.equal(s.body.any_installation, false);
  assert.ok(!JSON.stringify(s.body).includes(IA) && !JSON.stringify(s.body).includes(IB));
  const list = await adminList(env);
  assert.deepEqual(list.body.seats.map((x) => Object.keys(x)), [['accessId', 'first_seen', 'last_seen', 'product', 'version']]);
  assert.deepEqual(list.body.conflicts.map((x) => Object.keys(x)), [['accessId', 'kind', 'count', 'first_at', 'last_at']]);
  assert.equal(list.body.conflicts[0].count, 1);
  const text = JSON.stringify(list.body);
  for (const x of [IA, IB, short(IA), short(IB)]) assert.ok(!text.includes(x), x);
  // reset-seat: the binding, the index and the conflict go; the next installation binds
  const reset = await adminPost(env, 'reset-seat', { accessId: 'ab1234' });
  assert.deepEqual(reset.body, { status: 'reset', accessId: 'ab1234', had_seat: true });
  for (const k of ['seat:ab1234', 'conflict:ab1234', `install:${IA}`]) assert.equal(await env.ACCESS.get(k), null, k);
  assert.equal((await check(env, { access_id: 'ab1234', install_id: IB })).body.approved, true);
  assert.equal((await env.ACCESS.get('seat:ab1234', 'json')).install_id, IB);
  assert.ok(auditsOf(env).some((a) => a.action === 'reset-seat' && a.accessId === 'ab1234'));
  // nothing on record: null, not an error; not an AccessID: 400
  s = await adminPost(env, 'seat', { accessId: 'zz0000' });
  assert.deepEqual(s.body, { accessId: 'zz0000', any_installation: false, seat: null, conflict: null });
  assert.deepEqual((await adminPost(env, 'reset-seat', { accessId: 'zz0000' })).body, { status: 'reset', accessId: 'zz0000', had_seat: false });
  assert.equal((await adminPost(env, 'seat', { accessId: 'nope' })).status, 400);
  // remove clears the seat, the conflict, the index and the CV with the approval
  await check(env, { access_id: 'ab1234', install_id: IC });
  await env.ACCESS.put('cv:ab1234', new Uint8Array([37, 80, 68, 70, 45]), { metadata: { name: 'cv.pdf', kind: 'pdf', size: 5 } });
  await adminPost(env, 'remove', { accessId: 'ab1234' });
  for (const k of ['approved:ab1234', 'seat:ab1234', 'conflict:ab1234', `install:${IB}`, 'cv:ab1234']) assert.equal(await env.ACCESS.get(k), null, k);
});

// ---- The request portal (README.md, "The request portal"): the v2 body the website sends ----

const V2 = { v: 2, access_id: 'ab1234', name: 'A. Student', email: 'ab1234@wayne.edu', google_account: 'a.student@gmail.com', purpose: 'spine segmentation project', product: 'bridge' };
// each request from its own address unless one is given, so the ten-a-day limit per connection stays out of the way
let ipCount = 0;
const freshIp = () => `10.1.${Math.floor(ipCount / 250) % 250}.${(ipCount++ % 250) + 1}`;
const requestV2 = (env, over = {}, opts = {}) => call(env, 'POST', '/request', { body: { ...V2, ...over }, ip: freshIp(), ...opts }).then(asJson);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), crypto.randomBytes(3000), Buffer.from('\n%%EOF\n')]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), crypto.randomBytes(2000)]);
const DOC = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), crypto.randomBytes(2000)]);
const cvOf = (bytes, name = 'cv.pdf', type = 'application/pdf') => ({ name, type, base64: Buffer.from(bytes).toString('base64') });
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };

test('POST /request v2: the fields are checked, the request stored, a CV kept as bytes with the kind its bytes show', async () => {
  const env = makeEnv();
  const bad = [
    [{ access_id: 'abc123' }, /AccessID/], [{ email: 'other@wayne.edu' }, /e-mail must be ab1234@wayne\.edu/], [{ name: 'A' }, /name/],
    [{ google_account: undefined }, /Google account/], [{ google_account: 'not an address' }, /Google account/], [{ google_account: `${'x'.repeat(120)}@gmail.com` }, /Google account/],
    [{ purpose: undefined }, /use Beethoven for/], [{ purpose: ' ' }, /use Beethoven for/], [{ purpose: 'x'.repeat(501) }, /500/],
    [{ cv: 'a string' }, /CV/], [{ cv: cvOf(Buffer.from('hello, not a document'), 'cv.pdf') }, /PDF or a Word file/],
    [{ cv: { name: 'cv.pdf', type: 'application/pdf', base64: '%%%not base64%%%' } }, /CV/], [{ cv: { name: 'cv.pdf', type: 'application/pdf', base64: '' } }, /CV/],
    [{ v: 3 }, /v is 2/],
  ];
  for (const [over, why] of bad) {
    const r = await requestV2(env, over);
    assert.equal(r.status, 400, `${JSON.stringify(over).slice(0, 60)}: ${r.body.error}`);
    assert.match(r.body.error, why);
  }
  assert.deepEqual([...env.ACCESS.m.keys()].filter((k) => !k.startsWith('req:')), [], 'nothing stored for a refused body');
  // no CV
  let r = await requestV2(env);
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'not_verified' });
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  let rec = await env.ACCESS.get('pending:ab1234', 'json');
  assert.deepEqual({ ...rec, requested_at: 'x', submitted_at: 'x', ref: 'x' }, { name: 'A. Student', email: 'ab1234@wayne.edu', note: 'spine segmentation project', google_account: 'a.student@gmail.com', asked_from: 'Beethoven', requested_at: 'x', submitted_at: 'x', v: 2, ref: 'x', mailbox: 'not_verified' });
  assert.equal(rec.submitted_at, rec.requested_at);
  assert.equal(env.ACCESS.ttl.get('pending:ab1234'), undefined, 'with MAIL_STUDENTS "0" a request has no end');
  assert.match(rec.ref, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await env.ACCESS.get('cv:ab1234'), null);
  // with a PDF: the bytes as sent, the kind from the bytes (not from the name or the type the form gave)
  r = await requestV2(env, { access_id: 'cd5678', email: 'cd5678@wayne.edu', google_account: ' C.D@Gmail.com ', cv: cvOf(PDF, 'My CV (2026).PDF', 'text/html') });
  assert.equal(r.status, 202);
  const stored = await env.ACCESS.getWithMetadata('cv:cd5678', 'arrayBuffer');
  assert.ok(Buffer.from(stored.value).equals(PDF));
  assert.deepEqual({ ...stored.metadata, uploaded_at: 'x' }, { name: 'My CV (2026).PDF', kind: 'pdf', size: PDF.length, uploaded_at: 'x' });
  assert.equal(env.ACCESS.ttl.get('cv:cd5678'), 365 * 86400);
  rec = await env.ACCESS.get('pending:cd5678', 'json');
  assert.deepEqual(rec.cv, { name: 'My CV (2026).PDF', kind: 'pdf', size: PDF.length });
  assert.equal(rec.google_account, 'c.d@gmail.com');
  // a request sent again without a CV keeps the one already sent
  await requestV2(env, { access_id: 'cd5678', email: 'cd5678@wayne.edu', purpose: 'a longer purpose' });
  assert.deepEqual((await env.ACCESS.get('pending:cd5678', 'json')).cv, { name: 'My CV (2026).PDF', kind: 'pdf', size: PDF.length });
  // Word, both kinds; a data: address is taken as the base64 after its comma
  for (const [id, bytes, kind] of [['ef0001', DOCX, 'docx'], ['ef0002', DOC, 'doc']]) {
    const c = cvOf(bytes, `cv.${kind}`);
    r = await requestV2(env, { access_id: id, email: `${id}@wayne.edu`, cv: { ...c, base64: `data:application/octet-stream;base64,${c.base64}` } });
    assert.equal(r.status, 202, kind);
    assert.equal((await env.ACCESS.getWithMetadata(`cv:${id}`, 'arrayBuffer')).metadata.kind, kind);
  }
  // 5 MB at most (decoded); a body past the request cap is refused before it is read
  const five = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(5 * 1024 * 1024 - 9)]);
  r = await requestV2(env, { access_id: 'gh0001', email: 'gh0001@wayne.edu', cv: cvOf(five) });
  assert.equal(r.status, 202, r.body.error);
  assert.equal((await env.ACCESS.getWithMetadata('cv:gh0001', 'arrayBuffer')).metadata.size, 5 * 1024 * 1024);
  r = await requestV2(env, { access_id: 'gh0002', email: 'gh0002@wayne.edu', cv: cvOf(Buffer.concat([five, Buffer.from('x')])) });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /5 MB/);
  r = await call(env, 'POST', '/request', { body: JSON.stringify({ ...V2, access_id: 'gh0003', email: 'gh0003@wayne.edu', cv: { name: 'a.pdf', base64: 'A'.repeat(8 * 1024 * 1024) } }), ip: freshIp() }).then(asJson);
  assert.equal(r.status, 413);
  // the file name is kept as text: no control characters, 120 characters at most
  r = await requestV2(env, { access_id: 'gh0004', email: 'gh0004@wayne.edu', cv: cvOf(PDF, `cv\u0000${'n'.repeat(300)}.pdf`) });
  assert.equal(r.status, 202);
  const meta = (await env.ACCESS.getWithMetadata('cv:gh0004', 'arrayBuffer')).metadata;
  assert.ok(meta.name.length <= 120 && !meta.name.includes('\u0000'), meta.name);
  // the older form's body (no v, camelCase) is still taken and answered as before; so is v 1
  assert.deepEqual((await request(env, { accessId: 'ij0001', email: 'ij0001@wayne.edu' }, { ip: freshIp() })).body, { status: 'pending' });
  assert.deepEqual((await request(env, { v: 1, accessId: 'ij0002', email: 'ij0002@wayne.edu' }, { ip: freshIp() })).body, { status: 'pending' });
  // the other routes keep the 8 KiB cap
  assert.equal((await call(env, 'POST', '/admin/add', { headers: ADMIN, body: JSON.stringify({ accessId: 'ab1234', note: 'x'.repeat(9000) }) }).then(asJson)).status, 413);
});

test('the maintainer\'s e-mail for a v2 request: the Google account, the purpose, the CV link, the mailbox, three decisions', async () => {
  const env = mailEnv();
  mails.length = 0;
  const r = await requestV2(env, { cv: cvOf(PDF, 'cv.pdf') });
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'not_verified' });
  assert.equal(mails.length, 1);
  const m = mails[0].body;
  assert.deepEqual(m.to, ['maintainer@example.edu']);
  for (const s of ['Name: A. Student', 'AccessID: ab1234', 'E-mail: ab1234@wayne.edu', 'Google account: a.student@gmail.com', 'What for: spine segmentation project', `CV: cv.pdf (PDF, ${Math.ceil(PDF.length / 1024)} KB)`, 'Mailbox: not verified', 'Asked from: Beethoven']) assert.ok(m.text.includes(s), s);
  assert.ok(m.text.includes('add a.student@gmail.com to the Google Group'), 'the step after approving');
  const links = linksIn(m.text);
  for (const k of ['approve', 'lab', 'deny']) assert.ok(links[k].startsWith('https://service.example/decide?t='), k);
  assert.ok(links.cv.startsWith('https://service.example/cv?t='));
  assert.ok(m.html.includes(`href="${links.cv}"`));
  const cc = claimOf(tokenOf(links.cv));
  assert.deepEqual(Object.keys(cc), ['v', 'access_id', 'decision', 'nonce', 'exp', 'ref']);
  assert.equal(cc.decision, 'cv');
  assert.equal(cc.ref, (await env.ACCESS.get('pending:ab1234', 'json')).ref);
  assert.notEqual(cc.nonce, claimOf(tokenOf(links.approve)).nonce, 'the CV link is its own');
  assert.ok((cc.exp - Date.now() / 1000) / 86400 > 13.99);
  assert.ok(!m.text.includes(PDF.toString('base64').slice(0, 40)), 'the file is not in the e-mail');
  // Lab membership only: approved with grants lab; Beethoven stays closed; the CV is kept 12 months from now
  env.ACCESS.ttl.set('cv:ab1234', 1);
  const p = await press(env, tokenOf(links.lab));
  assert.equal(p.status, 200);
  assert.ok(p.text.includes('<h1>Approved for lab membership.</h1>'));
  const rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.deepEqual(rec.grants, ['lab']);
  assert.equal(rec.google_account, 'a.student@gmail.com');
  assert.equal(rec.by, 'e-mail link');
  assert.deepEqual((await check(env, { access_id: 'ab1234' })).body, { approved: false, access_id: 'ab1234', requestPage: `${SITE}/beethoven/request.html` });
  assert.equal(env.ACCESS.ttl.get('cv:ab1234'), 365 * 86400);
  assert.ok((await env.ACCESS.getWithMetadata('cv:ab1234', 'arrayBuffer')).metadata.decided_at);
  // Approve for Beethoven, from another e-mail: both grants, and the page says to add the Google account
  const env2 = mailEnv();
  mails.length = 0;
  await requestV2(env2);
  const ok = await press(env2, tokenOf(linksIn(mails[0].body.text).approve));
  assert.ok(ok.text.includes('<h1>Approved.</h1>'));
  assert.ok(ok.text.includes('Next: add a.student@gmail.com to the Google Group Beethoven-users.'));
  assert.deepEqual((await env2.ACCESS.get('approved:ab1234', 'json')).grants, ['extension', 'lab']);
  assert.equal((await check(env2, { access_id: 'ab1234' })).body.approved, true);
  // Deny deletes the CV at once
  const env3 = mailEnv();
  mails.length = 0;
  await requestV2(env3, { cv: cvOf(PDF) });
  assert.ok(await env3.ACCESS.get('cv:ab1234'));
  const dn = await press(env3, tokenOf(linksIn(mails[0].body.text).deny));
  assert.ok(dn.text.includes('<h1>Denied.</h1>'));
  assert.equal(await env3.ACCESS.get('cv:ab1234'), null);
  assert.equal((await env3.ACCESS.get('denied:ab1234', 'json')).google_account, 'a.student@gmail.com');
});

test('the CV link: opening it shows a page, the button answers the file once, with fixed headers', async () => {
  const env = mailEnv();
  mails.length = 0;
  await requestV2(env, { cv: cvOf(PDF, '<cv>.pdf') });
  const t = tokenOf(linksIn(mails[0].body.text).cv);
  const before = snapshot(env);
  const openCv = (e, tok, method = 'GET') => call(e, method, `/cv?t=${tok}`, { origin: null }).then(asPage);
  const pressCv = (e, tok, form = 'confirm=1') => call(e, 'POST', `/cv?t=${tok}`, { origin: null, headers: FORM, body: form });
  let p = await openCv(env, t);
  assert.equal(p.status, 200);
  plainPage(p, 'cv page');
  assert.ok(p.text.includes('The CV A. Student (ab1234) sent'));
  assert.ok(p.text.includes('&lt;cv&gt;.pdf'));
  assert.ok(p.text.includes('<button type="submit">Open the CV</button>'));
  assert.equal((await pressCv(env, t, '')).status, 200, 'a POST without confirm=1 only shows the page');
  for (const method of ['PUT', 'DELETE']) assert.equal((await openCv(env, t, method)).status, 405, method);
  assert.equal(snapshot(env), before, 'nothing spent by opening');
  const res = await pressCv(env, t);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('content-disposition'), 'inline; filename="ab1234-cv.pdf"');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(PDF));
  // once: a second press, or opening it again, says so and names the way to see it again
  for (const again of [await pressCv(env, t).then(asPage), await openCv(env, t)]) {
    assert.equal(again.status, 410);
    plainPage(again, 'spent');
    assert.ok(again.text.includes('This link was already used'));
    assert.ok(again.text.includes('admin.mjs cv ab1234'));
  }
  // Word is a download, with its own fixed type whatever the form said
  const env2 = mailEnv();
  mails.length = 0;
  await requestV2(env2, { cv: cvOf(DOCX, 'cv.docx', 'text/html') });
  const w = await pressCv(env2, tokenOf(linksIn(mails[0].body.text).cv));
  assert.equal(w.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(w.headers.get('content-disposition'), 'attachment; filename="ab1234-cv.docx"');
  assert.match(w.headers.get('content-security-policy'), /sandbox/);
  // a decision link is not a CV link, and a CV link decides nothing
  const env3 = mailEnv();
  mails.length = 0;
  await requestV2(env3, { cv: cvOf(PDF) });
  const l3 = linksIn(mails[0].body.text);
  assert.equal((await openCv(env3, tokenOf(l3.approve))).status, 400);
  assert.equal((await open(env3, tokenOf(l3.cv))).status, 400);
  // the CV gone (a Deny deletes it) or the link expired: nothing is served
  await press(env3, tokenOf(l3.deny));
  const gone = await pressCv(env3, tokenOf(l3.cv)).then(asPage);
  assert.equal(gone.status, 404);
  assert.ok(gone.text.includes('no CV on record'));
  const old = mint({ ...claimOf(tokenOf(l3.cv)), nonce: 'o'.repeat(22), exp: Math.floor(Date.now() / 1000) - 1 });
  assert.equal((await openCv(env3, old)).status, 410);
  // no DECIDE_KEY: the link cannot be checked
  assert.equal((await openCv(mailEnv({ DECIDE_KEY: undefined }), t)).status, 503);
});

test('admin cv answers the stored file to the maintainer, as often as needed; the lists show its name, not the file', async () => {
  const env = makeEnv();
  await requestV2(env, { cv: cvOf(PDF) });
  const res = await call(env, 'POST', '/admin/cv', { headers: ADMIN, body: { accessId: 'ab1234' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="ab1234-cv.pdf"');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('access-control-allow-origin'), SITE);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(PDF));
  assert.equal((await call(env, 'POST', '/admin/cv', { headers: ADMIN, body: { accessId: 'ab1234' } })).status, 200, 'not one use');
  assert.equal((await adminPost(env, 'cv', { accessId: 'cd5678' })).status, 404);
  assert.equal((await call(env, 'POST', '/admin/cv', { body: { accessId: 'ab1234' } })).status, 401);
  const list = await adminList(env);
  assert.deepEqual(list.body.pending[0].cv, { name: 'cv.pdf', kind: 'pdf', size: PDF.length });
  assert.ok(!JSON.stringify(list.body).includes(PDF.toString('base64').slice(0, 40)));
});

test('a lab member can ask for Beethoven: the request is stored, the e-mail says so, Approve adds the grant, Deny keeps the membership', async () => {
  const env = mailEnv();
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student', grants: ['lab'] });
  mails.length = 0;
  let r = await requestV2(env);
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'not_verified' });
  assert.ok(await env.ACCESS.get('pending:ab1234'));
  assert.match(mails[0].body.text, /^Already: a lab member/m);
  let p = await open(env, tokenOf(linksIn(mails[0].body.text).approve));
  assert.ok(p.text.includes('a lab member'));
  p = await press(env, tokenOf(linksIn(mails[0].body.text).approve));
  assert.equal(p.status, 200);
  const rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.deepEqual(rec.grants, ['extension', 'lab']);
  assert.equal(rec.google_account, 'a.student@gmail.com');
  assert.equal(await env.ACCESS.get('pending:ab1234'), null);
  // approved for Beethoven: the form says so and stores nothing
  assert.deepEqual((await requestV2(env)).body, { status: 'approved' });
  assert.equal(await env.ACCESS.get('pending:ab1234'), null);
  // Deny on a lab member's request: not for Beethoven, still a lab member
  const env2 = mailEnv();
  await adminPost(env2, 'add', { accessId: 'ab1234', name: 'A. Student', grants: ['lab'] });
  mails.length = 0;
  await requestV2(env2, { cv: cvOf(PDF) });
  p = await press(env2, tokenOf(linksIn(mails[0].body.text).deny));
  assert.equal(p.status, 200);
  assert.ok(p.text.includes('stays a lab member'));
  assert.deepEqual((await env2.ACCESS.get('approved:ab1234', 'json')).grants, ['lab']);
  assert.ok(await env2.ACCESS.get('denied:ab1234'));
  assert.equal(await env2.ACCESS.get('cv:ab1234'), null);
  r = await requestV2(env2);
  assert.deepEqual(r.body, { status: 'denied' });
});

test('mailbox proof: with MAIL_STUDENTS "1" the student confirms from their Wayne State mail before the maintainer hears', async () => {
  const env = mailEnv({ MAIL_STUDENTS: '1' });
  mails.length = 0;
  let r = await requestV2(env, { cv: cvOf(PDF) });
  assert.equal(r.status, 202);
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'confirm' });
  assert.equal(mails.length, 1);
  let m = mails[0].body;
  assert.deepEqual(m.to, ['ab1234@wayne.edu']);
  assert.equal(m.subject, 'Confirm your Beethoven access request');
  assert.ok(Array.isArray(m.reply_to) && m.reply_to.length >= 1 && !m.reply_to.includes('ab1234@wayne.edu'), 'a reply from the student goes to the maintainer');
  for (const s of ['A. Student', 'a.student@gmail.com', 'spine segmentation project', 'If it was not you, ignore this e-mail']) assert.ok(m.text.includes(s), s);
  assert.ok(!m.text.includes('/decide') && !m.text.includes('/cv'), 'no decision and no CV link goes to the student');
  const { confirm } = linksIn(m.text);
  assert.ok(confirm.startsWith('https://service.example/confirm?t='));
  assert.ok(m.html.includes(`href="${confirm}"`));
  const cc = claimOf(tokenOf(confirm));
  assert.deepEqual(Object.keys(cc), ['v', 'access_id', 'decision', 'nonce', 'exp', 'ref']);
  assert.equal(cc.decision, 'confirm');
  const hours = (cc.exp - Date.now() / 1000) / 3600;
  assert.ok(hours > 23.99 && hours <= 24, `24 hours, not ${hours}`);
  let rec = await env.ACCESS.get('pending:ab1234', 'json');
  assert.equal(rec.mailbox, 'waiting');
  assert.equal(cc.ref, rec.ref);
  // opening changes nothing (a link scanner opens it first)
  const before = snapshot(env);
  const openC = (e, t, method = 'GET') => call(e, method, `/confirm?t=${t}`, { origin: null }).then(asPage);
  const pressC = (e, t) => call(e, 'POST', `/confirm?t=${t}`, { origin: null, headers: FORM, body: 'confirm=1' }).then(asPage);
  let p = await openC(env, tokenOf(confirm));
  assert.equal(p.status, 200);
  plainPage(p, 'confirm page');
  assert.ok(p.text.includes('<button type="submit">Confirm it is me</button>'));
  assert.ok(p.text.includes('a.student@gmail.com'));
  assert.equal(snapshot(env), before);
  assert.equal(mails.length, 1, 'the maintainer has heard nothing yet');
  // a decision link is not a confirmation link
  assert.equal((await openC(env, mint({ ...cc, decision: 'approve' }))).status, 400);
  // the button: the request is confirmed and goes to the maintainer, marked so
  p = await pressC(env, tokenOf(confirm));
  assert.equal(p.status, 200);
  assert.ok(p.text.includes('<h1>Confirmed.</h1>'));
  rec = await env.ACCESS.get('pending:ab1234', 'json');
  assert.equal(rec.mailbox, 'confirmed');
  assert.ok(rec.confirmed_at);
  assert.equal(mails.length, 2);
  m = mails[1].body;
  assert.deepEqual(m.to, ['maintainer@example.edu']);
  assert.match(m.text, /^Mailbox: confirmed /m);
  assert.ok(linksIn(m.text).approve && linksIn(m.text).cv);
  // once
  p = await pressC(env, tokenOf(confirm));
  assert.equal(p.status, 410);
  assert.equal(mails.length, 2);
  // the form sent again after the e-mail: that e-mail's link no longer matches, a new one goes out
  const env2 = mailEnv({ MAIL_STUDENTS: '1' });
  mails.length = 0;
  await requestV2(env2);
  const first = tokenOf(linksIn(mails[0].body.text).confirm);
  await requestV2(env2, { purpose: 'something else' });
  assert.equal(mails.length, 2, 'a second confirmation e-mail');
  const stale = await pressC(env2, first);
  assert.equal(stale.status, 409);
  assert.ok(stale.text.includes('changed'));
  assert.equal((await env2.ACCESS.get('pending:ab1234', 'json')).mailbox, 'waiting');
  // three confirmation e-mails an AccessID a day; the fourth request is refused and changes nothing
  await requestV2(env2);
  const atCap = await env2.ACCESS.get('pending:ab1234');
  r = await requestV2(env2, { purpose: 'fourth' });
  assert.equal(r.status, 429);
  assert.match(r.body.error, /ab1234@wayne\.edu/);
  assert.equal(await env2.ACCESS.get('pending:ab1234'), atCap);
  assert.equal(mails.length, 3);
  // a confirmation for a request decided in the meantime confirms nothing
  const env4 = mailEnv({ MAIL_STUDENTS: '1' });
  mails.length = 0;
  await requestV2(env4);
  await adminPost(env4, 'approve', { accessId: 'ab1234' });
  assert.equal((await pressC(env4, tokenOf(linksIn(mails[0].body.text).confirm))).status, 409);
  // the student e-mail refused (Resend, before the domain is verified): confirmation is required, so the
  // maintainer hears nothing; the student is told it did not go, and the request waits unconfirmed (F2)
  const env3 = mailEnv({ MAIL_STUDENTS: '1' });
  mails.length = 0;
  try {
    resend.refuseTo = 'ab1234@wayne.edu';
    r = await requestV2(env3);
  } finally {
    resend.refuseTo = null;
  }
  assert.equal(r.status, 502);
  assert.match(r.body.error, /^the confirmation e-mail to ab1234@wayne\.edu could not be sent just now/);
  assert.equal(mails.length, 1, 'the one refused attempt; nothing to the maintainer');
  assert.deepEqual(mails[0].body.to, ['ab1234@wayne.edu']);
  const waiting = await env3.ACCESS.get('pending:ab1234', 'json');
  assert.deepEqual([waiting.mailbox, waiting.confirm_mail], ['waiting', 'failed']);
  assert.equal(env3.ACCESS.ttl.get('pending:ab1234'), 7 * 86400);
  // MAIL_STUDENTS unset or anything but "1": no student e-mail; the maintainer hears at once
  for (const value of [undefined, '0', 'yes']) {
    const e = mailEnv(value === undefined ? {} : { MAIL_STUDENTS: value });
    mails.length = 0;
    r = await requestV2(e);
    assert.deepEqual(r.body, { status: 'pending', mailbox: 'not_verified' }, String(value));
    assert.equal(mails.length, 1, String(value));
    assert.deepEqual(mails[0].body.to, ['maintainer@example.edu'], String(value));
  }
});

// ---- 2026-09-30 afternoon: links tied to one version, the Move guard, the reviewers' exemption on a
// localhost portal only, removal clears the checks, mailbox confirmation required, the lifecycle, and the
// invitation to the private listing's Google Group (ACCESS_CHECK.md and README.md say the same) ----

const GROUP_URL = 'https://groups.google.com/g/beethoven-users/members';
const doneLinks = (text) => [...text.matchAll(/^Done, invited: (\S+)$/gm)].map((m) => m[1]);
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const openConfirm = (e, t) => call(e, 'GET', `/confirm?t=${t}`, { origin: null }).then(asPage);
const pressConfirm = (e, t) => call(e, 'POST', `/confirm?t=${t}`, { origin: null, headers: FORM, body: 'confirm=1' }).then(asPage);
const pressCvLink = (e, t) => call(e, 'POST', `/cv?t=${t}`, { origin: null, headers: FORM, body: 'confirm=1' });
// the form action of a page's button, by its label (null when the page has no such button)
function formAction(html, button) {
  const m = new RegExp(`<form method="post" action="([^"]+)"><input type="hidden" name="confirm" value="1"><button type="submit">${button}</button></form>`).exec(html);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}
const tokenOfAction = (action) => new URLSearchParams(action.split('?')[1]).get('t');
// the Worker's cron, as Cloudflare calls it: scheduled(event, env, ctx), the work handed to ctx.waitUntil
async function runCron(env) {
  const waits = [];
  await worker.scheduled({ cron: '0 13 * * *', scheduledTime: Date.now() }, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
}
async function backdate(env, id, fields) {
  const rec = await env.ACCESS.get(`approved:${id}`, 'json');
  await env.ACCESS.put(`approved:${id}`, JSON.stringify({ ...rec, ...fields }));
}

test('F1 a: Move refuses with a plain page while the refused installation is another account\'s seat, and works once that is cleared', async () => {
  const env = mailEnv();
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  await adminPost(env, 'add', { accessId: 'cd5678', name: 'C. D.' });
  mails.length = 0;
  assert.equal((await check(env, { access_id: 'ab1234' })).body.approved, true);
  assert.equal((await check(env, { access_id: 'cd5678', install_id: IB })).body.approved, true);
  // ab1234 asks from IB, the installation cd5678 is bound to: refused, and e-mailed with a Move link to IB
  assert.equal((await check(env, { access_id: 'ab1234', install_id: IB })).body.reason, 'other_installation');
  const move = tokenOf(linksIn(mails[0].body.text).move);
  assert.equal(claimOf(move).install_id, IB);
  const before = snapshot(env);
  for (const [why, p] of [['opened', await open(env, move)], ['pressed', await press(env, move)]]) {
    assert.equal(p.status, 409, why);
    plainPage(p, why);
    for (const s of ['<h1>This installation is in use by another account</h1>', short(IB), 'cd5678', 'withdraw the approval of cd5678 first', 'node tools/intake/admin.mjs remove cd5678', 'Nothing was changed', ADMIN_PAGE]) assert.ok(p.text.includes(s), `${why}: ${s}`);
    assert.ok(!p.text.includes('<button'), `${why}: no button to press`);
  }
  assert.equal(snapshot(env), before, 'nothing written and the link not spent');
  // cd5678's approval withdrawn: the same link now moves ab1234 there
  await adminPost(env, 'remove', { accessId: 'cd5678' });
  const done = await press(env, move);
  assert.equal(done.status, 200);
  assert.ok(done.text.includes('<h1>Moved.</h1>'));
  assert.equal((await env.ACCESS.get('seat:ab1234', 'json')).install_id, IB);
  assert.equal((await env.ACCESS.get(`install:${IB}`, 'json')).access_id, 'ab1234');
  // an index left behind by a seat that moved on blocks nothing
  const env2 = mailEnv();
  await adminPost(env2, 'add', { accessId: 'ab1234', name: 'A. Student' });
  mails.length = 0;
  await check(env2, { access_id: 'ab1234' });
  await check(env2, { access_id: 'ab1234', install_id: IC });
  await env2.ACCESS.put(`install:${IC}`, JSON.stringify({ access_id: 'zz0001', bound_at: '2026-09-01T00:00:00.000Z' }));
  const moved = await press(env2, tokenOf(linksIn(mails[0].body.text).move));
  assert.equal(moved.status, 200);
  assert.equal((await env2.ACCESS.get('seat:ab1234', 'json')).install_id, IC);
});

test('F1 b: seat-rule any holds on a localhost portal only; on a real portal the account is held to one installation', async () => {
  const env = makeEnv();
  await adminPost(env, 'add', { accessId: 'st1234', name: 'Store reviewer (mock portal)' });
  await adminPost(env, 'seat-rule', { accessId: 'st1234', any: true });
  for (const portal of ['localhost', 'localhost:8080', 'reviewers.localhost', 'mock.portal.localhost:3000']) {
    for (const install_id of [IA, IB, undefined]) assert.equal((await check(env, { portal, install_id })).body.approved, true, `${portal} ${install_id}`);
  }
  assert.equal(await env.ACCESS.get('seat:st1234'), null, 'nothing bound from a local portal');
  // a real portal: the first installation binds, any other is refused, a build without an identifier must update
  assert.equal((await check(env, { install_id: IA })).body.approved, true);
  assert.equal((await env.ACCESS.get('seat:st1234', 'json')).install_id, IA);
  for (const portal of ['ondemand.grid.wayne.edu', 'localhost.example.com', 'notlocalhost', 'localhost.evil.edu:443']) {
    assert.equal((await check(env, { portal, install_id: IB })).body.reason, 'other_installation', portal);
  }
  assert.equal((await check(env, { install_id: undefined })).body.reason, 'update_required');
  // the mock portal is still let through from any installation
  assert.equal((await check(env, { portal: 'localhost:8080', install_id: IC })).body.approved, true);
  assert.equal((await env.ACCESS.get('seat:st1234', 'json')).install_id, IA);
});

test('F1 c: decision and CV links belong to one version of the request; a changed form replaces them, the same form keeps them', async () => {
  const env = mailEnv();
  mails.length = 0;
  await requestV2(env, { cv: cvOf(PDF) });
  const first = linksIn(mails[0].body.text);
  const ref1 = (await env.ACCESS.get('pending:ab1234', 'json')).ref;
  for (const k of ['approve', 'lab', 'deny', 'cv']) assert.equal(claimOf(tokenOf(first[k])).ref, ref1, k);
  // the same form again (a second press, the CV attached again or not): the same version, no second e-mail
  await requestV2(env, { cv: cvOf(PDF) });
  await requestV2(env);
  assert.equal(mails.length, 1);
  assert.equal((await env.ACCESS.get('pending:ab1234', 'json')).ref, ref1);
  assert.equal((await open(env, tokenOf(first.approve))).status, 200, 'the links still work');
  // sent again with a change: a new version, e-mailed at once; the older links answer "replaced"
  await requestV2(env, { purpose: 'a different project' });
  assert.equal(mails.length, 2);
  const second = linksIn(mails[1].body.text);
  const ref2 = (await env.ACCESS.get('pending:ab1234', 'json')).ref;
  assert.notEqual(ref2, ref1);
  assert.equal(claimOf(tokenOf(second.approve)).ref, ref2);
  const before = snapshot(env);
  for (const k of ['approve', 'lab', 'deny']) {
    for (const p of [await open(env, tokenOf(first[k])), await press(env, tokenOf(first[k]))]) {
      assert.equal(p.status, 409, k);
      plainPage(p, k);
      for (const s of ['<h1>This request was replaced</h1>', 'see the newer e-mail', 'Nothing was changed', ADMIN_PAGE]) assert.ok(p.text.includes(s), `${k}: ${s}`);
    }
  }
  const oldCv = await pressCvLink(env, tokenOf(first.cv)).then(asPage);
  assert.equal(oldCv.status, 409);
  plainPage(oldCv, 'old cv link');
  assert.ok(oldCv.text.includes('This request was replaced'));
  assert.equal(snapshot(env), before, 'nothing written, no link spent');
  // a new CV is a new version too
  await requestV2(env, { purpose: 'a different project', cv: cvOf(DOCX, 'cv.docx') });
  assert.equal(mails.length, 3);
  const third = linksIn(mails[2].body.text);
  assert.equal((await pressCvLink(env, tokenOf(second.cv)).then(asPage)).status, 409);
  const cvNow = await pressCvLink(env, tokenOf(third.cv));
  assert.equal(cvNow.status, 200);
  assert.ok(Buffer.from(await cvNow.arrayBuffer()).equals(DOCX));
  // the newest e-mail decides; afterwards the older ones still say replaced, and the used one says used
  const ok = await press(env, tokenOf(third.approve));
  assert.equal(ok.status, 200);
  assert.ok(ok.text.includes('<h1>Approved.</h1>'));
  assert.equal((await env.ACCESS.get('approved:ab1234', 'json')).ref, (await claimOf(tokenOf(third.approve))).ref);
  assert.equal((await press(env, tokenOf(first.deny))).status, 409);
  assert.ok((await press(env, tokenOf(second.lab))).text.includes('This request was replaced'));
  assert.equal((await press(env, tokenOf(third.deny))).status, 410);
  // decided through the admin page: that e-mail's links say decided already
  const env2 = mailEnv();
  mails.length = 0;
  await requestV2(env2);
  await adminPost(env2, 'deny', { accessId: 'ab1234', reason: 'not now' });
  const decided = await open(env2, tokenOf(linksIn(mails[0].body.text).approve));
  assert.equal(decided.status, 409);
  assert.ok(decided.text.includes('This request was decided already'));
  assert.equal(await env2.ACCESS.get('approved:ab1234'), null);
  // a CV or decision link without a ref (an e-mail sent before this change) is out of date
  const env3 = mailEnv();
  mails.length = 0;
  await requestV2(env3, { cv: cvOf(PDF) });
  const legacyCv = mint({ v: 1, access_id: 'ab1234', decision: 'cv', nonce: 'c'.repeat(22), exp: Math.floor(Date.now() / 1000) + 600 });
  const lc = await pressCvLink(env3, legacyCv).then(asPage);
  assert.equal(lc.status, 410);
  assert.ok(lc.text.includes('This link is out of date'));
  assert.ok(lc.text.includes('admin.mjs cv ab1234'));
});

test('F1 c: Move and Withdraw belong to the refusal e-mail they came in; a newer one replaces them; no ref is out of date', async () => {
  const env = mailEnv();
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  mails.length = 0;
  await check(env, { access_id: 'ab1234' });
  await check(env, { access_id: 'ab1234', install_id: IB });
  const first = linksIn(mails[0].body.text);
  const ref1 = (await env.ACCESS.get('conflict:ab1234', 'json')).ref;
  assert.match(ref1, /^[A-Za-z0-9_-]{22}$/);
  // more refusals the same day keep the ref (no new e-mail)
  await check(env, { access_id: 'ab1234', install_id: IB });
  assert.equal((await env.ACCESS.get('conflict:ab1234', 'json')).ref, ref1);
  // the next day another refusal is e-mailed: a new ref, and the first e-mail's links are replaced
  env.ACCESS.m.delete('conflict_notified:ab1234');
  await check(env, { access_id: 'ab1234', install_id: IC });
  assert.equal(mails.length, 2);
  const second = linksIn(mails[1].body.text);
  const ref2 = (await env.ACCESS.get('conflict:ab1234', 'json')).ref;
  assert.notEqual(ref2, ref1);
  assert.equal(claimOf(tokenOf(second.move)).ref, ref2);
  const before = snapshot(env);
  for (const k of ['move', 'withdraw']) {
    for (const p of [await open(env, tokenOf(first[k])), await press(env, tokenOf(first[k]))]) {
      assert.equal(p.status, 409, k);
      plainPage(p, k);
      for (const s of ['<h1>This e-mail was replaced</h1>', 'see the newer e-mail', 'Nothing was changed']) assert.ok(p.text.includes(s), `${k}: ${s}`);
    }
  }
  assert.equal(snapshot(env), before);
  const moved = await press(env, tokenOf(second.move));
  assert.equal(moved.status, 200);
  assert.equal((await env.ACCESS.get('seat:ab1234', 'json')).install_id, IC);
  // settled since (moved): a later e-mail's leftover link says so and changes nothing
  env.ACCESS.m.delete('conflict_notified:ab1234');
  await check(env, { access_id: 'ab1234', install_id: IA });
  const third = linksIn(mails[2].body.text);
  await adminPost(env, 'reset-seat', { accessId: 'ab1234' });
  const settled = await press(env, tokenOf(third.withdraw));
  assert.equal(settled.status, 409);
  assert.ok(settled.text.includes('no longer on record'));
  assert.ok(await env.ACCESS.get('approved:ab1234'), 'still approved');
  // links without a ref: out of date, nothing changed
  for (const decision of ['move', 'withdraw']) {
    const t = mint({ v: 1, access_id: 'ab1234', decision, nonce: 'l'.repeat(22), exp: Math.floor(Date.now() / 1000) + 600, ...(decision === 'move' ? { install_id: IB } : {}) });
    const p = await press(env, t);
    assert.equal(p.status, 410, decision);
    assert.ok(p.text.includes('This link is out of date'), decision);
  }
  assert.ok(await env.ACCESS.get('approved:ab1234'));
});

test('F1 d: remove and Withdraw delete the person\'s access-check records for every product, and only theirs', async () => {
  const env = mailEnv();
  for (const id of ['ab1234', 'cd5678']) await adminPost(env, 'add', { accessId: id, name: id });
  await check(env, { access_id: 'ab1234' });
  await check(env, { access_id: 'ab1234', product: 'beethoven' });
  await check(env, { access_id: 'cd5678', install_id: IB });
  await check(env, { access_id: 'xab1234', install_id: IC });
  const seenKeys = () => [...env.ACCESS.m.keys()].filter((k) => k.startsWith('seen:')).sort();
  assert.deepEqual(seenKeys(), ['seen:beethoven:ab1234', 'seen:bridge:ab1234', 'seen:bridge:cd5678', 'seen:bridge:xab1234']);
  await adminPost(env, 'remove', { accessId: 'ab1234' });
  assert.deepEqual(seenKeys(), ['seen:bridge:cd5678', 'seen:bridge:xab1234']);
  assert.ok(!(await adminList(env)).body.checks.some((c) => c.access_id === 'ab1234'));
  // Withdraw approval from the e-mail about a second installation does the same
  mails.length = 0;
  await check(env, { access_id: 'cd5678', install_id: IC });
  const p = await press(env, tokenOf(linksIn(mails[0].body.text).withdraw));
  assert.equal(p.status, 200);
  assert.deepEqual(seenKeys(), ['seen:bridge:xab1234']);
});

test('F2: with MAIL_STUDENTS "1" nothing reaches the maintainer unconfirmed; an unconfirmed request lasts 7 days and shows its age', async () => {
  const env = mailEnv({ MAIL_STUDENTS: '1' });
  mails.length = 0;
  let r = await requestV2(env, { cv: cvOf(PDF) });
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'confirm' });
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].body.to, ['ab1234@wayne.edu']);
  let rec = await env.ACCESS.get('pending:ab1234', 'json');
  assert.equal(rec.mailbox, 'waiting');
  assert.equal(env.ACCESS.ttl.get('pending:ab1234'), 7 * 86400, 'KV drops it after 7 days');
  assert.equal(env.ACCESS.ttl.get('cv:ab1234'), 7 * 86400, 'and its CV with it');
  const left = (Date.parse(rec.expires_at) - Date.now()) / 86400e3;
  assert.ok(left > 6.99 && left <= 7, `expires_at is 7 days out, not ${left}`);
  // the admin list: unconfirmed, with its age and when it goes
  await env.ACCESS.put('pending:ab1234', JSON.stringify({ ...rec, submitted_at: hoursAgo(5.5) }), { expirationTtl: 7 * 86400 });
  let p = (await adminList(env)).body.pending[0];
  assert.deepEqual([p.accessId, p.stage, p.mailbox, p.age_hours, p.expires_at], ['ab1234', 'unconfirmed', 'waiting', 5, rec.expires_at]);
  // after 7 days KV has dropped it: the student sends the form again, as a new request
  const confirmLink = tokenOf(linksIn(mails[0].body.text).confirm);
  env.ACCESS.m.delete('pending:ab1234');
  assert.equal((await pressConfirm(env, confirmLink)).status, 409, 'nothing to confirm any more');
  r = await requestV2(env, { cv: cvOf(PDF) });
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'confirm' });
  assert.equal(mails.length, 2);
  // confirmed: kept without an end, the CV for 12 months, the maintainer e-mailed now
  const c = await pressConfirm(env, tokenOf(linksIn(mails[1].body.text).confirm));
  assert.equal(c.status, 200);
  rec = await env.ACCESS.get('pending:ab1234', 'json');
  assert.equal(rec.mailbox, 'confirmed');
  assert.ok(rec.confirmed_at);
  assert.equal('expires_at' in rec, false);
  assert.equal(env.ACCESS.ttl.get('pending:ab1234'), undefined);
  assert.equal(env.ACCESS.ttl.get('cv:ab1234'), 365 * 86400);
  assert.equal(mails.length, 3);
  assert.deepEqual(mails[2].body.to, ['maintainer@example.edu']);
  assert.match(mails[2].body.text, /^Mailbox: confirmed /m);
  p = (await adminList(env)).body.pending[0];
  assert.deepEqual([p.stage, p.mailbox], ['submitted', 'confirmed']);
  assert.equal('expires_at' in p, false);
  // the same form sent again after confirming stays confirmed: no new confirmation, no second e-mail today
  r = await requestV2(env, { cv: cvOf(PDF) });
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'confirmed' });
  assert.equal(mails.length, 3);
  assert.equal((await env.ACCESS.get('pending:ab1234', 'json')).mailbox, 'confirmed');
  // a changed form needs confirming again
  r = await requestV2(env, { purpose: 'changed' });
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'confirm' });
  assert.equal((await env.ACCESS.get('pending:ab1234', 'json')).mailbox, 'waiting');
  assert.equal(mails.length, 4);
  assert.deepEqual(mails[3].body.to, ['ab1234@wayne.edu']);
  // MAIL_STUDENTS "0" (as deployed): no end, "not verified" in the maintainer's e-mail, as before
  const off = mailEnv({ MAIL_STUDENTS: '0' });
  mails.length = 0;
  r = await requestV2(off);
  assert.deepEqual(r.body, { status: 'pending', mailbox: 'not_verified' });
  assert.equal(off.ACCESS.ttl.get('pending:ab1234'), undefined);
  assert.match(mails[0].body.text, /^Mailbox: not verified/m);
  assert.equal((await adminList(off)).body.pending[0].stage, 'submitted');
});

test('F2: the lifecycle (submitted, confirmed, decided, invited, installed) is on the records and one stage in the admin list', async () => {
  const env = mailEnv({ MAIL_STUDENTS: '1' });
  mails.length = 0;
  await requestV2(env);
  const submitted = (await env.ACCESS.get('pending:ab1234', 'json')).submitted_at;
  await pressConfirm(env, tokenOf(linksIn(mails[0].body.text).confirm));
  const confirmedAt = (await env.ACCESS.get('pending:ab1234', 'json')).confirmed_at;
  const toMaintainer = mails.filter((m) => m.body.to[0] === 'maintainer@example.edu');
  assert.equal(toMaintainer.length, 1);
  const page = await press(env, tokenOf(linksIn(toMaintainer[0].body.text).approve));
  assert.equal(page.status, 200);
  let rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.deepEqual([rec.submitted_at, rec.confirmed_at, rec.mailbox, rec.decision], [submitted, confirmedAt, 'confirmed', 'approve']);
  assert.ok(rec.decided_at >= confirmedAt);
  let a = (await adminList(env)).body.approved[0];
  assert.deepEqual([a.stage, a.seat, a.conflicts], ['approved', { bound: false }, 0]);
  // invited from the approve page's button
  const done = await press(env, tokenOfAction(formAction(page.text, 'Done, invited')));
  assert.equal(done.status, 200);
  rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.equal(rec.invited_by, 'e-mail link');
  a = (await adminList(env)).body.approved[0];
  assert.equal(a.stage, 'invited');
  assert.equal(a.invited_at, rec.invited_at);
  // installed: set when the first installation binds; the approved record itself is not written by a check
  const beforeCheck = await env.ACCESS.get('approved:ab1234');
  assert.equal((await check(env, { access_id: 'ab1234' })).body.approved, true);
  assert.equal(await env.ACCESS.get('approved:ab1234'), beforeCheck, 'an access check never rewrites the approval');
  const installed = await env.ACCESS.get('installed:ab1234', 'json');
  assert.deepEqual(Object.keys(installed), ['at', 'product', 'version']);
  a = (await adminList(env)).body.approved[0];
  assert.equal(a.stage, 'installed');
  assert.equal(a.installed_at, installed.at);
  assert.deepEqual(Object.keys(a.seat), ['bound', 'first_seen', 'last_seen', 'product', 'version']);
  assert.equal(a.seat.bound, true);
  // a refusal is counted; a reset keeps "installed" and the date
  await check(env, { access_id: 'ab1234', install_id: IB });
  a = (await adminList(env)).body.approved[0];
  assert.equal(a.conflicts, 1);
  assert.ok(a.conflict_last_at);
  await adminPost(env, 'reset-seat', { accessId: 'ab1234' });
  a = (await adminList(env)).body.approved[0];
  assert.deepEqual([a.stage, a.installed_at, a.seat, a.conflicts], ['installed', installed.at, { bound: false }, 0]);
  await check(env, { access_id: 'ab1234', install_id: IC });
  assert.equal((await env.ACCESS.get('installed:ab1234', 'json')).at, installed.at, 'set once');
  // a seat bound before installed was recorded counts as installed from its first check
  const env2 = makeEnv();
  await adminPost(env2, 'add', { accessId: 'cd5678', name: 'C. D.' });
  await env2.ACCESS.put('seat:cd5678', JSON.stringify({ install_id: IA, first_seen: '2026-09-30T08:00:00.000Z', last_seen: '2026-09-30T09:00:00.000Z', product: 'bridge', version: '8.0.0' }));
  a = (await adminList(env2)).body.approved[0];
  assert.deepEqual([a.stage, a.installed_at], ['installed', '2026-09-30T08:00:00.000Z']);
  // lab only and denied carry their decisions; remove deletes installed with the rest
  const env3 = mailEnv();
  mails.length = 0;
  await requestV2(env3);
  await press(env3, tokenOf(linksIn(mails[0].body.text).lab));
  const lab = await env3.ACCESS.get('approved:ab1234', 'json');
  assert.equal(lab.decision, 'lab');
  assert.equal((await adminList(env3)).body.approved[0].stage, 'lab');
  await requestV2(env3, { access_id: 'cd5678', email: 'cd5678@wayne.edu' });
  await press(env3, tokenOf(linksIn(mails[1].body.text).deny));
  const denied = await env3.ACCESS.get('denied:cd5678', 'json');
  assert.deepEqual([denied.decision, denied.decided_at, typeof denied.ref], ['deny', denied.denied_at, 'string']);
  await adminPost(env, 'remove', { accessId: 'ab1234' });
  assert.equal(await env.ACCESS.get('installed:ab1234'), null);
});

test('F3: Approve shows the next step: the Google account in a copy box, the group\'s members page, and a Done, invited button that works once', async () => {
  const env = mailEnv();
  mails.length = 0;
  await requestV2(env);
  const page = await press(env, tokenOf(linksIn(mails[0].body.text).approve));
  assert.equal(page.status, 200);
  for (const s of ['<h1>Approved.</h1>', 'Next: add a.student@gmail.com to the Google Group Beethoven-users.', `href="${GROUP_URL}"`, 'value="a.student@gmail.com"', 'readonly', '>Copy</button>', 'They are not told automatically']) assert.ok(page.text.includes(s), s);
  // one inline script (the copy button), allowed by its hash in the policy and by nothing else
  const scripts = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.equal((page.text.match(/<script/g) || []).length, 1);
  const csp = page.headers.get('content-security-policy');
  assert.ok(csp.includes(`script-src 'sha256-${crypto.createHash('sha256').update(scripts[0]).digest('base64')}'`), csp);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /form-action 'self'/);
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(page.headers.get('cache-control'), 'no-store');
  // the Done, invited button: a signed one-use link for this approval, POSTed
  const it = tokenOfAction(formAction(page.text, 'Done, invited'));
  const ic = claimOf(it);
  const rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.deepEqual([ic.decision, ic.access_id, ic.ref], ['invited', 'ab1234', rec.ref]);
  assert.equal(it.split('.')[1], sign(it.split('.')[0]));
  const before = snapshot(env);
  const q = await open(env, it);
  assert.equal(q.status, 200);
  plainPage(q, 'invited question');
  assert.ok(q.text.includes('Mark A. Student (ab1234) as invited to Beethoven-users?'));
  assert.ok(q.text.includes('<button type="submit">Done, invited</button>'));
  assert.equal(snapshot(env), before, 'opening writes nothing');
  let d = await press(env, it);
  assert.equal(d.status, 200);
  plainPage(d, 'invited');
  assert.ok(d.text.includes('<h1>Marked invited.</h1>'));
  const after = await env.ACCESS.get('approved:ab1234', 'json');
  assert.equal(after.invited_by, 'e-mail link');
  assert.ok(Math.abs(Date.parse(after.invited_at) - Date.now()) < 5000);
  assert.ok(auditsOf(env).some((x) => x.action === 'invited' && x.accessId === 'ab1234' && x.by === 'e-mail link'));
  d = await press(env, it);
  assert.equal(d.status, 410);
  assert.ok(d.text.includes('This link was already used'));
  // the older form (no Google account): the step asks for one; no copy box, no script
  const env2 = mailEnv();
  mails.length = 0;
  await request(env2);
  const p2 = await press(env2, tokenOf(linksIn(mails[0].body.text).approve));
  plainPage(p2, 'approve without a Google account');
  assert.ok(p2.text.includes('Next: ask A. Student which Google account they use in Chrome, and add it to the Google Group Beethoven-users.'));
  assert.ok(formAction(p2.text, 'Done, invited'));
  // Lab membership only: no invitation step
  const env3 = mailEnv();
  mails.length = 0;
  await requestV2(env3);
  const p3 = await press(env3, tokenOf(linksIn(mails[0].body.text).lab));
  assert.ok(!p3.text.includes('Beethoven-users') && !p3.text.includes('Done, invited'));
  // an invited link for someone removed since, or lab only since, changes nothing
  const env4 = mailEnv();
  mails.length = 0;
  await requestV2(env4);
  const p4 = await press(env4, tokenOf(linksIn(mails[0].body.text).approve));
  const t4 = tokenOfAction(formAction(p4.text, 'Done, invited'));
  await adminPost(env4, 'grant', { accessId: 'ab1234', grants: ['lab'] });
  assert.equal((await press(env4, t4)).status, 409);
  await adminPost(env4, 'remove', { accessId: 'ab1234' });
  assert.equal((await press(env4, t4)).status, 409);
  assert.equal(await env4.ACCESS.get('approved:ab1234'), null);
});

test('F3: admin invited marks and clears the invitation; admin approve answers the next step', async () => {
  const env = makeEnv();
  await requestV2(env);
  const ap = await adminPost(env, 'approve', { accessId: 'ab1234' });
  assert.equal(ap.status, 200);
  assert.deepEqual(ap.body.invite, { group: 'Beethoven-users', members_url: GROUP_URL, google_account: 'a.student@gmail.com', invited: false, mode: 'manual' });
  let r = await adminPost(env, 'invited', { accessId: 'ab1234' });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ['status', 'accessId', 'invited_at']);
  assert.equal(r.body.status, 'invited');
  const at = r.body.invited_at;
  assert.equal((await env.ACCESS.get('approved:ab1234', 'json')).invited_by, 'admin');
  r = await adminPost(env, 'invited', { accessId: 'ab1234' });
  assert.deepEqual(r.body, { status: 'invited', accessId: 'ab1234', invited_at: at, already: true });
  r = await adminPost(env, 'invited', { accessId: 'ab1234', clear: true });
  assert.deepEqual(r.body, { status: 'not-invited', accessId: 'ab1234' });
  const rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.equal('invited_at' in rec || 'invited_by' in rec, false);
  assert.equal((await adminList(env)).body.approved[0].stage, 'approved');
  assert.equal((await adminPost(env, 'invited', { accessId: 'zz0000' })).status, 404);
  assert.equal((await adminPost(env, 'invited', { accessId: 'nope' })).status, 400);
  await adminPost(env, 'add', { accessId: 'cd5678', name: 'C. D.', grants: ['lab'] });
  assert.equal((await adminPost(env, 'invited', { accessId: 'cd5678' })).status, 409);
  assert.equal((await call(env, 'POST', '/admin/invited', { body: { accessId: 'ab1234' } }).then(asJson)).status, 401);
  // Lab membership only: no invitation to answer
  await requestV2(env, { access_id: 'ef0001', email: 'ef0001@wayne.edu' });
  assert.equal((await adminPost(env, 'approve', { accessId: 'ef0001', grants: ['lab'] })).body.invite, null);
  assert.deepEqual(auditsOf(env).filter((x) => x.action.startsWith('invited')).map((x) => [x.action, x.by]), [['invited', 'admin'], ['invited-clear', 'admin']]);
});

test('F3: the daily reminder lists approved accounts not invited after an hour, once a day, each with a Done, invited link', async () => {
  const ORIGIN = 'https://beethoven-access.example.workers.dev';
  const env = mailEnv({ SERVICE_ORIGIN: ORIGIN });
  mails.length = 0;
  await runCron(env);
  assert.equal(mails.length, 0, 'nobody waiting: no e-mail');
  // two due (an hour and more), and one each of: too recent, installed, invited, lab only, the reviewers' mock
  await requestV2(env);
  await adminPost(env, 'approve', { accessId: 'ab1234' });
  await backdate(env, 'ab1234', { decided_at: hoursAgo(2) });
  await adminPost(env, 'add', { accessId: 'cd5678', name: 'C. D.' });
  await backdate(env, 'cd5678', { approved_at: hoursAgo(30) });
  await requestV2(env, { access_id: 'ef0001', email: 'ef0001@wayne.edu', google_account: 'e.f@gmail.com' });
  await adminPost(env, 'approve', { accessId: 'ef0001' });
  await backdate(env, 'ef0001', { decided_at: hoursAgo(0.5) });
  await adminPost(env, 'add', { accessId: 'gh0001', name: 'G. H.' });
  await backdate(env, 'gh0001', { approved_at: hoursAgo(3) });
  await check(env, { access_id: 'gh0001', install_id: IB });
  await adminPost(env, 'add', { accessId: 'ij0001', name: 'I. J.' });
  await backdate(env, 'ij0001', { approved_at: hoursAgo(3) });
  await adminPost(env, 'invited', { accessId: 'ij0001' });
  await adminPost(env, 'add', { accessId: 'kl0001', name: 'K. L.', grants: ['lab'] });
  await backdate(env, 'kl0001', { approved_at: hoursAgo(3) });
  await adminPost(env, 'add', { accessId: 'st1234', name: 'Store reviewer (mock portal)' });
  await adminPost(env, 'seat-rule', { accessId: 'st1234', any: true });
  await backdate(env, 'st1234', { approved_at: hoursAgo(3) });
  mails.length = 0;
  await runCron(env);
  assert.equal(mails.length, 1);
  const m = mails[0].body;
  assert.deepEqual(m.to, ['maintainer@example.edu']);
  assert.equal(m.subject, 'Beethoven: 2 approved accounts not invited to Beethoven-users yet');
  assert.match(m.text, /^A\. Student \(ab1234\): a\.student@gmail\.com, approved /m);
  assert.match(m.text, /^C\. D\. \(cd5678\): no Google account on record \(ask them which one they use in Chrome\), approved /m);
  for (const id of ['ef0001', 'gh0001', 'ij0001', 'kl0001', 'st1234']) assert.ok(!m.text.includes(id), id);
  assert.ok(m.text.includes(GROUP_URL));
  assert.ok(m.text.includes(ADMIN_PAGE));
  const links = doneLinks(m.text);
  assert.equal(links.length, 2);
  for (const l of links) {
    assert.ok(l.startsWith(`${ORIGIN}/decide?t=`), l);
    assert.ok(m.html.includes(`href="${l}"`));
    assert.equal(claimOf(tokenOf(l)).decision, 'invited');
  }
  assert.deepEqual(links.map((l) => claimOf(tokenOf(l)).access_id), ['ab1234', 'cd5678']);
  assert.notEqual(claimOf(tokenOf(links[0])).nonce, claimOf(tokenOf(links[1])).nonce, 'each link on its own');
  const flag = `invite_reminder:${new Date().toISOString().slice(0, 10)}`;
  assert.ok(env.ACCESS.m.has(flag));
  assert.equal(env.ACCESS.ttl.get(flag), 2 * 86400);
  // once a day
  await runCron(env);
  assert.equal(mails.length, 1);
  // a link from it stamps invited; the next day lists only the other
  const d = await press(env, tokenOf(links[0]));
  assert.equal(d.status, 200);
  assert.ok((await env.ACCESS.get('approved:ab1234', 'json')).invited_at);
  env.ACCESS.m.delete(flag);
  await runCron(env);
  assert.equal(mails.length, 2);
  assert.equal(mails[1].body.subject, 'Beethoven: 1 approved account not invited to Beethoven-users yet');
  assert.ok(!mails[1].body.text.includes('ab1234') && mails[1].body.text.includes('cd5678'));
  // a failed send starts no day
  env.ACCESS.m.delete(flag);
  try {
    resend.status = 403;
    await runCron(env);
  } finally {
    resend.status = 200;
  }
  assert.equal(env.ACCESS.m.has(flag), false);
  // only the name REMINDER_FROM names sends it (both Worker names run the cron); no provider: nothing fetched
  const seed = async (e) => {
    await adminPost(e, 'add', { accessId: 'cd5678', name: 'C. D.' });
    await backdate(e, 'cd5678', { approved_at: hoursAgo(3) });
  };
  const old = mailEnv({ SERVICE_NAME: 'ashley-service', REMINDER_FROM: 'beethoven-access' });
  await seed(old);
  mails.length = 0;
  await runCron(old);
  assert.equal(mails.length, 0);
  const primary = mailEnv({ SERVICE_NAME: 'beethoven-access', REMINDER_FROM: 'beethoven-access' });
  await seed(primary);
  await runCron(primary);
  assert.equal(mails.length, 1);
  const quiet = mailEnv({ RESEND_API_KEY: undefined });
  await seed(quiet);
  fetched.length = 0;
  await runCron(quiet);
  assert.deepEqual(fetched, []);
  // what is deployed: the cron, the sending name and the links' origin, GROUP_MODE off; deploy.sh names each Worker
  const toml = fs.readFileSync(path.join(HERE, 'wrangler.toml'), 'utf8');
  assert.match(toml, /^\[triggers\]\ncrons = \["0 13 \* \* \*"\]$/m);
  assert.match(toml, /^REMINDER_FROM = "beethoven-access"$/m);
  assert.match(toml, /^SERVICE_ORIGIN = "https:\/\/beethoven-access\.openspineconsortium\.workers\.dev"$/m);
  assert.match(toml, /^GROUP_MODE = "manual"$/m);
  assert.match(fs.readFileSync(path.join(HERE, 'deploy.sh'), 'utf8'), /--var "SERVICE_NAME:\$WORKER_NAME"/);
});

test('F3: with MAIL_STUDENTS "1" the student is told after approval: the invitation, the private listing, how it works', async () => {
  const env = mailEnv({ MAIL_STUDENTS: '1' });
  mails.length = 0;
  await requestV2(env);
  await pressConfirm(env, tokenOf(linksIn(mails[0].body.text).confirm));
  const page = await press(env, tokenOf(linksIn(mails[1].body.text).approve));
  assert.ok(page.text.includes('They are e-mailed that they are approved'));
  const told = mails.filter((m) => m.body.subject === 'You are approved for Beethoven');
  assert.equal(told.length, 1);
  const s = told[0].body;
  assert.deepEqual(s.to, ['ab1234@wayne.edu']);
  for (const x of ['You are approved', 'Watch for the Google Groups invitation at a.student@gmail.com', 'install Beethoven from the private Chrome listing (the invitation e-mail has the link)', `How it works: ${SITE}/beethoven/`, 'one installation']) assert.ok(s.text.includes(x), x);
  assert.ok(s.html.includes(`href="${SITE}/beethoven/"`));
  assert.ok(!s.text.includes('/decide') && !s.text.includes('/cv'), 'no maintainer link reaches the student');
  // the admin route tells them the same, once; ONBOARDING_PAGE moves the address
  const env2 = mailEnv({ MAIL_STUDENTS: '1', ONBOARDING_PAGE: 'https://example.edu/start' });
  await requestV2(env2);
  mails.length = 0;
  await adminPost(env2, 'approve', { accessId: 'ab1234' });
  await adminPost(env2, 'approve', { accessId: 'ab1234' });
  assert.equal(mails.filter((m) => m.body.subject === 'You are approved for Beethoven').length, 1, 'only when Beethoven is newly granted');
  assert.ok(mails[0].body.text.includes('How it works: https://example.edu/start'));
  // lab only, and MAIL_STUDENTS "0": nobody but the maintainer is e-mailed
  const env3 = mailEnv({ MAIL_STUDENTS: '1' });
  await requestV2(env3);
  mails.length = 0;
  await adminPost(env3, 'approve', { accessId: 'ab1234', grants: ['lab'] });
  assert.equal(mails.length, 0);
  const env4 = mailEnv({ MAIL_STUDENTS: '0' });
  await requestV2(env4);
  mails.length = 0;
  await adminPost(env4, 'approve', { accessId: 'ab1234' });
  assert.equal(mails.length, 0);
});

test('F3: GROUP_MODE "workspace": Approve adds the account with a delegated service account; any failure falls back to the manual step', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const SA = JSON.stringify({ type: 'service_account', client_email: 'beethoven-groups@lab-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' });
  const WS = { GROUP_MODE: 'workspace', GROUP_SA_KEY: SA, GROUP_ADMIN_SUBJECT: 'admin@openspineconsortium.com' };
  const env = mailEnv(WS);
  google.calls.length = 0;
  mails.length = 0;
  logs.length = 0;
  await requestV2(env);
  const page = await press(env, tokenOf(linksIn(mails[0].body.text).approve));
  assert.equal(page.status, 200);
  assert.equal(google.calls.length, 2);
  // the token request: a JWT signed RS256 with the key, for the delegated administrator, with the one scope
  const form = new URLSearchParams(google.calls[0].body);
  assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [h, c, s] = form.get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.deepEqual([claims.iss, claims.sub, claims.scope, claims.aud], ['beethoven-groups@lab-project.iam.gserviceaccount.com', 'admin@openspineconsortium.com', 'https://www.googleapis.com/auth/admin.directory.group.member', 'https://oauth2.googleapis.com/token']);
  assert.equal(claims.exp - claims.iat, 600);
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url')), 'the signature verifies with the public key');
  // the insert: members.insert on the group, the account as MEMBER, the access token in the header
  assert.equal(google.calls[1].url, 'https://admin.googleapis.com/admin/directory/v1/groups/beethoven-users%40openspineconsortium.com/members');
  assert.deepEqual(google.calls[1].body, { email: 'a.student@gmail.com', role: 'MEMBER' });
  assert.equal(google.calls[1].headers.authorization, 'Bearer ya29.test-access-token');
  assert.ok(page.text.includes('Added a.student@gmail.com to the Google Group Beethoven-users (beethoven-users@openspineconsortium.com)'));
  assert.equal(formAction(page.text, 'Done, invited'), null, 'nothing left to mark');
  let rec = await env.ACCESS.get('approved:ab1234', 'json');
  assert.equal(rec.invited_by, 'workspace');
  assert.ok(rec.invited_at);
  assert.equal((await adminList(env)).body.group.address, 'beethoven-users@openspineconsortium.com');
  assert.equal((await adminList(env)).body.group.mode, 'workspace');
  // already a member (409): recorded as invited as well, through the admin route
  const env2 = mailEnv(WS);
  await requestV2(env2);
  google.insertStatus = 409;
  let ap;
  try {
    ap = await adminPost(env2, 'approve', { accessId: 'ab1234' });
  } finally {
    google.insertStatus = 200;
  }
  assert.equal(ap.body.invite.invited, true);
  assert.equal(ap.body.invite.mode, 'workspace');
  assert.equal((await env2.ACCESS.get('approved:ab1234', 'json')).invited_by, 'workspace');
  // Google refuses the insert, or the token: the manual step, with the reason; nothing stamped
  for (const [what, set, reason] of [['insert', () => { google.insertStatus = 403; }, 'HTTP 403'], ['token', () => { google.tokenStatus = 401; }, 'HTTP 401']]) {
    const e = mailEnv(WS);
    mails.length = 0;
    await requestV2(e);
    set();
    let p;
    try {
      p = await press(e, tokenOf(linksIn(mails[0].body.text).approve));
    } finally {
      google.insertStatus = 200;
      google.tokenStatus = 200;
    }
    assert.equal(p.status, 200, what);
    assert.ok(p.text.includes('could not add a.student@gmail.com to the group itself'), what);
    assert.ok(p.text.includes(reason), what);
    assert.ok(p.text.includes('Next: add a.student@gmail.com to the Google Group Beethoven-users.'), what);
    assert.ok(formAction(p.text, 'Done, invited'), what);
    assert.equal('invited_at' in (await e.ACCESS.get('approved:ab1234', 'json')), false, what);
  }
  // no key or no administrator: the manual step and no call to Google
  for (const missing of [{ GROUP_SA_KEY: undefined }, { GROUP_SA_KEY: 'not json' }, { GROUP_ADMIN_SUBJECT: undefined }]) {
    const e = mailEnv({ ...WS, ...missing });
    await requestV2(e);
    google.calls.length = 0;
    const r = await adminPost(e, 'approve', { accessId: 'ab1234' });
    assert.equal(r.body.invite.invited, false, JSON.stringify(missing));
    assert.match(r.body.invite.error, /GROUP_SA_KEY|GROUP_ADMIN_SUBJECT/, JSON.stringify(missing));
    assert.equal(google.calls.length, 0, JSON.stringify(missing));
  }
  // GROUP_MODE unset or "manual" (as deployed): Google is never called
  for (const mode of [undefined, 'manual']) {
    const e = mailEnv({ ...WS, GROUP_MODE: mode });
    mails.length = 0;
    await requestV2(e);
    google.calls.length = 0;
    const p = await press(e, tokenOf(linksIn(mails[0].body.text).approve));
    assert.equal(google.calls.length, 0, String(mode));
    assert.ok(formAction(p.text, 'Done, invited'), String(mode));
  }
  // the key never shows: not on a page, not in a log line
  rec = JSON.stringify(logs) + page.text;
  assert.ok(!rec.includes('PRIVATE KEY') && !rec.includes('ya29.'));
});

test('GET /admin/list answers the admin page\'s contract (ACCESS_CHECK.md, "The admin routes")', async () => {
  const env = mailEnv();
  await requestV2(env, { cv: cvOf(PDF) });
  await requestV2(env, { access_id: 'cd5678', email: 'cd5678@wayne.edu', google_account: 'c.d@gmail.com' });
  await adminPost(env, 'approve', { accessId: 'cd5678' });
  await check(env, { access_id: 'cd5678' });
  const l = (await adminList(env)).body;
  assert.deepEqual(Object.keys(l), ['now', 'group', 'pending', 'approved', 'denied', 'revoked', 'checks', 'seats', 'conflicts']);
  assert.ok(Math.abs(Date.parse(l.now) - Date.now()) < 5000);
  assert.deepEqual(l.group, { name: 'Beethoven-users', members_url: GROUP_URL, mode: 'manual' });
  const p = l.pending[0];
  for (const k of ['accessId', 'name', 'email', 'google_account', 'note', 'cv', 'mailbox', 'stage', 'requested_at', 'submitted_at', 'age_hours', 'ref']) assert.ok(k in p, k);
  assert.deepEqual([p.stage, p.mailbox, p.age_hours], ['submitted', 'not_verified', 0]);
  assert.equal('expires_at' in p, false);
  const a = l.approved[0];
  for (const k of ['accessId', 'name', 'email', 'google_account', 'note', 'grants', 'stage', 'approved_at', 'decided_at', 'decision', 'submitted_at', 'mailbox', 'seat', 'conflicts', 'lids', 'installed_at']) assert.ok(k in a, k);
  assert.deepEqual([a.accessId, a.stage, a.seat.bound, a.conflicts], ['cd5678', 'installed', true, 0]);
  const text = JSON.stringify(l);
  for (const x of [IA, short(IA), '/decide?t=', PDF.toString('base64').slice(0, 40)]) assert.ok(!text.includes(x), x);
});

// The three edge cases the reviews of the service stream found (2026-09-30), fixed in the integration pass
test('an old Done, invited link is replaced when its approval was removed and made again, either way round, and stamps nothing', async () => {
  // made for an approval from a request (it carries a ref); the approval removed, then added (no ref)
  const env = mailEnv();
  mails.length = 0;
  await requestV2(env);
  const page = await press(env, tokenOf(linksIn(mails[0].body.text).approve));
  const it = tokenOfAction(formAction(page.text, 'Done, invited'));
  assert.ok(claimOf(it).ref);
  await adminPost(env, 'remove', { accessId: 'ab1234' });
  await adminPost(env, 'add', { accessId: 'ab1234', name: 'A. Student' });
  let before = snapshot(env);
  let d = await press(env, it);
  assert.equal(d.status, 409);
  plainPage(d, 'replaced: a ref, then none');
  assert.ok(d.text.includes('<h1>This approval was replaced</h1>'));
  assert.equal(snapshot(env), before, 'nothing written and the link not spent');
  // made for an approval with no ref (add, through the daily reminder); removed, then approved from a request
  const env2 = mailEnv({ SERVICE_ORIGIN: 'https://beethoven-access.example.workers.dev' });
  await adminPost(env2, 'add', { accessId: 'cd5678', name: 'C. D.' });
  await backdate(env2, 'cd5678', { approved_at: hoursAgo(2) });
  mails.length = 0;
  await runCron(env2);
  const [old] = doneLinks(mails[0].body.text);
  assert.equal('ref' in claimOf(tokenOf(old)), false);
  await adminPost(env2, 'remove', { accessId: 'cd5678' });
  await requestV2(env2, { access_id: 'cd5678', email: 'cd5678@wayne.edu', google_account: 'c.d@gmail.com' });
  assert.equal((await adminPost(env2, 'approve', { accessId: 'cd5678' })).status, 200);
  assert.ok((await env2.ACCESS.get('approved:cd5678', 'json')).ref);
  before = snapshot(env2);
  d = await press(env2, tokenOf(old));
  assert.equal(d.status, 409);
  assert.ok(d.text.includes('<h1>This approval was replaced</h1>'));
  assert.equal(snapshot(env2), before);
  // a link and an approval that both have no ref still work (go2432 and hy9698 were added that way)
  const env3 = mailEnv({ SERVICE_ORIGIN: 'https://beethoven-access.example.workers.dev' });
  await adminPost(env3, 'add', { accessId: 'ef0001', name: 'E. F.' });
  await backdate(env3, 'ef0001', { approved_at: hoursAgo(2) });
  mails.length = 0;
  await runCron(env3);
  d = await press(env3, tokenOf(doneLinks(mails[0].body.text)[0]));
  assert.equal(d.status, 200);
  assert.ok(d.text.includes('<h1>Marked invited.</h1>'));
  assert.ok((await env3.ACCESS.get('approved:ef0001', 'json')).invited_at);
});

test('a second confirmation link for a version already confirmed answers Already confirmed and e-mails nobody', async () => {
  const env = mailEnv({ MAIL_STUDENTS: '1' });
  mails.length = 0;
  await requestV2(env);
  await requestV2(env);
  const toStudent = mails.filter((m) => m.body.to.includes('ab1234@wayne.edu'));
  assert.equal(toStudent.length, 2, 'the same form sent twice before confirming: two confirmation e-mails');
  const [first, second] = toStudent.map((m) => tokenOf(linksIn(m.body.text).confirm));
  assert.equal(claimOf(first).ref, claimOf(second).ref, 'one version');
  const toMaintainer = () => mails.filter((m) => m.body.to.includes('maintainer@example.edu')).length;
  assert.equal((await pressConfirm(env, first)).status, 200);
  assert.equal(toMaintainer(), 1);
  const before = snapshot(env);
  for (const p of [await openConfirm(env, second), await pressConfirm(env, second)]) {
    assert.equal(p.status, 200);
    plainPage(p, 'already confirmed');
    assert.ok(p.text.includes('<h1>Already confirmed</h1>'));
    assert.ok(p.text.includes('nothing was sent again'));
  }
  assert.equal(toMaintainer(), 1, 'no second e-mail with a second set of decision links');
  assert.equal(snapshot(env), before, 'nothing written');
});

test('GROUP_MODE "workspace" with MAIL_STUDENTS "1": a student the service added is not told to wait for an invitation', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const SA = JSON.stringify({ type: 'service_account', client_email: 'beethoven-groups@lab-project.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' });
  const WS = { MAIL_STUDENTS: '1', GROUP_MODE: 'workspace', GROUP_SA_KEY: SA, GROUP_ADMIN_SUBJECT: 'admin@openspineconsortium.com' };
  const approveOnce = async (env) => {
    mails.length = 0;
    await requestV2(env);
    await pressConfirm(env, tokenOf(linksIn(mails[0].body.text).confirm));
    const page = await press(env, tokenOf(linksIn(mails[1].body.text).approve));
    const told = mails.filter((m) => m.body.subject === 'You are approved for Beethoven');
    assert.equal(told.length, 1);
    return { page, text: told[0].body.text, html: told[0].body.html };
  };
  // Google accepts: the account is in the group, and no invitation e-mail will carry the listing's address
  const a = await approveOnce(mailEnv(WS));
  assert.equal(a.page.status, 200);
  for (const x of ['Added a.student@gmail.com to the Google Group Beethoven-users', 'send it to them yourself', 'that you send them the private listing']) assert.ok(a.page.text.includes(x), x);
  for (const x of ['Your Google account a.student@gmail.com is now in the Google Group Beethoven-users', 'there is no invitation to accept', 'your lab lead sends you its link', 'If the link has not come within two days']) assert.ok(a.text.includes(x), x);
  for (const x of ['Watch for the Google Groups invitation', 'the invitation e-mail has the link']) assert.ok(!a.text.includes(x) && !a.html.includes(x), x);
  // Google refuses: the manual step, and the student is told to watch for the invitation, as in manual mode
  google.insertStatus = 403;
  let b;
  try {
    b = await approveOnce(mailEnv(WS));
  } finally {
    google.insertStatus = 200;
  }
  assert.ok(formAction(b.page.text, 'Done, invited'));
  assert.ok(b.page.text.includes('told to watch for the invitation'));
  for (const x of ['Watch for the Google Groups invitation at a.student@gmail.com', 'the invitation e-mail has the link', 'If the invitation has not come within two days']) assert.ok(b.text.includes(x), x);
});
