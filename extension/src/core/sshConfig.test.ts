import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertBlock, renderBlock, stripBlock, hasBlock, definesHost, nodeHost, remoteUri, BLOCK_START, BLOCK_END } from './sshConfig';

const T = { accessId: 'ab1234', loginHost: 'warrior.grid.wayne.edu', alias: 'wsu-grid', nodeDomain: 'nas.grid.wayne.edu', identityFile: '~/.ssh/id_ed25519_wsu', includeGridAlias: true };

test('renderBlock carries the lines the grid needs', () => {
  const b = renderBlock(T);
  assert.match(b, /^# >>> ashley/m);
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
  assert.equal((changed.match(/# >>> ashley/g) ?? []).length, 1);
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
