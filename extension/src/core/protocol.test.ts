import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRequest, newRequestId, looksRateLimited, parseResetTime } from './protocol';
import { parseSqueue, parseSbatchId, workerStartArgs, describeWall } from './slurm';
import { normaliseAccessId, gridHome, SERVICES } from './services';
import { shq, shjoin } from './shell';

test('request ids sort by time and are filesystem safe', () => {
  const a = newRequestId(new Date('2026-09-27T23:59:00Z'));
  const b = newRequestId(new Date('2026-09-28T00:00:00Z'));
  assert.ok(a < b);
  assert.match(a, /^[A-Za-z0-9_.-]+$/);
});

test('makeRequest fills defaults', () => {
  const r = makeRequest({ prompt: 'hi', from: 'test' });
  assert.equal(r.v, 1);
  assert.equal(r.session, 'default');
  assert.equal(r.mode, 'acceptEdits');
  assert.equal(r.max_turns, 50);
  assert.equal(r.attempt, 1);
});

test('rate-limit detection matches the messages Claude Code prints', () => {
  assert.equal(looksRateLimited("You've hit your limit. Your limit will reset at 3pm."), true);
  assert.equal(looksRateLimited('API Error: 429 rate_limit_error'), true);
  assert.equal(looksRateLimited('Failed to authenticate: OAuth session expired and could not be refreshed'), false);
  assert.equal(looksRateLimited('OK'), false);
  assert.equal(looksRateLimited(undefined), false);
});

test('reset time parsing', () => {
  const now = new Date('2026-09-27T12:00:00');
  assert.equal(parseResetTime('try again in 2 hours', now), new Date('2026-09-27T14:00:00').toISOString());
  const t = parseResetTime('Your limit will reset at 3pm', now)!;
  assert.equal(new Date(t).getHours(), 15);
  const early = parseResetTime('resets 9am', now)!;
  assert.equal(new Date(early).getDate(), 28); // tomorrow
  assert.equal(parseResetTime('no time here', now), null);
});

test('squeue parsing', () => {
  const rows = parseSqueue('40481725_1|armb_t1f_gpu|RUNNING|voh3|3:05:12|3-00:00:00|gvohp|None\n40486313|ashley_probe1|PENDING|(null)|0:00|1:30:00|reqp|(Priority)\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].node, 'voh3');
  assert.equal(rows[1].node, '');
  assert.equal(rows[1].reason, '(Priority)');
  assert.equal(parseSbatchId('Submitted batch job 40486327'), '40486327');
  assert.equal(parseSbatchId('40486327;cluster'), '40486327');
  assert.equal(parseSbatchId('sbatch: error'), null);
  assert.equal(describeWall('1-00:00:00'), '24 h 00 min');
  assert.equal(describeWall('3-00:00:00'), '3.0 days');
});

test('worker start args switch to the GPU partitions', () => {
  const cpu = workerStartArgs({ name: 'a', partition: 'reqp', qos: 'requeue', hours: 24, cpus: 4, memory: '16G', gpus: 0, concurrency: 2 });
  assert.ok(cpu.includes('reqp') && cpu.includes('requeue') && !cpu.includes('--gpus'));
  const gpu = workerStartArgs({ name: 'a', partition: 'reqp', qos: 'requeue', hours: 24, cpus: 4, memory: '16G', gpus: 1, concurrency: 2 });
  assert.ok(gpu.includes('gmsap,gvohp,galhp') && gpu.includes('gpu'));
});

test('AccessID normalisation and grid home', () => {
  assert.equal(normaliseAccessId(' AB1234 '), 'ab1234');
  assert.equal(normaliseAccessId('ab1234@wayne.edu'), 'ab1234');
  assert.equal(normaliseAccessId('gregory'), null);
  assert.equal(gridHome('go2432'), '/wsu/home/go/go24/go2432');
});

test('token patterns accept real shapes and reject junk', () => {
  const gh = SERVICES.find((s) => s.id === 'github')!;
  assert.ok(gh.pattern!.test('ghp_' + 'a'.repeat(36)));
  assert.ok(!gh.pattern!.test('https://github.com/settings/tokens'));
  const claude = SERVICES.find((s) => s.id === 'claudeOauth')!;
  assert.ok(claude.pattern!.test('sk-ant-oat01-' + 'x'.repeat(40)));
  assert.ok(!claude.pattern!.test('sk-ant-api03-' + 'x'.repeat(40)));
  assert.equal(SERVICES.find((s) => s.id === 'anthropicApiKey')!.injectLocally, false);
});

test('remote quoting is single-layer POSIX', () => {
  assert.equal(shq("it's"), `'it'\\''s'`);
  assert.equal(shjoin(['a b', 'c']), `'a b' 'c'`);
});
