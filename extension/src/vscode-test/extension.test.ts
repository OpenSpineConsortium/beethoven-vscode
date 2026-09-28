// Integration tests: run inside a real VS Code by @vscode/test-cli (npm run test:vscode).
// They do not touch the grid; they prove the extension activates, contributes what
// package.json promises, and that the wizard's checks run against this machine.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXT_ID = 'openspineconsortium.ashley-wsu';
const COMMANDS = [
  'ashley.setup', 'ashley.doctor', 'ashley.troubleshoot', 'ashley.showLog', 'ashley.investigate', 'ashley.healthMenu', 'ashley.connect', 'ashley.workerStart', 'ashley.workerStop', 'ashley.workerLogs', 'ashley.ask',
  'ashley.gridStatus', 'ashley.gridBootstrap', 'ashley.access', 'ashley.phone', 'ashley.registerMcp', 'ashley.claudeToken', 'ashley.manageTokens', 'ashley.openManual', 'ashley.openTerminal', 'ashley.reset', 'ashley.refresh',
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
    assert.deepEqual(steps, ['wsuSignIn', 'github', 'huggingface', 'claudeOauth', 'gridTwoFactor', 'sshKey', 'sshConfig', 'installKey', 'gridInstall', 'labAccess']);
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
    grid_install: ['grid.scripts', 'grid.bashrc-block', 'grid.vscode-sysroot', 'grid.token-github', 'grid.token-hf', 'grid.token-claude'],
    workers: ['grid.slurm', 'grid.qos', 'grid.runtime', 'grid.container', 'grid.worker', 'grid.slurm-in-worker', 'node.probe'],
    relay: ['grid.relay', 'laptop.relay'],
    lab_access: ['grid.lab-access', 'grid.lab-folder', 'grid.slurm-visibility', 'grid.acl-tools'],
    remote_ssh: ['vscode.remote-ssh', 'vscode.remote-ssh-settings'],
    claude_bridge: ['vscode.claude-code', 'vscode.claude-binary', 'vscode.mcp-bridge'],
    phone: ['grid.phone'],
    accounts: ['grid.accounts'],
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
});
