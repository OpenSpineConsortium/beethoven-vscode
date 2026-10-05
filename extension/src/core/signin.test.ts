// One rule for what counts as a Claude sign-in, in every place that judges one: the laptop
// (localClaudeStatus), phone access (grid/phone.js), the grid's own sitting (grid/beethoven signin-kind)
// and, through the heartbeat, the daemon (daemon.test.ts). Only a claude.ai sign-in with Anthropic as the
// provider and no API key behind it is a subscription; that is hpcworker's hpcw_claude_signin, which the
// browser and desktop editions follow, so the same answers are asked of it when its checkout is at hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { localClaudeStatus, stepClaudeGrid, WizardEnv } from './wizard';
import { judgedByOldRule } from './gridApi';

const repo = path.resolve(__dirname, '..', '..', '..', '..'); // dist-test/unit/core -> repository root
type Kind = 'subscription' | 'other' | 'none';
// what `claude auth status` prints, and what each of the shapes is
const SHAPES: [string, Record<string, unknown>, Kind][] = [
  ['a Claude subscription', { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'ab1234@wayne.edu', subscriptionType: 'max' }, 'subscription'],
  ['a Claude subscription, no provider named', { loggedIn: true, authMethod: 'claude.ai', email: 'ab1234@wayne.edu' }, 'subscription'],
  ['the Console\'s own key beside a claude.ai sign-in', { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', apiKeySource: '/login managed key' }, 'other'],
  ['a key from the environment', { loggedIn: true, authMethod: 'claude.ai', apiKeySource: 'ANTHROPIC_API_KEY' }, 'other'],
  ['a key source with no value', { loggedIn: true, authMethod: 'claude.ai', apiKeySource: null }, 'other'],
  ['a token from the environment', { loggedIn: true, authMethod: 'oauth_token' }, 'other'],
  ['an API key', { loggedIn: true, authMethod: 'api_key' }, 'other'],
  ['a cloud provider', { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' }, 'other'],
  ['not signed in', { loggedIn: false, authMethod: 'none' }, 'none'],
];

test('the laptop counts only a Claude subscription with no key behind it, and says so in plain words', { skip: process.platform === 'win32' && 'needs a POSIX shell' }, async () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-signin-'));
  try {
    const answer = path.join(h, 'answer.json');
    const fake = path.join(h, 'claude');
    fs.writeFileSync(fake, `#!/bin/sh\ncat '${answer}'\n`, { mode: 0o755 });
    for (const [what, j, kind] of SHAPES) {
      fs.writeFileSync(answer, JSON.stringify(j, null, 2) + '\n');
      const s = await localClaudeStatus(fake);
      assert.equal(s.ok, true, what);
      assert.equal(s.subscription, kind === 'subscription', what);
      assert.equal(s.loggedIn, kind !== 'none', what);
      if (kind === 'other') assert.equal(s.detail, 'signed in, but not with a Claude subscription', what);
    }
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('phone access counts only a Claude subscription with no key behind it', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isSubscription } = require(path.join(repo, 'grid', 'phone.js'));
  for (const [what, j, kind] of SHAPES) assert.equal(isSubscription(j), kind === 'subscription', what);
});

function bashKind(script: string[], json: string): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-signin-'));
  try {
    const r = spawnSync('bash', script, { input: json, encoding: 'utf8', env: { ...process.env, HOME: h, BEETHOVEN_HOME: path.join(h, '.beethoven') } });
    return r.stdout.trim() || `(exit ${r.status}: ${r.stderr.trim()})`;
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
}

test('the grid\'s own sign-in sitting judges the same way, on what Claude Code prints, folded or not', { skip: process.platform !== 'linux' && 'needs bash and GNU grep, as on the grid' }, () => {
  for (const [what, j, kind] of SHAPES) {
    assert.equal(bashKind([path.join(repo, 'grid', 'beethoven'), 'signin-kind'], JSON.stringify(j)), kind, what);
    assert.equal(bashKind([path.join(repo, 'grid', 'beethoven'), 'signin-kind'], JSON.stringify(j, null, 2)), kind, `${what}, over several lines`);
  }
});

// hpcworker's hpcw_claude_signin: a verbatim copy is kept with the tests and asked the same on every run; when
// HPCWORKER_DIR names a checkout, the copy must equal the function there, so a change of the rule fails here
const signinCopy = path.join(repo, 'extension', 'test-fixtures', 'hpcworker', 'hpcw_claude_signin.sh');
test('and hpcworker\'s hpcw_claude_signin (the copy kept with the tests) gives the same answers', { skip: process.platform !== 'linux' && 'needs bash and GNU grep, as on the grid' }, () => {
  for (const [what, j, kind] of SHAPES) assert.equal(bashKind(['-c', `source '${signinCopy}' >/dev/null 2>&1; hpcw_claude_signin`], JSON.stringify(j, null, 2)), kind, what);
});

const common = process.env.HPCWORKER_DIR ? path.join(process.env.HPCWORKER_DIR, 'framework', 'lib', 'adapters', 'common.sh') : '';
const fn = (text: string) => /^hpcw_claude_signin\(\) \{[\s\S]*?^\}$/m.exec(text)?.[0];
test('and that copy is hpcworker\'s own', { skip: common && fs.existsSync(common) ? false : 'set HPCWORKER_DIR to an hpcworker checkout to check the copy is current' }, () => {
  const theirs = fn(fs.readFileSync(common, 'utf8'));
  assert.ok(theirs, 'hpcworker declares hpcw_claude_signin');
  assert.equal(fn(fs.readFileSync(signinCopy, 'utf8')), theirs, 'hpcworker changed its rule: copy hpcw_claude_signin into test-fixtures/hpcworker/hpcw_claude_signin.sh and follow it in every judge here');
});

test('a running worker from before grid scripts 9 is "restart it" on the laptop, never "signed in"', { skip: process.platform === 'win32' && 'needs a POSIX shell' }, async () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-signin-'));
  const savedPath = process.env.PATH;
  try {
    // ssh as the grid answers `beethoven claude status --json`: the newest running worker's heartbeat
    const answer = path.join(h, 'answer.json');
    fs.writeFileSync(path.join(h, 'ssh'), `#!/bin/sh\ncat '${answer}'\n`, { mode: 0o755 });
    process.env.PATH = `${h}:${savedPath}`;
    const env = { settings: { sshAlias: 'wsu-grid' } } as unknown as WizardEnv;
    const login = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'ab1234@wayne.edu' };
    const cases: [string, Record<string, unknown> | null, boolean, string, RegExp][] = [
      // grid scripts 8's daemon, with or without a key behind the sign-in: no apiKey in what it reports
      ['a daemon of grid scripts 8', { ...login, subscription: true }, true, 'todo', /restart it/],
      ['grid scripts 9, a subscription', { ...login, subscription: true, apiKey: false }, false, 'done', /signed in on the grid as ab1234@wayne\.edu/],
      ['grid scripts 9, a key behind it', { ...login, subscription: false, apiKey: true }, false, 'failed', /not with a Claude subscription/],
      ['the sign-in ended', { loggedIn: false, subscription: false }, false, 'failed', /has ended/],
      ['no worker running', null, false, 'done', /a running worker will confirm it/],
    ];
    for (const [what, l, old, status, detail] of cases) {
      assert.equal(judgedByOldRule(l as never), old, what);
      fs.writeFileSync(answer, JSON.stringify({ dir_present: true, consent: false, login: l }) + '\n');
      const r = await stepClaudeGrid.check(env);
      assert.equal(r.status, status, `${what}: ${r.detail}`);
      assert.match(r.detail, detail, what);
    }
  } finally {
    process.env.PATH = savedPath;
    fs.rmSync(h, { recursive: true, force: true });
  }
});
