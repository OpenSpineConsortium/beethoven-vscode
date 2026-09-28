// Integration tests: run inside a real VS Code by @vscode/test-cli (npm run test:vscode).
// They do not touch the grid; they prove the extension activates, contributes what
// package.json promises, and that the wizard's checks run against this machine.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXT_ID = 'openspineconsortium.ashley-wsu';
const COMMANDS = [
  'ashley.setup', 'ashley.doctor', 'ashley.connect', 'ashley.workerStart', 'ashley.workerStop', 'ashley.workerLogs', 'ashley.ask',
  'ashley.gridStatus', 'ashley.gridBootstrap', 'ashley.access', 'ashley.registerMcp', 'ashley.claudeToken', 'ashley.manageTokens', 'ashley.openManual', 'ashley.openTerminal', 'ashley.reset', 'ashley.refresh',
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
    assert.deepEqual(steps, ['accessId', 'gridTwoFactor', 'sshKey', 'sshConfig', 'installKey', 'github', 'huggingface', 'claudeOauth', 'anthropicApiKey', 'gridInstall', 'labAccess']);
  });

  test('refresh and openManual run without throwing', async () => {
    await vscode.commands.executeCommand('ashley.refresh');
    await vscode.commands.executeCommand('ashley.openManual');
  });
});
