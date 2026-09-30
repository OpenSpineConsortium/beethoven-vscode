// Integration tests: run inside a real VS Code by @vscode/test-cli (npm run test:vscode).
// They do not touch the grid; they prove the extension activates, contributes what
// package.json promises, and that the wizard's checks run against this machine.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as L from '../../../grid/license.js';

const EXT_ID = 'openspineconsortium.beethoven';
const COMMANDS = [
  'beethoven.setup', 'beethoven.license', 'beethoven.doctor', 'beethoven.troubleshoot', 'beethoven.showLog', 'beethoven.investigate', 'beethoven.healthMenu', 'beethoven.connect', 'beethoven.workerStart', 'beethoven.workerStop', 'beethoven.workerLogs', 'beethoven.ask',
  'beethoven.gridStatus', 'beethoven.gridBootstrap', 'beethoven.access', 'beethoven.phone', 'beethoven.registerMcp', 'beethoven.claudeSignIn', 'beethoven.errorReports', 'beethoven.terms', 'beethoven.support', 'beethoven.manageTokens', 'beethoven.openManual', 'beethoven.openTerminal', 'beethoven.reset', 'beethoven.refresh',
  'beethoven.renewToken', 'beethoven.claudeLocalSignIn', 'beethoven.wsuSignIn',
];

suite('Beethoven for VS Code extension', () => {
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
    const c = vscode.workspace.getConfiguration('beethoven');
    assert.equal(c.get('loginHost'), 'warrior.grid.wayne.edu');
    assert.equal(c.get('sshAlias'), 'wsu-grid');
    assert.equal(c.get('nodeDomain'), 'nas.grid.wayne.edu');
    assert.equal(c.get('worker.partition'), 'reqp');
    assert.equal(c.get('worker.qos'), 'requeue');
    assert.equal(c.get('worker.hours'), 24);
  });

  // the rename (Ashley for VS Code 3.0.0 -> Beethoven for VS Code 4.0.0): settings still set under the
  // old name are read (the workspace fixture sets two), and the new name wins once it is set
  test('settings: a value still set under the old name (ashley.*) is read; the new name wins', () => {
    const store = (vscode.extensions.getExtension(EXT_ID)!.exports as any)._internal.storeFor();
    assert.equal(store.settings().gridRoot, '/rs/example/set-under-the-old-name', 'ashley.gridRoot from the workspace settings');
    assert.equal(store.config.source('gridRoot'), 'ashley');
    assert.equal(store.config.get('defaultSession', 'default'), 'set-under-the-new-name', 'beethoven.defaultSession wins over ashley.defaultSession');
    assert.equal(store.config.get('worker.hours', 1), 24, 'set under neither name: the default');
    const pj = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
    assert.ok(Object.keys(pj.contributes.configuration.properties).every((k: string) => k.startsWith('beethoven.')), 'only beethoven.* is declared (ashley.* would collide with Ashley itself)');
  });

  test('the command ids from before the rename (ashley.*) still run, as hidden aliases', async () => {
    let all: string[] = [];
    for (let i = 0; i < 50; i++) {
      all = await vscode.commands.getCommands(true);
      if (all.includes('ashley.refresh')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    for (const c of COMMANDS) assert.ok(all.includes(c.replace(/^beethoven\./, 'ashley.')), `alias of ${c}`);
    await vscode.commands.executeCommand('ashley.refresh');
    const pj = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
    assert.ok(pj.contributes.commands.every((c: any) => c.command.startsWith('beethoven.')), 'the palette offers only beethoven.*');
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

  // a fix button beside a failing check runs a command; every one it names must exist, and every
  // sign-in or token the wizard collects must have one (the same click-through as the Beethoven view)
  test('every fix button names a registered command, and the account checks have one', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const all = await vscode.commands.getCommands(true);
    const g = (ext.exports as any)._internal.buildGraph();
    for (const n of g) if (n.fixCommand) assert.ok(all.includes(n.fixCommand.command) && n.fixCommand.title, `${n.id}: fix command ${n.fixCommand.command} is not registered`);
    const byId = Object.fromEntries(g.map((n: any) => [n.id, n]));
    const want: Record<string, string> = { 'account.github': 'beethoven.renewToken', 'account.huggingface': 'beethoven.renewToken', 'account.claude': 'beethoven.claudeLocalSignIn', 'account.wsu': 'beethoven.wsuSignIn', 'account.license-identity': 'beethoven.wsuSignIn', 'laptop.license': 'beethoven.license', 'laptop.terms': 'beethoven.terms', 'grid.claude-login': 'beethoven.claudeSignIn' };
    for (const [id, cmd] of Object.entries(want)) assert.equal(byId[id]?.fixCommand?.command, cmd, `${id} has the fix button ${cmd}`);
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
    grid_etiquette: ['grid.login-tmp', 'grid.home-quota'],
  };
  test('every feature keeps its diagnostic nodes (pre-integration rule)', () => {
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const ids = new Set((ext.exports as any)._internal.buildGraph().map((n: any) => n.id));
    for (const [feature, need] of Object.entries(REQUIRED_BY_FEATURE)) for (const id of need) assert.ok(ids.has(id), `feature ${feature} lost its diagnostic node ${id}`);
    // publish the graph for docs/DIAGNOSTICS.md
    const g = (ext.exports as any)._internal.buildGraph().map((n: any) => ({ id: n.id, title: n.title, layer: n.layer, dependsOn: n.dependsOn, assumption: n.assumption, manualFix: n.manualFix, futureRisk: n.futureRisk ?? '', source: n.source ?? '', autoRepair: typeof n.repair === 'function', fixCommand: n.fixCommand ? { command: n.fixCommand.command, title: n.fixCommand.title } : null, slow: !!n.slow }));
    const fs = require('node:fs');
    const path = require('node:path');
    const out = path.resolve(__dirname, '..', '..', '..', '..', 'docs', 'diagnostics_graph.json');
    fs.writeFileSync(out, JSON.stringify({ features: REQUIRED_BY_FEATURE, nodes: g }, null, 1));
  });

  test('refresh and openManual run without throwing', async () => {
    await vscode.commands.executeCommand('beethoven.refresh');
    await vscode.commands.executeCommand('beethoven.openManual');
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
    const dir = process.env.BEETHOVEN_LICENSE_DIR!;
    assert.ok(fs.existsSync(path.join(dir, 'terms.json')), 'the record is on disk for the CLI and MCP server');
    assert.ok(fs.existsSync(path.join(dir, 'terms', String(rec.terms_version), 'LICENSE.txt')), 'the accepted text is kept beside the record');
    assert.equal(vscode.workspace.getConfiguration('beethoven').get('diagnostics.share'), 'on', 'the setting is what the dialog writes; the test wrote the record only');
  });

  test('without a license every gated command refuses and nothing runs; getting one still works', async () => {
    assert.equal(gate().check(true).status, 'missing');
    for (const c of ['beethoven.workerStop', 'beethoven.gridStatus', 'beethoven.connect', 'beethoven.registerMcp', 'beethoven.phone', 'beethoven.ask']) {
      assert.equal(await vscode.commands.executeCommand(c), REFUSED(), `${c} refused`);
    }
    assert.equal(gate().lastRefusal.command, 'beethoven.ask');
    assert.equal(await vscode.commands.executeCommand('ashley.workerStop'), REFUSED(), 'an old command id passes the same gate');
    assert.notEqual(await vscode.commands.executeCommand('beethoven.refresh'), REFUSED(), 'the tree can refresh');
    const ungated = (vscode.extensions.getExtension(EXT_ID)!.exports as any)._internal.UNGATED as Set<string>;
    for (const c of ['beethoven.setup', 'beethoven.license', 'beethoven.openManual', 'beethoven.showLog', 'beethoven.troubleshoot']) assert.ok(ungated.has(c), `${c} is not gated`);
  });

  test('a valid key is kept; the gate opens only once the Wayne State sign-in names the same person', async () => {
    // the test keys are Full Edition keys (edition 'student'): they are kept only once the Full Edition
    // agreement is on record, and the dialog that shows it cannot be clicked here
    const ext = vscode.extensions.getExtension(EXT_ID)!;
    const internal = (ext.exports as any)._internal;
    const ask = gate().requireFullTerms;
    gate().requireFullTerms = async () => false; // the person declined the Full Edition agreement
    const declined = await gate().set(issue('ab1234'));
    assert.equal(declined.ok, false);
    assert.match(declined.detail, /Full Edition agreement/);
    assert.equal(gate().key(), undefined, 'a declined Full Edition key is not stored');
    gate().requireFullTerms = ask;
    assert.equal(internal.terms.record('full'), undefined);
    const full = await internal.terms.accept('off', 'Test Person', 'full');
    assert.equal(full.edition, 'full');
    assert.match(full.affirmations[0].label, /Full Edition License Agreement/);
    assert.ok(require('node:fs').existsSync(require('node:path').join(process.env.BEETHOVEN_LICENSE_DIR!, 'terms-full.json')), 'the Full Edition record is on disk for the CLI');
    assert.ok(internal.terms.record(), 'the Trial Edition record is untouched');
    const c = await gate().set(`Your key:\n${issue('ab1234')}\n`);
    assert.equal(c.status, 'valid', c.detail);
    assert.equal(gate().allowed('beethoven.workerStop').ok, false, 'nobody signed in yet');
    assert.match(gate().allowed('beethoven.workerStop').reason, /sign-in/);
    await gate().recordIdentity({ accessId: 'ab1234', email: 'ab1234@wayne.edu' });
    assert.equal(gate().allowed('beethoven.workerStop').ok, true);
    const key = fs.readFileSync(path.join(process.env.BEETHOVEN_LICENSE_DIR!, 'license.key'), 'utf8');
    assert.match(key, /^ASHLEY1\./, 'stored where the CLI and the MCP server read it');
    const id = JSON.parse(fs.readFileSync(path.join(process.env.BEETHOVEN_LICENSE_DIR!, 'identity.json'), 'utf8'));
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
    assert.equal(gate().allowed('beethoven.workerStop').ok, true);
  });

  test('a key with the new prefix (BEETHOVEN1) is accepted like one with the old prefix (ASHLEY1)', async () => {
    const before = gate().key();
    // self-contained: the sign-in this test compares against. The test profile's VS Code state sometimes
    // loses the one recorded two tests earlier (2 of 12 runs of the 3.0.0 suite fail on it the same way)
    await gate().recordIdentity({ accessId: 'ab1234', email: 'ab1234@wayne.edu' });
    const k = L.signLicense({ kid: 'test', sub: 'ab1234', email: 'ab1234@wayne.edu', exp: Math.floor(Date.now() / 1000) + 30 * 86400 } as never, testKey(), { prefix: 'beethoven' });
    assert.match(k, /^BEETHOVEN1\./);
    const c = await gate().set(`Your key:\n${k}\n`);
    assert.equal(c.status, 'valid', c.detail);
    assert.match(gate().key(), /^BEETHOVEN1\./);
    assert.equal(gate().allowed('beethoven.workerStop').ok, true);
    if (before) assert.equal((await gate().set(before)).status, 'valid', 'the key from before again');
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
    assert.equal(await vscode.commands.executeCommand('beethoven.workerStop'), REFUSED());
  });
});
