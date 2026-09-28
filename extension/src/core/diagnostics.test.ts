import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiagNode, order, runDiagnostics, formatReport } from './diagnostics';

type Ctx = { broken: Set<string>; repaired: string[] };
const node = (id: string, deps: string[] = [], extra: Partial<DiagNode<Ctx>> = {}): DiagNode<Ctx> => ({
  id,
  title: id,
  layer: 'laptop',
  dependsOn: deps,
  assumption: `${id} works`,
  manualFix: `fix ${id}`,
  async check(c) {
    return c.broken.has(id) ? { ok: false, detail: `${id} broken` } : { ok: true, detail: `${id} ok` };
  },
  ...extra,
});

test('order is topological and refuses unknown dependencies and cycles', () => {
  const o = order([node('c', ['b']), node('b', ['a']), node('a')]).map((n) => n.id);
  assert.deepEqual(o, ['a', 'b', 'c']);
  assert.throws(() => order([node('a', ['missing'])]), /unknown missing/);
  assert.throws(() => order([node('a', ['b']), node('b', ['a'])]), /cycle/);
});

test('a failure blocks its dependents and is named as their root cause', async () => {
  const ctx: Ctx = { broken: new Set(['ssh']), repaired: [] };
  const rep = await runDiagnostics([node('openssh'), node('ssh', ['openssh']), node('grid', ['ssh']), node('worker', ['grid']), node('tokens')], ctx);
  const by = Object.fromEntries(rep.reports.map((r) => [r.id, r]));
  assert.equal(by.openssh.status, 'ok');
  assert.equal(by.ssh.status, 'fail');
  assert.equal(by.grid.status, 'blocked');
  assert.equal(by.worker.status, 'blocked');
  assert.equal(by.worker.rootCause, 'ssh');
  assert.equal(by.tokens.status, 'ok');
  assert.deepEqual(rep.rootCauses.map((r) => r.id), ['ssh']);
  assert.equal(rep.ok, false);
  assert.match(formatReport(rep), /ROOT CAUSE ssh/);
});

test('a safe repair runs, is re-checked, and unblocks the rest', async () => {
  const ctx: Ctx = { broken: new Set(['ext']), repaired: [] };
  const ext = node('ext', [], {
    async repair(c) {
      c.broken.delete('ext');
      c.repaired.push('ext');
      return { ok: true, detail: 'installed' };
    },
  });
  const rep = await runDiagnostics([ext, node('uses-ext', ['ext'])], ctx, { repair: true });
  const by = Object.fromEntries(rep.reports.map((r) => [r.id, r]));
  assert.equal(by.ext.status, 'repaired');
  assert.equal(by['uses-ext'].status, 'ok');
  assert.equal(rep.ok, true);
  assert.deepEqual(ctx.repaired, ['ext']);
});

test('a repair that does not fix it keeps the failure and says so', async () => {
  const ctx: Ctx = { broken: new Set(['x']), repaired: [] };
  const x = node('x', [], { async repair() { return { ok: true, detail: 'tried' }; } });
  const rep = await runDiagnostics([x], ctx, { repair: true });
  assert.equal(rep.reports[0].status, 'fail');
  assert.match(rep.reports[0].detail, /still fails/);
});

test('crashes and timeouts become failures, slow nodes skip in a quick sweep, skips propagate', async () => {
  const ctx: Ctx = { broken: new Set(), repaired: [] };
  const crash = node('crash', [], { async check() { throw new Error('boom'); } });
  const hang = node('hang', [], { async check() { return new Promise(() => {}); } });
  const slow = node('slow', [], { slow: true });
  const na = node('admin-only', [], { async check() { return { ok: true, detail: 'student', skip: true }; } });
  const child = node('admin-child', ['admin-only']);
  const rep = await runDiagnostics([crash, hang, slow, na, child], ctx, { quick: true, timeoutMs: 200 });
  const by = Object.fromEntries(rep.reports.map((r) => [r.id, r]));
  assert.equal(by.crash.status, 'fail');
  assert.match(by.crash.detail, /boom/);
  assert.equal(by.hang.status, 'fail');
  assert.match(by.hang.detail, /timed out/);
  assert.equal(by.slow.status, 'skipped');
  assert.equal(by['admin-only'].status, 'skipped');
  assert.equal(by['admin-child'].status, 'skipped');
});
