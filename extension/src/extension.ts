// Ashley: VS Code entry point. UI and OS integration only; the logic lives in src/core.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AshleyStore } from './vscode/store';
import { VsCodeUI, resolveExecutable } from './vscode/ui';
import { SetupPanel } from './vscode/panel';
import { AshleyTree } from './vscode/tree';
import { registerMcp, isMcpRegistered } from './vscode/mcpRegister';
import { runWizard, checkAll, StepReport, testConnection, STEPS } from './core/wizard';
import { GridApi } from './core/gridApi';
import { GridRelay } from './core/relay';
import { SERVICES, SecretId, gridHome } from './core/services';
import { remoteUri, stripBlock, hasBlock } from './core/sshConfig';
import { WorkerJobSpec, describeWall } from './core/slurm';
import { AshleyResult } from './core/protocol';
import { run, expandHome } from './core/shell';
import { findClaudeExecutable } from './vscode/store';

let output: vscode.OutputChannel;
let store: AshleyStore;
let tree: AshleyTree;
let panel: SetupPanel | undefined;
let relay: GridRelay | undefined;
function getRelay(alias: string): GridRelay {
  if (!relay || relay.alias !== alias) {
    relay?.close();
    relay = new GridRelay(alias, { onStatus: (s, d) => output.appendLine(`relay ${s} ${d ?? ''}`) });
  }
  return relay;
}

export async function activate(context: vscode.ExtensionContext): Promise<{ _internal: typeof _internal }> {
  output = vscode.window.createOutputChannel('Ashley');
  store = new AshleyStore(context);
  const grid = () => {
    const alias = store.settings().sshAlias;
    return new GridApi(alias, (l) => output.appendLine(l), getRelay(alias));
  };
  tree = new AshleyTree(store, grid);
  context.subscriptions.push(output, vscode.window.registerTreeDataProvider('ashley.status', tree));

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
  reg('ashley.connect', (item?: any) => commandConnect(context, grid(), item?.data?.name));
  reg('ashley.workerStart', () => commandWorkerStart(grid()));
  reg('ashley.workerStop', (item?: any) => commandWorkerStop(grid(), item?.data?.name));
  reg('ashley.workerLogs', (item?: any) => commandWorkerLogs(grid(), item?.data?.name));
  reg('ashley.ask', () => commandAsk(grid()));
  reg('ashley.gridStatus', () => commandGridStatus(grid()));
  reg('ashley.gridBootstrap', () => commandBootstrap(context));
  reg('ashley.registerMcp', () => commandRegisterMcp(context));
  reg('ashley.claudeToken', () => commandTokenStep(context, 'claudeOauth'));
  reg('ashley.manageTokens', () => commandManageTokens(context));
  reg('ashley.openManual', () => commandOpenManual(context));
  reg('ashley.openTerminal', () => commandOpenTerminal());
  reg('ashley.reset', () => commandReset(context));
  reg('ashley.refresh', () => tree.refresh());

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
  panel?.dispose();
  relay?.close();
}

// ---------------------------------------------------------------------------------------

function format(reports: StepReport[]): string {
  const mark = { done: 'PASS', todo: 'TODO', skipped: 'SKIP', failed: 'FAIL' } as const;
  return reports.map((r) => `${mark[r.status]}  ${r.title}: ${r.detail}`).join('\n');
}

function openPanel(context: vscode.ExtensionContext, title = 'Ashley setup'): SetupPanel {
  panel?.dispose();
  panel = new SetupPanel(context, output, title);
  return panel;
}

async function commandSetup(context: vscode.ExtensionContext): Promise<void> {
  const p = openPanel(context);
  const env = store.wizardEnv(p);
  output.appendLine('--- Ashley setup wizard ---');
  p.setSteps([], null);
  const before = await checkAll(env);
  p.setSteps(before, null);
  output.appendLine(format(before));
  let opts: { force?: boolean; only?: string[] } = {};
  if (before.every((r) => r.status === 'done' || r.status === 'skipped')) {
    const again = await p.confirm('Everything is already set up on this laptop and on the grid. Run every step again anyway, or only the grid install (uploads scripts and tokens)?', 'Run everything again', 'Only the grid install');
    opts = again ? { force: true } : { force: true, only: ['gridInstall'] };
  }
  const reports = await runWizard(env, { ...opts, onStep: (rs, cur) => p.setSteps(mergeReports(before, rs), cur) });
  const all = mergeReports(before, reports);
  p.setSteps(all, null);
  output.appendLine(format(reports));
  const failed = reports.find((r) => r.status === 'failed');
  const skipped = reports.find((r) => r.status === 'skipped' && r.id !== 'anthropicApiKey');
  if (failed) p.finish(`Stopped at "${failed.title}": ${failed.detail}`, false);
  else if (skipped) p.finish(`Paused at "${skipped.title}". Run the wizard again to continue.`, false);
  else p.finish('Setup finished. The Ashley view shows when the grid container is ready; then start a worker.', true);
  await store.hydrateEnvironment();
  tree.refresh();
  if (!failed && store.config.get<boolean>('mcp.autoRegister', true) && !(await isMcpRegistered())) await commandRegisterMcp(context, true);
}

function mergeReports(base: StepReport[], updates: StepReport[]): StepReport[] {
  const m = new Map(base.map((r) => [r.id, r]));
  for (const u of updates) m.set(u.id, u);
  return STEPS.map((s) => m.get(s.id)).filter((x): x is StepReport => !!x);
}

async function commandTokenStep(context: vscode.ExtensionContext, id: SecretId): Promise<void> {
  const p = openPanel(context, 'Ashley token');
  const env = store.wizardEnv(p);
  const reports = await runWizard(env, { force: true, only: [id], onStep: (rs, cur) => p.setSteps(rs, cur) });
  output.appendLine(format(reports));
  const r = reports[0];
  if (r?.status === 'done') {
    const push = await p.confirm(`${r.title}: ${r.detail}. Push it to the grid now?`, 'Push to grid', 'Later');
    if (push) {
      const gi = await runWizard(env, { force: true, only: ['gridInstall'], onStep: (rs, cur) => p.setSteps(rs, cur) });
      output.appendLine(format(gi));
      p.finish(gi[0]?.detail ?? 'done', gi[0]?.status === 'done');
    } else p.finish(r.detail, true);
  } else p.finish(r?.detail ?? 'cancelled', false);
  await store.hydrateEnvironment();
  tree.refresh();
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
  const summary = reports.map((r) => `${r.status === 'done' ? '✓' : r.status === 'skipped' ? '–' : '✗'} ${r.title}`).join('   ');
  if (reports.every((r) => r.status === 'done' || r.status === 'skipped')) {
    const g = new GridApi(store.settings().sshAlias, (l) => output.appendLine(l));
    const r = await g.ashley(['doctor'], { timeoutMs: 120_000 });
    output.appendLine('--- grid doctor ---\n' + (r.stdout + r.stderr).trim());
  }
  void vscode.window.showInformationMessage(`Ashley doctor: ${summary}`, 'Show details').then((c) => c && output.show());
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
  const pick = await vscode.window.showQuickPick(rows.map((w) => ({ label: w.name, description: `${w.job_state} ${w.node ?? ''}`, w })), { title: prompt });
  return pick ? { name: pick.w.name, node: pick.w.node, state: pick.w.job_state } : undefined;
}

async function commandConnect(context: vscode.ExtensionContext, grid: GridApi, workerName?: string): Promise<void> {
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
  const host = remoteUri(node, s.nodeDomain, '').replace('vscode-remote://ssh-remote+', '');
  const sshCfg = vscode.workspace.getConfiguration('remote.SSH');
  const platforms = { ...(sshCfg.get<Record<string, string>>('remotePlatform') ?? {}) };
  if (platforms[host] !== 'linux') {
    platforms[host] = 'linux';
    await sshCfg.update('remotePlatform', platforms, vscode.ConfigurationTarget.Global);
  }
  // The compute nodes' sshd takes ~25 s before it runs anything, and the first connection
  // downloads the server on the node; 60 s was not enough.
  if ((sshCfg.get<number>('connectTimeout') ?? 15) < 300) await sshCfg.update('connectTimeout', 300, vscode.ConfigurationTarget.Global);
  if (!context.globalState.get('ashley.osBannerExplained')) {
    await context.globalState.update('ashley.osBannerExplained', true);
    await vscode.window.showInformationMessage(
      'The grid runs CentOS 7, which VS Code no longer supports officially, so the new window will show a banner saying the OS is unsupported. That is expected: Wayne State provides the compatibility libraries and everything works. Dismiss the banner (or choose "Don\'t show again"). The first connection takes one or two minutes.',
      { modal: true },
      'Connect',
    );
  }
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
  // container: the lab's shared library when readable (no build, same for everyone), else the account's own
  let container: string | undefined;
  const pref = c.get<string>('container', 'auto');
  const lib = await grid.library();
  if (lib.available && Object.keys(lib.containers).length) {
    if (pref !== 'auto' && pref !== 'own' && lib.containers[pref]) container = pref;
    else if (pref === 'auto' || pref === 'own') {
      const items = Object.entries(lib.containers).map(([name, e]) => ({ label: name + (name === lib.default ? '  (lab default)' : ''), description: `${e.purpose ?? ''}${e.gpu ? '  GPU' : ''}  ${e.claude_version ?? ''}`, name }));
      items.push({ label: 'my own build', description: 'the container built in your storage (ashley install --build-own)', name: '' });
      const pick = await vscode.window.showQuickPick(items, { title: 'Which container? (shared containers need no build and are identical for every student)' });
      if (!pick) return;
      container = pick.name || undefined;
    }
  }
  const spec: WorkerJobSpec = {
    name,
    partition: c.get('worker.partition', 'reqp'),
    qos: c.get('worker.qos', 'requeue') as WorkerJobSpec['qos'],
    hours: parseInt(hours, 10),
    cpus: c.get('worker.cpus', 4),
    memory: c.get('worker.memory', '16G'),
    gpus: gpuPick.gpus,
    concurrency: c.get('worker.concurrency', 2),
    container,
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
  const w = await pickWorker(grid, 'Ask which worker?');
  if (!w) {
    const start = await vscode.window.showInformationMessage('No Claude worker is running on the grid.', { modal: true }, 'Start one');
    if (start) await commandWorkerStart(grid);
    return;
  }
  const session = store.config.get<string>('defaultSession', 'default');
  const prompt = await vscode.window.showInputBox({ title: `Ask the grid Claude (worker ${w.name}, session ${session})`, prompt: 'What should it do? It runs in your grid home with your subscription.', ignoreFocusOut: true });
  if (!prompt) return;
  const chan = vscode.window.createOutputChannel(`Ashley: ${session}`, 'markdown');
  chan.show(true);
  chan.appendLine(`> ${prompt}\n`);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Grid Claude (${w.name}) is working`, cancellable: true }, async (progress, token) => {
    const ctl = new AbortController();
    token.onCancellationRequested(() => ctl.abort());
    let turns = 0;
    const result: AshleyResult = await grid.ask(
      { prompt, session, from: `vscode@${os.hostname()}` },
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
  });
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
  const p = openPanel(context, 'Ashley: grid install');
  const env = store.wizardEnv(p);
  const reports = await runWizard(env, { force: true, only: ['gridInstall'], onStep: (rs, cur) => p.setSteps(rs, cur) });
  output.appendLine(format(reports));
  p.finish(reports[0]?.detail ?? 'done', reports[0]?.status === 'done');
  tree.refresh();
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

async function commandManageTokens(context: vscode.ExtensionContext): Promise<void> {
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
    await commandTokenStep(context, pick.id as SecretId);
  }
}

async function commandReset(context: vscode.ExtensionContext): Promise<void> {
  const s = store.settings();
  const items: Array<vscode.QuickPickItem & { id: string }> = [
    { id: 'tokens', label: 'Tokens in the OS keychain', description: 'GitHub, Hugging Face, Claude, API key', picked: true },
    { id: 'ssh', label: 'SSH key and the config block', description: `${s.identityFile}, the Ashley block in ~/.ssh/config`, picked: true },
    { id: 'settings', label: 'Ashley settings', description: 'AccessID and preferences', picked: true },
    { id: 'mcp', label: 'MCP bridge registration', description: 'claude mcp remove ashley', picked: true },
    { id: 'grid', label: 'Ashley on the grid', description: 'stop workers, remove ~/.ashley and the bashrc block (the container stays)', picked: false },
    { id: 'gridRoot', label: 'The container and workspaces on the grid storage', description: 'rebuilt by the next install (7 min)', picked: false },
  ];
  const picks = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Ashley: reset. What should be forgotten?' });
  if (!picks || picks.length === 0) return;
  const sure = await vscode.window.showWarningMessage(`Forget: ${picks.map((p) => p.label).join('; ')}? This is what a brand-new laptop looks like to Ashley.`, { modal: true }, 'Reset');
  if (!sure) return;
  const ids = new Set(picks.map((p) => p.id));
  const done: string[] = [];
  if (ids.has('grid') || ids.has('gridRoot')) {
    const g = new GridApi(s.sshAlias, (l) => output.appendLine(l));
    const r = await g.ashley(['uninstall', ...(ids.has('gridRoot') ? ['--purge-root'] : [])], { timeoutMs: 180_000 });
    done.push(`grid: ${(r.stdout + r.stderr).trim().split('\n').pop()}`);
  }
  if (ids.has('tokens')) {
    for (const svc of SERVICES) await store.setSecret(svc.id, undefined);
    done.push('tokens deleted');
  }
  if (ids.has('mcp')) {
    const r = await run(findClaudeExecutable(), ['mcp', 'remove', '--scope', 'user', 'ashley'], { timeoutMs: 60_000 });
    done.push(`mcp: ${(r.stdout || r.stderr).trim().split('\n')[0] || 'removed'}`);
  }
  if (ids.has('ssh')) {
    const cfg = path.join(os.homedir(), '.ssh', 'config');
    if (fs.existsSync(cfg)) {
      const t = fs.readFileSync(cfg, 'utf8');
      if (hasBlock(t)) fs.writeFileSync(cfg, stripBlock(t));
    }
    for (const f of [expandHome(s.identityFile), expandHome(s.identityFile) + '.pub']) if (fs.existsSync(f)) fs.rmSync(f);
    done.push('ssh block and key removed (the grid still lists the old public key; harmless)');
  }
  if (ids.has('settings')) {
    for (const k of ['accessId', 'gridRoot']) await store.config.update(k, undefined, vscode.ConfigurationTarget.Global);
    await context.globalState.update('ashley.offered', undefined);
    await context.globalState.update('ashley.osBannerExplained', undefined);
    done.push('settings cleared');
  }
  await store.hydrateEnvironment();
  tree.refresh();
  output.appendLine(`reset: ${done.join('; ')}`);
  const reload = await vscode.window.showInformationMessage(`Reset done: ${done.join('; ')}. Reload the window to see Ashley as a new student would.`, 'Reload window');
  if (reload) void vscode.commands.executeCommand('workbench.action.reloadWindow');
}

async function commandOpenManual(context: vscode.ExtensionContext): Promise<void> {
  const html = path.join(context.extensionPath, 'media', 'manual.html');
  if (!fs.existsSync(html)) return void vscode.window.showWarningMessage('The manual is not bundled in this build; see docs/manual.html in the Ashley repository.');
  const p = vscode.window.createWebviewPanel('ashley.manual', 'Ashley manual', vscode.ViewColumn.One, { enableScripts: true, enableFindWidget: true, localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'media'))] });
  let text = fs.readFileSync(html, 'utf8');
  const base = p.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'media'))).toString();
  text = text.replace(/(src|href)="(?!https?:|#|data:|command:)([^"]+)"/g, (_m, attr, rel) => `${attr}="${base}/${rel}"`);
  p.webview.html = text;
}

async function commandOpenTerminal(): Promise<void> {
  const s = store.settings();
  if (!s.accessId) return void vscode.commands.executeCommand('ashley.setup');
  const t = vscode.window.createTerminal({ name: `grid (${s.accessId})`, shellPath: resolveExecutable('ssh'), shellArgs: ['-t', s.sshAlias] });
  t.show();
}

const _internal = { STEPS, testConnection };
export { _internal };
