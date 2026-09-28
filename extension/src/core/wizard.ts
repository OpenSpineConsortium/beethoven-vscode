// The setup wizard as a list of resumable steps over an abstract environment.
// The VS Code extension (a webview panel) and the terminal CLI each provide a `WizardEnv`;
// the steps never import 'vscode'. Every step has a `check` that says whether it is already
// done, so the wizard can be rerun at any time and only does what is missing.
//
// Design rules from the students' feedback (2026-09-27):
//  - native to the OS: nothing is mirrored into WSL, nothing needs a second shell;
//  - tokens arrive by sign-in where the service allows it (GitHub through VS Code's own
//    GitHub sign-in), otherwise by one copy that the panel detects on the clipboard;
//  - the password-and-code login happens inside the panel (ssh2), the terminal is a fallback;
//  - a token that cannot be verified because of the laptop's network is kept and verified on
//    the grid; only a token the service rejects is refused.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SERVICES, ServiceConfig, SecretId, normaliseAccessId, gridHome } from './services';
import { upsertBlock, hasBlock, SshTargets } from './sshConfig';
import { run, ssh, scp, expandHome, isWindows } from './shell';
import { parseSbatchId } from './slurm';

export type StepStatus = 'done' | 'todo' | 'skipped' | 'failed';

export interface StepReport {
  id: string;
  title: string;
  status: StepStatus;
  detail: string;
}

export interface WizardSettings {
  accessId: string;
  loginHost: string;
  sshAlias: string;
  nodeDomain: string;
  identityFile: string; // tilde form
  gridRoot: string;
  /** Directory holding the grid-side scripts to upload (dist/grid). */
  gridScriptsDir: string;
  /** Path to a claude executable for `claude setup-token`, or 'claude' if on PATH. */
  claudeExecutable: string;
}

export interface TokenAskOptions {
  /** What a valid token looks like; the UI uses it to recognise one on the clipboard. */
  pattern: RegExp;
  /** Shown above the field. */
  instructions?: string;
  /** Optional page to open first (button in the UI). */
  url?: string;
  optional?: boolean;
}

export interface WizardUI {
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  /** Returns the string, or undefined if the student cancelled. */
  ask(prompt: string, opts?: { password?: boolean; placeholder?: string; value?: string; validate?: (v: string) => string | null }): Promise<string | undefined>;
  confirm(message: string, yes: string, no: string): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  /** Run an interactive command in a terminal the student can type into. Resolves with the exit code when known. */
  runInteractive(title: string, command: string, args: string[]): Promise<number | null>;
  progress(message: string): void;
  /** A token field that also watches the clipboard; falls back to ask() when not implemented. */
  askToken?(prompt: string, opts: TokenAskOptions): Promise<string | undefined>;
}

export interface WizardEnv {
  settings: WizardSettings;
  saveSetting<K extends keyof WizardSettings>(key: K, value: WizardSettings[K]): Promise<void>;
  getSecret(id: SecretId): Promise<string | undefined>;
  setSecret(id: SecretId, value: string | undefined): Promise<void>;
  ui: WizardUI;
  onTokensChanged?(): Promise<void>;
  /** Sign in to GitHub through the host (VS Code's GitHub authentication). Returns the OAuth token. */
  signInGitHub?(): Promise<{ token: string; login?: string } | undefined>;
  /** Install the public key with a password + code typed in the UI (ssh2). */
  installKeyWithPassword?(pub: string): Promise<{ ok: boolean; detail: string; authFailure?: boolean }>;
}

export interface WizardStep {
  id: string;
  title: string;
  /** One line for the panel's step list. */
  blurb: string;
  check(env: WizardEnv): Promise<StepReport>;
  run(env: WizardEnv): Promise<StepReport>;
}

function report(id: string, title: string, status: StepStatus, detail: string): StepReport {
  return { id, title, status, detail };
}

function sshConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config');
}

function targets(s: WizardSettings): SshTargets {
  return { accessId: s.accessId, loginHost: s.loginHost, alias: s.sshAlias, nodeDomain: s.nodeDomain, identityFile: s.identityFile, includeGridAlias: true };
}

export async function testConnection(alias: string): Promise<{ ok: boolean; hostname: string; error: string }> {
  const r = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'AddressFamily=inet', '-o', 'GSSAPIAuthentication=no', alias, 'hostname'], { timeoutMs: 40_000 });
  const hostname = r.stdout.trim().split(/\s+/)[0] ?? '';
  return { ok: r.code === 0 && hostname.length > 0, hostname, error: r.stderr.trim() };
}

async function askToken(ui: WizardUI, prompt: string, opts: TokenAskOptions): Promise<string | undefined> {
  if (ui.askToken) return ui.askToken(prompt, opts);
  if (opts.url) {
    const go = await ui.confirm(`${prompt}\n\n${opts.instructions ?? ''}`, 'Open the page', opts.optional ? 'Skip' : 'I already have one');
    if (go) await ui.openUrl(opts.url);
    else if (opts.optional) return '';
  }
  return ui.ask(prompt, { password: true, validate: (x) => (x.trim() === '' && opts.optional ? null : opts.pattern.test(x.trim()) ? null : 'That does not look like the right kind of token.') });
}

// ---------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------

export const stepAccessId: WizardStep = {
  id: 'accessId',
  title: 'Wayne State AccessID',
  blurb: 'Your grid username, e.g. ab1234.',
  async check(env) {
    const id = normaliseAccessId(env.settings.accessId ?? '');
    return id ? report(this.id, this.title, 'done', `${id}; grid home ${gridHome(id)}`) : report(this.id, this.title, 'todo', 'not set');
  },
  async run(env) {
    const v = await env.ui.ask('Your Wayne State AccessID (two letters and four digits). It is your grid username.', {
      value: env.settings.accessId,
      placeholder: 'ab1234',
      validate: (x) => (normaliseAccessId(x) ? null : 'An AccessID looks like ab1234 (two letters, four digits).'),
    });
    if (!v) return report(this.id, this.title, 'skipped', 'cancelled');
    const id = normaliseAccessId(v)!;
    await env.saveSetting('accessId', id);
    env.settings.accessId = id;
    return report(this.id, this.title, 'done', id);
  },
};

export const stepSshKey: WizardStep = {
  id: 'sshKey',
  title: 'SSH key',
  blurb: 'An ed25519 key on this laptop, no passphrase, so nothing ever prompts.',
  async check(env) {
    const key = expandHome(env.settings.identityFile);
    return fs.existsSync(key) && fs.existsSync(key + '.pub') ? report(this.id, this.title, 'done', key) : report(this.id, this.title, 'todo', 'no key yet');
  },
  async run(env) {
    const key = expandHome(env.settings.identityFile);
    fs.mkdirSync(path.dirname(key), { recursive: true });
    if (fs.existsSync(key) && fs.existsSync(key + '.pub')) return report(this.id, this.title, 'done', key);
    env.ui.progress('Generating the key...');
    const r = await run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `${env.settings.accessId}@wayne.edu ashley`, '-f', key], { timeoutMs: 60_000 });
    if (r.code !== 0 || !fs.existsSync(key + '.pub')) return report(this.id, this.title, 'failed', `ssh-keygen failed: ${(r.stderr || r.stdout).trim()}`);
    if (!isWindows()) fs.chmodSync(key, 0o600);
    return report(this.id, this.title, 'done', `created ${key}`);
  },
};

export const stepSshConfig: WizardStep = {
  id: 'sshConfig',
  title: 'SSH configuration',
  blurb: 'The login node becomes a jump host; every compute node is one hop away.',
  async check(env) {
    const p = sshConfigPath();
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    return hasBlock(text) && upsertBlock(text, targets(env.settings)) === text ? report(this.id, this.title, 'done', p) : report(this.id, this.title, 'todo', 'block missing or outdated');
  },
  async run(env) {
    const p = sshConfigPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const next = upsertBlock(text, targets(env.settings));
    if (next !== text) {
      if (text) fs.copyFileSync(p, p + '.ashley.bak');
      fs.writeFileSync(p, next, { mode: 0o600 });
    }
    return report(this.id, this.title, 'done', `wrote ${p}`);
  },
};

export const stepInstallKey: WizardStep = {
  id: 'installKey',
  title: 'Log in to the grid once',
  blurb: 'Your grid password and the six-digit code, once; after this the grid never asks again.',
  async check(env) {
    const t = await testConnection(env.settings.sshAlias);
    return t.ok ? report(this.id, this.title, 'done', `${env.settings.sshAlias} answers as ${t.hostname}`) : report(this.id, this.title, 'todo', 'the grid does not accept the key yet');
  },
  async run(env) {
    const pub = fs.readFileSync(expandHome(env.settings.identityFile) + '.pub', 'utf8').trim();
    if (env.installKeyWithPassword) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const r = await env.installKeyWithPassword(pub);
        if (r.ok) break;
        if (r.detail === 'cancelled') return report(this.id, this.title, 'skipped', 'cancelled');
        if (r.authFailure && attempt < 3) {
          await env.ui.warn(`The grid rejected that password or code (attempt ${attempt} of 3). Try again.`);
          continue;
        }
        if (!r.authFailure) {
          env.ui.progress(`In-panel login did not work (${r.detail}); falling back to a terminal.`);
          break;
        }
        return report(this.id, this.title, 'failed', r.detail);
      }
    }
    let t = await testConnection(env.settings.sshAlias);
    if (!t.ok) {
      const remote = `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '${pub}' ~/.ssh/authorized_keys || echo '${pub}' >> ~/.ssh/authorized_keys; echo ASHLEY-KEY-INSTALLED`;
      await env.ui.info('A terminal will ask for your grid PASSWORD, then the six-digit Google Authenticator CODE. Once.');
      const code = await env.ui.runInteractive('Ashley: install key on the grid', 'ssh', [
        '-o', 'MACs=+hmac-sha1', '-o', 'PubkeyAuthentication=no', '-o', 'StrictHostKeyChecking=accept-new', `${env.settings.accessId}@${env.settings.loginHost}`, remote,
      ]);
      if (code !== null && code !== 0) return report(this.id, this.title, 'failed', `ssh exited with ${code}`);
      t = await testConnection(env.settings.sshAlias);
    }
    return t.ok ? report(this.id, this.title, 'done', `${env.settings.sshAlias} answers as ${t.hostname}`) : report(this.id, this.title, 'failed', `still prompted: ${t.error}`);
  },
};

export async function validateToken(svc: ServiceConfig, token: string): Promise<{ ok: boolean; detail: string; network: boolean }> {
  if (!svc.validate) return { ok: true, detail: 'no online check for this service', network: false };
  try {
    const headers: Record<string, string> = { 'User-Agent': 'ashley-wsu' };
    if (svc.validate.header === 'Authorization') headers.Authorization = `Bearer ${token}`;
    else headers['X-Api-Key'] = token;
    if (svc.id === 'anthropicApiKey') headers['anthropic-version'] = '2023-06-01';
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    const res = await fetch(svc.validate.url, { headers, signal: ctl.signal });
    clearTimeout(t);
    if (res.status === 401 || res.status === 403) return { ok: false, detail: `the service rejected it (HTTP ${res.status})`, network: false };
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, network: true };
    const j = (await res.json()) as Record<string, unknown>;
    const f = svc.validate.expectField;
    const who = f ? j[f] : 'ok';
    return { ok: true, detail: typeof who === 'string' ? who : 'ok', network: false };
  } catch (e) {
    return { ok: false, detail: `this laptop's network refused the check (${(e as Error).message})`, network: true };
  }
}

function tokenStep(svc: ServiceConfig, blurb: string): WizardStep {
  return {
    id: svc.id,
    title: svc.name.split(' (')[0],
    blurb,
    async check(env) {
      const v = await env.getSecret(svc.id);
      if (v) return report(svc.id, this.title, 'done', 'stored in the OS keychain');
      return report(svc.id, this.title, svc.optional ? 'skipped' : 'todo', svc.optional ? 'optional, not set' : 'not set');
    },
    async run(env) {
      let token: string | undefined;
      let via = 'pasted';
      if (svc.id === 'github' && env.signInGitHub) {
        env.ui.progress('Opening GitHub sign-in in your browser...');
        try {
          const s = await env.signInGitHub();
          if (s) {
            token = s.token;
            via = `signed in as ${s.login ?? 'you'}`;
          }
        } catch (e) {
          env.ui.progress(`GitHub sign-in did not complete (${(e as Error).message}); you can paste a token instead.`);
        }
      }
      if (!token && svc.id === 'claudeOauth') {
        const go = await env.ui.confirm(`${svc.instructions}\n\nRun "claude setup-token" now? A terminal opens, your browser asks you to approve, the terminal prints the token; copy it and the panel picks it up.`, 'Run it', 'I already have a token');
        if (go) await env.ui.runInteractive('Ashley: claude setup-token', env.settings.claudeExecutable, ['setup-token']);
      }
      if (!token) {
        const v = await askToken(env.ui, svc.prompt, { pattern: svc.pattern!, instructions: svc.instructions, url: svc.tokenUrl, optional: svc.optional });
        if (v === undefined) return report(svc.id, this.title, 'skipped', 'cancelled');
        if (v.trim() === '' && svc.optional) return report(svc.id, this.title, 'skipped', 'skipped');
        token = v.trim();
      }
      const check = await validateToken(svc, token);
      if (!check.ok && !check.network) {
        await env.ui.warn(`${this.title}: ${check.detail}. Please create a new one.`);
        return report(svc.id, this.title, 'failed', check.detail);
      }
      await env.setSecret(svc.id, token);
      await env.onTokensChanged?.();
      return report(svc.id, this.title, 'done', check.ok ? `${via}; verified as ${check.detail}` : `${via}; ${check.detail}; it will be verified on the grid`);
    },
  };
}

export const stepGithub = tokenStep(SERVICES.find((s) => s.id === 'github')!, 'Sign in with your browser; the token arrives by itself.');
export const stepHuggingFace = tokenStep(SERVICES.find((s) => s.id === 'huggingface')!, 'Create a token on the page that opens; copy it; the panel notices.');
export const stepClaudeToken = tokenStep(SERVICES.find((s) => s.id === 'claudeOauth')!, 'claude setup-token: approve in the browser, copy the printed token.');
export const stepAnthropicKey = tokenStep(SERVICES.find((s) => s.id === 'anthropicApiKey')!, 'Optional pay-per-use overflow for the grid worker.');

export function gridScriptFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).map((f) => path.join(dir, f)).filter((p) => fs.statSync(p).isFile());
}

export const stepGridInstall: WizardStep = {
  id: 'gridInstall',
  title: 'Install on the grid',
  blurb: 'Scripts, your tokens (files with mode 600), a bashrc block, and a job that builds the container.',
  async check(env) {
    const r = await ssh(env.settings.sshAlias, ['~/.ashley/bin/ashley', 'status', '--json'], { timeoutMs: 60_000 });
    if (r.code !== 0) return report(this.id, this.title, 'todo', 'not installed on the grid');
    try {
      const j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
      const missing: string[] = [];
      const gridSecrets: string[] = Array.isArray(j.secrets) ? j.secrets : [];
      const gridAccounts: string[] = Array.isArray(j.accounts) ? j.accounts.map((a: { name: string }) => a.name) : [];
      if ((await env.getSecret('github')) && !gridSecrets.includes('GITHUB_TOKEN')) missing.push('GitHub token');
      if ((await env.getSecret('huggingface')) && !gridSecrets.includes('HF_TOKEN')) missing.push('Hugging Face token');
      if ((await env.getSecret('claudeOauth')) && !gridAccounts.includes('default')) missing.push('Claude token');
      if ((await env.getSecret('anthropicApiKey')) && !gridAccounts.includes('apikey')) missing.push('Anthropic API key');
      if (missing.length) return report(this.id, this.title, 'todo', `grid is missing: ${missing.join(', ')}`);
      if (j.ready) return report(this.id, this.title, 'done', `ready (Claude Code ${j.claude_version ?? '?'}, scripts v${j.version ?? '?'})`);
      if (j.bootstrap_job) return report(this.id, this.title, 'todo', `bootstrap job ${j.bootstrap_job} is ${j.bootstrap_state ?? 'queued'}`);
      return report(this.id, this.title, 'todo', 'scripts present, container not built');
    } catch {
      return report(this.id, this.title, 'todo', 'installed scripts did not answer');
    }
  },
  async run(env) {
    const alias = env.settings.sshAlias;
    const files = gridScriptFiles(env.settings.gridScriptsDir);
    if (files.length === 0) return report(this.id, this.title, 'failed', `no grid scripts found in ${env.settings.gridScriptsDir}`);
    env.ui.progress('Uploading the grid scripts...');
    let r = await ssh(alias, ['mkdir', '-p', '~/.ashley/bin', '~/.ashley/log', '~/.ashley/accounts/default', '~/.ashley/workers', '~/.ashley/sessions']);
    if (r.code !== 0) return report(this.id, this.title, 'failed', `cannot create ~/.ashley: ${r.stderr.trim()}`);
    r = await scp(alias, files, '~/.ashley/bin/');
    if (r.code !== 0) return report(this.id, this.title, 'failed', `upload failed: ${r.stderr.trim()}`);
    env.ui.progress('Writing tokens to your grid home (mode 600, never on a command line)...');
    const claude = await env.getSecret('claudeOauth');
    const apiKey = await env.getSecret('anthropicApiKey');
    const gh = await env.getSecret('github');
    const hf = await env.getSecret('huggingface');
    const secrets = [gh ? `GITHUB_TOKEN=${gh}\nGH_TOKEN=${gh}` : '', hf ? `HF_TOKEN=${hf}` : ''].filter(Boolean).join('\n') + '\n';
    r = await ssh(alias, ['bash', '-c', 'umask 077; cat > ~/.ashley/secrets.env'], { input: secrets });
    if (r.code !== 0) return report(this.id, this.title, 'failed', `writing secrets.env: ${r.stderr.trim()}`);
    if (claude) {
      r = await ssh(alias, ['bash', '-c', 'umask 077; mkdir -p ~/.ashley/accounts/default; cat > ~/.ashley/accounts/default/token'], { input: claude + '\n' });
      if (r.code !== 0) return report(this.id, this.title, 'failed', `writing the Claude token: ${r.stderr.trim()}`);
    }
    if (apiKey) {
      r = await ssh(alias, ['bash', '-c', 'umask 077; mkdir -p ~/.ashley/accounts/apikey; cat > ~/.ashley/accounts/apikey/apikey'], { input: apiKey + '\n' });
      if (r.code !== 0) return report(this.id, this.title, 'failed', `writing the API key: ${r.stderr.trim()}`);
    }
    env.ui.progress('Installing on the grid and submitting the container build job...');
    const installArgs = ['~/.ashley/bin/ashley', 'install'];
    if (env.settings.gridRoot) installArgs.push('--root', env.settings.gridRoot);
    r = await ssh(alias, installArgs, { timeoutMs: 180_000 });
    if (r.code !== 0) return report(this.id, this.title, 'failed', `ashley install: ${(r.stderr || r.stdout).trim()}`);
    const jobId = parseSbatchId(r.stdout) ?? (/bootstrap job (\d+)/.exec(r.stdout)?.[1] ?? null);
    const already = /already ready/i.test(r.stdout);
    const verify = await ssh(alias, ['~/.ashley/bin/ashley', 'verify-tokens'], { timeoutMs: 90_000 });
    const verified = verify.code === 0 ? verify.stdout.trim().split('\n').filter(Boolean).join('; ') : '';
    return report(this.id, this.title, 'done', (already ? 'grid already ready' : jobId ? `bootstrap job ${jobId} submitted (5 to 15 minutes)` : r.stdout.trim().split('\n').pop() ?? 'submitted') + (verified ? `; tokens on the grid: ${verified}` : ''));
  },
};

export const STEPS: WizardStep[] = [stepAccessId, stepSshKey, stepSshConfig, stepInstallKey, stepGithub, stepHuggingFace, stepClaudeToken, stepAnthropicKey, stepGridInstall];

export interface RunOptions {
  force?: boolean;
  only?: string[];
  /** Called before a step runs and after it finishes, with the full report list so far. */
  onStep?(reports: StepReport[], current: string | null): void;
}

/** Run every step that is not done, in order. Stops at the first failure of a required step. */
export async function runWizard(env: WizardEnv, opts: RunOptions = {}): Promise<StepReport[]> {
  const out: StepReport[] = [];
  for (const step of STEPS) {
    if (opts.only && !opts.only.includes(step.id)) continue;
    const pre = opts.force ? report(step.id, step.title, 'todo', 'forced') : await step.check(env);
    if (pre.status === 'done') {
      out.push(pre);
      opts.onStep?.(out, null);
      continue;
    }
    opts.onStep?.(out, step.id);
    env.ui.progress(`${step.title}...`);
    const res = await step.run(env);
    out.push(res);
    opts.onStep?.(out, null);
    const required = step.id !== 'anthropicApiKey';
    if (required && (res.status === 'failed' || res.status === 'skipped')) break;
  }
  return out;
}

export async function checkAll(env: WizardEnv): Promise<StepReport[]> {
  const out: StepReport[] = [];
  for (const step of STEPS) out.push(await step.check(env));
  return out;
}
