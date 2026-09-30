// The dependency graph Beethoven checks: every piece from the laptop's OS to the compute node, with a
// cheap check, a safe repair where one exists, the manual fix and the risk it guards against.
// Rule: a feature integrates only after its pieces are nodes here (see docs/DIAGNOSTICS.md).
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DiagNode, CheckResult } from '../core/diagnostics';
import { run, ssh, gridCli } from '../core/shell';
import { WizardEnv, stepWsuSignIn, stepGithub, stepHuggingFace, stepSshKey, stepSshConfig, stepGridInstall, testConnection, pushTokens, licenseFingerprint, stepClaudeLocal } from '../core/wizard';
import { GridRelay } from '../core/relay';
import { BeethovenStore, findClaudeExecutable } from './store';
import { isMcpRegistered, registerMcp } from './mcpRegister';
import { TERMS_VERSION } from '../core/terms';
import { termsRecord } from './terms';

interface GridDiagNode { id: string; ok: boolean; warn: boolean; skip: boolean; detail: string; repaired: string }
interface GridDiag { version: string; host: string; user: string; nodes: GridDiagNode[] }

export interface DiagCtx {
  store: BeethovenStore;
  env: WizardEnv;
  extensionPath: string;
  /** the grid's own diagnosis, fetched once per run (and again after a grid repair) */
  grid(fresh?: boolean): Promise<GridDiag | null>;
  gridRepair(): Promise<GridDiag | null>;
  withNodeProbe: boolean;
  log(line: string): void;
}

export function makeCtx(store: BeethovenStore, env: WizardEnv, extensionPath: string, withNodeProbe: boolean, log: (l: string) => void): DiagCtx {
  let cache: Promise<GridDiag | null> | null = null;
  const fetchDiag = async (args: string[]): Promise<GridDiag | null> => {
    const r = await ssh(env.settings.sshAlias, gridCli(['diag', '--json', ...args]), { timeoutMs: 240_000 });
    log(`grid diag ${args.join(' ')} -> exit ${r.code}`);
    try {
      return JSON.parse(r.stdout.trim().split('\n').pop() ?? '') as GridDiag;
    } catch {
      return null;
    }
  };
  return {
    store,
    env,
    extensionPath,
    withNodeProbe,
    log,
    grid(fresh) {
      if (!cache || fresh) cache = fetchDiag(withNodeProbe ? ['--node'] : []);
      return cache;
    },
    async gridRepair() {
      cache = fetchDiag(['--repair', ...(withNodeProbe ? ['--node'] : [])]);
      return cache;
    },
  };
}

const ok = (detail: string, warn = false): CheckResult => ({ ok: true, detail, warn });
const fail = (detail: string): CheckResult => ({ ok: false, detail });
const skip = (detail: string): CheckResult => ({ ok: true, detail, skip: true });

async function stepCheck(step: { check(env: WizardEnv): Promise<{ status: string; detail: string }> }, ctx: DiagCtx): Promise<CheckResult> {
  const r = await step.check(ctx.env);
  return r.status === 'done' ? ok(r.detail) : r.status === 'skipped' ? skip(r.detail) : fail(r.detail);
}

/** A grid node answered by `beethoven diag`; repairs go through `beethoven diag --repair` unless given. */
function gridNode(id: string, title: string, dependsOn: string[], assumption: string, manualFix: string, futureRisk: string, repair?: DiagNode<DiagCtx>['repair'], slow = false): DiagNode<DiagCtx> {
  return {
    id,
    title,
    layer: id.startsWith('node.') ? 'grid-node' : 'grid-login',
    dependsOn,
    assumption,
    manualFix,
    futureRisk,
    source: 'grid/beethoven (cmd_diag)',
    slow,
    async check(ctx) {
      const d = await ctx.grid();
      if (!d) return fail('the grid did not return a diagnosis');
      const n = d.nodes.find((x) => x.id === id);
      if (!n) return skip('not reported by this grid version');
      if (n.skip) return skip(n.detail);
      return n.ok ? ok(n.detail + (n.repaired ? ` (repaired: ${n.repaired})` : ''), n.warn) : fail(n.detail);
    },
    repair:
      repair ??
      (async (ctx) => {
        const d = await ctx.gridRepair();
        const n = d?.nodes.find((x) => x.id === id);
        return { ok: !!n?.ok, detail: n?.repaired || n?.detail || 'grid repair ran' };
      }),
  };
}

export function buildGraph(): DiagNode<DiagCtx>[] {
  const G: DiagNode<DiagCtx>[] = [];
  const add = (n: DiagNode<DiagCtx>) => G.push(n);

  // ---------------------------------------------------------------- laptop and VS Code
  add({
    id: 'laptop.os', title: 'Operating system', layer: 'laptop', dependsOn: [],
    assumption: 'Windows 10/11, macOS or Linux on x64 or arm64', manualFix: 'Beethoven supports Windows, macOS and Linux laptops',
    futureRisk: 'a new OS release changing OpenSSH or the keychain', source: 'extension/src/extension.ts',
    async check() { return ['win32', 'darwin', 'linux'].includes(process.platform) ? ok(`${process.platform} ${process.arch}`) : fail(`unsupported platform ${process.platform}`); },
  });
  add({
    id: 'laptop.openssh', title: 'OpenSSH client', layer: 'laptop', dependsOn: ['laptop.os'],
    assumption: 'ssh 7.3+ on PATH (ProxyJump); on Windows the built-in OpenSSH client',
    manualFix: 'Windows: Settings > System > Optional features > OpenSSH Client; macOS/Linux: install openssh-client',
    futureRisk: 'an OpenSSH release dropping hmac-sha1, which the grid still needs', source: 'extension/src/core/shell.ts',
    async check() {
      const r = await run('ssh', ['-V'], { timeoutMs: 15_000 });
      const v = (r.stderr + r.stdout).trim();
      const m = /OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)/.exec(v);
      if (!m) return fail(r.code === 127 ? 'ssh not found' : `unrecognised: ${v.slice(0, 80)}`);
      return +m[1] > 7 || (+m[1] === 7 && +m[2] >= 3) ? ok(v.split(',')[0]) : fail(`${v.split(',')[0]} is older than 7.3 (no ProxyJump)`);
    },
  });
  add({
    id: 'laptop.ssh-keygen', title: 'ssh-keygen', layer: 'laptop', dependsOn: ['laptop.openssh'],
    assumption: 'ssh-keygen can make ed25519 keys', manualFix: 'install the OpenSSH client (it includes ssh-keygen)', source: 'extension/src/core/wizard.ts (stepSshKey)',
    async check() {
      const r = await run('ssh-keygen', ['-?'], { timeoutMs: 15_000 });
      return /ed25519|usage/i.test(r.stderr + r.stdout) ? ok('present') : fail('not found');
    },
  });
  add({
    id: 'vscode.version', title: 'VS Code version', layer: 'vscode', dependsOn: ['laptop.os'],
    assumption: 'VS Code 1.100 or newer', manualFix: 'Help > Check for Updates', futureRisk: 'API removals in a future VS Code', source: 'extension/package.json (engines)',
    async check() {
      const [a, b] = vscode.version.split('.').map((x) => parseInt(x, 10));
      return a > 1 || b >= 100 ? ok(vscode.version) : fail(`${vscode.version} is older than 1.100`);
    },
  });
  const extNode = (id: string, extId: string, title: string, why: string): DiagNode<DiagCtx> => ({
    id, title, layer: 'vscode', dependsOn: ['vscode.version'], assumption: `${extId} installed (${why})`,
    manualFix: `install ${extId} from the Extensions view`, futureRisk: 'the extension renamed or its commands changed', source: 'extension/src/extension.ts',
    async check() { const e = vscode.extensions.getExtension(extId); return e ? ok(`${extId} ${e.packageJSON.version}`) : fail(`${extId} is not installed`); },
    async repair() {
      await vscode.commands.executeCommand('workbench.extensions.installExtension', extId);
      return { ok: true, detail: `installed ${extId} (a window reload may be needed)` };
    },
  });
  add(extNode('vscode.remote-ssh', 'ms-vscode-remote.remote-ssh', 'Remote-SSH extension', 'opening grid files and images'));
  add(extNode('vscode.claude-code', 'anthropic.claude-code', 'Claude Code extension', 'the local Claude, its own sign-in, the bridge'));
  add({
    id: 'vscode.claude-binary', title: 'Claude Code program', layer: 'vscode', dependsOn: ['vscode.claude-code'],
    assumption: 'the claude executable bundled with the Claude Code extension runs', manualFix: 'reinstall the Claude Code extension',
    futureRisk: 'the extension moving its bundled binary', source: 'extension/src/vscode/store.ts (findClaudeExecutable)',
    async check() {
      const r = await run(findClaudeExecutable(), ['--version'], { timeoutMs: 30_000 });
      return r.code === 0 ? ok(r.stdout.trim()) : fail(`${findClaudeExecutable()} did not run: ${(r.stderr || r.stdout).trim().slice(0, 120)}`);
    },
  });
  add({
    id: 'vscode.shell-integration', title: 'Terminal shell integration', layer: 'vscode', dependsOn: ['vscode.version'],
    assumption: 'terminal.integrated.shellIntegration.enabled is on (Beethoven reads the Claude token from the terminal)',
    manualFix: 'Settings: Terminal > Integrated > Shell Integration: Enabled', source: 'extension/src/vscode/panel.ts (runCapturing)',
    async check() { return vscode.workspace.getConfiguration('terminal.integrated').get<boolean>('shellIntegration.enabled', true) ? ok('enabled') : fail('disabled'); },
    async repair() { await vscode.workspace.getConfiguration('terminal.integrated').update('shellIntegration.enabled', true, vscode.ConfigurationTarget.Global); return { ok: true, detail: 'enabled' }; },
  });
  add({
    id: 'vscode.secret-storage', title: 'Keychain (VS Code secret storage)', layer: 'vscode', dependsOn: ['vscode.version'],
    assumption: 'tokens can be stored and read back from the OS keychain', manualFix: 'Linux: install a keyring (gnome-keyring or kwallet); restart VS Code',
    futureRisk: 'a keychain backend change', source: 'extension/src/vscode/store.ts',
    async check(ctx) {
      const probe = `beethoven-probe-${Date.now()}`;
      await ctx.store.setSecretRaw('beethoven.diag-probe', probe);
      const back = await ctx.store.getSecretRaw('beethoven.diag-probe');
      await ctx.store.setSecretRaw('beethoven.diag-probe', undefined);
      return back === probe ? ok('write and read back work') : fail('a stored value did not read back');
    },
  });
  add({
    id: 'vscode.remote-ssh-settings', title: 'Remote-SSH settings for the grid', layer: 'vscode', dependsOn: ['vscode.remote-ssh'],
    assumption: 'remote.SSH.connectTimeout >= 300 (compute nodes take ~25 s per session; the first connection downloads the server)',
    manualFix: 'Settings: remote.SSH.connectTimeout = 300', futureRisk: 'Remote-SSH changing its timeout semantics', source: 'extension/src/extension.ts (commandConnect)',
    async check() { const t = vscode.workspace.getConfiguration('remote.SSH').get<number>('connectTimeout', 15); return t >= 300 ? ok(`connectTimeout ${t}`) : fail(`connectTimeout ${t} s is too short for the grid's compute nodes`); },
    async repair() { await vscode.workspace.getConfiguration('remote.SSH').update('connectTimeout', 300, vscode.ConfigurationTarget.Global); return { ok: true, detail: 'set to 300 s' }; },
  });
  add({
    id: 'network.internet', title: 'Internet from this laptop', layer: 'network', dependsOn: ['laptop.os'],
    assumption: 'HTTPS to github.com, huggingface.co and anthropic.com', manualFix: 'check the Wi-Fi; some campus networks block token checks (the grid checks them instead)',
    source: 'extension/src/core/wizard.ts (validateToken)',
    async check() {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 10_000);
        const r = await fetch('https://api.github.com/zen', { signal: ctl.signal });
        clearTimeout(t);
        return ok(`HTTPS works (github ${r.status})`);
      } catch (e) {
        return ok(`this laptop's network refused an HTTPS check (${(e as Error).message}); the grid verifies tokens instead`, true);
      }
    },
  });

  // ---------------------------------------------------------------- the license (everything personal waits on it)
  add({
    id: 'laptop.terms', title: 'License terms accepted', layer: 'account', dependsOn: ['vscode.version'],
    assumption: 'the current version of the agreement and privacy statement was accepted in the signing dialog, and the record with the texts is on this laptop',
    manualFix: 'run any Beethoven command: the signing dialog appears; Beethoven: Read the license terms shows the text',
    fixCommand: { command: 'beethoven.terms', title: 'Accept the terms' },
    futureRisk: 'a new terms version (every installation is asked again); the record folder deleted by hand',
    source: 'extension/src/core/terms.ts, extension/src/vscode/termsPanel.ts',
    async check(ctx) {
      const r = termsRecord(ctx.store.context);
      if (!r) return fail(`the terms (version ${TERMS_VERSION}) have not been accepted on this laptop`);
      return ok(`version ${r.terms_version} accepted ${r.accepted_at.slice(0, 10)} by ${r.signed_name}`);
    },
  });
  add({
    id: 'laptop.license', title: 'Beethoven license', layer: 'account', dependsOn: ['laptop.terms'],
    assumption: 'a license key signed by a key this release trusts, in date (or in its grace period), not withdrawn',
    manualFix: 'Beethoven: License, then paste the key your lead sent; a new key if it ended or was withdrawn',
    fixCommand: { command: 'beethoven.license', title: 'Enter the key' },
    futureRisk: 'the signing key rotating (a new release trusts the new key); the revocation list address moving',
    source: 'grid/license.js, extension/src/core/license.ts, extension/src/vscode/licenseGate.ts',
    async check(ctx) {
      const g = ctx.store.licenseGate;
      if (!g) return skip('no license gate in this host');
      const c = g.check(true);
      if (!c.ok) return fail(c.detail);
      return ok(`${c.payload?.edition} license ${c.payload?.lid}: ${c.detail}`, c.status === 'grace' || (c.daysLeft ?? 999) <= 30);
    },
  });
  add({
    id: 'account.license-identity', title: 'License names the signed-in person', layer: 'account', dependsOn: ['laptop.license', 'account.wsu'],
    assumption: 'the AccessID (or e-mail) in the license matches the Wayne State sign-in Beethoven recorded',
    manualFix: 'sign in with the account the license names (setup step "Sign in with Wayne State"), or ask your lead for a license in your name',
    fixCommand: { command: 'beethoven.wsuSignIn', title: 'Sign in with Wayne State' },
    futureRisk: 'Wayne State changing the sign-in e-mail format (AccessID@wayne.edu)',
    source: 'grid/license.js (identityMatches), extension/src/core/wizard.ts (stepWsuSignIn)',
    async check(ctx) {
      const g = ctx.store.licenseGate;
      if (!g) return skip('no license gate in this host');
      const c = g.check(true);
      if (c.identity === true) return ok(`the license is for ${g.identity()?.accessId ?? g.identity()?.email}`);
      if (c.identity === null) return fail('no Wayne State sign-in recorded yet: run the setup step "Sign in with Wayne State"');
      return fail(c.detail);
    },
  });

  // ---------------------------------------------------------------- accounts (the wizard's own checks)
  add({ id: 'account.wsu', title: 'Wayne State sign-in and the lab list', layer: 'account', dependsOn: ['vscode.version', 'laptop.license'], assumption: 'signed in with AccessID@wayne.edu; AccessID on the pre-approved list',
    manualFix: 'run the wizard step "Sign in with Wayne State"; if not on the list, ask your lead', futureRisk: 'the WSU tenant blocking VS Code sign-in', source: 'extension/src/core/wizard.ts (stepWsuSignIn)',
    fixCommand: { command: 'beethoven.wsuSignIn', title: 'Sign in with Wayne State' },
    check: (ctx) => stepCheck(stepWsuSignIn, ctx) });
  // the fix button and the token's row in the Beethoven view run the wizard's own step for that token
  const tokenNode = (id: string, step: typeof stepGithub, title: string): DiagNode<DiagCtx> => ({
    id, title, layer: 'account', dependsOn: ['account.wsu'], assumption: `${title} stored in the keychain and accepted by the service`,
    manualFix: `press Renew next to "${step.title}" in the setup panel, or click its row in the Beethoven view`, futureRisk: 'token formats or scopes changing', source: 'extension/src/core/wizard.ts (tokenStep)',
    fixCommand: { command: 'beethoven.renewToken', title: 'Renew', arguments: [step.id] },
    check: (ctx) => stepCheck(step, ctx),
  });
  add(tokenNode('account.github', stepGithub, 'GitHub token'));
  add(tokenNode('account.huggingface', stepHuggingFace, 'Hugging Face token'));
  add({ id: 'account.claude', title: 'Claude on this laptop', layer: 'account', dependsOn: ['account.wsu', 'vscode.claude-binary'],
    assumption: 'Claude Code on this laptop is signed in with the student\'s own Claude Pro or Max subscription (Beethoven reads status only)',
    manualFix: 'sign in to Claude Code on this laptop (setup step "Claude on this laptop")', futureRisk: 'claude auth status changing its output; plan names changing', source: 'extension/src/core/wizard.ts (stepClaudeLocal)',
    fixCommand: { command: 'beethoven.claudeLocalSignIn', title: 'Sign in' },
    check: (ctx) => stepCheck(stepClaudeLocal, ctx) });

  // ---------------------------------------------------------------- SSH to the grid
  add({ id: 'laptop.ssh-key', title: 'SSH key for the grid', layer: 'laptop', dependsOn: ['laptop.ssh-keygen', 'account.wsu'], assumption: '~/.ssh/id_ed25519_wsu and .pub exist',
    manualFix: 'run the wizard steps "SSH key" and "Log in to the grid once"', source: 'extension/src/core/wizard.ts (stepSshKey)', check: (ctx) => stepCheck(stepSshKey, ctx) });
  add({ id: 'laptop.ssh-config', title: 'SSH configuration block', layer: 'laptop', dependsOn: ['laptop.ssh-key'],
    assumption: 'the Beethoven block in ~/.ssh/config is current (jump host, MACs +hmac-sha1, AddressFamily inet, *.nas.grid.wayne.edu)',
    manualFix: 'run the wizard step "SSH configuration"', futureRisk: 'the grid dropping hmac-sha1 or renaming nodes', source: 'extension/src/core/sshConfig.ts',
    check: (ctx) => stepCheck(stepSshConfig, ctx),
    async repair(ctx) { const r = await stepSshConfig.run(ctx.env); return { ok: r.status === 'done', detail: r.detail }; } });
  add({ id: 'network.grid-login', title: 'Login node without a prompt', layer: 'network', dependsOn: ['laptop.openssh', 'laptop.ssh-config'],
    assumption: 'ssh -o BatchMode=yes wsu-grid answers (key installed, no password or code)',
    manualFix: 'Permission denied: run "Log in to the grid once" again; timed out: check the network (the grid accepts SSH from anywhere)',
    futureRisk: 'the login host renamed, 2FA enforced for keys', source: 'extension/src/core/wizard.ts (testConnection)',
    async check(ctx) {
      const t0 = Date.now();
      const t = await testConnection(ctx.env.settings.sshAlias);
      const s = (Date.now() - t0) / 1000;
      if (!t.ok) return fail(t.error.split('\n').pop() || 'no answer');
      return ok(`${t.hostname} in ${s.toFixed(1)} s`, s > 6);
    } });
  add({ id: 'laptop.relay', title: 'Prompt relay (open session)', layer: 'network', dependsOn: ['grid.relay'],
    assumption: 'one persistent ssh session carries prompts in tens of milliseconds', manualFix: 'Beethoven falls back to one ssh per prompt; check the grid relay node', source: 'extension/src/core/relay.ts',
    async check(ctx) {
      const r = new GridRelay(ctx.env.settings.sshAlias);
      try {
        await r.ensure();
        const p = await r.ping();
        return ok(`round trip ${p.rttMs} ms`, p.rttMs > 1000);
      } catch (e) {
        return fail((e as Error).message);
      } finally {
        r.close();
      }
    } });

  // ---------------------------------------------------------------- the grid (answered by `beethoven diag`)
  G.push({ ...gridNode('grid.scripts', 'Beethoven scripts on the grid', ['network.grid-login'], 'the grid has this extension\'s scripts (same version, LF line endings)',
    'run the wizard step "Install on the grid"', 'a home directory restore or clean-up removing ~/.beethoven',
    async (ctx) => { const r = await stepGridInstall.run(ctx.env); await ctx.grid(true); return { ok: r.status === 'done', detail: `re-uploaded: ${r.detail}` }; }),
    async check(ctx) {
      const d = await ctx.grid();
      if (!d) return fail('Beethoven does not answer on the grid (not installed?)');
      const n = d.nodes.find((x) => x.id === 'grid.scripts');
      let want = '';
      try { want = fs.readFileSync(path.join(ctx.env.settings.gridScriptsDir, 'VERSION'), 'utf8').trim(); } catch { /* none */ }
      if (want && String(d.version) !== want) return fail(`the grid runs Beethoven v${d.version}; this extension brings v${want}`);
      return n?.ok ? ok(n.detail) : fail(n?.detail ?? 'scripts missing');
    } });
  add(gridNode('grid.bashrc-block', 'Beethoven block in ~/.bashrc', ['grid.scripts'], 'the block exporting the VS Code sysroot variables and PATH', 'ssh wsu-grid "~/.beethoven/bin/beethoven install"', 'a new default .bashrc from C&IT'));
  add(gridNode('grid.vscode-sysroot', 'VS Code compatibility libraries (C&IT sysroot)', ['grid.bashrc-block'], '/wsu/apps/vscode sysroot and patchelf exist at the paths in the block', 'ask hpc@wayne.edu where the VS Code sysroot moved', 'Wayne State moving or upgrading the sysroot (repair rediscovers it)'));
  add(gridNode('grid.login-tmp', 'Nothing of yours left under /tmp on the login node', ['grid.scripts'], 'no container build leftovers (rootfs-*, build-temp-*, apptainer*) or files over 50 MB of yours under /tmp on the login node, which C&IT keeps free of user files; Beethoven builds containers only inside Slurm jobs with node-local temp and cache', 'ssh wsu-grid and remove your files under /tmp (repair removes the recognisable leftovers)', 'a container command run by hand on the login node; a build job killed before its cleanup trap'));
  add(gridNode('grid.slurm', 'Slurm commands', ['grid.scripts'], 'sbatch, squeue, sacct, scancel work on the login node', 'contact hpc@wayne.edu', 'a Slurm upgrade changing output formats'));
  add(gridNode('grid.slurm-visibility', 'Access requests visible to the admin', ['grid.slurm'], 'Slurm PrivateData=none (the admin sees the held access-request jobs)', 'the admin can grant directly without a request', 'C&IT enabling PrivateData=jobs'));
  add(gridNode('grid.qos', 'Slurm partitions and QoS', ['grid.slurm'], 'the account has the requeue or secondary QoS', 'ask your lead / hpc@wayne.edu for the QoS', 'QoS renamed by C&IT'));
  add(gridNode('grid.internet', 'Internet from the grid', ['grid.scripts'], 'HTTPS from the login node; curl reads secrets from stdin (-K -)', 'contact hpc@wayne.edu', 'a proxy introduced on the grid'));
  add(gridNode('grid.acl-tools', 'ACL tools (setfacl/getfacl)', ['grid.scripts'], 'POSIX ACL tools present (lab access)', 'contact hpc@wayne.edu', 'the lab volume moved to a filesystem without ACLs'));
  add(gridNode('grid.home-quota', 'Home directory quota', ['grid.scripts'], 'home below 98 % of its soft quota', 'delete or move large files; ask your lead for lab storage', 'quota policy changes'));
  const pushRepair: DiagNode<DiagCtx>['repair'] = async (ctx) => { const r = await pushTokens(ctx.env); await ctx.grid(true); return r; };
  add(gridNode('grid.token-github', 'GitHub token on the grid', ['grid.internet', 'account.github'], 'the grid copy of the GitHub token verifies', 'press Renew next to GitHub', 'GitHub token expiry policies', pushRepair));
  add(gridNode('grid.token-hf', 'Hugging Face token on the grid', ['grid.internet', 'account.huggingface'], 'the grid copy of the Hugging Face token verifies', 'press Renew next to Hugging Face', 'Hugging Face token changes', pushRepair));
  add({ ...gridNode('grid.claude-login', 'Claude signed in on the grid', ['grid.scripts', 'account.claude'], 'Claude Code on the grid reports its own sign-in (made by the student with beethoven claude login; Beethoven never touches the credential)', 'run Beethoven: Sign in to Claude on the grid (the sign-in lasts about a month)', 'Anthropic changing the login flow or its lifetime', undefined),
    fixCommand: { command: 'beethoven.claudeSignIn', title: 'Sign in on the grid' } });
  add({
    id: 'grid.license', title: 'Beethoven license on the grid', layer: 'grid-login', dependsOn: ['grid.scripts', 'account.license-identity'],
    assumption: 'the grid has the same license key as this laptop, and every running worker accepts it for this grid account',
    manualFix: 'Troubleshoot and repair copies it; a worker started before licensing needs a restart (Beethoven: Stop a worker, then Start)',
    futureRisk: 'a worker template older than the license check', source: 'grid/beethoven (cmd_diag, license_fp), grid/beethovend.js (checkLicense)',
    async check(ctx) {
      const d = await ctx.grid();
      const n = d?.nodes.find((x) => x.id === 'grid.license');
      if (!n) return fail('this grid version does not check licenses (install on the grid again)');
      if (!n.ok) return fail(n.detail);
      const here = licenseFingerprint(ctx.store.licenseGate?.key());
      const there = /license ([0-9a-f]{16})/.exec(n.detail)?.[1];
      if (here && there && here !== there) return fail('the grid has a different license key than this laptop (repair copies this one)');
      return ok(n.detail);
    },
    repair: pushRepair,
  });
  add(gridNode('grid.accounts', 'Claude accounts on the grid', ['grid.claude-login'], 'one subscription token per person, no copied logins, and every account shares one session history (so a conversation survives a move to your API key)', 'Troubleshoot and repair links the history; remove extra accounts with: ssh wsu-grid "beethoven accounts remove NAME"', 'Claude Code moving where --resume looks for transcripts', undefined));
  add(gridNode('grid.lab-access', 'Lab access', ['account.claude', 'grid.token-github', 'grid.token-hf', 'grid.slurm'], 'the lab folder is readable (approved), or a request is pending', 'the last wizard step: Join the lab', 'the lab folder moving'));
  add(gridNode('grid.runtime', 'Container runtime (Apptainer)', ['grid.scripts'], 'the configured apptainer executable exists (repair switches to the current module)', 'ask your lead to republish the container', 'Wayne State upgrading or removing the apptainer module'));
  add(gridNode('grid.container', 'Lab Claude container', ['grid.lab-access', 'grid.runtime'], 'the lab container is adopted (repair runs beethoven adopt)', 'wait for lab access', 'a republished container at a new path'));
  add(gridNode('grid.relay', 'Prompt relay on the login node', ['grid.scripts'], 'beethoven relay answers PING', 'reinstall Beethoven on the grid', 'bash changes on the login node'));
  add(gridNode('grid.lab-folder', 'Lab folder layout (admin)', ['grid.acl-tools'], 'the lab folder is closed to other users and requests go through Slurm', 'ssh wsu-grid "beethoven access init"', 'someone widening permissions by hand'));
  add({
    id: 'grid.worker', title: 'Claude workers', layer: 'grid-slurm', dependsOn: ['grid.container', 'grid.qos'],
    assumption: 'every running worker job has a daemon that answers (heartbeat under 90 s)', manualFix: 'Beethoven: Stop a worker, then Start a worker',
    futureRisk: 'node images changing under the container', source: 'grid/beethovend.js, grid/worker.sbatch.tpl',
    async check(ctx) {
      const d = await ctx.grid();
      const ws = (d?.nodes ?? []).filter((x) => x.id.startsWith('grid.worker'));
      if (!ws.length || ws.every((w) => w.skip)) return skip('no worker running');
      const dead = ws.filter((w) => !w.ok);
      return dead.length ? fail(dead.map((w) => `${w.id.replace('grid.worker.', '')}: ${w.detail}`).join('; ')) : ok(ws.filter((w) => !w.skip).map((w) => `${w.id.replace('grid.worker.', '')}: ${w.detail}`).join('; '), ws.some((w) => w.warn));
    },
    async repair(ctx) {
      const d = await ctx.grid();
      const dead = (d?.nodes ?? []).filter((x) => x.id.startsWith('grid.worker.') && !x.ok).map((x) => x.id.replace('grid.worker.', ''));
      const outs: string[] = [];
      for (const w of dead) {
        const r = await ssh(ctx.env.settings.sshAlias, gridCli(['worker', 'restart', '--name', w]), { timeoutMs: 120_000 });
        outs.push((r.stdout + r.stderr).trim());
      }
      await ctx.grid(true);
      return { ok: outs.length > 0, detail: outs.join('; ') || 'nothing to restart' };
    },
  });
  add(gridNode('grid.slurm-in-worker', 'Slurm inside the workers', ['grid.worker'], 'the worker\'s Claude can submit and watch Slurm jobs from inside its container (the host client, its library, munge and the config are bound in)', 'Troubleshoot and repair restarts a worker started before version 3; if it still fails, tell your lead (the detail names the missing piece)', 'Wayne State moving the Slurm client, its library, munge or slurm.conf; a Slurm upgrade that needs more host libraries'));
  add(gridNode('node.probe', 'Compute node and container', ['grid.worker'], 'inside a worker: the container runs node and Claude Code, has a pseudo-terminal and HTTPS', 'restart the worker; if it persists tell your lead', 'a node OS or kernel update breaking the container', undefined, true));
  add({
    id: 'grid.phone', title: 'Phone access', layer: 'grid-node', dependsOn: ['grid.worker'], assumption: 'when turned on, the worker\'s Remote Control session runs',
    manualFix: 'Beethoven: Phone access (sign in again if asked)', futureRisk: 'Remote Control flags or login flow changing', source: 'grid/phone.js',
    async check(ctx) {
      const r = await ssh(ctx.env.settings.sshAlias, gridCli(['phone', 'status', '--worker', 'default', '--json']), { timeoutMs: 60_000 });
      if (r.code !== 0) return skip('no default worker');
      try {
        const j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
        if (!j.enabled) return skip('phone access is off');
        const ph = j.status?.phase;
        if (ph === 'elsewhere') return ok(`hosted by worker ${j.host?.worker ?? '?'}${j.host?.node ? ` on ${j.host.node}` : ''}`, true);
        return ph === 'running' ? ok(`running${j.status.session_url ? ` (${j.status.session_url})` : ''}`) : ph === 'error' ? fail(j.status.message) : ok(`${ph}: ${j.status.message ?? ''}`, true);
      } catch {
        return fail('unreadable phone status');
      }
    },
  });

  // ---------------------------------------------------------------- the bridge to the local Claude
  add({
    id: 'vscode.mcp-bridge', title: 'Claude Code bridge to the grid (MCP)', layer: 'vscode', dependsOn: ['vscode.claude-binary', 'network.grid-login'],
    assumption: 'the beethoven MCP server is registered with Claude Code and connects', manualFix: 'Beethoven: Connect the Claude Code extension to the grid',
    futureRisk: 'claude mcp CLI changes; Electron-as-node removed from VS Code', source: 'extension/src/vscode/mcpRegister.ts',
    async check() { return (await isMcpRegistered()) ? ok('registered') : fail('not registered'); },
    async repair(ctx) { const r = await registerMcp(ctx.extensionPath, ctx.env.settings.sshAlias, ctx.log); return { ok: r.ok, detail: `${r.how}: ${r.detail.split('\n')[0]}` }; },
  });
  return G;
}
