import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRequest, newRequestId, looksRateLimited, parseResetTime } from './protocol';
import { parseSqueue, parseSbatchId, workerStartArgs, describeWall } from './slurm';
import { normaliseAccessId, gridHome, SERVICES, extractWrappedToken } from './services';
import { shq, shjoin, renderRemote, remotePath, gridCli, gridCliLine, GRID_HOME_PICK } from './shell';

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
  const rows = parseSqueue('40481725_1|armb_t1f_gpu|RUNNING|voh3|3:05:12|3-00:00:00|gvohp|None\n40486313|beethoven_probe1|PENDING|(null)|0:00|1:30:00|reqp|(Priority)\n');
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
  assert.equal(SERVICES.find((s) => s.id === ('claudeOauth' as string)), undefined, 'Beethoven stores no Claude credential');
  assert.equal(SERVICES.find((s) => s.id === 'anthropicApiKey')!.injectLocally, false);
});

test('remote quoting is single-layer POSIX', () => {
  assert.equal(shq("it's"), `'it'\\''s'`);
  assert.equal(shjoin(['a b', 'c']), `'a b' 'c'`);
});

test('every ~/ argument expands on the grid; nothing else does', () => {
  // the first install ran mkdir with quoted '~/...' paths and made a folder literally named '~'
  assert.equal(renderRemote(['mkdir', '-p', '~/.beethoven/bin', '~/.beethoven/log']), `'mkdir' '-p' ~/'.beethoven/bin' ~/'.beethoven/log'`);
  assert.equal(renderRemote(['~/.beethoven/bin/beethoven', 'status']), `~/'.beethoven/bin/beethoven' 'status'`);
  assert.equal(renderRemote(['echo', '$USER', 'a~/b', '~']), `'echo' '$USER' 'a~/b' ~`);
  assert.equal(remotePath("~/it's here"), `~/'it'\\''s here'`);
});

test('the grid command: the new path first, the one before the rename as the fallback', () => {
  const argv = gridCli(['status', '--json']);
  assert.deepEqual(argv.slice(0, 2), ['bash', '-c']);
  assert.deepEqual(argv.slice(3), ['beethoven', 'status', '--json'], 'the arguments reach the command as "$@"');
  assert.match(argv[2], /^b=\$HOME\/\.beethoven\/bin\/beethoven; \[ -x \$b \] \|\| b=\$HOME\/\.ashley\/bin\/ashley; exec \$b "\$@"$/);
  // one argument over ssh: the script is quoted once, the arguments each once
  assert.equal(renderRemote(argv).split("' '").length, 6);
  const line = gridCliLine(['claude', 'login']);
  assert.ok(line.endsWith(`exec $b 'claude' 'login'`));
  assert.ok(!line.includes('"'), 'no double quotes: the line passes through Windows argument quoting unchanged');
  assert.ok(!GRID_HOME_PICK.includes('"'));
  assert.match(GRID_HOME_PICK, /h=\$HOME\/\.beethoven;.*h=\$HOME\/\.ashley;$/);
});

test('a token is captured whole: across chunks and across hard line wraps', () => {
  const pat = /sk-ant-oat[A-Za-z0-9_\-]{20,}/;
  const tok = 'sk-ant-oat01-' + 'A1b2C3d4E5'.repeat(9) + '-xY_z';
  // unwrapped, still arriving: not complete until a following line exists
  assert.deepEqual(extractWrappedToken('Your token:\n' + tok.slice(0, 40), pat), { token: tok.slice(0, 40), complete: false });
  assert.deepEqual(extractWrappedToken('Your token:\n' + tok + '\n\nStore it safely.\n', pat), { token: tok, complete: true });
  // hard-wrapped at 60 columns by the terminal UI, with trailing padding
  const w = 60;
  const wrapped = tok.match(new RegExp(`.{1,${w}}`, 'g'))!.map((l, i, a) => (i < a.length - 1 ? l : l.padEnd(10, ' '))).join('\n');
  assert.deepEqual(extractWrappedToken('Your token:\n' + wrapped + '\n\nStore it safely.\n', pat), { token: tok, complete: true });
  // Claude Code prints a blank line after the token, which ends it. (A one-word line directly after an
  // unwrapped token would look like a wrap and be glued on; the token check then fails and Renew asks again.)
  assert.deepEqual(extractWrappedToken('x\n' + tok + '\n\nDone\n', pat), { token: tok, complete: true });
  // the token followed by text on the same line
  assert.deepEqual(extractWrappedToken(`token=${tok} (keep it)\n`, pat), { token: tok, complete: true });
});
