// beethoven.account: the engine's list is read and never written; a label that is not listed leaves the
// terminals on the usual sign-in and says why; a listed one gives them its directory (or, at Claude Code's
// default place, its label alone); a remote window gets nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ACCOUNT_LABEL, DEFAULT_PLACE, accountEnvironment, accountPlace, accountsFile, asLabel, chooseAccount, ensureAccountDir, inheritedConfigDir, readAccounts } from './accounts';
import { stepClaudeLocal, WizardEnv } from './wizard';

// the engine's own lookup is honoured; the tests name an empty environment so the machine's own never leaks in
const file = (h: string) => accountsFile(h, {});

function home(list?: unknown | ((h: string) => unknown)): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-home-'));
  if (list !== undefined) {
    fs.mkdirSync(path.dirname(file(h)), { recursive: true });
    const v = typeof list === 'function' ? (list as (h: string) => unknown)(h) : list;
    fs.writeFileSync(file(h), typeof v === 'string' ? v : JSON.stringify(v));
  }
  return h;
}

/** what `bee account add` writes: absolute folders, or null for Claude Code's default place */
const LIST = (h: string) => ({
  version: 1,
  accounts: [
    { label: 'main', path: path.join(h, '.beethoven', 'claude'), enabled: true, order: 0, hibernate_until: null },
    { label: 'second', path: '/abs/accounts/second/claude', enabled: true, order: 1, hibernate_until: '2026-10-04T18:00:00Z' },
    { label: 'spent', path: path.join(h, '.beethoven', 'accounts', 'spent', 'claude'), enabled: false, order: 2, hibernate_until: null },
    { label: 'laptop', path: null, enabled: true, order: 3, hibernate_until: null },
  ],
});

/**
 * The file as it is now, with its modification time set in the past: the returned check fails if anything
 * since then changed a byte of it or wrote it at all (a rewrite of the same bytes moves the time too).
 */
function frozen(f: string): () => void {
  const past = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(f, past, past);
  const bytes = fs.readFileSync(f);
  return () => {
    assert.ok(fs.readFileSync(f).equals(bytes), 'the file is the engine\'s: reading it changed no byte');
    assert.equal(fs.statSync(f).mtimeMs, past.getTime(), 'the file is the engine\'s: reading it wrote nothing, not even the same bytes');
  };
}

test('the label rule is the engine\'s: lower-case letters, digits and hyphens, not starting with a hyphen, 1 to 32', () => {
  for (const ok of ['main', 'a', 'lab-2', '0-', '0123456789abcdef0123456789abcdef']) assert.ok(ACCOUNT_LABEL.test(ok), ok);
  for (const bad of ['', 'Main', 'my account', 'a_b', 'é', 'x'.repeat(33), 'main\n', '-work', '-lab', '-']) assert.ok(!ACCOUNT_LABEL.test(bad), JSON.stringify(bad));
});

test('the list is where the engine keeps it: BEE_REGISTRY_DIR, else BEETHOVEN_HOME/engine, else ~/.beethoven/engine', () => {
  const h = '/home/s';
  assert.equal(accountsFile(h, {}), path.join(h, '.beethoven', 'engine', 'accounts.json'));
  assert.equal(accountsFile(h, { BEETHOVEN_HOME: '/data/bee' }), path.join(path.resolve('/data/bee'), 'engine', 'accounts.json'));
  assert.equal(accountsFile(h, { BEETHOVEN_HOME: '/data/bee', BEE_REGISTRY_DIR: '~/reg' }), path.join(path.resolve(path.join(h, 'reg')), 'accounts.json'), 'the registry folder wins, ~ is the home');
});

test('the list is read as the engine wrote it, ~ expanded, rows the engine would refuse dropped, in order', () => {
  const rows = [
    { label: 'z', path: '/z', order: 5 },
    { label: 'Bad Label', path: '/x' },
    { label: '-dash', path: '/d' },
    { label: 'noPath' },
    { label: 'nopath' },
    { label: 'empty', path: '' },
    { label: 'relative', path: 'work-claude' },
    { label: 'dotted', path: './work-claude' },
    { label: 'number', path: 7 },
    { label: 'a', path: '~/a' },
    { label: 'laptop', path: null, order: 9 },
    'junk',
    null,
  ];
  const h = home({ accounts: rows });
  try {
    const l = readAccounts(file(h), h);
    assert.ok(l.ok);
    if (!l.ok) return;
    // without an order a row takes its place in the file: z (5), then a and laptop (9), by label
    assert.deepEqual(l.accounts.map((a) => a.label), ['z', 'a', 'laptop'], 'no valid label, a missing, empty, relative or non-text folder: dropped; order wins, then the label');
    assert.equal(l.accounts[0].order, 5);
    assert.equal(l.accounts[1].path, path.join(h, 'a'));
    assert.equal(l.accounts[1].enabled, true, 'enabled defaults to true');
    assert.equal(l.accounts[1].hibernateUntil, null);
    assert.equal(l.accounts[2].path, null, 'null is Claude Code\'s default place, kept as such');
    // a bare array is accepted too
    fs.writeFileSync(file(h), JSON.stringify([{ label: 'only', path: '/o' }]));
    const l2 = readAccounts(file(h), h);
    assert.ok(l2.ok && l2.accounts.length === 1);
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('the default: an empty setting means no variable, whatever the list says', () => {
  for (const h of [home(), home(LIST), home('{ not json')]) {
    try {
      const c = chooseAccount('', readAccounts(file(h), h));
      assert.deepEqual(c, { kind: 'default' });
      assert.deepEqual(accountEnvironment(c), {});
      assert.equal(asLabel(c), '');
      assert.deepEqual(chooseAccount('   ', readAccounts(file(h), h)), { kind: 'default' }, 'spaces are empty');
      assert.deepEqual(chooseAccount('', readAccounts(file(h), h), 'ssh-remote'), { kind: 'default' }, 'empty is empty in a remote window too');
    } finally {
      fs.rmSync(h, { recursive: true, force: true });
    }
  }
});

test('a missing list: the label is not used and the problem names the label and both fixes', () => {
  const h = home();
  try {
    const l = readAccounts(file(h), h);
    assert.deepEqual(l, { ok: false, file: file(h), reason: 'missing', detail: 'no such file' });
    const c = chooseAccount('main', l);
    assert.equal(c.kind, 'invalid');
    if (c.kind !== 'invalid') return;
    assert.equal(c.label, 'main');
    assert.match(c.problem, /no account list yet/);
    assert.match(c.problem, /Pick a label from your account list/);
    assert.match(c.problem, /"bee account add main"/);
    assert.match(c.problem, /usual sign-in/);
    assert.deepEqual(accountEnvironment(c), {}, 'nothing is set on a problem');
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('a list that does not parse: not used, said plainly, never written', () => {
  const h = home('{ "accounts": [ oops');
  try {
    let untouched = frozen(file(h));
    const l = readAccounts(file(h), h);
    untouched();
    assert.ok(!l.ok && l.reason === 'unreadable');
    const c = chooseAccount('main', l);
    assert.equal(c.kind, 'invalid');
    if (c.kind === 'invalid') assert.match(c.problem, /could not be read/);
    // a file with no list in it is unreadable too
    fs.writeFileSync(file(h), JSON.stringify({ version: 1 }));
    untouched = frozen(file(h));
    const l2 = readAccounts(file(h), h);
    chooseAccount('main', l2);
    untouched();
    assert.ok(!l2.ok && l2.reason === 'unreadable' && /no "accounts" list/.test(l2.detail));
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('an unknown label, a relative folder and a label that is not one leave the terminals alone', () => {
  const h = home((x: string) => ({ ...LIST(x), accounts: [...LIST(x).accounts, { label: 'work', path: 'work-claude', enabled: true, order: 4 }] }));
  try {
    const l = readAccounts(file(h), h);
    const unknown = chooseAccount('third', l);
    assert.equal(unknown.kind, 'invalid');
    if (unknown.kind === 'invalid') {
      assert.match(unknown.problem, /"third", which is not in your account list \(main, second, spent, laptop\)/);
      assert.match(unknown.problem, /"bee account add third"/);
    }
    const relative = chooseAccount('work', l);
    assert.equal(relative.kind, 'invalid', 'a relative folder would land in each terminal\'s working directory: the row is not offered');
    if (relative.kind === 'invalid') assert.match(relative.problem, /not in your account list/);
    for (const label of ['Main', '-work']) {
      const bad = chooseAccount(label, l);
      assert.equal(bad.kind, 'invalid');
      if (bad.kind === 'invalid') {
        assert.match(bad.problem, /not an account label/);
        assert.match(bad.problem, /not starting with a hyphen/);
        assert.match(bad.problem, /bee account add <label>/, 'a label that is not one cannot be the one to add');
      }
    }
    for (const c of [unknown, relative, chooseAccount('-work', l)]) assert.deepEqual(accountEnvironment(c), {});
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('a listed label: the terminals get that directory and the label, and nothing else; the file is only read', () => {
  const h = home(LIST);
  try {
    const untouched = frozen(file(h));
    const l = readAccounts(file(h), h);
    const c = chooseAccount('main', l);
    const c2 = chooseAccount('second', l);
    untouched();
    assert.deepEqual(c, { kind: 'account', label: 'main', path: path.join(h, '.beethoven', 'claude'), hibernateUntil: null, outOfRotation: false });
    assert.deepEqual(accountEnvironment(c), { CLAUDE_CONFIG_DIR: path.join(h, '.beethoven', 'claude'), BEE_ACCOUNT: 'main' });
    assert.equal(asLabel(c), ', as main');
    assert.equal(c2.kind, 'account');
    if (c2.kind === 'account') {
      assert.equal(c2.path, '/abs/accounts/second/claude', 'an absolute path is taken as is');
      assert.equal(c2.hibernateUntil, '2026-10-04T18:00:00Z', 'the rest the engine knows is carried, not interpreted');
    }
    // no credential variable ever appears in what the terminals get
    for (const k of Object.keys(accountEnvironment(c))) assert.ok(!/TOKEN|API_KEY/.test(k), k);
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('an account at Claude Code\'s default place: the label alone, as bee-use does, and no folder is made', () => {
  const h = home(LIST);
  try {
    const c = chooseAccount('laptop', readAccounts(file(h), h));
    assert.deepEqual(c, { kind: 'account', label: 'laptop', path: null, hibernateUntil: null, outOfRotation: false });
    assert.deepEqual(accountEnvironment(c), { BEE_ACCOUNT: 'laptop' }, 'CLAUDE_CONFIG_DIR stays unset');
    assert.equal(asLabel(c), ', as laptop');
    if (c.kind === 'account') assert.equal(accountPlace(c), DEFAULT_PLACE);
    ensureAccountDir(c);
    assert.ok(!fs.existsSync(path.join(h, '.claude')), 'nothing is made for the default place');
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('an account the engine took out of its rotation is still the student\'s to use and to sign in again', () => {
  const h = home(LIST);
  try {
    const c = chooseAccount('spent', readAccounts(file(h), h));
    assert.equal(c.kind, 'account', 'enabled is the rotation only: bee-use and bee account login ignore it');
    if (c.kind !== 'account') return;
    assert.equal(c.outOfRotation, true);
    assert.deepEqual(accountEnvironment(c), { CLAUDE_CONFIG_DIR: path.join(h, '.beethoven', 'accounts', 'spent', 'claude'), BEE_ACCOUNT: 'spent' });
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('a remote window: whatever the label, nothing of this laptop reaches its terminals, and it says why', () => {
  const h = home(LIST);
  try {
    const l = readAccounts(file(h), h);
    for (const label of ['main', 'third', '-work']) {
      const c = chooseAccount(label, l, 'ssh-remote');
      assert.equal(c.kind, 'remote', label);
      if (c.kind === 'remote') assert.match(c.problem, /remote window/);
      assert.deepEqual(accountEnvironment(c), {});
      assert.equal(asLabel(c), '');
    }
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('a CLAUDE_CONFIG_DIR VS Code was started with is said where the choice does not replace it', () => {
  const h = home(LIST);
  try {
    const l = readAccounts(file(h), h);
    const env = { CLAUDE_CONFIG_DIR: '/home/s/.beethoven/accounts/second/claude', BEE_ACCOUNT: 'second' };
    assert.equal(inheritedConfigDir(chooseAccount('main', l), env), '', 'a folder of its own replaces it');
    assert.match(inheritedConfigDir({ kind: 'default' }, env), /started with CLAUDE_CONFIG_DIR set to \/home\/s\/\.beethoven\/accounts\/second\/claude \(the account second\)/);
    assert.match(inheritedConfigDir(chooseAccount('laptop', l), env), new RegExp(`not ${DEFAULT_PLACE}`), 'the default place cannot be had while the variable is inherited');
    assert.equal(inheritedConfigDir(chooseAccount('main', l, 'wsl'), env), '', 'a remote window\'s terminals do not inherit the laptop\'s');
    assert.equal(inheritedConfigDir({ kind: 'default' }, {}), '');
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('before a sign-in the account directory exists, new ones empty and private; an existing one is left alone', () => {
  const h = home(LIST);
  try {
    const c = chooseAccount('main', readAccounts(file(h), h));
    assert.equal(c.kind, 'account');
    if (c.kind !== 'account' || c.path === null) return;
    const dir = c.path;
    assert.ok(!fs.existsSync(dir));
    ensureAccountDir(c);
    assert.ok(fs.statSync(dir).isDirectory());
    assert.deepEqual(fs.readdirSync(dir), [], 'empty: Claude Code writes its own files there');
    if (process.platform !== 'win32') assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    fs.writeFileSync(path.join(dir, 'marker'), 'theirs');
    ensureAccountDir(c);
    assert.equal(fs.readFileSync(path.join(dir, 'marker'), 'utf8'), 'theirs', 'nothing inside is touched');
    ensureAccountDir({ kind: 'default' });
    ensureAccountDir({ kind: 'invalid', label: 'x', problem: 'y' });
    ensureAccountDir({ kind: 'remote', label: 'x', problem: 'y' });
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

// The wizard's step asks a stand-in `claude` that answers by the folder it is started in: signed in at the
// default place, not signed in anywhere else. What it was started with is what the terminals would get.
test('the laptop sign-in step checks the environment the terminals get, and a label not applied fails nothing', { skip: process.platform === 'win32' }, async () => {
  const h = home(LIST);
  const saved = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, BEE_ACCOUNT: process.env.BEE_ACCOUNT };
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.BEE_ACCOUNT;
  try {
    const seen = path.join(h, 'seen');
    const fake = path.join(h, 'claude');
    fs.writeFileSync(
      fake,
      `#!/bin/sh\necho "\${CLAUDE_CONFIG_DIR:-default} \${BEE_ACCOUNT:-none}" >> '${seen}'\nif [ -n "$CLAUDE_CONFIG_DIR" ]; then echo '{"loggedIn":false}'; else echo '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty","email":"me@example.org","subscriptionType":"max"}'; fi\n`,
      { mode: 0o755 },
    );
    const l = readAccounts(file(h), h);
    const env = (label: string, remote?: string) => ({ settings: { account: label, claudeExecutable: fake }, accountChoice: () => chooseAccount(label, l, remote) }) as unknown as WizardEnv;
    const third = await stepClaudeLocal.check(env('third'));
    assert.equal(third.status, 'done', 'an unlisted label: the usual sign-in, which is signed in, decides');
    assert.match(third.detail, /signed in as me@example\.org \(max\)\. The Beethoven setting "account" names "third"/);
    const remote = await stepClaudeLocal.check(env('main', 'ssh-remote'));
    assert.equal(remote.status, 'done');
    assert.match(remote.detail, /remote window/);
    const main = await stepClaudeLocal.check(env('main'));
    assert.equal(main.status, 'todo');
    assert.match(main.detail, /not signed in, as main/);
    const laptop = await stepClaudeLocal.check(env('laptop'));
    assert.equal(laptop.status, 'done', 'the default place, under its label');
    assert.match(laptop.detail, /, as laptop$/);
    assert.deepEqual(fs.readFileSync(seen, 'utf8').trim().split('\n'), ['default none', 'default none', `${path.join(h, '.beethoven', 'claude')} main`, 'default laptop']);
    // a label not applied is never signed in at the usual place in its stead, even when that place is not signed in
    const out = path.join(h, 'claude-out');
    fs.writeFileSync(out, `#!/bin/sh\necho '{"loggedIn":false}'\n`, { mode: 0o755 });
    const asked: string[] = [];
    const ui = { confirm: async (m: string) => (asked.push(m), true), runInteractive: async () => 0, progress: () => undefined };
    const run = await stepClaudeLocal.run({ settings: { account: 'third', claudeExecutable: out }, accountChoice: () => chooseAccount('third', l), ui } as unknown as WizardEnv);
    assert.equal(run.status, 'todo');
    assert.match(run.detail, /not signed in\. The Beethoven setting "account" names "third"/);
    assert.deepEqual(asked, [], 'no sign-in was offered');
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    fs.rmSync(h, { recursive: true, force: true });
  }
});
