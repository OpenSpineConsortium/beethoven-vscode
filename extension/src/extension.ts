// Ashley: VS Code entry point. UI and OS integration only; the logic lives in src/core.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AshleyStore } from './vscode/store';
import { VsCodeUI } from './vscode/ui';
import { AshleyTree } from './vscode/tree';
import { registerMcp, isMcpRegistered } from './vscode/mcpRegister';
import { runWizard, checkAll, StepReport, testConnection, STEPS } from './core/wizard';
import { GridApi } from './core/gridApi';
import { SERVICES, SecretId } from './core/services';
import { remoteUri } from './core/sshConfig';
import { gridHome } from './core/services';
import { WorkerJobSpec, describeWall } from './core/slurm';
import { AshleyResult } from './core/protocol';

let output: vscode.OutputChannel;
let store: AshleyStore;
let tree: AshleyTree;

export async function activate(context: vscode.ExtensionContext): Promise<{ _internal: typeof _internal }> {
  output = vscode.window.createOutputChannel('Ashley');
  store = new AshleyStore(context);
  const grid = () => new GridApi(store.settings().sshAlias, (l) => output.appendLine(l));
  tree = new AshleyTree(store, grid);
  context.subscriptions.push(output, vscode.window.registerTreeDataProvider('ashley.status', tree));

  // 1. Every integrated terminal gets the tokens (except ANTHROPIC_API_KEY; see store.ts).
  try {
    const names = await store.hydrateEnvironment();
    if (names.length) output.appendLine(`environment: ${names.join(', ')}`);
  } catch (e) {
    output.appendLine(`environment hydration failed: ${e}`);
  }

  const reg = (id: string, fn: (...a: any[]) => Promise<unknown> | unknown) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...a: any[]) => {
        try {
          return await fn(...a);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          output.appendLine(`ERROR ${id}: ${msg}`);
          void vscode.window.showErrorMessage(`Ashley: ${msg}`, 'Show log').then((c) => c && output.show());
        }
      }),
    );

  reg('ashley.setup', () => commandSetup(context));
  reg('ashley.doctor', () => commandDoctor(context));
  reg('ashley.connect', (item?: any) => commandConnect(grid(), item?.data?.name));
  reg('ashley.workerStart', () => commandWorkerStart(grid()));
  reg('ashley.workerStop', (item?: any) => commandWorkerStop(grid(), item?.data?.name));
  reg('ashley.workerLogs', (item?: any) => commandWorkerLogs(grid(), item?.data?.name));
  reg('ashley.ask', () => commandAsk(grid()));
  reg('ashley.gridStatus', () => commandGridStatus(grid()));
  reg('ashley.gridBootstrap', () => commandBootstrap(context));
  reg('ashley.registerMcp', () => commandRegisterMcp(context));
  reg('ashley.claudeToken', () => commandClaudeToken(context));
  reg('ashley.manageTokens', () => commandManageTokens());
  reg('ashley.openManual', () => commandOpenManual(context));
  reg('ashley.openTerminal', () => commandOpenTerminal());
  reg('ashley.refresh', () => tree.refresh());

  // 2. First run: offer the wizard once. Never awaited: activation must not block on a dialog.
  const s = store.settings();
  if (!s.accessId && !context.globalState.get('ashley.offered')) {
    void context.globalState.update('ashley.offered', true);
    void vscode.window.showInformationMessage('Ashley can set up this laptop for the Wayne State grid (SSH, tokens, a Claude worker). Start now?', 'Set up', 'Read the manual', 'Later').then((pick) => {
      if (pick === 'Set up') void vscode.commands.executeCommand('ashley.setup');
      else if (pick === 'Read the manual') void vscode.commands.executeCommand('ashley.openManual');
    });
  }
  output.appendLine(`Ashley ${context.extension.packageJSON.version} active (build ${process.env.ASHLEY_BUILD ?? 'dev'})`);
  return { _internal };
}

export function deactivate(): void {
  /* nothing to release: no background processes are kept */
}

// ---------------------------------------------------------------------------------------

function format(reports: StepReport[]): string {
  const mark = { done: 'PASS', todo: 'TODO', skipped: 'SKIP', failed: 'FAIL' } as const;
  return reports.map((r) => `${mark[r.status]}  ${r.title}: ${r.detail}`).join('\n');
}

async function commandSetup(context: vscode.ExtensionContext): Promise<void> {
  const ui = new VsCodeUI(output);
  const env = store.wizardEnv(ui);
  output.show(true);
  output.appendLine('--- Ashley setup wizard ---');
  const before = await checkAll(env);
  output.appendLine(format(before));
  const todo = before.filter((r) => r.status !== 'done');
  if (todo.length === 0) {
    const again = await vscode.window.showInformationMessage('Everything is already set up. Run the wizard again anyway (re-enter tokens, reinstall on the grid)?', { modal: true }, 'Run everything again', 'Only the grid install', 'No');
    if (again === 'No' || !again) return;
    const reports = await runWizard(env, { force: true, only: again === 'Only the grid install' ? ['gridInstall'] : undefined });
    output.appendLine(format(reports));
  } else {
    const reports = await runWizard(env);
    output.appendLine(format(reports));
    const failed = reports.find((r) => r.status === 'failed');
    if (failed) {
      void vscode.window.showErrorMessage(`Ashley setup stopped at "${failed.title}": ${failed.detail}`, 'Show log').then((c) => c && output.show());
    } else {
      void vscode.window.showInformationMessage('Ashley setup finished. The Ashley view shows when the grid container is ready; then start a worker.', 'Open Ashley view').then((c) => c && vscode.commands.executeCommand('ashley.status.focus'));
    }
  }
  await store.hydrateEnvironment();
  tree.refresh();
  if (store.config.get<boolean>('mcp.autoRegister', true) && !(await isMcpRegistered())) {
    await commandRegisterMcp(context, true);
  }
}

async function commandDoctor(context: vscode.ExtensionContext): Promise<void> {
  const ui = new VsCodeUI(output);
  const env = store.wizardEnv(ui);
  output.show(true);
  output.appendLine(`--- Ashley doctor ${new Date().toISOString()} ---`);
  output.appendLine(`platform ${process.platform} ${process.arch}; VS Code ${vscode.version}; extension ${context.extension.packageJSON.version}`);
  const remoteSsh = vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
  output.appendLine(`${remoteSsh ? 'PASS' : 'FAIL'}  Remote-SSH extension ${remoteSsh ? remoteSsh.packageJSON.version : 'not installed (Ashley: Open my grid files needs it)'}`);
  const claudeExt = vscode.extensions.getExtension('anthropic.claude-code');
  output.appendLine(`${claudeExt ? 'PASS' : 'WARN'}  Claude Code extension ${claudeExt ? claudeExt.packageJSON.version : 'not installed'}`);
  output.appendLine(`INFO  claude executable for setup-token: ${env.settings.claudeExecutable}`);
  const reports = await checkAll(env);
  output.appendLine(format(reports));
  const mcp = await isMcpRegistered();
  output.appendLine(`${mcp ? 'PASS' : 'TODO'}  MCP bridge registered with Claude Code${mcp ? '' : ' (Ashley: Connect the Claude Code extension to the grid)'}`);
  if (reports.every((r) => r.status === 'done' || r.status === 'skipped')) {
    const s = store.settings();
    const g = new GridApi(s.sshAlias, (l) => output.appendLine(l));
    const r = await g.ashley(['doctor'], { timeoutMs: 120_000 });
    output.appendLine('--- grid doctor ---\n' + (r.stdout + r.stderr).trim());
  }
  if (!remoteSsh) {
    const inst = await vscode.window.showWarningMessage('The Remote-SSH extension is missing; it is what shows your grid files and images. Install it?', 'Install');
    if (inst) await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-ssh');
  }
  tree.refresh();
}

async function pickWorker(grid: GridApi, prompt: string, onlyRunning = true): Promise<{ name: string; node: string; state: string } | undefined> {
  const workers = await grid.workers();
  const rows = (workers as any[]).filter((w) => !onlyRunning || w.job_state === 'RUNNING');
  if (rows.length === 0) return undefined;
  if (rows.length === 1) return { name: rows[0].name, node: rows[0].node, state: rows[0].job_state };
  const pick = await vscode.window.showQuickPick(
    rows.map((w) => ({ label: w.name, description: `${w.job_state} ${w.node ?? ''}`, w })),
    { title: prompt },
  );
  return pick ? { name: pick.w.name, node: pick.w.node, state: pick.w.job_state } : undefined;
}

async function commandConnect(grid: GridApi, workerName?: string): Promise<void> {
  const s = store.settings();
  if (!s.accessId) return void vscode.commands.executeCommand('ashley.setup');
  if (!vscode.extensions.getExtension('ms-vscode-remote.remote-ssh')) {
    const inst = await vscode.window.showWarningMessage('Opening your grid files needs the Remote-SSH extension.', 'Install it');
    if (inst) await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode-remote.remote-ssh');
    return;
  }
  let node = '';
  if (workerName) {
    const r = await grid.ashley(['worker', 'node', '--name', workerName]);
    node = r.stdout.trim();
  } else {
    const w = await pickWorker(grid, 'Which running job should VS Code connect to?');
    if (w?.node) node = w.node;
    else {
      const jobs = (await grid.squeue()).filter((j) => j.state === 'RUNNING' && j.node);
      if (jobs.length) {
        const pick = await vscode.window.showQuickPick(jobs.map((j) => ({ label: `${j.name} (job ${j.jobId})`, description: `${j.node} ${j.elapsed}/${j.timeLimit}`, j })), { title: 'No Claude worker is running. Connect to another running job?' });
        if (pick) node = pick.j.node;
      }
    }
  }
  if (!node) {
    const start = await vscode.window.showInformationMessage('You need a running job to connect to (VS Code may not run on the login node). Start a Claude worker now?', { modal: true }, 'Start a worker');
    if (start) await commandWorkerStart(grid);
    return;
  }
  const folder = await vscode.window.showInputBox({ title: 'Folder to open on the grid', value: gridHome(s.accessId), prompt: 'Your grid home, or a project folder', ignoreFocusOut: true });
  if (!folder) return;
  // Tell Remote-SSH the platform up front, so it never shows the "select platform" dialog,
  // and give the jump through the login node time to settle.
  const host = remoteUri(node, s.nodeDomain, '').replace('vscode-remote://ssh-remote+', '');
  const sshCfg = vscode.workspace.getConfiguration('remote.SSH');
  const platforms = { ...(sshCfg.get<Record<string, string>>('remotePlatform') ?? {}) };
  if (platforms[host] !== 'linux') {
    platforms[host] = 'linux';
    await sshCfg.update('remotePlatform', platforms, vscode.ConfigurationTarget.Global);
  }
  // The compute nodes' sshd takes ~25 s before it runs anything (measured 2026-09-28), and the
  // first connection also downloads the server on the node; 60 s was not enough.
  if ((sshCfg.get<number>('connectTimeout') ?? 15) < 300) await sshCfg.update('connectTimeout', 300, vscode.ConfigurationTarget.Global);
  const uri = vscode.Uri.parse(remoteUri(node, s.nodeDomain, folder));
  output.appendLine(`opening ${uri.toString()}`);
  await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
}

async function commandWorkerStart(grid: GridApi): Promise<void> {
  const c = store.config;
  const name = await vscode.window.showInputBox({ title: 'Worker name', value: 'default', prompt: 'One worker is enough for most people; name a second one for a separate project or a GPU.', validateInput: (v) => (/^[A-Za-z0-9_-]+$/.test(v) ? undefined : 'letters, digits, - and _ only'), ignoreFocusOut: true });
  if (!name) return;
  const gpuPick = await vscode.window.showQuickPick(
    [
      { label: 'CPU node', description: `${c.get('worker.cpus')} CPUs, ${c.get('worker.memory')}, ${c.get('worker.partition')}/${c.get('worker.qos')}`, gpus: 0 },
      { label: '1 GPU', description: 'gmsap/gvohp/galhp, qos gpu (only if the work trains or infers)', gpus: 1 },
    ],
    { title: 'What kind of node?' },
  );
  if (!gpuPick) return;
  const hours = await vscode.window.showInputBox({ title: 'Hours', value: String(c.get('worker.hours', 24)), validateInput: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 720 ? undefined : '1 to 720'), ignoreFocusOut: true });
  if (!hours) return;
  const spec: WorkerJobSpec = {
    name,
    partition: c.get('worker.partition', 'reqp'),
    qos: c.get('worker.qos', 'requeue') as WorkerJobSpec['qos'],
    hours: parseInt(hours, 10),
    cpus: c.get('worker.cpus', 4),
    memory: c.get('worker.memory', '16G'),
    gpus: gpuPick.gpus,
    concurrency: c.get('worker.concurrency', 2),
  };
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Ashley: submitting the worker job' }, async () => {
    const r = await grid.workerStart(spec);
    output.appendLine(r.message);
    if (r.ok) void vscode.window.showInformationMessage(`${r.message}. It appears in the Ashley view as soon as Slurm starts it.`);
    else void vscode.window.showErrorMessage(`Could not start the worker: ${r.message}`);
  });
  tree.refresh();
}

async function commandWorkerStop(grid: GridApi, workerName?: string): Promise<void> {
  const w = workerName ? { name: workerName } : await pickWorker(grid, 'Stop which worker?', false);
  if (!w) return void vscode.window.showInformationMessage('No worker to stop.');
  const sure = await vscode.window.showWarningMessage(`Stop worker "${w.name}"? Queued requests stay in its inbox and run when it is started again.`, { modal: true }, 'Stop');
  if (!sure) return;
  output.appendLine(await grid.workerStop(w.name));
  tree.refresh();
}

async function commandWorkerLogs(grid: GridApi, workerName?: string): Promise<void> {
  const w = workerName ? { name: workerName } : await pickWorker(grid, 'Logs of which worker?', false);
  if (!w) return;
  output.show(true);
  output.appendLine(`--- worker ${w.name} log ---\n` + (await grid.workerLog(w.name, 120)));
}

async function commandAsk(grid: GridApi): Promise<void> {
  const s = store.settings();
  const w = await pickWorker(grid, 'Ask which worker?');
  if (!w) {
    const start = await vscode.window.showInformationMessage('No Claude worker is running on the grid.', { modal: true }, 'Start one');
    if (start) await commandWorkerStart(grid);
    return;
  }
  const prompt = await vscode.window.showInputBox({ title: `Ask the grid Claude (worker ${w.name}, session ${store.config.get('defaultSession', 'default')})`, prompt: 'What should it do? It runs in your grid home with your subscription.', ignoreFocusOut: true });
  if (!prompt) return;
  const session = store.config.get<string>('defaultSession', 'default');
  const chan = vscode.window.createOutputChannel(`Ashley: ${session}`, 'markdown');
  chan.show(true);
  chan.appendLine(`> ${prompt}\n`);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Grid Claude (${w.name}) is working`, cancellable: true }, async (progress, token) => {
    const ctl = new AbortController();
    token.onCancellationRequested(() => ctl.abort());
    let turns = 0;
    const result: AshleyResult = await grid.ask(
      { prompt, session, from: `vscode@${require('node:os').hostname()}` },
      w.name,
      3600,
      {
        onEvent: (ev: any) => {
          if (ev.type === 'assistant' && ev.message?.content) {
            for (const block of ev.message.content) {
              if (block.type === 'text' && block.text) chan.appendLine(block.text);
              if (block.type === 'tool_use') {
                turns++;
                progress.report({ message: `${turns} tool calls` });
                chan.appendLine(`\n_[${block.name}] ${summariseInput(block.input)}_`);
              }
            }
          } else if (ev.type === 'ashley') chan.appendLine(`_${ev.event} ${ev.node ?? ''} ${ev.account ?? ''}_`);
        },
      },
      ctl.signal,
    );
    chan.appendLine(`\n---\n**${result.status}** in ${result.duration_ms ? Math.round(result.duration_ms / 1000) : '?'} s, ${result.num_turns ?? '?'} turns, $${result.cost_usd?.toFixed(3) ?? '?'} (${result.account ?? ''})`);
    if (result.status !== 'ok') chan.appendLine(`${result.error ?? ''}${result.retry_after ? ` retry after ${result.retry_after}` : ''}`);
    if (result.status === 'ok' && !result.result) chan.appendLine('(no text; see the events)');
  });
  output.appendLine(`ask done (session ${session}, worker ${w.name}); accessId ${s.accessId}`);
}

function summariseInput(input: any): string {
  if (!input) return '';
  const s = typeof input === 'string' ? input : input.command ?? input.file_path ?? input.pattern ?? input.description ?? JSON.stringify(input);
  return String(s).slice(0, 160).replace(/\n/g, ' ');
}

async function commandGridStatus(grid: GridApi): Promise<void> {
  output.show(true);
  const r = await grid.ashley(['status'], { timeoutMs: 120_000 });
  output.appendLine(`--- grid status ---\n${(r.stdout + r.stderr).trim()}`);
  const jobs = await grid.squeue();
  if (jobs.length) output.appendLine(jobs.map((j) => `${j.jobId} ${j.name} ${j.state} ${j.node} ${j.elapsed}/${describeWall(j.timeLimit)} ${j.partition} ${j.reason}`).join('\n'));
  tree.refresh();
}

async function commandBootstrap(context: vscode.ExtensionContext): Promise<void> {
  const ui = new VsCodeUI(output);
  const env = store.wizardEnv(ui);
  output.show(true);
  const reports = await runWizard(env, { force: true, only: ['gridInstall'] });
  output.appendLine(format(reports));
  void vscode.window.showInformationMessage(reports[0]?.detail ?? 'done');
  tree.refresh();
  void context;
}

async function commandRegisterMcp(context: vscode.ExtensionContext, quiet = false): Promise<void> {
  const s = store.settings();
  const r = await registerMcp(context.extensionPath, s.sshAlias, (l) => output.appendLine(l));
  output.appendLine(`MCP: ${r.how} ${r.detail}`);
  if (!quiet || !r.ok) {
    if (r.ok) void vscode.window.showInformationMessage(`Claude Code now has the ashley_* tools (${r.how}). Start a new Claude Code conversation and ask it to "check the grid status".`);
    else void vscode.window.showWarningMessage(`Could not register the MCP bridge: ${r.detail}`);
  }
}

async function commandClaudeToken(context: vscode.ExtensionContext): Promise<void> {
  const ui = new VsCodeUI(output);
  const env = store.wizardEnv(ui);
  const reports = await runWizard(env, { force: true, only: ['claudeOauth'] });
  output.appendLine(format(reports));
  if (reports[0]?.status === 'done') {
    const push = await vscode.window.showInformationMessage('Token stored. Push it to the grid now (rewrites ~/.ashley/accounts/default/token)?', 'Push to grid');
    if (push) await commandBootstrap(context);
  }
}

async function commandManageTokens(): Promise<void> {
  const summary = await store.secretSummary();
  const pick = await vscode.window.showQuickPick(
    summary.map((x) => ({ label: x.name, description: x.present ? 'stored' : 'missing', id: x.id })),
    { title: 'Tokens in the OS keychain' },
  );
  if (!pick) return;
  const action = await vscode.window.showQuickPick(['Replace', 'Delete', 'Cancel'], { title: pick.label });
  if (action === 'Delete') {
    await store.setSecret(pick.id as SecretId, undefined);
    await store.hydrateEnvironment();
    tree.refresh();
  } else if (action === 'Replace') {
    const ui = new VsCodeUI(output);
    const env = store.wizardEnv(ui);
    const svc = SERVICES.find((x) => x.id === pick.id)!;
    const reports = await runWizard(env, { force: true, only: [svc.id] });
    output.appendLine(format(reports));
    tree.refresh();
  }
}

async function commandOpenManual(context: vscode.ExtensionContext): Promise<void> {
  const html = path.join(context.extensionPath, 'media', 'manual.html');
  if (!fs.existsSync(html)) return void vscode.window.showWarningMessage('The manual is not bundled in this build; see docs/manual.html in the Ashley repository.');
  const panel = vscode.window.createWebviewPanel('ashley.manual', 'Ashley manual', vscode.ViewColumn.One, { enableScripts: true, enableFindWidget: true, localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))] });
  let text = fs.readFileSync(html, 'utf8');
  const base = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media'))).toString();
  text = text.replace(/(src|href)="(?!https?:|#|data:|command:)([^"]+)"/g, (_m, attr, rel) => `${attr}="${base}/${rel}"`);
  panel.webview.html = text;
}

async function commandOpenTerminal(): Promise<void> {
  const s = store.settings();
  if (!s.accessId) return void vscode.commands.executeCommand('ashley.setup');
  const t = vscode.window.createTerminal({ name: `grid (${s.accessId})`, shellPath: require('./vscode/ui').resolveExecutable('ssh'), shellArgs: ['-t', s.sshAlias] });
  t.show();
}

const _internal = { STEPS, testConnection };
export { _internal };
