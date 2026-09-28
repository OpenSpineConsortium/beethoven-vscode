// Integration tests: run inside a real VS Code by @vscode/test-cli (npm run test:vscode).
// They do not touch the grid; they prove the extension activates, contributes what
// package.json promises, and that the wizard's checks run against this machine.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as L from '../../../grid/license.js';

const EXT_ID = 'openspineconsortium.ashley';
const COMMANDS = [
  'ashley.setup', 'ashley.license', 'ashley.doctor', 'ashley.troubleshoot', 'ashley.showLog', 'ashley.investigate', 'ashley.healthMenu', 'ashley.connect', 'ashley.workerStart', 'ashley.workerStop', 'ashley.workerLogs', 'ashley.ask',
  'ashley.gridStatus', 'ashley.gridBootstrap', 'ashley.access', 'ashley.phone', 'ashley.registerMcp', 'ashley.claudeSignIn', 'ashley.errorReports', 'ashley.terms', 'ashley.support', 'ashley.manageTokens', 'ashley.openManual', 'ashley.openTerminal', 'ashley.reset', 'ashley.refresh',
];

suite('Ashley extension', () => {
  test('is present and activates', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `extension ${EXT_ID} not found`);
    await ext!.activate();
    assert.equal(ext!.isActive, true);
  });

  test('registers every command from package.json', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of COMMANDS) assert.ok(all.includes(c), `missing command ${c}`);
  });

  test('exposes the settings with sane defaults', () => {
    const c = vscode.workspace.getConfiguration('ashley');
    assert.equal(c.get('loginHost'), 'warrior.grid.wayne.edu');
    assert.equal(c.get('sshAlias'), 'wsu-grid');
    assert.equal(c.get('nodeDomain'), 'nas.grid.wayne.edu');
    assert.equal(c.get('worker.partition'), 'reqp');
    assert.equal(c.get('worker.qos'), 'requeue');
    assert.equal(c.get('worker.hours'), 24);
  });

  test('the wizard exports its steps in order', () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const steps = (ext.exports as any)._internal.STEPS.map((s: any) => s.id);
    assert.deepEqual(steps, ['wsuSignIn', 'license', 'github', 'huggingface', 'claudeLocal', 'gridTwoFactor', 'sshKey', 'sshConfig', 'installKey', 'gridInstall', 'labAccess', 'claudeGrid']);
  });

  test('the diagnostics graph is a valid DAG and every node documents its fix', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const g = (ext.exports as any)._internal.buildGraph();
    const { order } = (ext.exports as any)._internal;
    const o = order(g);
    assert.equal(o.length, g.length);
    for (const n of g) assert.ok(n.manualFix && n.assumption, `${n.id} documents its fix`);
    assert.ok(g.length >= 30, `graph has ${g.length} nodes`);
  });

  // The pre-integration rule, enforced: every feature keeps its diagnostic nodes. A new feature adds
  // its nodes to src/vscode/diagNodes.ts AND its ids here, or this test fails.
  const REQUIRED_BY_FEATURE: Record<string, string[]> = {
    wizard: ['account.wsu', 'account.github', 'account.huggingface', 'account.claude', 'laptop.ssh-key', 'laptop.ssh-config', 'network.grid-login'],
    grid_install: ['grid.scripts', 'grid.bashrc-block', 'grid.vscode-sysroot', 'grid.token-github', 'grid.token-hf', 'grid.claude-login'],
    workers: ['grid.slurm', 'grid.qos', 'grid.runtime', 'grid.container', 'grid.worker', 'grid.slurm-in-worker', 'node.probe'],
    relay: ['grid.relay', 'laptop.relay'],
    lab_access: ['grid.lab-access', 'grid.lab-folder', 'grid.slurm-visibility', 'grid.acl-tools'],
    remote_ssh: ['vscode.remote-ssh', 'vscode.remote-ssh-settings'],
    claude_bridge: ['vscode.claude-code', 'vscode.claude-binary', 'vscode.mcp-bridge'],
    phone: ['grid.phone'],
    accounts: ['grid.accounts'],
    licensing: ['laptop.terms', 'laptop.license', 'account.license-identity', 'grid.license'],
    claude_signin: ['account.claude', 'grid.claude-login'],
    token_capture: ['vscode.shell-integration', 'vscode.secret-storage'],
  };
  test('every feature keeps its diagnostic nodes (pre-integration rule)', () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const ids = new Set((ext.exports as any)._internal.buildGraph().map((n: any) => n.id));
    for (const [feature, need] of Object.entries(REQUIRED_BY_FEATURE)) for (const id of need) assert.ok(ids.has(id), `feature ${feature} lost its diagnostic node ${id}`);
    // publish the graph for docs/DIAGNOSTICS.md
    const g = (ext.exports as any)._internal.buildGraph().map((n: any) => ({ id: n.id, title: n.title, layer: n.layer, dependsOn: n.dependsOn, assumption: n.assumption, manualFix: n.manualFix, futureRisk: n.futureRisk ?? '', source: n.source ?? '', autoRepair: typeof n.repair === 'function', slow: !!n.slow }));
    const fs = require('node:fs');
    const path = require('node:path');
    const out = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'diagnostics_graph.json');
    fs.writeFileSync(out, JSON.stringify({ features: REQUIRED_BY_FEATURE, nodes: g }, null, 1));
  });

  test('refresh and openManual run without throwing', async () => {
    await vscode.commands.executeCommand('ashley.refresh');
    await vscode.commands.executeCommand('ashley.openManual');
  });

  // ---- the license gate ----------------------------------------------------------------------
  const testKey = () => {
    // test builds trust this key (esbuild --tests); releases never do (see package.test.ts)
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    return crypto.createPrivateKey(fs.readFileSync(path.join(ext.extensionPath, 'test-fixtures', 'license', 'test-signing-key.pem'), 'utf8'));
  };
  const issue = (sub: string, days = 30) => L.signLicense({ kid: 'test', sub, email: `${sub}@wayne.edu`, exp: Math.floor(Date.now() / 1000) + days * 86400 } as never, testKey());
  const gate = () => (vscode.extensions.getExtension(EXT_ID)!.exports as any)._internal.licenseGate();
  const REFUSED = () => (vscode.extensions.getExtension(EXT_ID)!.exports as any)._internal.REFUSED;

  test('before the terms are accepted, a command is refused without the license even being looked at', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    assert.equal((ext.exports as any)._internal.terms.record(), undefined, 'fresh profile: no acceptance recorded');
    // the dialog cannot be answered by a test: accept the way the dialog does
    const rec = await (ext.exports as any)._internal.terms.accept('off', 'Test Person');
    assert.equal((ext.exports as any)._internal.terms.record().diagnostics, 'off');
    // the record proves what was accepted: version, text hashes, every affirmation's exact wording, the name, the button
    assert.equal(rec.terms_version, (ext.exports as any)._internal.terms.version);
    assert.match(rec.license_sha256, /^[0-9a-f]{64}$/);
    assert.equal(rec.affirmations.length, 4);
    assert.ok(rec.affirmations.every((a: any) => a.checked && /I /.test(a.label)));
    assert.equal(rec.button_label, 'Accept and Continue');
    assert.equal(rec.signed_name, 'Test Person');
    const fs = require('node:fs');
    const path = require('node:path');
    const dir = process.env.ASHLEY_LICENSE_DIR!;
    assert.ok(fs.existsSync(path.join(dir, 'terms.json')), 'the record is on disk for the CLI and MCP server');
    assert.ok(fs.existsSync(path.join(dir, 'terms', String(rec.terms_version), 'LICENSE.txt')), 'the accepted text is kept beside the record');
    assert.equal(vscode.workspace.getConfiguration('ashley').get('diagnostics.share'), 'on', 'the setting is what the dialog writes; the test wrote the record only');
  });

  test('without a license every gated command refuses and nothing runs; getting one still works', async () => {
    assert.equal(gate().check(true).status, 'missing');
    for (const c of ['ashley.workerStop', 'ashley.gridStatus', 'ashley.connect', 'ashley.registerMcp', 'ashley.phone', 'ashley.ask']) {
      assert.equal(await vscode.commands.executeCommand(c), REFUSED(), `${c} refused`);
    }
    assert.equal(gate().lastRefusal.command, 'ashley.ask');
    assert.notEqual(await vscode.commands.executeCommand('ashley.refresh'), REFUSED(), 'the tree can refresh');
    const ungated = (vscode.extensions.getExtension(EXT_ID)!.exports as any)._internal.UNGATED as Set<string>;
    for (const c of ['ashley.setup', 'ashley.license', 'ashley.openManual', 'ashley.showLog', 'ashley.troubleshoot']) assert.ok(ungated.has(c), `${c} is not gated`);
  });

  test('a valid key is kept; the gate opens only once the Wayne State sign-in names the same person', async () => {
    const c = await gate().set(`Your key:\n${issue('ab1234')}\n`);
    assert.equal(c.status, 'valid', c.detail);
    assert.equal(gate().allowed('ashley.workerStop').ok, false, 'nobody signed in yet');
    assert.match(gate().allowed('ashley.workerStop').reason, /sign-in/);
    await gate().recordIdentity({ accessId: 'ab1234', email: 'ab1234@wayne.edu' });
    assert.equal(gate().allowed('ashley.workerStop').ok, true);
    const key = fs.readFileSync(path.join(process.env.ASHLEY_LICENSE_DIR!, 'license.key'), 'utf8');
    assert.match(key, /^ASHLEY1\./, 'stored where the CLI and the MCP server read it');
    const id = JSON.parse(fs.readFileSync(path.join(process.env.ASHLEY_LICENSE_DIR!, 'identity.json'), 'utf8'));
    assert.equal(id.accessId, 'ab1234');
  });

  test('a key for someone else, an altered key, and a key signed by an unknown key are refused and not stored', async () => {
    const before = gate().key();
    assert.equal((await gate().set(issue('cd5678'))).status, 'wrong-person');
    const k = issue('ab1234');
    assert.equal((await gate().set(k.slice(0, -4) + 'AAAA')).ok, false);
    const stranger = crypto.generateKeyPairSync('ed25519').privateKey;
    assert.equal((await gate().set(L.signLicense({ kid: 'k-stranger', sub: 'ab1234', exp: Math.floor(Date.now() / 1000) + 86400 } as never, stranger))).status, 'unknown-key');
    assert.equal((await gate().set('not a key')).status, 'invalid');
    assert.equal(gate().key(), before, 'the good key is still the one stored');
    assert.equal(gate().allowed('ashley.workerStop').ok, true);
  });

  test('the wizard signs in first, then the access step reports the stored key', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    assert.equal((ext.exports as any)._internal.STEPS[0].id, 'wsuSignIn');
    const step = (ext.exports as any)._internal.STEPS[1];
    assert.equal(step.id, 'license');
    const env = { license: gate(), settings: {}, ui: {} };
    const r = await step.check(env);
    assert.equal(r.status, 'done', r.detail);
    assert.match(r.detail, /license L-/);
  });

  test('removing the key closes the gate again', async () => {
    await gate().remove();
    assert.equal(gate().check(true).status, 'missing');
    assert.equal(await vscode.commands.executeCommand('ashley.workerStop'), REFUSED());
  });
});
