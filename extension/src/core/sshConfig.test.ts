import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { upsertBlock, renderBlock, stripBlock, hasBlock, definesHost, nodeHost, remoteUri, BLOCK_START, BLOCK_END } from './sshConfig';
import { keyMadeByBeethoven } from './wizard';

const T = { accessId: 'ab1234', loginHost: 'warrior.grid.wayne.edu', alias: 'wsu-grid', nodeDomain: 'nas.grid.wayne.edu', identityFile: '~/.ssh/id_ed25519_wsu', includeGridAlias: true };

test('renderBlock carries the lines the grid needs', () => {
  const b = renderBlock(T);
  assert.match(b, /^# >>> beethoven/m);
  assert.match(b, /Host wsu-grid grid\n/);
  assert.match(b, /HostName warrior\.grid\.wayne\.edu/);
  assert.match(b, /User ab1234/);
  assert.match(b, /MACs \+hmac-sha1/); // Windows OpenSSH 9.5 refuses the grid without it
  assert.match(b, /AddressFamily inet/); // the IPv6 attempt costs 11 s per connection on Windows
  assert.match(b, /GSSAPIAuthentication no/);
  assert.match(b, /Host \*\.nas\.grid\.wayne\.edu/);
  assert.match(b, /ProxyJump wsu-grid/);
  assert.match(b, /IdentitiesOnly yes/);
  assert.ok(b.trimEnd().endsWith(BLOCK_END));
});

test('upsertBlock inserts first in an empty config', () => {
  const out = upsertBlock('', T);
  assert.ok(out.startsWith(BLOCK_START));
  assert.equal(hasBlock(out), true);
});

test('upsertBlock keeps existing hosts and puts the block first', () => {
  const existing = 'Host github.com\n    User git\n\nHost *\n    AddKeysToAgent yes\n';
  const out = upsertBlock(existing, T);
  assert.ok(out.startsWith(BLOCK_START));
  assert.ok(out.includes('Host github.com'));
  assert.ok(out.includes('Host *\n    AddKeysToAgent yes'));
  assert.ok(out.indexOf(BLOCK_END) < out.indexOf('Host github.com'));
});

test('upsertBlock is idempotent and replaces an old block', () => {
  const once = upsertBlock('Host other\n    User x\n', T);
  const twice = upsertBlock(once, T);
  assert.equal(twice, once);
  const changed = upsertBlock(once, { ...T, accessId: 'zz9999' });
  assert.ok(changed.includes('User zz9999'));
  assert.ok(!changed.includes('User ab1234'));
  assert.equal((changed.match(/# >>> beethoven/g) ?? []).length, 1);
});

test('the grid alias is not duplicated when the student already has Host grid', () => {
  const existing = 'Host grid\n    HostName grid.wayne.edu\n    User ab1234\n';
  const out = upsertBlock(existing, T);
  assert.match(out, /Host wsu-grid\n/);
  assert.equal(definesHost(out, 'grid'), true);
  assert.ok(!/Host wsu-grid grid\n/.test(out));
});

test('stripBlock removes exactly our block', () => {
  const s = upsertBlock('Host a\n    User b\n', T);
  assert.equal(stripBlock(s).trim(), 'Host a\n    User b');
});

test('node names become Remote-SSH hosts', () => {
  assert.equal(nodeHost('voh3', 'nas.grid.wayne.edu'), 'voh3.nas.grid.wayne.edu');
  assert.equal(nodeHost('asx1.nas.grid.wayne.edu', 'nas.grid.wayne.edu'), 'asx1.nas.grid.wayne.edu');
  assert.equal(remoteUri('voh3', 'nas.grid.wayne.edu', '/wsu/home/ab/ab12/ab1234'), 'vscode-remote://ssh-remote+voh3.nas.grid.wayne.edu/wsu/home/ab/ab12/ab1234');
  assert.throws(() => nodeHost('  ', 'x'));
});

test('the block hands scope back: the student\'s global lines below it stay global', () => {
  const targets = { alias: 'wsu-grid', includeGridAlias: false, loginHost: 'warrior.grid.wayne.edu', accessId: 'ab1234', identityFile: '~/.ssh/id_ed25519_wsu', nodeDomain: 'nas.grid.wayne.edu' };
  const block = renderBlock(targets);
  const lines = block.trim().split('\n');
  assert.equal(lines[lines.length - 1], BLOCK_END);
  assert.equal(lines[lines.length - 2], 'Match all', 'the last directive inside the block resets the scope');
  const merged = upsertBlock('Include config.d/*\nForwardAgent yes\n', targets);
  assert.ok(merged.indexOf('Match all') < merged.indexOf('Include config.d/*'), 'the old global lines follow the reset');
});

test('a block written before the rename (Ashley for VS Code) is replaced, never doubled', () => {
  const old = ['# >>> ashley (managed; rerun "Ashley: Set up" to change) >>>', 'Host wsu-grid grid', '    HostName warrior.grid.wayne.edu', '    User ab1234', '# <<< ashley <<<', '', 'Host github.com', '    User git', ''].join('\n');
  assert.equal(hasBlock(old), true, 'the old markers count as our block');
  const out = upsertBlock(old, T);
  assert.ok(out.startsWith(BLOCK_START));
  assert.equal((out.match(/^Host wsu-grid/gm) ?? []).length, 1, 'one Host wsu-grid block');
  assert.ok(!out.includes('# >>> ashley'), 'the old block is gone');
  assert.ok(out.includes('Host github.com'), 'the student\'s own lines stay');
  assert.equal(stripBlock(old).trim(), 'Host github.com\n    User git');
});

test('a start marker without its own end keeps every line after it: those hosts are the student\'s', () => {
  const lone = `Host a\n    User b\n${BLOCK_START}\nHost wsu-grid grid\n    HostName warrior.grid.wayne.edu\n\nHost github.com\n    User git\n`;
  assert.equal(stripBlock(lone), lone, 'nothing is dropped');
  const out = upsertBlock(lone, T);
  assert.ok(out.startsWith(BLOCK_START), 'the block goes first as always');
  assert.ok(out.includes('Host github.com\n    User git'), 'the host after the lone marker stays');
  assert.equal(upsertBlock(out, T), out, 'and stays put on the next run');
  // a lone start before a whole block: the lines between them stay too
  const two = `${BLOCK_START}\nHost mine\n    User me\n${renderBlock(T)}Host after\n`;
  const s = stripBlock(two);
  assert.ok(s.includes('Host mine') && s.includes('Host after'), s);
  assert.ok(!s.includes(BLOCK_END) && !s.includes('ProxyJump'), 'the whole block went');
});

test('Reset deletes a key only when the SSH key step made it: any other key at that path is the student\'s', () => {
  const body = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';
  assert.equal(keyMadeByBeethoven(`${body} ab1234@wayne.edu beethoven\n`), true, 'made by the step');
  assert.equal(keyMadeByBeethoven(`${body} ab1234@wayne.edu ashley\n`), true, 'made by the step before the rename');
  assert.equal(keyMadeByBeethoven(`${body} @wayne.edu beethoven\n`), true, 'made before an AccessID was set');
  for (const theirs of [`${body} student@laptop\n`, `${body} ab1234@wayne.edu\n`, `${body} ab1234@wayne.edu beethoven-not\n`, `${body}\n`, 'ssh-rsa AAAAB3Nza ab1234@wayne.edu beethoven\n', '']) {
    assert.equal(keyMadeByBeethoven(theirs), false, JSON.stringify(theirs));
  }
});

test('and it recognises what ssh-keygen writes with the step\'s own arguments', { skip: spawnSync('ssh-keygen', ['-?'], { encoding: 'utf8' }).error ? 'no ssh-keygen here' : false }, () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-key-'));
  try {
    const gen = (name: string, extra: string[]) => {
      const k = path.join(h, name);
      const r = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', ...extra, '-f', k], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return fs.readFileSync(k + '.pub', 'utf8');
    };
    assert.equal(keyMadeByBeethoven(gen('ours', ['-C', 'ab1234@wayne.edu beethoven'])), true); // stepSshKey's arguments
    assert.equal(keyMadeByBeethoven(gen('theirs', [])), false); // ssh-keygen's own default comment, user@host
  } finally {
    fs.rmSync(h, { recursive: true, force: true });
  }
});
