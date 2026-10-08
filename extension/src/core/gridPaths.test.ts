// A worker's name and a request's id become file names under ~/.beethoven/workers on the grid, and both reach
// the grid script from the laptop's Claude (beethoven_result, beethoven_send, the relay). Up to grid scripts 9
// `beethoven result --worker default ../../../claude/.credentials` printed the Claude sign-in, and a worker
// name with a slash put an inbox inside it. The real script runs here in a made-up home holding a FAKE sign-in,
// with a Slurm that only records what it is asked: every crafted name or id is refused, nothing of the sign-in
// is printed, nothing is made beside it, and the values a worker job starts with are words and numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(__dirname, '..', '..', '..', '..'); // dist-test/unit/core -> repository root
const skip = process.platform === 'linux' ? false : 'needs bash, as on the grid';
const FAKE = '{"claudeAiOauth":{"accessToken":"FAKE-SECRET-FOR-TESTS"}}';

function lab() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-paths-'));
  const bh = path.join(h, '.beethoven');
  const bin = path.join(bh, 'bin');
  const put = (rel: string, body = '', mode?: number) => {
    fs.mkdirSync(path.dirname(path.join(h, rel)), { recursive: true });
    fs.writeFileSync(path.join(h, rel), body, mode ? { mode } : {});
  };
  fs.mkdirSync(bin, { recursive: true });
  for (const f of ['beethoven', 'VERSION', 'worker.sbatch.tpl']) fs.copyFileSync(path.join(repo, 'grid', f), path.join(bin, f));
  // the student's own sign-in, as Claude Code keeps it (a fake), and other files nobody may be handed
  put('.beethoven/claude/.credentials.json', FAKE);
  put('.beethoven/claude/planted.events.jsonl', `${FAKE}\n`);
  put('.beethoven/elsewhere/outbox/x.json', FAKE); // reachable only through a worker name with a slash
  // a ready account with one worker and one answered request
  put('.beethoven/config.env', `ROOT=${path.join(h, 'work')}\nSANDBOX=${path.join(h, 'sandbox')}\nCLAUDE_BIN=${path.join(h, 'sandbox', 'claude')}\n`);
  put('.beethoven/READY', '{"fake":true}\n');
  put('.beethoven/license.key', 'BEETHOVEN1.fake\n');
  put('sandbox/usr/local/bin/node', '#!/bin/sh\n', 0o755);
  put('sandbox/claude', '#!/bin/sh\n', 0o755);
  put('.beethoven/workers/w1/outbox/r1.json', '{"v":1,"id":"r1","status":"ok","result":"the answer"}');
  put('.beethoven/workers/w1/outbox/r1.events.jsonl', '{"type":"assistant"}\n');
  fs.mkdirSync(path.join(bh, 'workers', 'w1', 'inbox'), { recursive: true });
  const fakeBin = path.join(h, 'fakebin');
  fs.mkdirSync(fakeBin);
  const calls = path.join(h, 'sbatch.calls');
  fs.writeFileSync(path.join(fakeBin, 'sbatch'), `#!/bin/sh\necho "$@" >> '${calls}'\necho 4242\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'squeue'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'sacct'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'scancel'), '#!/bin/sh\n', { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: h, USER: os.userInfo().username, PATH: `${fakeBin}:${process.env.PATH}`, BEETHOVEN_LIBRARY: path.join(h, 'no-lab', 'beethoven') };
  for (const k of ['CLAUDECODE', 'BEETHOVEN_REQUEST_ID', 'BEETHOVEN_WORKER', 'ASHLEY_REQUEST_ID', 'ASHLEY_WORKER', 'BEETHOVEN_HOME', 'ASHLEY_HOME']) delete env[k];
  const cli = path.join(bin, 'beethoven');
  return {
    h, bh,
    run: (args: string[], input = '') => {
      // `tail -f` and `wait` keep going on a file they found: the timeout ends them, and what they printed counts
      const r = spawnSync('bash', [cli, ...args], { env, encoding: 'utf8', input, timeout: 5000, killSignal: 'SIGKILL' });
      return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
    },
    sbatchCalls: () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''),
    exists: (rel: string) => fs.existsSync(path.join(h, rel)),
    // what the sign-in folder holds; nothing may be added to it
    signin: () => fs.readdirSync(path.join(bh, 'claude')).sort(),
  };
}

const REQ = (id: string) => JSON.stringify({ v: 1, id, prompt: 'p', session: 's', mode: 'acceptEdits', created: '2026-10-07T00:00:00Z', from: 'test' });

test('result, tail and wait refuse a worker name or request id that leaves the worker folder, and hand over nothing', { skip }, () => {
  const l = lab();
  try {
    const before = l.signin();
    const cases: [string, string[]][] = [
      ['result, id up to the sign-in', ['result', '--worker', 'w1', '../../../claude/.credentials']],
      ['result, default worker', ['result', '../../../claude/.credentials']],
      ['result, absolute id', ['result', '--worker', 'w1', `${l.bh}/claude/.credentials`]],
      ['result, worker with a slash', ['result', '--worker', '../elsewhere', 'x']],
      ['tail, id up to the sign-in', ['tail', '--worker', 'w1', '../../../claude/planted']],
      ['wait, worker with a slash', ['wait', '--worker', '../elsewhere', 'x', '--timeout', '1']],
    ];
    for (const [what, args] of cases) {
      const r = l.run(args);
      assert.notEqual(r.status, 0, `${what}: refused (${r.out})`);
      assert.doesNotMatch(r.out, /FAKE-SECRET/, `${what}: nothing of the sign-in printed`);
      assert.match(r.out, /must be letters|request id/, `${what}: says why`);
    }
    assert.deepEqual(l.signin(), before, 'nothing added to the sign-in folder');
    // an answered request still comes back
    const ok = l.run(['result', '--worker', 'w1', 'r1']);
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /the answer/);
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('send and ask refuse a worker name that leaves the workers folder, and make nothing beside the sign-in', { skip }, () => {
  const l = lab();
  try {
    const before = l.signin();
    for (const args of [['send', '--worker', '../claude', '--json'], ['ask', '--worker', '../claude', '--json', '--timeout', '1'], ['send', '--worker', 'w1/../../claude', '--json']]) {
      const r = l.run(args, REQ('r9'));
      assert.notEqual(r.status, 0, `${args.join(' ')}: refused (${r.out})`);
      assert.match(r.out, /worker name must be letters/);
    }
    assert.equal(l.exists('.beethoven/claude/inbox'), false, 'no inbox in the sign-in folder');
    assert.equal(l.exists('.beethoven/claude/outbox'), false, 'no outbox in the sign-in folder');
    assert.deepEqual(l.signin(), before);
    // a request id is checked as before, and a good request is queued
    assert.notEqual(l.run(['send', '--worker', 'w1', '--json'], REQ('../x')).status, 0);
    const ok = l.run(['send', '--worker', 'w1', '--json'], REQ('r10'));
    assert.equal(ok.status, 0, ok.out);
    assert.ok(l.exists('.beethoven/workers/w1/inbox/r10.json'));
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('the relay answers ERROR to a crafted worker name or request id, prints nothing of the sign-in and queues nothing outside workers', { skip }, () => {
  const l = lab();
  try {
    const before = l.signin();
    const lines = [
      'RESULT w1 ../../../claude/.credentials',
      'RESULT ../elsewhere x',
      `RESULT w1 r1 ../../../claude/.credentials`,
      `SEND ../claude ${REQ('r11')}`,
      `SEND w1/../../claude ${REQ('r12')}`,
      'RESULT w1 r1',
      `SEND w1 ${REQ('r13')}`,
      'QUIT',
    ];
    const r = l.run(['relay'], lines.join('\n') + '\n');
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /FAKE-SECRET/, 'nothing of the sign-in on the wire');
    const out = r.out.trim().split('\n');
    assert.match(out[0], /^READY \d+ \d+$/);
    assert.deepEqual(out.slice(1, 6).map((x) => x.split(' ')[0]), ['ERROR', 'ERROR', 'ERROR', 'ERROR', 'ERROR'], out.join('\n'));
    assert.match(out[6], /^RESULT r1 .*the answer/);
    assert.match(out[7], /^QUEUED r13 \d+$/);
    assert.equal(l.exists('.beethoven/claude/inbox'), false, 'no inbox in the sign-in folder');
    assert.deepEqual(l.signin(), before);
    assert.ok(l.exists('.beethoven/workers/w1/inbox/r13.json'));
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('worker start takes only words and numbers into the job script, and a template it cannot render is never submitted', { skip }, () => {
  const l = lab();
  try {
    const good = ['worker', 'start', '--name', 'w2', '--hours', '24', '--cpus', '4', '--mem', '16G', '--concurrency', '2', '--partition', 'reqp', '--qos', 'requeue'];
    const set = (flag: string, value: string) => { const a = [...good]; const i = a.indexOf(flag); if (i < 0) a.push(flag, value); else a[i + 1] = value; return a; };
    const bad: [string, string][] = [
      ['--mem', '16G$(touch "$HOME/pwned")'],
      ['--mem', '16G\n#SBATCH --uid=0'],
      ['--cpus', '4;touch "$HOME/pwned"'],
      ['--concurrency', '2 ; touch "$HOME/pwned"'],
      ['--gpus', '1$(id)'],
      ['--partition', 'reqp|x'],
      ['--partition', 'reqp\n#SBATCH --x'],
      ['--qos', 'requeue$(id)'],
      ['--container', '../x'],
      ['--name', '../w3'],
    ];
    for (const [flag, value] of bad) {
      const r = l.run(set(flag, value));
      assert.notEqual(r.status, 0, `${flag} ${JSON.stringify(value)} refused (${r.out})`);
    }
    assert.equal(l.sbatchCalls(), '', 'nothing was submitted');
    assert.equal(l.exists('.beethoven/workers/w2/job.sbatch'), false, 'no job script was written');
    assert.equal(l.exists('pwned'), false);
    const ok = l.run(good);
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /submitted worker w2 as job 4242/);
    const job = fs.readFileSync(path.join(l.bh, 'workers', 'w2', 'job.sbatch'), 'utf8');
    assert.match(job, /^#SBATCH --mem=16G$/m);
    assert.match(job, /^#SBATCH --partition=reqp$/m);
    assert.match(l.run(set('--partition', 'gmsap,gvohp,galhp')).out, /already has job|submitted/, 'a list of partitions passes');
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});
