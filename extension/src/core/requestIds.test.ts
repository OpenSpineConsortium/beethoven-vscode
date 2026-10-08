// The laptop's half of the worker-name and request-id check. beethoven_result and beethoven_send hand the
// laptop's Claude a worker name and an id, which become file names on the grid; up to grid scripts 9 an id like
// ../../../claude/.credentials came back with the Claude sign-in in it, by a fresh ssh and over the relay alike.
// The laptop refuses such a value before ssh or the relay sees it, so it holds against grid scripts that do not
// check (an account not yet updated). The end-to-end cases run the real grid script behind a stand-in ssh, in a
// made-up home holding a FAKE sign-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { checkRequestId, checkWorkerName, makeRequest, newRequestId } from './protocol';
import { workerStartArgs, WorkerJobSpec } from './slurm';
import { GridApi } from './gridApi';
import { GridRelay } from './relay';

const repo = path.resolve(__dirname, '..', '..', '..', '..'); // dist-test/unit/core -> repository root
const skip = process.platform === 'linux' ? false : 'needs bash, as on the grid';
const CRAFTED_IDS = ['../../../claude/.credentials', '/home/x/.beethoven/claude/.credentials', 'r1 ../x', 'r1\nRESULT default ../x', '', 'a/b', '~/x', 'r1\0'];
const CRAFTED_WORKERS = ['../claude', 'w1/../../claude', 'w.1', '..', '', 'w1 x', 'w1\nPING', '~'];

test('worker names and request ids: plain words pass, anything that could leave the worker folder or the line does not', () => {
  for (const w of ['default', 'w1', 'gpu_2', 'my-project']) assert.equal(checkWorkerName(w), w);
  for (const id of ['r1', '20261007T223300-abc123', 'a.b', 'A_B-c.d']) assert.equal(checkRequestId(id), id);
  for (const w of [...CRAFTED_WORKERS, 5, null, undefined]) assert.throws(() => checkWorkerName(w), /worker name/, JSON.stringify(w));
  for (const id of [...CRAFTED_IDS, 5, null, undefined]) assert.throws(() => checkRequestId(id), /request id/, JSON.stringify(id));
  for (let i = 0; i < 50; i++) checkRequestId(newRequestId());
  checkRequestId(makeRequest({ prompt: 'p', from: 't' }).id);
});

test('worker start values that the job script would run are refused before anything is sent', () => {
  const good: WorkerJobSpec = { name: 'w1', partition: 'reqp', qos: 'requeue', hours: 24, cpus: 4, memory: '16G', gpus: 0, concurrency: 2 };
  assert.ok(workerStartArgs(good).includes('16G'));
  for (const memory of ['16GB', '512M', '512mb', '2T', '16000']) assert.ok(workerStartArgs({ ...good, memory }).includes(memory), memory);
  assert.ok(workerStartArgs({ ...good, partition: 'secp,reqp', memory: '512M', container: 'node22-bookworm' }).includes('secp,reqp'));
  // with a GPU the partition and qos are the fixed GPU ones, whatever the settings say
  assert.ok(workerStartArgs({ ...good, gpus: 1, partition: 'ignored' }).includes('gmsap,gvohp,galhp'));
  const bad: Partial<WorkerJobSpec>[] = [
    { name: '../w' }, { memory: '16G$(id)' }, { memory: '16G\n#SBATCH --x' }, { memory: '' }, { memory: 'G' }, { memory: '16GBB' }, { partition: 'reqp|x' }, { partition: 'reqp,' },
    { qos: 'requeue;id' as WorkerJobSpec['qos'] }, { container: '../x' }, { container: 'a b' },
    { hours: 0 }, { hours: 1.5 }, { cpus: 0 }, { cpus: NaN }, { gpus: -1 }, { concurrency: 0 }, { cpus: '4;id' as unknown as number },
  ];
  for (const b of bad) assert.throws(() => workerStartArgs({ ...good, ...b }), Error, JSON.stringify(b));
});

function grid() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-ids-'));
  const put = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(h, rel)), { recursive: true });
    fs.writeFileSync(path.join(h, rel), body);
  };
  const bin = path.join(h, '.beethoven', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const f of ['beethoven', 'VERSION']) fs.copyFileSync(path.join(repo, 'grid', f), path.join(bin, f));
  fs.chmodSync(path.join(bin, 'beethoven'), 0o755);
  put('.beethoven/claude/.credentials.json', '{"claudeAiOauth":{"accessToken":"FAKE-SECRET-FOR-TESTS"}}');
  put('.beethoven/workers/default/outbox/r1.json', '{"v":1,"id":"r1","status":"ok","result":"the answer"}');
  fs.mkdirSync(path.join(h, '.beethoven', 'workers', 'default', 'inbox'));
  // ssh as the grid runs it: the remote line goes to the login shell
  const fakeBin = path.join(h, 'fakebin');
  fs.mkdirSync(fakeBin);
  const sshLog = path.join(h, 'ssh.calls');
  fs.writeFileSync(path.join(fakeBin, 'ssh'), `#!/bin/sh\necho x >> '${sshLog}'\nwhile [ "$1" != "--" ]; do shift; done; shift\nexec bash -c "$1"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'squeue'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'sacct'), '#!/bin/sh\n', { mode: 0o755 });
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = `${fakeBin}:${saved.PATH}`;
  process.env.HOME = h;
  return {
    h,
    sshCalls: () => (fs.existsSync(sshLog) ? fs.readFileSync(sshLog, 'utf8').split('\n').filter(Boolean).length : 0),
    signin: () => fs.readdirSync(path.join(h, '.beethoven', 'claude')).sort(),
    done: () => {
      process.env.PATH = saved.PATH;
      process.env.HOME = saved.HOME;
      fs.rmSync(h, { recursive: true, force: true });
    },
  };
}

test('GridApi refuses a crafted id or worker for result, send and ask, by a fresh ssh, before ssh runs', { skip }, async () => {
  const g = grid();
  try {
    const api = new GridApi('wsu-grid');
    for (const id of CRAFTED_IDS) {
      await assert.rejects(api.result(id, 'default'), /request id/, JSON.stringify(id));
    }
    for (const w of CRAFTED_WORKERS) {
      await assert.rejects(api.result('r1', w), /worker name/, JSON.stringify(w));
      await assert.rejects(api.send({ prompt: 'p' }, w), /worker name/, JSON.stringify(w));
      await assert.rejects(api.ask({ prompt: 'p' }, w, 10), /worker name/, JSON.stringify(w));
    }
    await assert.rejects(api.send({ prompt: 'p', id: '../x' }, 'default'), /request id/);
    for (const id of CRAFTED_IDS) await assert.rejects(api.ask({ prompt: 'p', id }, 'default', 10), /request id/, `ask ${JSON.stringify(id)}`);
    assert.equal(g.sshCalls(), 0, 'nothing reached ssh');
    assert.deepEqual(g.signin(), ['.credentials.json'], 'nothing added to the sign-in folder');
    // an answered request still comes back
    const r = await api.result('r1', 'default');
    assert.equal(r?.result, 'the answer');
    assert.equal(g.sshCalls(), 1);
    const bad = await api.workerStart({ name: 'w1', partition: 'reqp', qos: 'requeue', hours: 24, cpus: 4, memory: '16G$(id)', gpus: 0, concurrency: 2 });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /memory/);
    assert.equal(g.sshCalls(), 1, 'a refused start sends nothing');
  } finally {
    g.done();
  }
});

test('the relay refuses a crafted id or worker before it opens or writes a line, and GridApi does not fall back to ssh with it', { skip }, async () => {
  const g = grid();
  const relay = new GridRelay('wsu-grid');
  try {
    for (const id of CRAFTED_IDS) await assert.rejects(relay.result(id, 'default'), /request id/, JSON.stringify(id));
    for (const w of CRAFTED_WORKERS) {
      await assert.rejects(relay.result('r1', w), /worker name/, JSON.stringify(w));
      await assert.rejects(relay.send(makeRequest({ prompt: 'p', from: 't' }), w), /worker name/, JSON.stringify(w));
      await assert.rejects(relay.ask(makeRequest({ prompt: 'p', from: 't' }), w, 10), /worker name/, JSON.stringify(w));
    }
    await assert.rejects(relay.send(makeRequest({ prompt: 'p', from: 't', id: '../x' }), 'default'), /request id/);
    for (const id of CRAFTED_IDS) await assert.rejects(relay.ask(makeRequest({ prompt: 'p', from: 't', id }), 'default', 10), /request id/, `relay ask ${JSON.stringify(id)}`);
    assert.equal(g.sshCalls(), 0, 'the relay was never opened');
    const api = new GridApi('wsu-grid', () => {}, relay);
    await assert.rejects(api.result('../../../claude/.credentials', 'default'), /request id/);
    assert.equal(g.sshCalls(), 0, 'no fresh ssh either');
    // the real relay answers a good one
    const r = await relay.result('r1', 'default');
    assert.equal(r?.result, 'the answer');
    assert.deepEqual(g.signin(), ['.credentials.json']);
  } finally {
    relay.close();
    g.done();
  }
});
