// The setup wizard as a list of resumable steps over an abstract environment.
// The VS Code extension and the terminal CLI each provide a `WizardEnv`; the steps never
// import 'vscode'. Every step has a `check` that says whether it is already done, so the
// wizard can be rerun at any time and only does what is missing (the /onboard rule).
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SERVICES, ServiceConfig, SecretId, normaliseAccessId, gridHome } from './services';
import { upsertBlock, hasBlock, SshTargets } from './sshConfig';
import { run, ssh, scp, shq, expandHome, isWindows, wslAvailable, wslBash, toWslPath } from './shell';
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
  mirrorToWsl: boolean;
  gridRoot: string;
  /** Directory holding the grid-side scripts to upload (dist/grid). */
  gridScriptsDir: string;
  /** Path to a claude executable for `claude setup-token`, or 'claude' if on PATH. */
  claudeExecutable: string;
}

export interface WizardUI {
  info(message: string): Promise<void>;
  warn(message: string): Promise<void>;
  /** Returns the string, or undefined if the student cancelled. */
  ask(prompt: string, opts?: { password?: boolean; placeholder?: string; value?: string; validate?: (v: string) => string | null }): Promise<string | undefined>;
  confirm(message: string, yes: string, no: string): Promise<boolean>;
  openUrl(url: string): Promise<void>;
  /** Run an interactive command in a terminal the student can type into (password, code).
   *  Resolves with the exit code when known, or null if the terminal cannot report it. */
  runInteractive(title: string, command: string, args: string[]): Promise<number | null>;
  progress(message: string): void;
}

export interface WizardEnv {
  settings: WizardSettings;
  saveSetting<K extends keyof WizardSettings>(key: K, value: WizardSettings[K]): Promise<void>;
  getSecret(id: SecretId): Promise<string | undefined>;
  setSecret(id: SecretId, value: string | undefined): Promise<void>;
  ui: WizardUI;
  /** Called after tokens change so terminals get the new environment. */
  onTokensChanged?(): Promise<void>;
}

export interface WizardStep {
  id: string;
  title: string;
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
  return {
    accessId: s.accessId,
    loginHost: s.loginHost,
    alias: s.sshAlias,
    nodeDomain: s.nodeDomain,
    identityFile: s.identityFile,
    includeGridAlias: true,
  };
}

export async function testConnection(alias: string): Promise<{ ok: boolean; hostname: string; error: string }> {
  const r = await run('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'AddressFamily=inet', '-o', 'GSSAPIAuthentication=no', alias, 'hostname'], { timeoutMs: 40_000 });
  const hostname = r.stdout.trim().split(/\s+/)[0] ?? '';
  return { ok: r.code === 0 && hostname.length > 0, hostname, error: r.stderr.trim() };
}

// ---------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------

export const stepAccessId: WizardStep = {
  id: 'accessId',
  title: 'Wayne State AccessID',
  async check(env) {
    const id = normaliseAccessId(env.settings.accessId ?? '');
    return id ? report(this.id, this.title, 'done', `AccessID ${id}; grid home ${gridHome(id)}`) : report(this.id, this.title, 'todo', 'not set');
  },
  async run(env) {
    const v = await env.ui.ask('Your Wayne State AccessID (two letters, four digits, e.g. ab1234). It is your grid username.', {
      value: env.settings.accessId,
      placeholder: 'ab1234',
      validate: (x) => (normaliseAccessId(x) ? null : 'An AccessID looks like ab1234 (two letters, four digits).'),
    });
    if (!v) return report(this.id, this.title, 'skipped', 'cancelled');
    const id = normaliseAccessId(v)!;
    await env.saveSetting('accessId', id);
    env.settings.accessId = id;
    return report(this.id, this.title, 'done', `AccessID ${id}`);
  },
};

export const stepSshKey: WizardStep = {
  id: 'sshKey',
  title: 'SSH key for the grid',
  async check(env) {
    const key = expandHome(env.settings.identityFile);
    return fs.existsSync(key) && fs.existsSync(key + '.pub')
      ? report(this.id, this.title, 'done', key)
      : report(this.id, this.title, 'todo', `${key} does not exist`);
  },
  async run(env) {
    const key = expandHome(env.settings.identityFile);
    fs.mkdirSync(path.dirname(key), { recursive: true });
    if (fs.existsSync(key) && fs.existsSync(key + '.pub')) return report(this.id, this.title, 'done', key);
    env.ui.progress('Generating an ed25519 key (no passphrase, so Claude and Remote-SSH can use it unattended)...');
    const r = await run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `${env.settings.accessId}@wayne.edu ashley`, '-f', key], { timeoutMs: 60_000 });
    if (r.code !== 0 || !fs.existsSync(key + '.pub')) {
      return report(this.id, this.title, 'failed', `ssh-keygen failed: ${(r.stderr || r.stdout).trim()}`);
    }
    if (!isWindows()) fs.chmodSync(key, 0o600);
    return report(this.id, this.title, 'done', `created ${key}`);
  },
};

export const stepSshConfig: WizardStep = {
  id: 'sshConfig',
  title: 'SSH config (login node as jump host, compute nodes one hop away)',
  async check(env) {
    const p = sshConfigPath();
    const text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const want = upsertBlock(text, targets(env.settings));
    return hasBlock(text) && want === text ? report(this.id, this.title, 'done', p) : report(this.id, this.title, 'todo', `${p} needs the Ashley block`);
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
    let detail = `wrote ${p}`;
    if (env.settings.mirrorToWsl && isWindows() && (await wslAvailable())) {
      const key = expandHome(env.settings.identityFile);
      const wslKey = `~/.ssh/${path.basename(key)}`;
      const existing = await wslBash('cat ~/.ssh/config 2>/dev/null || true');
      const wslNext = upsertBlock(existing.stdout, { ...targets(env.settings), identityFile: wslKey });
      const r = await wslBash(
        `umask 077; mkdir -p ~/.ssh && cp ${shq(toWslPath(key))} ~/.ssh/ && cp ${shq(toWslPath(key + '.pub'))} ~/.ssh/ && chmod 600 ~/.ssh/${path.basename(key)} && cat > ~/.ssh/config && chmod 600 ~/.ssh/config && echo MIRRORED`,
        { input: wslNext },
      );
      detail += r.stdout.includes('MIRRORED') ? '; mirrored into WSL' : `; WSL mirror failed: ${r.stderr.trim()}`;
    }
    return report(this.id, this.title, 'done', detail);
  },
};

export const stepInstallKey: WizardStep = {
  id: 'installKey',
  title: 'Install the key on the grid (one password + Authenticator code)',
  async check(env) {
    const t = await testConnection(env.settings.sshAlias);
    return t.ok ? report(this.id, this.title, 'done', `ssh ${env.settings.sshAlias} answers as ${t.hostname}`) : report(this.id, this.title, 'todo', t.error || 'key not installed yet');
  },
  async run(env) {
    const pub = fs.readFileSync(expandHome(env.settings.identityFile) + '.pub', 'utf8').trim();
    const remote = `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '${pub}' ~/.ssh/authorized_keys || echo '${pub}' >> ~/.ssh/authorized_keys; echo ASHLEY-KEY-INSTALLED`;
    await env.ui.info(
      'A terminal will open and ask for your grid PASSWORD, then the six-digit Google Authenticator CODE. This happens once. After it, the grid never prompts again.',
    );
    const code = await env.ui.runInteractive(
      'Ashley: install key on the grid',
      'ssh',
      ['-o', 'MACs=+hmac-sha1', '-o', 'PubkeyAuthentication=no', '-o', 'StrictHostKeyChecking=accept-new', `${env.settings.accessId}@${env.settings.loginHost}`, remote],
    );
    if (code !== null && code !== 0) return report(this.id, this.title, 'failed', `ssh exited with ${code}`);
    const t = await testConnection(env.settings.sshAlias);
    return t.ok ? report(this.id, this.title, 'done', `ssh ${env.settings.sshAlias} answers as ${t.hostname}`) : report(this.id, this.title, 'failed', `still cannot log in without a prompt: ${t.error}`);
  },
};

function tokenStep(svc: ServiceConfig): WizardStep {
  return {
    id: svc.id,
    title: svc.name,
    async check(env) {
      const v = await env.getSecret(svc.id);
      if (v) return report(svc.id, svc.name, 'done', 'stored in the OS keychain');
      return report(svc.id, svc.name, svc.optional ? 'skipped' : 'todo', svc.optional ? 'optional, not set' : 'not set');
    },
    async run(env) {
      if (svc.id === 'claudeOauth') return runClaudeTokenStep(env, svc);
      if (svc.tokenUrl) {
        const go = await env.ui.confirm(`${svc.name}\n\n${svc.instructions}`, 'Open the page', svc.optional ? 'Skip' : 'I already have one');
        if (go) await env.ui.openUrl(svc.tokenUrl);
        else if (svc.optional) return report(svc.id, svc.name, 'skipped', 'skipped');
      }
      const v = await env.ui.ask(svc.prompt, {
        password: true,
        validate: (x) => (x.trim() === '' && svc.optional ? null : svc.pattern && !svc.pattern.test(x.trim()) ? 'That does not look like the right kind of token.' : null),
      });
      if (v === undefined) return report(svc.id, svc.name, 'skipped', 'cancelled');
      if (v.trim() === '' && svc.optional) return report(svc.id, svc.name, 'skipped', 'skipped');
      const token = v.trim();
      const check = await validateToken(svc, token);
      if (!check.ok) {
        const keep = await env.ui.confirm(`The token could not be verified (${check.detail}). Keep it anyway?`, 'Keep', 'Discard');
        if (!keep) return report(svc.id, svc.name, 'failed', check.detail);
      }
      await env.setSecret(svc.id, token);
      await env.onTokensChanged?.();
      return report(svc.id, svc.name, 'done', check.ok ? `verified as ${check.detail}` : 'stored (unverified)');
    },
  };
}

async function runClaudeTokenStep(env: WizardEnv, svc: ServiceConfig): Promise<StepReport> {
  const how = await env.ui.confirm(
    `${svc.name}\n\n${svc.instructions}\n\nRun "claude setup-token" now in a terminal?`,
    'Run it',
    'I already have a token',
  );
  if (how) {
    await env.ui.runInteractive('Ashley: claude setup-token', env.settings.claudeExecutable, ['setup-token']);
  }
  const v = await env.ui.ask(svc.prompt, { password: true, validate: (x) => (svc.pattern!.test(x.trim()) ? null : 'Expected a token starting with sk-ant-oat.') });
  if (v === undefined) return report(svc.id, svc.name, 'skipped', 'cancelled');
  await env.setSecret('claudeOauth', v.trim());
  return report(svc.id, svc.name, 'done', 'stored in the OS keychain (pushed to the grid in the install step)');
}

export async function validateToken(svc: ServiceConfig, token: string): Promise<{ ok: boolean; detail: string }> {
  if (!svc.validate) return { ok: true, detail: 'no online check for this service' };
  try {
    const headers: Record<string, string> = { 'User-Agent': 'ashley-wsu' };
    if (svc.validate.header === 'Authorization') headers.Authorization = `Bearer ${token}`;
    else headers['X-Api-Key'] = token;
    if (svc.id === 'anthropicApiKey') headers['anthropic-version'] = '2023-06-01';
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15_000);
    const res = await fetch(svc.validate.url, { headers, signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const j = (await res.json()) as Record<string, unknown>;
    const f = svc.validate.expectField;
    if (f && !(f in j)) return { ok: false, detail: `unexpected response` };
    const who = f ? j[f] : 'ok';
    return { ok: true, detail: typeof who === 'string' ? who : 'ok' };
  } catch (e) {
    return { ok: false, detail: `network: ${(e as Error).message}` };
  }
}

export const stepGithub = tokenStep(SERVICES.find((s) => s.id === 'github')!);
export const stepHuggingFace = tokenStep(SERVICES.find((s) => s.id === 'huggingface')!);
export const stepClaudeToken = tokenStep(SERVICES.find((s) => s.id === 'claudeOauth')!);
export const stepAnthropicKey = tokenStep(SERVICES.find((s) => s.id === 'anthropicApiKey')!);

/** Files under gridScriptsDir that go to ~/.ashley/bin on the grid. */
export function gridScriptFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .map((f) => path.join(dir, f))
    .filter((p) => fs.statSync(p).isFile());
}

export const stepGridInstall: WizardStep = {
  id: 'gridInstall',
  title: 'Install Ashley on the grid (scripts, tokens, container job)',
  async check(env) {
    const r = await ssh(env.settings.sshAlias, ['~/.ashley/bin/ashley', 'status', '--json'], { timeoutMs: 60_000 });
    if (r.code !== 0) return report(this.id, this.title, 'todo', 'not installed on the grid');
    try {
      const j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
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

    env.ui.progress('Installing (bashrc block, layout) and submitting the container build job...');
    const installArgs = ['~/.ashley/bin/ashley', 'install'];
    if (env.settings.gridRoot) installArgs.push('--root', env.settings.gridRoot);
    r = await ssh(alias, installArgs, { timeoutMs: 180_000 });
    if (r.code !== 0) return report(this.id, this.title, 'failed', `ashley install: ${(r.stderr || r.stdout).trim()}`);
    const jobId = parseSbatchId(r.stdout) ?? (/bootstrap job (\d+)/.exec(r.stdout)?.[1] ?? null);
    const already = /already ready/i.test(r.stdout);
    return report(
      this.id,
      this.title,
      'done',
      already ? 'grid already ready' : jobId ? `bootstrap job ${jobId} submitted (5 to 15 minutes; the Ashley view shows when it is ready)` : r.stdout.trim().split('\n').pop() ?? 'submitted',
    );
  },
};

export const STEPS: WizardStep[] = [stepAccessId, stepSshKey, stepSshConfig, stepInstallKey, stepGithub, stepHuggingFace, stepClaudeToken, stepAnthropicKey, stepGridInstall];

/** Run every step that is not done, in order. Stops at the first failure of a required step. */
export async function runWizard(env: WizardEnv, opts: { force?: boolean; only?: string[] } = {}): Promise<StepReport[]> {
  const out: StepReport[] = [];
  for (const step of STEPS) {
    if (opts.only && !opts.only.includes(step.id)) continue;
    const pre = opts.force ? report(step.id, step.title, 'todo', 'forced') : await step.check(env);
    if (pre.status === 'done') {
      out.push(pre);
      continue;
    }
    env.ui.progress(`${step.title}...`);
    const res = await step.run(env);
    out.push(res);
    if (res.status === 'failed' || res.status === 'skipped') {
      const required = !['anthropicApiKey'].includes(step.id);
      if (required && res.status === 'failed') break;
      if (required && res.status === 'skipped') break;
    }
  }
  return out;
}

export async function checkAll(env: WizardEnv): Promise<StepReport[]> {
  const out: StepReport[] = [];
  for (const step of STEPS) out.push(await step.check(env));
  return out;
}
