// beethoven.account: the engine's list is read and never written; a label that is not listed and enabled
// leaves the terminals on the usual sign-in and says why; a listed one gives them its directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ACCOUNT_LABEL, accountEnvironment, accountsFile, asLabel, chooseAccount, ensureAccountDir, readAccounts } from './accounts';

function home(list?: unknown): string {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-home-'));
  if (list !== undefined) {
    fs.mkdirSync(path.dirname(accountsFile(h)), { recursive: true });
    fs.writeFileSync(accountsFile(h), typeof list === 'string' ? list : JSON.stringify(list));
  }
  return h;
}

const LIST = {
  version: 1,
  accounts: [
    { label: 'main', path: '~/.beethoven/claude', enabled: true, order: 0, hibernate_until: null },
    { label: 'second', path: '/abs/accounts/second/claude', enabled: true, order: 1, hibernate_until: '2026-10-04T18:00:00Z' },
    { label: 'spent', path: '~/.beethoven/accounts/spent/claude', enabled: false, order: 2, hibernate_until: null },
  ],
};

test('the label pattern: lower-case letters, digits and hyphens, 1 to 32', () => {
  for (const ok of ['main', 'a', 'lab-2', '0123456789abcdef0123456789abcdef']) assert.ok(ACCOUNT_LABEL.test(ok), ok);
  for (const bad of ['', 'Main', 'my account', 'a_b', 'é', 'x'.repeat(33), 'main\n']) assert.ok(!ACCOUNT_LABEL.test(bad), JSON.stringify(bad));
});

test('the list is read as the engine wrote it, ~ expanded, bad rows dropped, in order', () => {
  const h = home({ accounts: [{ label: 'z', path: '/z', order: 5 }, { label: 'Bad Label', path: '/x' }, { label: 'noPath' }, { label: 'a', path: '~/a' }, 'junk', null] });
  try {
    const l = readAccounts(accountsFile(h), h);
    assert.ok(l.ok);
    if (!l.ok) return;
    assert.deepEqual(l.accounts.map((a) => a.label), ['a', 'z'], 'rows without a valid label or a path are dropped; order wins, then the label');
    assert.equal(l.accounts[0].path, path.join(h, 'a'));
    assert.equal(l.accounts[0].enabled, true, 'enabled defaults to true');
    assert.equal(l.accounts[1].order, 5);
    assert.equal(l.accounts[0].hibernateUntil, null);
    // a bare array is accepted too
    fs.writeFileSync(accountsFile(h), JSON.stringify([{ label: 'only', path: '/o' }]));
    const l2 = readAccounts(accountsFile(h), h);
    assert.ok(l2.ok && l2.accounts.length === 1);
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('the default: an empty setting means no variable, whatever the list says', () => {
  for (const h of [home(), home(LIST), home('{ not json')]) {
    try {
      const c = chooseAccount('', readAccounts(accountsFile(h), h));
      assert.deepEqual(c, { kind: 'default' });
      assert.deepEqual(accountEnvironment(c), {});
      assert.equal(asLabel(c), '');
      assert.deepEqual(chooseAccount('   ', readAccounts(accountsFile(h), h)), { kind: 'default' }, 'spaces are empty');
    } finally {
      fs.rmSync(h, { recursive: true, force: true });
    }
  }
});

test('a missing list: the label is not used and the problem names the label and both fixes', () => {
  const h = home();
  try {
    const l = readAccounts(accountsFile(h), h);
    assert.deepEqual(l, { ok: false, file: accountsFile(h), reason: 'missing', detail: 'no such file' });
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

test('a list that does not parse: not used, said plainly, never rewritten', () => {
  const h = home('{ "accounts": [ oops');
  try {
    const before = fs.readFileSync(accountsFile(h), 'utf8');
    const l = readAccounts(accountsFile(h), h);
    assert.ok(!l.ok && l.reason === 'unreadable');
    const c = chooseAccount('main', l);
    assert.equal(c.kind, 'invalid');
    if (c.kind === 'invalid') assert.match(c.problem, /could not be read/);
    // a file with no list in it is unreadable too
    fs.writeFileSync(accountsFile(h), JSON.stringify({ version: 1 }));
    const l2 = readAccounts(accountsFile(h), h);
    assert.ok(!l2.ok && l2.reason === 'unreadable' && /no "accounts" list/.test(l2.detail));
    fs.writeFileSync(accountsFile(h), before);
    assert.equal(fs.readFileSync(accountsFile(h), 'utf8'), before, 'the file is the engine\'s; reading changed nothing');
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('an unknown label, a disabled label and a label that is not one', () => {
  const h = home(LIST);
  try {
    const l = readAccounts(accountsFile(h), h);
    const unknown = chooseAccount('third', l);
    assert.equal(unknown.kind, 'invalid');
    if (unknown.kind === 'invalid') {
      assert.match(unknown.problem, /"third", which is not in your account list \(main, second, spent\)/);
      assert.match(unknown.problem, /"bee account add third"/);
    }
    const off = chooseAccount('spent', l);
    assert.equal(off.kind, 'invalid');
    if (off.kind === 'invalid') assert.match(off.problem, /turned off/);
    const bad = chooseAccount('Main', l);
    assert.equal(bad.kind, 'invalid');
    if (bad.kind === 'invalid') {
      assert.match(bad.problem, /not an account label/);
      assert.match(bad.problem, /bee account add <label>/, 'a label that is not one cannot be the one to add');
    }
    for (const c of [unknown, off, bad]) assert.deepEqual(accountEnvironment(c), {});
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('a listed, enabled label: the terminals get that directory and the label, and nothing else', () => {
  const h = home(LIST);
  try {
    const l = readAccounts(accountsFile(h), h);
    const c = chooseAccount('main', l);
    assert.deepEqual(c, { kind: 'account', label: 'main', path: path.join(h, '.beethoven', 'claude'), hibernateUntil: null });
    assert.deepEqual(accountEnvironment(c), { CLAUDE_CONFIG_DIR: path.join(h, '.beethoven', 'claude'), BEE_ACCOUNT: 'main' });
    assert.equal(asLabel(c), ', as main');
    const c2 = chooseAccount('second', l);
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

test('before a sign-in the account directory exists, new ones empty and private; an existing one is left alone', () => {
  const h = home(LIST);
  try {
    const l = readAccounts(accountsFile(h), h);
    const c = chooseAccount('main', l);
    assert.equal(c.kind, 'account');
    if (c.kind !== 'account') return;
    assert.ok(!fs.existsSync(c.path));
    ensureAccountDir(c);
    assert.ok(fs.statSync(c.path).isDirectory());
    assert.deepEqual(fs.readdirSync(c.path), [], 'empty: Claude Code writes its own files there');
    if (process.platform !== 'win32') assert.equal(fs.statSync(c.path).mode & 0o777, 0o700);
    fs.writeFileSync(path.join(c.path, 'marker'), 'theirs');
    ensureAccountDir(c);
    assert.equal(fs.readFileSync(path.join(c.path, 'marker'), 'utf8'), 'theirs', 'nothing inside is touched');
    ensureAccountDir({ kind: 'default' });
    ensureAccountDir({ kind: 'invalid', label: 'x', problem: 'y' });
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});
