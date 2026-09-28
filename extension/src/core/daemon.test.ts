// End-to-end test of the grid daemon (grid/ashleyd.js) with a fake claude, on the laptop.
// Exercises: claim from inbox, events stream, final result, session persistence (--session-id
// then --resume), account rotation on a rate limit, crash handling, clean stop.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';

const here = __dirname; // dist-test/unit/core
const repo = path.resolve(here, '..', '..', '..', '..');
const daemon = path.join(repo, 'grid', 'ashleyd.js');
const fake = path.join(repo, 'extension', 'test-fixtures', 'fake-claude.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashley-test-'));
const home = path.join(tmp, 'ashley-home');
const worker = path.join(home, 'workers', 'w1');
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
  fs.mkdirSync(path.join(home, 'accounts', 'default'), { recursive: true });
  fs.writeFileSync(path.join(home, 'accounts', 'default', 'token'), 'sk-ant-oat01-fake\n');
  fs.mkdirSync(path.join(home, 'accounts', 'apikey'), { recursive: true });
  fs.writeFileSync(path.join(home, 'accounts', 'apikey', 'apikey'), 'sk-ant-api03-fake\n');
  fs.writeFileSync(path.join(home, 'secrets.env'), 'HF_TOKEN=hf_fake\nGITHUB_TOKEN=ghp_fake\n');
  fs.writeFileSync(path.join(worker, 'node'), 'testnode\n');
  fs.writeFileSync(path.join(worker, 'job.id'), '123\n');
  // the daemon runs a .js "claude" with its own node binary (Windows cannot spawn .cmd wrappers without a shell)
  child = spawn(process.execPath, [daemon, '--worker-dir', worker, '--claude', fake, '--concurrency', '2', '--poll-ms', '200'], {
    env: { ...process.env, ASHLEY_HOME: home, ASHLEY_ROOT: root },
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
  assert.equal(r.account, 'default');
  assert.equal(r.node, 'testnode');
  assert.equal(r.num_turns, 2);
  const events = fs.readFileSync(path.join(worker, 'outbox', 'r1.events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(events[0].type, 'ashley');
  assert.ok(events.some((e) => e.type === 'assistant'));
  assert.equal(events[events.length - 1].event, 'exit');
  const sess = JSON.parse(fs.readFileSync(path.join(home, 'sessions', 's1.json'), 'utf8'));
  assert.equal(sess.session_id, r.session_id);
  assert.ok(sess.cwd.startsWith(root), 'session cwd under ASHLEY_ROOT/workspaces');
  const argv = JSON.parse(fs.readFileSync(path.join(sess.cwd, 'fake_argv.json'), 'utf8'));
  assert.ok(argv.args.includes('--session-id'), 'first turn sets the session id');
  assert.equal(argv.env.CLAUDE_CODE_OAUTH_TOKEN, 'sk-ant-oat01-fake');
  assert.equal(argv.env.ANTHROPIC_API_KEY, null, 'subscription runs never see the API key');
  assert.equal(argv.env.HF_TOKEN, 'hf_fake');
  assert.ok(argv.env.CLAUDE_CONFIG_DIR.endsWith(path.join('accounts', 'default')));
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

test('a rate-limited account is cooled down and the request moves to the next credential', async () => {
  fs.writeFileSync(path.join(home, 'accounts', 'default', 'fake_rate_limit'), '');
  send({ v: 1, id: 'r3', prompt: 'limited', session: 's2', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r3')));
  const r = result('r3');
  assert.equal(r.status, 'ok');
  assert.equal(r.account, 'apikey', 'fell over to the API key');
  const st = JSON.parse(fs.readFileSync(path.join(home, 'accounts', 'default', 'state.json'), 'utf8'));
  assert.ok(st.cooldown_until && new Date(st.cooldown_until) > new Date(), 'default account on cooldown');
  const argv = JSON.parse(fs.readFileSync(path.join(root, 'workspaces', 's2', 'fake_argv.json'), 'utf8'));
  assert.equal(argv.env.ANTHROPIC_API_KEY, 'sk-ant-api03-fake');
  assert.equal(argv.env.CLAUDE_CODE_OAUTH_TOKEN, null);
  fs.rmSync(path.join(home, 'accounts', 'default', 'fake_rate_limit'));
});

test('when every account is limited the result says rate_limited with a retry time', async () => {
  fs.writeFileSync(path.join(home, 'accounts', 'apikey', 'fake_rate_limit'), '');
  // default is still cooling from the previous test
  send({ v: 1, id: 'r4', prompt: 'nothing left', session: 's3', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r4')));
  const r = result('r4');
  assert.equal(r.status, 'rate_limited');
  assert.ok(r.retry_after);
  fs.rmSync(path.join(home, 'accounts', 'apikey', 'fake_rate_limit'));
  const state = JSON.parse(fs.readFileSync(path.join(worker, 'state.json'), 'utf8'));
  assert.ok(['blocked', 'idle', 'busy'].includes(state.status));
});

test('a crash without a result is reported as error, not lost', async () => {
  fs.rmSync(path.join(home, 'accounts', 'default', 'state.json'), { force: true });
  fs.writeFileSync(path.join(home, 'accounts', 'default', 'fake_crash'), '');
  send({ v: 1, id: 'r5', prompt: 'boom', session: 's4', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r5')));
  const r = result('r5');
  assert.equal(r.status, 'error');
  assert.match(r.error, /without a result/);
  fs.rmSync(path.join(home, 'accounts', 'default', 'fake_crash'));
});

test('a forced account is honoured and the heartbeat has the expected shape', async () => {
  send({ v: 1, id: 'r6', prompt: 'forced', session: 's5', account: 'apikey', mode: 'plan', max_turns: 3, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r6')));
  assert.equal(result('r6').account, 'apikey');
  const argv = JSON.parse(fs.readFileSync(path.join(root, 'workspaces', 's5', 'fake_argv.json'), 'utf8'));
  assert.ok(argv.args.includes('--permission-mode') && argv.args.includes('plan'));
  const st = JSON.parse(fs.readFileSync(path.join(worker, 'state.json'), 'utf8'));
  for (const k of ['worker', 'node', 'job', 'pid', 'last_beat', 'status', 'concurrency', 'running', 'queued', 'processed', 'accounts']) assert.ok(k in st, `state has ${k}`);
  assert.equal(st.worker, 'w1');
  assert.ok(st.processed >= 6);
});

test('a session that moves to the API key on a limit keeps its conversation (shared history)', async () => {
  // Claude Code looks for a session only under the running account's CLAUDE_CONFIG_DIR/projects;
  // without the shared history the resume on the API key fails with "No conversation found".
  fs.rmSync(path.join(home, 'accounts', 'default', 'state.json'), { force: true });
  fs.rmSync(path.join(home, 'accounts', 'apikey', 'state.json'), { force: true });
  fs.writeFileSync(path.join(home, 'accounts', 'default', 'fake_rate_limit'), '');
  send({ v: 1, id: 'r20', prompt: 'continue on the key', session: 's1', mode: 'acceptEdits', max_turns: 5, created: new Date().toISOString(), from: 'test' });
  assert.ok(await waitFor(() => !!result('r20')));
  const r = result('r20');
  fs.rmSync(path.join(home, 'accounts', 'default', 'fake_rate_limit'));
  assert.equal(r.status, 'ok', `status ${r.status}: ${r.error ?? ''}`);
  assert.equal(r.account, 'apikey');
  assert.match(r.result, /\(resumed\)/);
  assert.equal(r.session_id, result('r1').session_id, 'the same conversation');
  for (const a of ['default', 'apikey']) {
    const l = fs.lstatSync(path.join(home, 'accounts', a, 'projects'));
    assert.ok(l.isSymbolicLink(), `${a}/projects links to the shared history`);
  }
});
