// End-to-end test of the grid daemon (grid/beethovend.js) with a fake claude, on the laptop.
// Exercises: claim from inbox, events stream, final result, session persistence (--session-id
// then --resume), waiting out a spent subscription window, crash handling, clean stop.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as L from '../../../grid/license.js';

const here = __dirname; // dist-test/unit/core
const repo = path.resolve(here, '..', '..', '..', '..');
const fake = path.join(repo, 'extension', 'test-fixtures', 'fake-claude.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-test-'));
// The daemon runs from a copy that trusts the test signing key (grid/license_keys.json holds the
// release keys, whose private half is not in the repository).
const bin = path.join(tmp, 'bin');
fs.mkdirSync(bin, { recursive: true });
for (const f of ['beethovend.js', 'phone.js', 'license.js']) fs.copyFileSync(path.join(repo, 'grid', f), path.join(bin, f));
const testKey = crypto.createPrivateKey(fs.readFileSync(path.join(repo, 'extension', 'test-fixtures', 'license', 'test-signing-key.pem'), 'utf8'));
fs.writeFileSync(path.join(bin, 'license_keys.json'), JSON.stringify({ test: L.rawFromPublicKey(crypto.createPublicKey(testKey)) }));
const daemon = path.join(bin, 'beethovend.js');
const user = os.userInfo().username;
const licenseFor = (sub: string, days = 30) => L.signLicense({ kid: 'test', sub, exp: Math.floor(Date.now() / 1000) + days * 86400 } as never, testKey);
const home = path.join(tmp, 'beethoven-home');
const worker = path.join(home, 'workers', 'w1');
const claudeHome = path.join(home, 'claude');
const root = path.join(tmp, 'root');
let child: ChildProcess;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitFor(pred: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await sleep(100);
  }
  return false;
}
function send(req: Record<string, unknown>) {
  const p = path.join(worker, 'inbox', `${req.id}.json`);
  fs.writeFileSync(p + '.part', JSON.stringify(req));
  fs.renameSync(p + '.part', p);
}
function result(id: string): any {
  const p = path.join(worker, 'outbox', `${id}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

before(async () => {
  assert.ok(fs.existsSync(daemon), `daemon missing at ${daemon}`);
  for (const d of ['inbox', 'outbox', 'log']) fs.mkdirSync(path.join(worker, d), { recursive: true });
  // the student's own sign-in, as Claude Code stores it (the fake reads the marker; the daemon only checks presence)
  fs.mkdirSync(claudeHome, { recursive: true });
  fs.writeFileSync(path.join(claudeHome, '.credentials.json'), '{"fake":true}\n');
  fs.writeFileSync(path.join(claudeHome, 'fake_logged_in'), '');
  // an API key a build up to 4.0.0 stored for its paid overflow: still on disk, never read
  fs.mkdirSync(path.join(home, 'accounts', 'apikey'), { recursive: true });
  fs.writeFileSync(path.join(home, 'accounts', 'apikey', 'apikey'), 'sk-ant-api03-fake\n');
  fs.writeFileSync(path.join(home, 'secrets.env'), 'HF_TOKEN=hf_fake\nGITHUB_TOKEN=ghp_fake\n');
  fs.writeFileSync(path.join(home, 'license.key'), licenseFor(user) + '\n');
  fs.writeFileSync(path.join(worker, 'node'), 'testnode\n');
  fs.writeFileSync(path.join(worker, 'job.id'), '123\n');
  // the daemon runs a .js "claude" with its own node binary (Windows cannot spawn .cmd wrappers without a shell)
  child = spawn(process.execPath, [daemon, '--worker-dir', worker, '--claude', fake, '--concurrency', '2', '--poll-ms', '200'], {
    env: { ...process.env, BEETHOVEN_HOME: home, BEETHOVEN_ROOT: root, BEETHOVEN_LICENSE_RECHECK_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', (d) => process.stderr.write(`[daemon] ${d}`));
  assert.ok(await waitFor(() => fs.existsSync(path.join(worker, 'state.json'))), 'daemon wrote state.json');
});

after(async () => {
  fs.writeFileSync(path.join(worker, 'stop'), '');
  await waitFor(() => child.exitCode !== null, 10000);
  if (child.exitCode === null) child.kill();
});

test('a request is answered, with events and a saved session', async () => {
  send({ v: 1, id: 'r1', prompt: 'hello grid', session: 's1', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r1')), 'result r1 appears');
  const r = result('r1');
  assert.equal(r.status, 'ok');
  assert.equal(r.result, 'echo: hello grid');
  assert.equal(r.account, 'claude');
  assert.equal(r.node, 'testnode');
  assert.equal(r.num_turns, 2);
  const events = fs.readFileSync(path.join(worker, 'outbox', 'r1.events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(events[0].type, 'beethoven');
  assert.ok(events.some((e) => e.type === 'assistant'));
  assert.equal(events[events.length - 1].event, 'exit');
  const sess = JSON.parse(fs.readFileSync(path.join(home, 'sessions', 's1.json'), 'utf8'));
  assert.equal(sess.session_id, r.session_id);
  assert.ok(sess.cwd.startsWith(root), 'session cwd under BEETHOVEN_ROOT/workspaces');
  const argv = JSON.parse(fs.readFileSync(path.join(sess.cwd, 'fake_argv.json'), 'utf8'));
  assert.ok(argv.args.includes('--session-id'), 'first turn sets the session id');
  assert.equal(argv.env.CLAUDE_CODE_OAUTH_TOKEN, null, 'Beethoven passes no Claude credential: Claude Code uses the sign-in it stored');
  assert.equal(argv.env.ANTHROPIC_API_KEY, null, 'no run ever sees an API key');
  assert.equal(argv.env.HF_TOKEN, 'hf_fake');
  assert.ok(argv.env.CLAUDE_CONFIG_DIR.endsWith('claude'), `config dir is the sign-in folder (${argv.env.CLAUDE_CONFIG_DIR})`);
  assert.equal(fs.existsSync(path.join(worker, 'inbox', 'r1.json.claimed')), false, 'claim removed');
});

test('the second turn of a session resumes it', async () => {
  send({ v: 1, id: 'r2', prompt: 'again', session: 's1', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r2')));
  const r = result('r2');
  assert.equal(r.status, 'ok');
  assert.match(r.result, /\(resumed\)/);
  assert.equal(r.session_id, result('r1').session_id);
});

test('a spent subscription window is waited out: no API key, no second account', async () => {
  fs.writeFileSync(path.join(claudeHome, 'fake_rate_limit'), '');
  send({ v: 1, id: 'r3', prompt: 'limited', session: 's2', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r3')));
  const r = result('r3');
  assert.equal(r.status, 'rate_limited');
  assert.equal(r.account, 'claude');
  assert.ok(r.retry_after && new Date(r.retry_after) > new Date(), 'the result says when the window resets');
  assert.equal(fs.existsSync(path.join(worker, 'inbox', 'r3.json')), false, 'not requeued for another credential');
  const st = JSON.parse(fs.readFileSync(path.join(claudeHome, 'state.json'), 'utf8'));
  assert.ok(st.cooldown_until && new Date(st.cooldown_until) > new Date(), 'the sign-in is on cooldown');
  const argv = JSON.parse(fs.readFileSync(path.join(root, 'workspaces', 's2', 'fake_argv.json'), 'utf8'));
  assert.equal(argv.env.ANTHROPIC_API_KEY, null, 'the stored key is never read');
  assert.equal(argv.env.CLAUDE_CODE_OAUTH_TOKEN, null);
  fs.rmSync(path.join(claudeHome, 'fake_rate_limit'));
});

test('while the window is spent a request is answered rate_limited at once, and the heartbeat lists only the sign-in', async () => {
  send({ v: 1, id: 'r4', prompt: 'still limited', session: 's3', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r4')));
  const r = result('r4');
  assert.equal(r.status, 'rate_limited');
  assert.match(r.error, /cooldown until/);
  assert.ok(r.retry_after);
  assert.equal(fs.existsSync(path.join(root, 'workspaces', 's3', 'fake_argv.json')), false, 'Claude Code was not started');
  const state = JSON.parse(fs.readFileSync(path.join(worker, 'state.json'), 'utf8'));
  assert.deepEqual(state.accounts.map((a: { name: string }) => a.name), ['claude']);
  assert.ok(['blocked', 'idle', 'busy'].includes(state.status));
});

test('a crash without a result is reported as error, not lost', async () => {
  fs.rmSync(path.join(claudeHome, 'state.json'), { force: true });
  fs.writeFileSync(path.join(claudeHome, 'fake_crash'), '');
  send({ v: 1, id: 'r5', prompt: 'boom', session: 's4', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r5')));
  const r = result('r5');
  assert.equal(r.status, 'error');
  assert.match(r.error, /without a result/);
  fs.rmSync(path.join(claudeHome, 'fake_crash'));
});

test('a request may name only the sign-in, and the heartbeat has the expected shape', async () => {
  send({ v: 1, id: 'r6', prompt: 'forced', session: 's5', account: 'claude', mode: 'plan', max_turns: 3, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r6')));
  assert.equal(result('r6').account, 'claude');
  send({ v: 1, id: 'r7', prompt: 'on the key', session: 's6', account: 'apikey', mode: 'plan', max_turns: 3, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r7')));
  assert.equal(result('r7').status, 'error', 'an API key is never an account');
  assert.match(result('r7').error, /only on your own Claude sign-in/);
  assert.equal(fs.existsSync(path.join(root, 'workspaces', 's6', 'fake_argv.json')), false);
  // a laptop of 4.0.0 excluded the sign-in to move a request to the key: the sign-in still answers it
  send({ v: 1, id: 'r8', prompt: 'excluded', session: 's7', exclude_accounts: ['claude'], mode: 'plan', max_turns: 3, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r8')));
  assert.equal(result('r8').status, 'ok');
  assert.equal(result('r8').account, 'claude');
  const argv = JSON.parse(fs.readFileSync(path.join(root, 'workspaces', 's5', 'fake_argv.json'), 'utf8'));
  assert.ok(argv.args.includes('--permission-mode') && argv.args.includes('plan'));
  const st = JSON.parse(fs.readFileSync(path.join(worker, 'state.json'), 'utf8'));
  for (const k of ['worker', 'node', 'job', 'pid', 'last_beat', 'status', 'concurrency', 'running', 'queued', 'processed', 'accounts']) assert.ok(k in st, `state has ${k}`);
  assert.equal(st.worker, 'w1');
  assert.ok(st.processed >= 5); // r1, r2, r3, r5, r6, r8 ran Claude Code (r4 and r7 never started it); the heartbeat may trail by one
});

test('after the window resets the same conversation resumes from the shared history', async () => {
  fs.rmSync(path.join(claudeHome, 'state.json'), { force: true }); // the reset time has come
  send({ v: 1, id: 'r20', prompt: 'continue after the reset', session: 's1', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r20')));
  const r = result('r20');
  assert.equal(r.status, 'ok', `status ${r.status}: ${r.error ?? ''}`);
  assert.equal(r.account, 'claude');
  assert.match(r.result, /\(resumed\)/);
  assert.equal(r.session_id, result('r1').session_id, 'the same conversation');
  assert.ok(fs.lstatSync(path.join(claudeHome, 'projects')).isSymbolicLink(), 'the sign-in folder links to the shared history');
  assert.equal(fs.existsSync(path.join(home, 'accounts', 'apikey', 'projects')), false, 'nothing is set up for the stored key');
  assert.equal(fs.readFileSync(path.join(home, 'accounts', 'apikey', 'apikey'), 'utf8'), 'sk-ant-api03-fake\n', 'the worker leaves the file alone');
});

test('without a valid license the worker refuses work, says why, and resumes when a good key returns', async () => {
  const lic = path.join(home, 'license.key');
  const good = fs.readFileSync(lic, 'utf8');
  const state = () => JSON.parse(fs.readFileSync(path.join(worker, 'state.json'), 'utf8'));
  // a license for another grid account
  fs.writeFileSync(lic, licenseFor('zz9999') + '\n');
  assert.ok(await waitFor(() => state().license?.status === 'wrong-person'), 'heartbeat reports wrong-person');
  assert.equal(state().status, 'unlicensed');
  send({ v: 1, id: 'r30', prompt: 'not for you', session: 's9', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r30')));
  assert.equal(result('r30').status, 'error');
  assert.match(result('r30').error, /license/i);
  // no key at all
  fs.rmSync(lic);
  assert.ok(await waitFor(() => state().license?.status === 'missing'));
  // an ended key past its grace
  fs.writeFileSync(lic, licenseFor(user, -20) + '\n');
  assert.ok(await waitFor(() => state().license?.status === 'expired'));
  // the good key again
  fs.writeFileSync(lic, good);
  assert.ok(await waitFor(() => state().license?.ok === true), 'accepted again');
  send({ v: 1, id: 'r31', prompt: 'licensed again', session: 's9', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r31')));
  assert.equal(result('r31').status, 'ok');
});

test('a withdrawn license is refused by the worker', async () => {
  const lic = path.join(home, 'license.key');
  const lid = L.verifyLicense(fs.readFileSync(lic, 'utf8').trim(), { keys: { test: L.rawFromPublicKey(crypto.createPublicKey(testKey)) } }).payload!.lid;
  fs.writeFileSync(path.join(home, 'license.revoked'), L.signRevocationList([lid], 'test', testKey) + '\n');
  const state = () => JSON.parse(fs.readFileSync(path.join(worker, 'state.json'), 'utf8'));
  assert.ok(await waitFor(() => state().license?.status === 'revoked'), 'heartbeat reports revoked');
  fs.rmSync(path.join(home, 'license.revoked'));
  assert.ok(await waitFor(() => state().license?.ok === true));
});

test('when the sign-in is gone the worker says how to sign in, and picks it up again by itself', async () => {
  const state = () => JSON.parse(fs.readFileSync(path.join(worker, 'state.json'), 'utf8'));
  fs.rmSync(path.join(claudeHome, 'state.json'), { force: true }); // no cooldown left over from the limit tests
  assert.equal(state().claude_login?.loggedIn, true, 'heartbeat reports the sign-in');
  assert.equal(state().claude_login?.email, 'ab1234@wayne.edu');
  fs.rmSync(path.join(claudeHome, 'fake_logged_in'));
  fs.writeFileSync(path.join(claudeHome, '.credentials.json'), '{"fake":true,"changed":1}\n'); // the daemon watches this file
  assert.ok(await waitFor(() => state().claude_login?.loggedIn === false, 20000), 'heartbeat notices the sign-in is gone');
  send({ v: 1, id: 'r40', prompt: 'nobody home', session: 's12', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r40')));
  assert.equal(result('r40').status, 'error');
  assert.match(result('r40').error, /Sign in to Claude on the grid/);
  fs.writeFileSync(path.join(claudeHome, 'fake_logged_in'), '');
  fs.writeFileSync(path.join(claudeHome, '.credentials.json'), '{"fake":true,"changed":2}\n');
  assert.ok(await waitFor(() => state().claude_login?.loggedIn === true, 20000), 'signed in again');
  send({ v: 1, id: 'r41', prompt: 'back', session: 's12', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r41')));
  assert.equal(result('r41').status, 'ok');
  assert.equal(result('r41').account, 'claude');
});

test('a sign-in that is not a Claude subscription gets no work, says so, and the subscription is picked up again', async () => {
  const state = () => JSON.parse(fs.readFileSync(path.join(worker, 'state.json'), 'utf8'));
  let n = 2;
  const touch = () => fs.writeFileSync(path.join(claudeHome, '.credentials.json'), `{"fake":true,"changed":${++n}}\n`); // the daemon watches this file
  // a token taken from the environment (the setup-token route the credential rule forbids), then a cloud provider (paid by use)
  for (const [file, field, value, id] of [['fake_auth_method', 'authMethod', 'oauth_token', 'r50'], ['fake_api_provider', 'apiProvider', 'bedrock', 'r51']] as const) {
    fs.writeFileSync(path.join(claudeHome, file), value);
    touch();
    assert.ok(await waitFor(() => state().claude_login?.[field] === value, 20000), `the heartbeat has the new answer (${value})`);
    assert.equal(state().claude_login.subscription, false, 'not a subscription');
    assert.equal(state().claude_login.loggedIn, true, 'what Claude Code said is kept');
    send({ v: 1, id, prompt: 'not on a key', session: `s-${id}`, mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
    assert.ok(await waitFor(() => !!result(id)));
    assert.equal(result(id).status, 'error');
    assert.match(result(id).error, /not with a Claude subscription/);
    assert.equal(fs.existsSync(path.join(root, 'workspaces', `s-${id}`, 'fake_argv.json')), false, 'Claude Code was not started');
    fs.rmSync(path.join(claudeHome, file));
    touch();
    assert.ok(await waitFor(() => state().claude_login?.subscription === true, 20000), 'the subscription again');
  }
  send({ v: 1, id: 'r52', prompt: 'subscription', session: 's-r52', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r52')));
  assert.equal(result('r52').status, 'ok');
});
