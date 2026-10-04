// The error-report scrubber: what must never leave the laptop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, buildSharedReport, worthSending, signature } from './diagReport';
import type { DiagReport } from './diagnostics';

const ctx = { accessId: 'go2432', email: 'gregory.schwing@med.wayne.edu', home: 'C:\\Users\\grego', words: ['DESKTOP-ABC', 'grego'] };

test('identity, paths, hosts, tokens and addresses are replaced', () => {
  const s = scrub('user go2432: ssh go2432@warrior.grid.wayne.edu failed for gregory.schwing@med.wayne.edu; key C:\\Users\\grego\\.ssh\\id_ed25519_wsu; home /wsu/home/go/go24/go2432/.beethoven; node asx1 job 40486902 at 10.0.0.5; token sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123456789 and ghp_abcdefghijklmnopqrstuvwxyz0123456789 and ASHLEY1.eyJhbGciOiJFZDI1NTE5In0abcdefghijklmnop.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmUtc2lnbmF0dXJl', ctx);
  for (const bad of ['go2432', 'gregory.schwing', 'med.wayne.edu', 'C:\\Users', 'grego\\.ssh', '/wsu/home', 'asx1', '40486902', '10.0.0.5', 'sk-ant-oat01', 'ghp_', 'ASHLEY1.', 'DESKTOP-ABC']) {
    assert.ok(!s.includes(bad), `${bad} must not survive: ${s}`);
  }
  for (const good of ['<id>', '<email>', '<path>', '<host>', 'job <n>', '<ip>', '<token>']) assert.ok(s.includes(good), `${good} placeholder present: ${s}`);
});

test('a license key or list of either prefix is replaced', () => {
  for (const p of ['ASHLEY1', 'BEETHOVEN1', 'ASHLEYREV1', 'BEETHOVENREV1']) {
    const s = scrub(`key ${p}.eyJ2IjoxLCJraWQiOiJrMSJ9abcdefgh.c2lnbmF0dXJlLXNpZ25hdHVyZS1zaWduYXR1cmU here`, {});
    assert.ok(!s.includes(p + '.'), `${p} must not survive: ${s}`);
    assert.ok(s.includes('<token>'));
  }
});

test('an AccessID pattern is replaced even when it is not the known one; ordinary words survive', () => {
  const s = scrub('user ab1234 and cd5678 could not read the lab folder; QoS requeue; partition secp', {});
  assert.ok(!/ab1234|cd5678/.test(s));
  assert.ok(/lab folder/.test(s) && /requeue/.test(s) && /secp/.test(s));
});

test('the shared report carries verdicts and scrubbed details, and only failures are worth sending', () => {
  const rep: DiagReport = {
    started: '2026-09-28T10:00:00Z',
    finished: '2026-09-28T10:00:20Z',
    ok: false,
    rootCauses: [],
    reports: [
      { id: 'laptop.os', title: 'OS', layer: 'laptop', status: 'ok', detail: 'Windows for go2432', ms: 1 },
      { id: 'network.grid-login', title: 'Login', layer: 'network', status: 'fail', detail: 'Permission denied for go2432@warrior.grid.wayne.edu', manualFix: 'x', ms: 2000 },
      { id: 'grid.scripts', title: 'Scripts', layer: 'grid-login', status: 'blocked', detail: 'waits on Login', rootCause: 'network.grid-login', ms: 0 },
    ],
  };
  rep.rootCauses = [rep.reports[1]];
  const out = buildSharedReport(rep, { installId: '11111111-2222-4333-8444-555555555555', product: 'beethoven-vscode', version: '4.0.0', vscode: '1.139.1', os: 'win32 10.0', arch: 'x64', errorLines: ['ERROR beethoven.ask: ssh go2432@warrior: timeout'] }, ctx);
  assert.equal(out.nodes[0].detail, '', 'passing checks carry no detail');
  assert.ok(!JSON.stringify(out).includes('go2432'), 'no AccessID anywhere');
  assert.ok(!JSON.stringify(out).includes('warrior.grid'), 'no hostname anywhere');
  assert.deepEqual(out.root_causes, ['network.grid-login']);
  assert.equal(out.nodes[2].root_cause, 'network.grid-login');
  assert.match(out.errors[0], /<id>@<host>/);
  assert.equal(out.signature, signature(rep.reports));
  assert.equal(worthSending(rep), true);
  assert.equal(worthSending({ ...rep, ok: true, rootCauses: [], reports: rep.reports.map((r) => ({ ...r, status: 'ok' as const })) }), false);
});

test('the Claude accounts\' labels and folders and the variables VS Code was started with are replaced whole', () => {
  // what account.choice says when VS Code came from a shell after `bee-use`, outside the paths the patterns know
  const detail = 'as laptop: Claude Code\'s default place; VS Code itself was started with CLAUDE_CONFIG_DIR set to /data/claude/jsmith-personal (the account jsmith-personal), so Claude Code in its terminals uses that folder; the domain remains, and so does the account main.';
  const s = scrub(detail, { ...ctx, values: ['jsmith-personal', '/data/claude/jsmith-personal', 'laptop', 'main'] });
  for (const bad of ['/data/claude', 'jsmith', 'laptop']) assert.ok(!s.includes(bad), `${bad} must not survive: ${s}`);
  assert.match(s, /set to <id> \(the account <id>\)/, 'the folder is replaced whole before the label inside it');
  assert.match(s, /as <id>: Claude Code's default place/);
  assert.match(s, /the account <id>\.$/);
  assert.match(s, /the domain remains/, 'whole values only: the label main leaves "domain" and "remains" alone');
});
