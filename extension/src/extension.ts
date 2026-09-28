// Ashley: VS Code entry point. UI and OS integration only; the logic lives in src/core.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AshleyStore } from './vscode/store';
import { resolveExecutable } from './vscode/ui';
import { SetupPanel } from './vscode/panel';
import { Troubleshooter } from './vscode/diagnosticsUi';
import { LicenseGate, REFUSED, UNGATED } from './vscode/licenseGate';
import { ensureTermsAccepted, termsRecord, TERMS_VERSION, TermsRecord, TermsEdition, openTerms, supportUrl } from './vscode/terms';
import { AGREE_BUTTON, writeTermsRecord, sha256, TERMS_FILE, affirmationsFor } from './core/terms';
import { DiagSharer } from './vscode/diagShare';
import { buildGraph, makeCtx } from './vscode/diagNodes';
import { VsCodeUI as SetupPanelFreeUI } from './vscode/ui';
import { order, runDiagnostics, formatReport } from './core/diagnostics';
import { AshleyTree } from './vscode/tree';
import { registerMcp, isMcpRegistered } from './vscode/mcpRegister';
import { runWizard, checkAll, StepReport, testConnection, STEPS, validateToken } from './core/wizard';
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
let troubleshooter: Troubleshooter | undefined;
let license: LicenseGate;
let sharer: DiagSharer;
let context0: vscode.ExtensionContext | undefined;
function getRelay(alias: string): GridRelay {
  if (!relay || relay.alias !== alias) {
    relay?.close();
    relay = new GridRelay(alias, { onStatus: (s, d) => output.appendLine(`relay ${s} ${d ?? ''}`) });
  }
  return relay;
}

export async function activate(context: vscode.ExtensionContext): Promise<{ _internal: typeof _internal }> {
  context0 = context;
  output = vscode.window.createOutputChannel('Ashley');
  store = new AshleyStore(context);
  license = new LicenseGate(context, output);
  store.licenseGate = license;
  context.subscriptions.push(license);
  sharer = new DiagSharer(context, output, () => license.identity());
  license.requestTrial = () => store.requestTrial();
  // a Full Edition key is kept only after its own agreement is accepted in the signing dialog
  license.requireFullTerms = async () => !!(await ensureTermsAccepted(context, output, () => sharer.installId(), 'full'));
  // the lab's service addresses come from services.json (published with the support site) unless a setting names one
  license.revocationUrl = () => store.serviceUrl('revocation');
  void store.services().then((s) => { sharer.fallbackEndpoint = s.report || ''; }, () => undefined);
  // upgrades: an earlier Ashley kept a Claude token in the keychain; it is deleted (Ashley stores no Claude credential)
  try {
    if (await context.secrets.get('ashley.claudeOauth')) {
      await context.secrets.delete('ashley.claudeOauth');
      output.appendLine('removed the Claude token an earlier Ashley kept in the keychain (Ashley no longer stores Claude credentials)');
    }
  } catch {
    /* no keychain */
  }
  // upgrades: the Wayne State sign-in recorded by 1.0.0 lives in settings; the license gate compares against it
  const s0 = store.settings();
  if (!license.identity() && s0.accessId && s0.wsuEmail) await license.recordIdentity({ accessId: s0.accessId, email: s0.wsuEmail });
  const grid = () => {
    const alias = store.settings().sshAlias;
    return new GridApi(alias, (l) => output.appendLine(l), getRelay(alias));
  };
  tree = new AshleyTree(store, grid);
  context.subscriptions.push(output, vscode.window.registerTreeDataProvider('ashley.status', tree));

  // tokens go into terminals only for a licensed person
  const hydrate = async () => {
    if (!license.allowed('ashley.hydrate').ok) return;
    try {
      const names = await store.hydrateEnvironment();
      if (names.length) output.appendLine(`environment: ${names.join(', ')}`);
    } catch (e) {
      output.appendLine(`environment hydration failed: ${e}`);
    }
  };
  await hydrate();
  context.subscriptions.push(
    license.onDidChange(() => {
      tree.refresh();
      void hydrate();
    }),
  );

  // gateAs: the command whose gate applies (a wizard step run on its own is gated like the wizard)
  const reg = (id: string, fn: (...a: any[]) => Promise<unknown> | unknown, gateAs = id) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(id, async (...a: any[]) => {
        // the terms first (a person-run command, never a background one), then the license gate;
        // reading the manual and the log needs neither
        if (!TERMS_EXEMPT.has(id) && !(await ensureTermsAccepted(context, output, () => sharer.installId()))) return REFUSED;
        const gate = license.allowed(gateAs);
        if (!gate.ok) return license.refuse(id, gate.reason);
        try {
          return await fn(...a);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          output.appendLine(`ERROR ${id}: ${msg}`);
          void vscode.window.showErrorMessage(`Ashley: ${msg}`, 'Show log').then((c) => c && output.show());
        }
      }),
    );

  troubleshooter = new Troubleshooter(context, store, output, (rep, gridVersion) => sharer.maybeSend(rep, gridVersion, output ? [] : []));
  context.subscriptions.push(troubleshooter);
  reg('ashley.license', () => license.manage());
  reg('ashley.terms', async () => {
    const fullOnRecord = !!termsRecord(context, 'full');
    const pick = await vscode.window.showQuickPick(
      [
        { id: 'license', label: '$(law) Trial Edition License Agreement', description: termsRecord(context) ? `accepted ${termsRecord(context)!.accepted_at.slice(0, 10)}` : 'not accepted yet' },
        { id: 'full', label: '$(law) Full Edition License Agreement', description: fullOnRecord ? `accepted ${termsRecord(context, 'full')!.accepted_at.slice(0, 10)}` : 'applies only if you register a Full Edition key' },
        { id: 'privacy', label: '$(shield) Privacy statement', description: '' },
      ],
      { title: 'Ashley: the license terms', placeHolder: 'Which text do you want to read?' },
    );
    if (pick) await openTerms(context, pick.id as 'license' | 'full' | 'privacy');
  });
  reg('ashley.support', () => vscode.env.openExternal(vscode.Uri.parse(supportUrl(context))));
  reg('ashley.errorReports', () => sharer.manage());
  reg('ashley.claudeSignIn', () => commandStepOnly(context, 'claudeGrid', 'Ashley: sign in to Claude on the grid'));
  reg('ashley.claudeLocalSignIn', () => commandStepOnly(context, 'claudeLocal', 'Ashley: sign in to Claude on this laptop'));
  // the gate compares the license against this very sign-in, so it must be reachable before the gate opens:
  // gated like the wizard it is a step of (ashley.setup is not gated); the terms still come first
  reg('ashley.wsuSignIn', () => commandStepOnly(context, 'wsuSignIn', 'Ashley: sign in with Wayne State'), 'ashley.setup');
  reg('ashley.renewToken', (id?: unknown) => commandRenewToken(context, id));
  reg('ashley.troubleshoot', () => troubleshooter!.run({ repair: true, quick: false, quiet: false }));
  reg('ashley.healthMenu', () => troubleshooter!.menu());
  reg('ashley.showLog', () => output.show(true));
  reg('ashley.investigate', () => troubleshooter!.investigate());
  reg('ashley.setup', () => commandSetup(context));
  reg('ashley.doctor', () => troubleshooter!.run({ repair: false, quick: false, quiet: false }));
  reg('ashley.connect', (item?: any) => commandConnect(context, grid(), item?.data?.name));
  reg('ashley.workerStart', () => commandWorkerStart(grid()));
  reg('ashley.workerStop', (item?: any) => commandWorkerStop(grid(), item?.data?.name));
  reg('ashley.workerLogs', (item?: any) => commandWorkerLogs(grid(), item?.data?.name));
  reg('ashley.ask', () => commandAsk(grid()));
  reg('ashley.gridStatus', () => commandGridStatus(grid()));
  reg('ashley.gridBootstrap', () => commandBootstrap(context));
  reg('ashley.registerMcp', () => commandRegisterMcp(context));
  reg('ashley.manageTokens', () => commandManageTokens(context));
  reg('ashley.openManual', () => commandOpenManual(context));
  reg('ashley.openTerminal', () => commandOpenTerminal());
  reg('ashley.reset', () => commandReset(context));
  reg('ashley.access', () => commandAccess(context, grid()));
  reg('ashley.phone', (item?: any) => commandPhone(context, grid(), item?.data?.name));
  reg('ashley.refresh', () => tree.refresh());

  const s = store.settings();
  const lic0 = license.check(true);
  if (!lic0.ok && !context.globalState.get('ashley.licenseOffered')) {
    void context.globalState.update('ashley.licenseOffered', true);
    void vscode.window.showInformationMessage(`Ashley needs a license key before it can set anything up (${lic0.detail}).`, 'Enter the key', 'Read the manual').then((pick) => {
      if (pick === 'Enter the key') void vscode.commands.executeCommand('ashley.license');
      else if (pick === 'Read the manual') void vscode.commands.executeCommand('ashley.openManual');
    });
  } else if (!s.accessId && !context.globalState.get('ashley.offered')) {
    void context.globalState.update('ashley.offered', true);
    void vscode.window.showInformationMessage('Ashley can set up this laptop for the Wayne State grid (SSH, tokens, a Claude worker). Start now?', 'Set up', 'Read the manual', 'Later').then((pick) => {
      if (pick === 'Set up') void vscode.commands.executeCommand('ashley.setup');
      else if (pick === 'Read the manual') void vscode.commands.executeCommand('ashley.openManual');
    });
  }
  troubleshooter.startSweeps();
  license.startRevocationChecks();
  setTimeout(() => {
    if (license.allowed('ashley.tokenCheck').ok) void checkTokensQuietly(context).catch((e) => output.appendLine(`token check: ${e}`));
  }, 20_000);
  output.appendLine(`license: ${license.check().status} (${license.check().detail})`);
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
  const p = new SetupPanel(context, output, title);
  panel = p;
  let busy = false;
  p.onRunStep = async (id) => {
    if (busy) return;
    busy = true;
    try {
      const env = store.wizardEnv(p);
      const reports = await runWizard(env, { force: true, only: [id], onStep: (rs, cur) => p.setSteps(rs, cur) });
      output.appendLine(format(reports));
      const r = reports[reports.length - 1];
      const all = await checkAll(env);
      p.setSteps(all, null);
      p.finish(r ? `${r.title}: ${r.detail}` : 'done', r?.status === 'done');
      await store.hydrateEnvironment();
      tree.refresh();
    } finally {
      busy = false;
    }
  };
  return p;
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

async function commandStepOnly(context: vscode.ExtensionContext, id: string, title: string): Promise<void> {
  const p = openPanel(context, title);
  const env = store.wizardEnv(p);
  const reports = await runWizard(env, { force: true, only: [id], onStep: (rs, cur) => p.setSteps(rs, cur) });
  output.appendLine(format(reports));
  const r = reports[reports.length - 1];
  p.setSteps(await checkAll(env), null);
  p.finish(r ? `${r.title}: ${r.detail}` : 'cancelled', r?.status === 'done');
  tree.refresh();
}

async function commandTokenStep(context: vscode.ExtensionContext, id: SecretId): Promise<void> {
  const p = openPanel(context, 'Ashley: renew a token');
  const env = store.wizardEnv(p);
  const reports = await runWizard(env, { force: true, only: [id], onStep: (rs, cur) => p.setSteps(rs, cur) });
  output.appendLine(format(reports));
  const r = reports[reports.length - 1];
  p.setSteps(await checkAll(env), null);
  p.finish(r ? `${r.title}: ${r.detail}` : 'cancelled', r?.status === 'done');
  await store.hydrateEnvironment();
  tree.refresh();
}

/**
 * A token row in the Ashley view, the troubleshooter's Renew button, or the palette: the wizard's own
 * step for that token. Without an id (the palette), a picker; the optional API key has no step and stays
 * with Ashley: Manage stored tokens.
 */
async function commandRenewToken(context: vscode.ExtensionContext, arg?: unknown): Promise<void> {
  const renewable = SERVICES.filter((s) => STEPS.some((st) => st.id === s.id));
  let id = renewable.find((s) => s.id === arg)?.id;
  if (!id) {
    const summary = await store.secretSummary();
    const pick = await vscode.window.showQuickPick(
      renewable.map((s) => {
        const x = summary.find((y) => y.id === s.id);
        return { label: s.name.split(' (')[0], description: x?.status === 'expired' ? 'no longer accepted' : x?.present ? 'stored' : 'missing', id: s.id };
      }),
      { title: 'Renew which token?' },
    );
    if (!pick) return;
    id = pick.id;
  }
  await commandTokenStep(context, id);
}

/**
 * Once a day: a token the service no longer accepts gets a Renew button (it updates the grid too).
 * The verdict is kept in the store, so the Ashley view can say "expired" without asking the service
 * again; a network failure is not a verdict.
 */
async function checkTokensQuietly(context: vscode.ExtensionContext): Promise<void> {
  const last = context.globalState.get<number>('ashley.tokenCheck', 0);
  if (Date.now() - last < 24 * 3600e3 || !store.settings().accessId) return;
  await context.globalState.update('ashley.tokenCheck', Date.now());
  let changed = false;
  for (const svc of SERVICES.filter((s) => ['github', 'huggingface'].includes(s.id))) {
    const v = await store.getSecret(svc.id);
    if (!v) continue;
    const c = await validateToken(svc, v);
    if (c.network) continue;
    if (store.tokenCheck(svc.id)?.ok !== c.ok) changed = true;
    await store.recordTokenCheck(svc.id, { ok: c.ok, detail: c.detail });
    if (!c.ok) {
      // the row says "expired" while the notice is up, whether or not it is answered
      if (changed) tree.refresh();
      changed = false;
      const pick = await vscode.window.showWarningMessage(`Your ${svc.name.split(' (')[0]} no longer works (${c.detail}). Renew it: one click in the browser, and the grid is updated too.`, 'Renew');
      if (pick) await commandTokenStep(context, svc.id);
    }
  }
  if (changed) tree.refresh();
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
      const pick = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { title: 'Which lab container?' });
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
    summary.map((x) => ({ label: x.name, description: x.status === 'expired' ? 'no longer accepted' : x.present ? 'stored' : 'missing', id: x.id })),
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
    for (const k of ['accessId', 'wsuEmail', 'gridRoot', 'twoFactorDone']) await store.config.update(k, undefined, vscode.ConfigurationTarget.Global);
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

async function commandAccess(context: vscode.ExtensionContext, grid: GridApi): Promise<void> {
  const who = await grid.accessWhoami();
  if (!who) return void vscode.window.showWarningMessage('Ashley is not installed on the grid yet, or the grid did not answer.');
  if (who.admin) {
    for (;;) {
      const rows = await grid.accessList();
      const order = { pending: 0, approved: 1, denied: 2, removed: 3 } as Record<string, number>;
      rows.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.user.localeCompare(b.user));
      const items = rows.map((r) => ({ label: `${r.state === 'pending' ? '$(bell) ' : r.state === 'approved' ? '$(pass) ' : '$(circle-slash) '}${r.user}`, description: r.state === 'pending' ? `pending: Claude account (assumed) ${r.user}@wayne.edu` : r.state, detail: [r.note ? `note: ${r.note}` : '', r.requested ? `requested ${r.requested}` : '', r.message ? `message: ${r.message}` : ''].filter(Boolean).join('   '), user: r.user }));
      items.push({ label: '$(add) Grant a user directly', description: 'no request needed', detail: 'opens the lab folder, read-only, for an AccessID you type', user: '' });
      const pick = await vscode.window.showQuickPick(items, { title: `Shared library access: ${rows.filter((r) => r.state === 'pending').length} pending, ${rows.filter((r) => r.state === 'approved').length} approved (lab admin ${who.user})`, matchOnDetail: true });
      if (!pick) return;
      let user = pick.user;
      if (!user) {
        user = (await vscode.window.showInputBox({ title: 'AccessID to grant', validateInput: (v) => (/^[a-z]{2}\d{4}$/.test(v) ? undefined : 'ab1234') })) ?? '';
        if (!user) continue;
        output.appendLine(await grid.access(['admin', 'approve', user]));
        continue;
      }
      const action = await vscode.window.showQuickPick(['Approve', 'Deny', 'Deny with message', 'Remove access', 'Reset (may ask again)', 'Back'], { title: user });
      if (!action || action === 'Back') continue;
      let msg = '';
      if (action === 'Deny with message' || action === 'Remove access') msg = (await vscode.window.showInputBox({ title: `Message to ${user}`, prompt: 'shown to the student in their status' })) ?? '';
      const args = action === 'Approve' ? ['admin', 'approve', user] : action.startsWith('Deny') ? ['admin', 'deny', user, '--message', msg] : action === 'Remove access' ? ['admin', 'remove', user, '--message', msg] : ['admin', 'reset', user];
      const out = await grid.access(args);
      output.appendLine(out);
      void vscode.window.showInformationMessage(out.split('\n').pop() ?? out);
    }
  }
  // a student: the request is the wizard's last step; run it (it refuses until everything works)
  const p = openPanel(context, 'Ashley: join the lab');
  const env = store.wizardEnv(p);
  const reports = await runWizard(env, { only: ['labAccess'], onStep: (rs, cur) => p.setSteps(rs, cur) });
  const r = reports[0];
  output.appendLine(format(reports));
  p.finish(r ? `${r.title}: ${r.detail}` : 'nothing to do', r?.status === 'done');
  tree.refresh();
}

async function commandPhone(context: vscode.ExtensionContext, grid: GridApi, workerName?: string): Promise<void> {
  const w = workerName ? { name: workerName } : await pickWorker(grid, 'Phone access on which worker?');
  if (!w) {
    const start = await vscode.window.showInformationMessage('Phone access runs on a Claude worker, and none is running.', { modal: true }, 'Start a worker');
    if (start) await commandWorkerStart(grid);
    return;
  }
  const p = openPanel(context, 'Ashley: phone access');
  p.setSteps([], null);
  const alias = store.settings().sshAlias;
  const wait = async (phases: string[], seconds: number) => {
    const end = Date.now() + seconds * 1000;
    for (;;) {
      const s = await grid.phoneStatus(w.name);
      const st = s?.status;
      if (st?.message) p.progress(st.message);
      if (st && phases.includes(st.phase)) return st;
      if (Date.now() > end) return st ?? null;
      await new Promise((r) => setTimeout(r, 2500));
    }
  };
  p.progress(await grid.phone('on', w.name));
  let st = await wait(['need_login', 'need_consent', 'running', 'error', 'elsewhere'], 120);
  for (let round = 0; st && (st.phase === 'need_login' || st.phase === 'need_consent') && round < 2; round++) {
    if (st.phase === 'need_login') {
      const go = await p.confirm('Phone access uses your own Claude sign-in on the grid, and there is none yet. A terminal opens; Claude Code signs you in there (click the link, Authorize, paste the code). Ashley never sees the sign-in.', 'Open the terminal', 'Not now');
      if (!go) return p.finish('Phone access is waiting for the sign-in; run this again any time.', false);
      await p.runInteractive('Sign in to Claude on the grid', 'ssh', ['-t', alias, '~/.ashley/bin/ashley', 'claude', 'login']);
    } else {
      const go = await p.confirm('Claude Code asks once whether to enable Remote Control, and you answer it yourself. A terminal opens: type y when asked, and press Ctrl+C once you see the session link. While your phone is connected, the session transcript is stored on Anthropic\'s servers, so keep confidential data out of phone sessions.', 'Open the terminal', 'Not now');
      if (!go) return p.finish('Phone access is waiting for your answer; run this again any time.', false);
      await p.runInteractive('Enable Remote Control', 'ssh', ['-t', alias, '~/.ashley/bin/ashley', 'claude', 'remote-consent']);
    }
    st = await wait(['need_login', 'need_consent', 'running', 'error', 'elsewhere'], 180);
  }
  if (st?.phase === 'running' || st?.phase === 'starting') {
    p.finish(`Phone access is on. Open the Claude app on your phone (or claude.ai/code), go to Code, and pick the session on ${w.name}. It runs as long as the worker job does; the sign-in lasts about a month and Ashley tells you when to repeat it.${st.session_url ? ` Link: ${st.session_url}` : ''}`, true);
    if (st.session_url) {
      const open = await vscode.window.showInformationMessage('Phone access is on. Open the session on this laptop too?', 'Open');
      if (open) await vscode.env.openExternal(vscode.Uri.parse(st.session_url));
    }
  } else if (st?.phase === 'elsewhere') {
    p.finish(st.message ?? 'another worker hosts phone access', true);
  } else {
    p.finish(`Phone access did not start: ${st?.message ?? 'no answer from the worker'}. Show log for details.`, false);
  }
  tree.refresh();
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

/** Commands that work before the terms are accepted: reading about Ashley and seeing its log. */
const TERMS_EXEMPT = new Set(['ashley.openManual', 'ashley.showLog', 'ashley.refresh', 'ashley.healthMenu']);

const _internal = {
  STEPS,
  testConnection,
  buildGraph,
  order,
  runDiagnostics,
  formatReport,
  storeFor: () => store,
  makeCtx: (s: AshleyStore, withNodeProbe: boolean, log: (l: string) => void) => makeCtx(s, s.wizardEnv(new SetupPanelFreeUI(output)), s.context.extensionPath, withNodeProbe, log),
  licenseGate: () => license,
  sharer: () => sharer,
  terms: {
    record: (edition: TermsEdition = 'trial') => termsRecord(context0!, edition),
    version: TERMS_VERSION,
    /** what the dialog writes, for tests that cannot click it */
    accept: async (diagnostics: 'on' | 'off' = 'off', signedName = 'Test Person', edition: TermsEdition = 'trial') => {
      const license = fs.readFileSync(path.join(context0!.extensionPath, TERMS_FILE[edition]), 'utf8');
      const privacy = fs.readFileSync(path.join(context0!.extensionPath, 'PRIVACY.md'), 'utf8');
      const rec: TermsRecord = { v: 1, terms_version: TERMS_VERSION, edition, license_sha256: sha256(license), privacy_sha256: sha256(privacy), accepted_at: new Date().toISOString(), surface: 'dialog', button_label: AGREE_BUTTON, affirmations: affirmationsFor(edition).map((a) => ({ ...a, checked: true })), signed_name: signedName, scrolled_to_end: true, diagnostics, product_version: context0!.extension.packageJSON.version, host: vscode.env.appName, host_version: vscode.version, platform: process.platform, locale: vscode.env.language, install_id: sharer.installId() };
      writeTermsRecord(rec, { license, privacy });
      await context0!.globalState.update(edition === 'full' ? 'ashley.terms.full' : 'ashley.terms', rec);
      return rec;
    },
  },
  REFUSED,
  UNGATED,
};
export { _internal };
