// Phone access (grid/phone.js) with a fake claude: one host at a time, hand-over when phone access
// moves, take-over of an abandoned lease, the onboarding seed, and a clean environment for Remote
// Control. phone.js drives Claude through util-linux `script` (a pseudo-terminal), so this suite
// runs where `script` exists: the grid container, or any Linux machine. It skips elsewhere.
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashley-phone-'));
const home = path.join(tmp, 'ashley-home');
const root = path.join(tmp, 'root');
const cfg = path.join(home, 'remote', 'config');
const lease = path.join(home, 'remote', 'host.lock');
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
  fs.writeFileSync(path.join(cfg, 'fake_logged_in'), ''); // signed in already; the sign-in has its own test
  // credentials that must never reach Remote Control
  process.env.ANTHROPIC_AUTH_TOKEN = 'leak-auth';
  process.env.ANTHROPIC_BASE_URL = 'https://elsewhere.invalid';
  process.env.CLAUDE_CODE_OAUTH_TOKEN = 'leak-oauth';
  const mk = (w: string, job: string) => startPhone({ workerDir: path.join(home, 'workers', w), ashleyHome: home, root, claude: fake, node: `node-${w}`, job, log: (m: string) => logs.push(`${w}: ${m}`) });
  A = mk('wa', '101');
  B = mk('wb', '202');
});

after(() => {
  if (!hasScript) return;
  A.stop();
  B.stop();
});

test('the first worker to turn phone access on hosts it, and runs Remote Control with a clean environment', { skip }, async () => {
  enable('wa', true);
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

test('the sign-in answers a wrong code and accepts the right one', { skip }, async () => {
  enable('wa', false);
  assert.ok(await tickUntil(A, () => status('wa').phase === 'off', 5000));
  fs.rmSync(path.join(cfg, 'fake_logged_in'));
  enable('wa', true);
  assert.ok(await tickUntil(A, () => status('wa').phase === 'need_code', 20000), `link shown (${JSON.stringify(status('wa'))})`);
  assert.match(status('wa').url, /oauth\/authorize/);
  const code = path.join(home, 'workers', 'wa', 'rc', 'code');
  fs.writeFileSync(code, 'wrongcode\n');
  assert.ok(await tickUntil(A, () => status('wa').phase === 'need_code' && /did not accept/.test(status('wa').message), 15000), `wrong code reported (${JSON.stringify(status('wa'))})`);
  fs.writeFileSync(code, 'goodcode\n');
  assert.ok(await tickUntil(A, () => status('wa').phase === 'running', 30000), `signed in and running (${JSON.stringify(status('wa'))})`);
});
