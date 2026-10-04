// beethoven.account: the engine's list is read and never written; a label that is not listed leaves the
// terminals on the usual sign-in and says why; a listed one gives them its directory (or, at Claude Code's
// default place, its label alone); a remote window gets nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ACCOUNT_LABEL, DEFAULT_PLACE, accountEnvironment, accountPlace, accountProcessEnv, accountValues, accountsFile, asLabel, chooseAccount, ensureAccountDir, inheritedConfigDir, readAccounts } from './accounts';
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
  assert.equal(accountsFile(h, { BEETHOVEN_HOME: '/data/bee', BEE_REGISTRY_DIR: '/data/reg' }), path.join(path.resolve('/data/reg'), 'accounts.json'), 'the registry folder wins');
  // the engine's os.path.abspath expands no ~, so neither does this: both read <working directory>/~/reg
  assert.equal(accountsFile(h, { BEE_REGISTRY_DIR: '~/reg' }), path.join(path.resolve('~/reg'), 'accounts.json'));
  assert.equal(accountsFile(h, { BEETHOVEN_HOME: '~/bee' }), path.join(path.resolve('~/bee'), 'engine', 'accounts.json'));
});

// Each refusal below is the engine's own: RegistryFile.model_validate_json of beethoven-research's bee/accounts.py
// refused every one of these files whole, and took the two lax ones (checked 2026-10-04).
test('a list the engine refuses is refused whole, with its reason; one it takes is read in its order', () => {
  const row = (label: string, p: unknown, order: unknown, more: Record<string, unknown> = {}) => ({ label, path: p, order, ...more });
  const refused: Array<[string, unknown, RegExp]> = [
    ['a folder with ~', { version: 1, accounts: [row('main', '/h/c', 0), row('work', '~/work', 1)] }, /"work" has no full path/],
    ['a relative folder', { version: 1, accounts: [row('work', 'work-claude', 0)] }, /"work" has no full path/],
    ['an empty folder', { version: 1, accounts: [row('work', '', 0)] }, /no full path/],
    ['no folder at all', { version: 1, accounts: [{ label: 'work', order: 0 }] }, /no full path/],
    ['a folder that is a number', { version: 1, accounts: [row('work', 7, 0)] }, /no full path/],
    ['no order', { version: 1, accounts: [{ label: 'main', path: '/h/c' }] }, /"main" has no place in the order/],
    ['a negative order', { version: 1, accounts: [row('main', '/h/c', -1)] }, /no place in the order/],
    ['a fractional order', { version: 1, accounts: [row('main', '/h/c', 1.5)] }, /no place in the order/],
    ['a label twice', { version: 1, accounts: [row('main', '/a', 0), row('main', '/b', 1)] }, /a label appears twice/],
    ['a folder twice', { version: 1, accounts: [row('a', '/same', 0), row('b', '/same', 1)] }, /one folder is listed under two labels/],
    ['the default place twice', { version: 1, accounts: [row('a', null, 0), row('b', null, 1)] }, /one folder is listed under two labels/],
    ['a label that is not one', { version: 1, accounts: [row('Main', '/a', 0)] }, /entry 1 has no valid label/],
    ['a label with a hyphen first', { version: 1, accounts: [row('-a', '/a', 0)] }, /no valid label/],
    ['a label of 33', { version: 1, accounts: [row('x'.repeat(33), '/a', 0)] }, /no valid label/],
    ['a field of a row it does not know', { version: 1, accounts: [row('a', '/a', 0, { note: 'mine' })] }, /"a" has a field the engine does not know \("note"\)/],
    ['a field of the file it does not know', { version: 1, accounts: [], owner: 'me' }, /does not know \("owner"\)/],
    ['another version', { version: 2, accounts: [] }, /a version other than 1/],
    ['a bare array', [row('a', '/a', 0)], /not the engine's list/],
    ['a row that is not an object', { version: 1, accounts: ['junk'] }, /entry 1 is not an account/],
    ['a null row', { version: 1, accounts: [null] }, /entry 1 is not an account/],
    ['accounts null', { version: 1, accounts: null }, /"accounts" is not a list/],
    ['enabled null', { version: 1, accounts: [row('a', '/a', 0, { enabled: null })] }, /neither enabled nor disabled/],
    ['a rest time without its zone', { version: 1, accounts: [row('a', '/a', 0, { hibernate_until: '2026-10-04T18:00:00' })] }, /rest time that is not a time with its zone/],
    ['a rest time that is no time', { version: 1, accounts: [row('a', '/a', 0, { hibernate_until: 'soon' })] }, /rest time/],
    ['a rest time as a number', { version: 1, accounts: [row('a', '/a', 0, { hibernate_until: 1759600000 })] }, /rest time/],
  ];
  const h = home({});
  try {
    for (const [what, body, why] of refused) {
      fs.writeFileSync(file(h), JSON.stringify(body));
      const l = readAccounts(file(h));
      assert.ok(!l.ok && l.reason === 'unreadable', `${what}: refused whole`);
      if (!l.ok) {
        assert.match(l.detail, why, what);
        assert.ok(!/~\/work|work-claude|\/h\/c|\/same/.test(l.detail), `${what}: the reason names no folder (it can reach an error report)`);
      }
      const c = chooseAccount('main', l);
      assert.equal(c.kind, 'invalid', `${what}: no label is applied from it`);
    }
    // what the engine takes: its own rows in any order, a missing version or list, and its lax values
    fs.writeFileSync(file(h), JSON.stringify({ accounts: [row('z', '/z', 5), row('a', '/a', '1', { enabled: 'no' }), row('laptop', null, 1, { hibernate_until: '2026-10-04T18:00:00+02:00' }), row('win', 'C:\\Users\\s\\claude', 7)] }));
    const l = readAccounts(file(h));
    assert.ok(l.ok, 'taken');
    if (!l.ok) return;
    assert.deepEqual(l.accounts.map((a) => a.label), ['a', 'laptop', 'z', 'win'], 'order wins, then the label');
    assert.equal(l.accounts[0].order, 1, '"1" is an order to the engine');
    assert.equal(l.accounts[0].enabled, false, '"no" is false to the engine');
    assert.equal(l.accounts[1].path, null, 'null is Claude Code\'s default place, kept as such');
    assert.equal(l.accounts[1].hibernateUntil, '2026-10-04T18:00:00+02:00');
    assert.equal(l.accounts[2].enabled, true, 'enabled defaults to true');
    // a Windows folder is a full path to the engine on any computer, but not one this computer can use
    const win = chooseAccount('win', l);
    if (process.platform !== 'win32') {
      assert.equal(win.kind, 'invalid');
      if (win.kind === 'invalid') assert.match(win.problem, /not a full path on this computer/);
    }
    fs.writeFileSync(file(h), JSON.stringify({ version: 1 }));
    assert.deepEqual(readAccounts(file(h)), { ok: true, file: file(h), accounts: [] }, 'no "accounts" is an empty list to the engine');
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('the default: an empty setting means no variable, whatever the list says', () => {
  for (const h of [home(), home(LIST), home('{ not json')]) {
    try {
      const c = chooseAccount('', readAccounts(file(h)));
      assert.deepEqual(c, { kind: 'default' });
      assert.deepEqual(accountEnvironment(c), {});
      assert.equal(asLabel(c), '');
      assert.deepEqual(chooseAccount('   ', readAccounts(file(h))), { kind: 'default' }, 'spaces are empty');
      assert.deepEqual(chooseAccount('', readAccounts(file(h)), 'ssh-remote'), { kind: 'default' }, 'empty is empty in a remote window too');
    } finally {
      fs.rmSync(h, { recursive: true, force: true });
    }
  }
});

test('a missing list: the label is not used and the problem names the label and both fixes', () => {
  const h = home();
  try {
    const l = readAccounts(file(h));
    assert.deepEqual(l, { ok: false, file: file(h), reason: 'missing', detail: 'no such file' });
    const c = chooseAccount('main', l);
    assert.equal(c.kind, 'invalid');
    if (c.kind !== 'invalid') return;
    assert.equal(c.label, 'main');
    assert.match(c.problem, /no account list yet/);
    assert.match(c.problem, /Pick a label from your account list/);
    assert.match(c.problem, /"bee account add main"/);
    assert.match(c.problem, /signs in as it would without the setting/);
    assert.deepEqual(accountEnvironment(c), {}, 'nothing is set on a problem');
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('a list that does not parse: not used, said plainly, never written', () => {
  const h = home('{ "accounts": [ oops');
  try {
    let untouched = frozen(file(h));
    const l = readAccounts(file(h));
    untouched();
    assert.ok(!l.ok && l.reason === 'unreadable');
    const c = chooseAccount('main', l);
    assert.equal(c.kind, 'invalid');
    if (c.kind === 'invalid') assert.match(c.problem, /could not be read/);
    // a list that is not one is unreadable too
    fs.writeFileSync(file(h), JSON.stringify({ version: 1, accounts: {} }));
    untouched = frozen(file(h));
    const l2 = readAccounts(file(h));
    chooseAccount('main', l2);
    untouched();
    assert.ok(!l2.ok && l2.reason === 'unreadable' && /"accounts" is not a list/.test(l2.detail));
    // V8 quotes a few characters of the file in some messages; the reason keeps only where it broke
    fs.writeFileSync(file(h), '{"accounts":[{"label":"a","path":"/data/jsmith/claude","order":0},]}');
    const l3 = readAccounts(file(h));
    assert.ok(!l3.ok && /^not valid JSON/.test(l3.detail));
    if (!l3.ok) assert.ok(!/jsmith|claude/.test(l3.detail), l3.detail);
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('an unknown label and a label that is not one leave the terminals alone', () => {
  const h = home(LIST);
  try {
    const l = readAccounts(file(h));
    const unknown = chooseAccount('third', l);
    assert.equal(unknown.kind, 'invalid');
    if (unknown.kind === 'invalid') {
      assert.match(unknown.problem, /"third", which is not in your account list \(main, second, spent, laptop\)/);
      assert.match(unknown.problem, /"bee account add third"/);
    }
    for (const label of ['Main', '-work']) {
      const bad = chooseAccount(label, l);
      assert.equal(bad.kind, 'invalid');
      if (bad.kind === 'invalid') {
        assert.match(bad.problem, /not an account label/);
        assert.match(bad.problem, /not starting with a hyphen/);
        assert.match(bad.problem, /bee account add <label>/, 'a label that is not one cannot be the one to add');
      }
    }
    for (const c of [unknown, chooseAccount('-work', l)]) assert.deepEqual(accountEnvironment(c), {});
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('a listed label: the terminals get that directory and the label, and nothing else; the file is only read', () => {
  const h = home(LIST);
  try {
    const untouched = frozen(file(h));
    const l = readAccounts(file(h));
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
    const c = chooseAccount('laptop', readAccounts(file(h)));
    assert.deepEqual(c, { kind: 'account', label: 'laptop', path: null, hibernateUntil: null, outOfRotation: false });
    assert.deepEqual(accountEnvironment(c), { BEE_ACCOUNT: 'laptop' }, 'CLAUDE_CONFIG_DIR stays unset');
    // Beethoven's own processes go further, as bee-use does: a folder VS Code was started with is taken away
    assert.deepEqual(accountProcessEnv(c), { CLAUDE_CONFIG_DIR: undefined, BEE_ACCOUNT: 'laptop' });
    assert.deepEqual(accountProcessEnv(chooseAccount('main', readAccounts(file(h)))), { CLAUDE_CONFIG_DIR: path.join(h, '.beethoven', 'claude'), BEE_ACCOUNT: 'main' });
    for (const other of [{ kind: 'default' } as const, chooseAccount('third', readAccounts(file(h)))]) assert.deepEqual(accountProcessEnv(other), {}, 'without an account nothing is set or taken away');
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
    const c = chooseAccount('spent', readAccounts(file(h)));
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
    const l = readAccounts(file(h));
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
    const l = readAccounts(file(h));
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

test('an error report is told every value of the accounts: the list\'s place, folders, labels, the setting and the inherited variables', () => {
  const h = home(LIST);
  try {
    const v = accountValues(' third ', readAccounts(file(h)), { CLAUDE_CONFIG_DIR: '/data/claude/jsmith', BEE_ACCOUNT: 'jsmith', HOME: '/home/s' });
    for (const want of [file(h), 'third', '/data/claude/jsmith', 'jsmith', 'main', path.join(h, '.beethoven', 'claude'), 'second', '/abs/accounts/second/claude', 'laptop']) assert.ok(v.includes(want), want);
    assert.ok(!v.includes('/home/s') && !v.includes(''), 'nothing else, and nothing empty');
    assert.deepEqual(accountValues('', { ok: false, file: '/r/accounts.json', reason: 'missing', detail: 'no such file' }, {}), ['/r/accounts.json']);
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('before a sign-in the account directory exists, new ones empty and private; an existing one is left alone', () => {
  const h = home(LIST);
  try {
    const c = chooseAccount('main', readAccounts(file(h)));
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
    const l = readAccounts(file(h));
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

// VS Code started from a shell after `bee-use main`: every terminal inherits main's folder, which the collection
// cannot take away. An account at the default place is still checked and signed in at the default place, never in
// main's folder under another label, and every detail says where the terminals' Claude Code really is.
test('an account at the default place is never checked or signed in inside a folder VS Code was started with', { skip: process.platform === 'win32' }, async () => {
  const h = home(LIST);
  const saved = { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, BEE_ACCOUNT: process.env.BEE_ACCOUNT };
  const main = path.join(h, '.beethoven', 'claude');
  process.env.CLAUDE_CONFIG_DIR = main;
  process.env.BEE_ACCOUNT = 'main';
  try {
    const seen = path.join(h, 'seen');
    const fake = path.join(h, 'claude');
    fs.writeFileSync(fake, `#!/bin/sh\necho "\${CLAUDE_CONFIG_DIR:-default} \${BEE_ACCOUNT:-none}" >> '${seen}'\necho '{"loggedIn":false}'\n`, { mode: 0o755 });
    const l = readAccounts(file(h));
    const asked: string[] = [];
    const terminals: Array<Record<string, string | undefined> | undefined> = [];
    const ui = { confirm: async (m: string) => (asked.push(m), true), runInteractive: async (_t: string, _c: string, _a: string[], env?: Record<string, string | undefined>) => (terminals.push(env), 0), progress: () => undefined };
    const env = (label: string) => ({ settings: { account: label, claudeExecutable: fake }, accountChoice: () => chooseAccount(label, l), ui }) as unknown as WizardEnv;
    const laptop = await stepClaudeLocal.check(env('laptop'));
    assert.equal(laptop.status, 'todo');
    assert.match(laptop.detail, new RegExp(`not signed in, as laptop\\. VS Code itself was started with CLAUDE_CONFIG_DIR set to ${main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(the account main\\), so Claude Code in its terminals uses that folder, not ${DEFAULT_PLACE}`));
    await stepClaudeLocal.run(env('laptop'));
    assert.match(asked[0], /keeps its own sign-in in its default place/);
    assert.deepEqual(terminals, [{ CLAUDE_CONFIG_DIR: undefined, BEE_ACCOUNT: 'laptop' }], 'the sign-in terminal has main\'s folder taken away');
    const third = await stepClaudeLocal.check(env('third'));
    assert.match(third.detail, /signs in as it would without the setting\. VS Code itself was started with CLAUDE_CONFIG_DIR set to .* to change that\.$/, 'an unlisted label says where that is');
    assert.deepEqual(fs.readFileSync(seen, 'utf8').trim().split('\n'), ['default laptop', 'default laptop', 'default laptop', `${main} main`], 'the label at the default place, the unlisted one where VS Code points');
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    fs.rmSync(h, { recursive: true, force: true });
  }
});
