// Phone access (grid/phone.js) with a fake claude: it waits for the student's own sign-in and their
// one-time Remote Control consent, hosts on one worker at a time, hands over when phone access
// moves, takes over an abandoned lease, seeds Claude Code's first-run settings, and starts Remote
// Control with a clean environment. phone.js drives Claude through util-linux `script` (a
// pseudo-terminal), so this suite runs where `script` exists: the grid container, or any Linux
// machine. It skips elsewhere.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const here = __dirname; // dist-test/unit/core
const repo = path.resolve(here, '..', '..', '..', '..');
const fake = path.join(repo, 'extension', 'test-fixtures', 'fake-claude.js');
const hasScript = process.platform !== 'win32' && spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = hasScript ? false : 'needs util-linux script (runs on the grid; see docs/DIAGNOSTICS.md)';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-phone-'));
const home = path.join(tmp, 'beethoven-home');
const root = path.join(tmp, 'root');
const cfg = path.join(home, 'claude'); // the student's own sign-in, stored by Claude Code
const lease = path.join(home, 'remote', 'host.lock');
const consent = path.join(cfg, '.ashley-remote-consent');
type Phone = { tick(): void; stop(): void; phase(): string };
let A: Phone;
let B: Phone;
const logs: string[] = [];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function status(w: string): any {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, 'workers', w, 'rc', 'status.json'), 'utf8'));
  } catch {
    return {};
  }
}
async function tickUntil(p: Phone, pred: () => boolean, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    p.tick();
    if (pred()) return true;
    await sleep(250);
  }
  return false;
}
function enable(w: string, on: boolean) {
  const rc = path.join(home, 'workers', w, 'rc');
  fs.mkdirSync(rc, { recursive: true });
  if (on) fs.writeFileSync(path.join(rc, 'enable'), '');
  else fs.rmSync(path.join(rc, 'enable'), { force: true });
}

before(() => {
  if (!hasScript) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startPhone } = require(path.join(repo, 'grid', 'phone.js'));
  for (const w of ['wa', 'wb']) fs.mkdirSync(path.join(home, 'workers', w), { recursive: true });
  fs.mkdirSync(cfg, { recursive: true });
  // credentials that must never reach Remote Control
  process.env.ANTHROPIC_AUTH_TOKEN = 'leak-auth';
  process.env.ANTHROPIC_BASE_URL = 'https://elsewhere.invalid';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'leak-oauth';
  const mk = (w: string, job: string) => startPhone({ workerDir: path.join(home, 'workers', w), beethovenHome: home, claudeHome: cfg, root, claude: fake, node: `node-${w}`, job, log: (m: string) => logs.push(`${w}: ${m}`) });
  A = mk('wa', '101');
  B = mk('wb', '202');
});

after(() => {
  if (!hasScript) return;
  A.stop();
  B.stop();
});

test('without the student\'s own sign-in, phone access waits and says what to do; Beethoven signs nobody in', { skip }, async () => {
  enable('wa', true);
  assert.ok(await tickUntil(A, () => status('wa').phase === 'need_login', 10000), `need_login (${JSON.stringify(status('wa'))})`);
  assert.match(status('wa').message, /beethoven claude login/);
  assert.ok(!fs.existsSync(path.join(home, 'workers', 'wa', 'rc', 'login.log')), 'no sign-in was attempted by Beethoven');
});

test('signed in but without the one-time Remote Control consent, it waits for the student\'s answer', { skip }, async () => {
  fs.writeFileSync(path.join(cfg, 'fake_logged_in'), '');
  fs.writeFileSync(path.join(cfg, '.credentials.json'), '{"fake":true}');
  assert.ok(await tickUntil(A, () => status('wa').phase === 'need_consent', 70000), `need_consent (${JSON.stringify(status('wa'))})`);
  assert.match(status('wa').message, /remote-consent/);
});

test('with consent, the first worker to turn phone access on hosts it, with a clean environment and seeded settings', { skip }, async () => {
  fs.writeFileSync(consent, new Date().toISOString());
  assert.ok(await tickUntil(A, () => status('wa').phase === 'running'), `wa running (${JSON.stringify(status('wa'))})`);
  assert.match(status('wa').session_url ?? '', /claude\.ai\/code\/session_fake123/);
  const holder = JSON.parse(fs.readFileSync(path.join(lease, 'holder.json'), 'utf8'));
  assert.equal(holder.worker, 'wa');
  const seen = JSON.parse(fs.readFileSync(path.join(cfg, 'fake_rc_env.json'), 'utf8'));
  for (const [k, v] of Object.entries(seen.env)) assert.equal(v, null, `${k} is removed before Remote Control`);
  const j = JSON.parse(fs.readFileSync(path.join(cfg, '.claude.json'), 'utf8'));
  assert.equal(j.hasCompletedOnboarding, true, 'onboarding seeded');
  assert.ok(j.theme, 'theme seeded');
  assert.equal(j.projects[path.join(root, 'workspaces', 'phone')].hasTrustDialogAccepted, true, 'phone folder trusted');
});

test('a second worker does not start a second host while the first holds the lease', { skip }, async () => {
  enable('wb', true);
  assert.ok(await tickUntil(B, () => status('wb').phase === 'elsewhere', 5000), `wb elsewhere (${JSON.stringify(status('wb'))})`);
  assert.match(status('wb').message, /worker wa/);
  A.tick();
  assert.equal(status('wa').phase, 'running', 'the host keeps running');
});

test('turning it off on the host hands the lease over', { skip }, async () => {
  enable('wa', false);
  assert.ok(await tickUntil(A, () => status('wa').phase === 'off', 5000));
  assert.equal(fs.existsSync(lease), false, 'lease released');
  assert.ok(await tickUntil(B, () => status('wb').phase === 'running'), `wb running (${JSON.stringify(status('wb'))})`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(lease, 'holder.json'), 'utf8')).worker, 'wb');
});

test('an abandoned lease (no beat for over 60 s) is taken over', { skip }, async () => {
  enable('wb', false);
  assert.ok(await tickUntil(B, () => status('wb').phase === 'off', 5000));
  fs.mkdirSync(lease, { recursive: true });
  fs.writeFileSync(path.join(lease, 'holder.json'), JSON.stringify({ worker: 'ghost', node: 'gone', job: '9', pid: 1 }));
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(path.join(lease, 'holder.json'), old, old);
  enable('wa', true);
  assert.ok(await tickUntil(A, () => status('wa').phase === 'running'), `wa took over (${JSON.stringify(status('wa'))})`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(lease, 'holder.json'), 'utf8')).worker, 'wa');
});

test('when the sign-in ends, phone access stops and asks for a new sign-in; Beethoven never runs logout', { skip }, async () => {
  fs.rmSync(path.join(cfg, 'fake_logged_in'));
  // the running session ends as the real one does when its login expires
  const log = path.join(home, 'workers', 'wa', 'rc', 'session.log');
  A.stop();
  enable('wa', true);
  assert.ok(await tickUntil(A, () => status('wa').phase === 'need_login', 70000), `need_login again (${JSON.stringify(status('wa'))})`);
  assert.ok(!logs.some((l) => /logout/.test(l)), 'no logout in the log');
  assert.ok(fs.existsSync(log));
});
