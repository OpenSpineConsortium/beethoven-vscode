// The packaged extension, as a student receives it: unpacked from the .vsix (tools/release.mjs),
// readable but without source maps, trusting only the release signing keys. Run: npx vscode-test --label package
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as L from '../../../grid/license.js';

const EXT_ID = 'openspineconsortium.beethoven';
const here = __dirname; // extension/dist-test/vscode/vscode-test
const repo = path.resolve(here, '..', '..', '..', '..');

suite('Beethoven as packaged', () => {
  const ext = () => vscode.extensions.getExtension(EXT_ID)!;
  const internal = () => (ext().exports as any)._internal;

  test('activates from the release bundle, with the notice and without source maps', async () => {
    assert.ok(ext(), 'installed');
    await ext().activate();
    assert.ok(ext().isActive);
    assert.equal(ext().packageJSON.license, 'SEE LICENSE IN LICENSE.txt');
    const js = fs.readFileSync(path.join(ext().extensionPath, 'dist', 'extension.js'), 'utf8');
    assert.match(js.slice(0, 300), /Licensed software/);
    assert.ok(!/sourceMappingURL/.test(js), 'no source map reference');
    for (const f of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'dist/grid/license.js', 'dist/grid/license_keys.json']) assert.ok(fs.existsSync(path.join(ext().extensionPath, f)), `${f} shipped`);
    assert.ok(!fs.existsSync(path.join(ext().extensionPath, 'test-fixtures')), 'no test fixtures');
    assert.ok(!fs.readdirSync(path.join(ext().extensionPath, 'dist')).some((f) => f.endsWith('.map')), 'no .map files');
  });

  test('refuses to work without a license', async () => {
    await internal().terms.accept('off');
    assert.equal(internal().licenseGate().check(true).status, 'missing');
    assert.equal(await vscode.commands.executeCommand('beethoven.workerStop'), internal().REFUSED);
    assert.equal(await vscode.commands.executeCommand('beethoven.gridStatus'), internal().REFUSED);
  });

  test('does not trust the test signing key', async () => {
    const testKey = crypto.createPrivateKey(fs.readFileSync(path.join(repo, 'extension', 'test-fixtures', 'license', 'test-signing-key.pem'), 'utf8'));
    const k = L.signLicense({ kid: 'test', sub: 'ab1234', exp: Math.floor(Date.now() / 1000) + 86400 } as never, testKey);
    const c = await internal().licenseGate().set(k);
    assert.equal(c.status, 'unknown-key', 'a release build must refuse keys signed with the test key');
  });

  test('accepts a key issued with the release key, for the person it names', async function () {
    const key = process.env.BEETHOVEN_RELEASE_TEST_LICENSE;
    if (!key) return this.skip();
    const g = internal().licenseGate();
    const c = await g.set(key);
    assert.equal(c.ok, true, c.detail);
    const sub = c.payload.sub;
    assert.equal(g.allowed('beethoven.workerStop').ok, false, 'not before the sign-in');
    await g.recordIdentity({ accessId: sub, email: `${sub}@wayne.edu` });
    assert.equal(g.allowed('beethoven.workerStop').ok, true);
    await g.recordIdentity({ accessId: 'zz0001', email: 'zz0001@wayne.edu' });
    assert.equal(g.allowed('beethoven.workerStop').ok, false, 'someone else signed in');
    await g.remove();
  });
});
