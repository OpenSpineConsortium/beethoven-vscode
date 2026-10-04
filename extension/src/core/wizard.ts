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
import { run, ssh, scp, expandHome, isWindows, gridCli, gridCliLine, GRID_HOME_PICK } from './shell';
import { parseSbatchId } from './slurm';
import { KEY_PATTERN, LicenseCheck, Identity, describeLicense } from './license';
import * as crypto from 'node:crypto';

export type StepStatus = 'done' | 'todo' | 'skipped' | 'failed';

export interface StepReport {
  id: string;
  title: string;
  status: StepStatus;
  detail: string;
}

export interface WizardSettings {
  accessId: string;
  /** The Wayne State account the student signed in with (AccessID@wayne.edu). */
  wsuEmail: string;
  /** The student confirmed a grid account with Google Authenticator set up (or the key already works). */
  twoFactorDone: boolean;
  loginHost: string;
  sshAlias: string;
  nodeDomain: string;
  identityFile: string; // tilde form
  gridRoot: string;
  /** Directory holding the grid-side scripts to upload (dist/grid). */
  gridScriptsDir: string;
  /** Path to a claude executable (for `claude auth status` and `auth login`), or 'claude' if on PATH. */
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
  /** A menu of buttons; resolves with the index, or undefined on cancel. Falls back to confirm() pairs. */
  choose?(message: string, buttons: string[]): Promise<number | undefined>;
  /**
   * Run an interactive command in a terminal AND read its output (VS Code shell integration), so a
   * value it prints (a token) can be captured without the student copying it. Resolves with the exit
   * code and the first match of `pattern` in the output, if any. Falls back to runInteractive().
   */
  runCapturing?(title: string, command: string, args: string[], pattern: RegExp): Promise<{ code: number | null; match?: string }>;
}

async function choose(ui: WizardUI, message: string, buttons: string[]): Promise<number | undefined> {
  if (ui.choose) return ui.choose(message, buttons);
  for (let i = 0; i < buttons.length - 1; i++) {
    if (await ui.confirm(message, buttons[i], i === buttons.length - 2 ? buttons[i + 1] : 'Next option')) return i;
    if (i === buttons.length - 2) return buttons.length - 1;
  }
  return buttons.length - 1;
}

export const ONDEMAND_URL = 'https://ondemand.grid.wayne.edu/';
export const GRID_ACCOUNT_URL = 'https://tech.wayne.edu/kb/high-performance-computing';
export const AUTHENTICATOR_KB_URL = 'https://services.wayne.edu/TDClient/277/Portal/KB/Article/20242';
export const AUTHENTICATOR_IOS_URL = 'https://apps.apple.com/us/app/google-authenticator/id388497605';
export const AUTHENTICATOR_ANDROID_URL = 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2';

/** OnDemand answers only from the campus network or the WSU VPN, so reaching it is a VPN test. */
export async function onDemandReachable(timeoutMs = 8000): Promise<{ ok: boolean; detail: string }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(ONDEMAND_URL, { method: 'GET', redirect: 'manual', signal: ctl.signal });
    clearTimeout(t);
    return { ok: true, detail: `ondemand.grid.wayne.edu answered (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

export interface WizardEnv {
  settings: WizardSettings;
  saveSetting<K extends keyof WizardSettings>(key: K, value: WizardSettings[K]): Promise<void>;
  getSecret(id: SecretId): Promise<string | undefined>;
  setSecret(id: SecretId, value: string | undefined): Promise<void>;
  ui: WizardUI;
  onTokensChanged?(): Promise<void>;
  /** Sign in with the Wayne State (Microsoft) account in the browser. Returns the account's e-mail. */
  signInWsu?(): Promise<{ email: string } | undefined>;
  /** The lab's pre-approved AccessIDs; null when no list is available (no restriction). */
  allowlist?(): Promise<string[] | null>;
  /** The lab's service addresses (services.json): request_page, support_page, license_service, ... */
  services?(): Promise<Record<string, string>>;
  /** Sign in to GitHub through the host (VS Code's GitHub authentication). Returns the OAuth token. */
  signInGitHub?(): Promise<{ token: string; login?: string } | undefined>;
  /** Host-specific requirements for joining the lab (VS Code: the Claude Code and Remote-SSH extensions, the bridge). */
  extraRequirements?(): Promise<string[]>;
  /** Install the public key with a password + code typed in the UI (ssh2). */
  installKeyWithPassword?(pub: string): Promise<{ ok: boolean; detail: string; authFailure?: boolean }>;
  /** The Beethoven license on this computer (extension: the gate; CLI: the files in ~/.beethoven-local, core/localDir.ts). */
  license?: WizardLicense;
}

export interface WizardLicense {
  check(force?: boolean): LicenseCheck;
  /** verify a pasted key and keep it when it is valid */
  set(text: string): Promise<LicenseCheck>;
  identity(): Identity | undefined;
  recordIdentity(id: Identity): Promise<void>;
  key(): string | undefined;
  /** the signed revocation lists to copy to the grid */
  revocationTexts(): string;
  /** ask the licence service for a free trial in this person's name (VS Code: after the Wayne State sign-in) */
  requestTrial?(): Promise<{ key?: string; detail: string; notApproved?: boolean; requestPage?: string }>;
}

/** First 16 hex digits of the key's SHA-256: enough to tell whether the grid has the same key. */
export function licenseFingerprint(key: string | undefined): string {
  return key ? crypto.createHash('sha256').update(key.trim()).digest('hex').slice(0, 16) : '';
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

const WSU_EMAIL = /@([a-z0-9-]+\.)*wayne\.edu$/i;

/**
 * Step 1: sign in with the Wayne State account (the university's Microsoft sign-in, in the browser)
 * and continue only if the AccessID is on the lab's pre-approved list. The AccessID also names the
 * student's other accounts: the lab assumes the Claude subscription was made with AccessID@wayne.edu.
 */
export const stepLicense: WizardStep = {
  id: 'license',
  title: 'Access',
  blurb: 'Your access key: after your Wayne State sign-in, Beethoven asks the lab for a key in your name.',
  async check(env) {
    if (!env.license) return report(this.id, this.title, 'done', 'not checked by this host');
    const c = env.license.check(true);
    if (c.ok) return report(this.id, this.title, 'done', describeLicense(c));
    return report(this.id, this.title, c.status === 'missing' ? 'todo' : 'failed', c.detail);
  },
  async run(env) {
    if (!env.license) return report(this.id, this.title, 'done', 'not checked by this host');
    const cur = env.license.check(true);
    if (cur.ok) return report(this.id, this.title, 'done', describeLicense(cur));
    let why = cur.detail;
    // the normal path: the lab's access service issues a key to an approved, signed-in person
    if (cur.status === 'missing' && env.license.requestTrial && env.license.identity()) {
      env.ui.progress('Asking the lab for your access key...');
      const tr = await env.license.requestTrial();
      if (tr.key) {
        const c = await env.license.set(tr.key);
        if (c.ok) return report(this.id, this.title, 'done', describeLicense(c));
        why = c.detail;
      } else if (tr.notApproved) {
        const id = env.license.identity()?.accessId ?? 'your AccessID';
        const page = tr.requestPage || (env.services ? (await env.services()).request_page : '');
        const pick = await env.ui.confirm(`${id} is not approved for Beethoven yet. Ask for access on the lab's page (it takes a minute); when your lead approves you, run this step again and the key arrives by itself. If your lead gave you a key instead, choose "I have a key".`, page ? 'Ask for access' : 'I have a key', 'I have a key');
        if (pick && page) {
          await env.ui.openUrl(page);
          return report(this.id, this.title, 'todo', `${id} is not approved yet: asked for access; run this step again once approved`);
        }
      } else {
        await env.ui.warn(tr.detail);
      }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const text = await askToken(env.ui, attempt ? `That key was not accepted (${why}). Paste your Beethoven key again` : 'Your Beethoven key (if your lead sent you one)', {
        pattern: KEY_PATTERN,
        instructions: 'Your lead sends it to you. It starts with ASHLEY1. or BEETHOVEN1. and is one long line; copying it is enough, Beethoven notices. A Full Edition key opens its own agreement to accept.',
      });
      if (!text) return report(this.id, this.title, 'skipped', 'no key entered');
      const c = await env.license.set(text);
      if (c.ok) return report(this.id, this.title, 'done', describeLicense(c));
      why = c.detail;
    }
    return report(this.id, this.title, 'failed', `the key was not accepted: ${why}`);
  },
};

export const stepWsuSignIn: WizardStep = {
  id: 'wsuSignIn',
  title: 'Sign in with Wayne State',
  blurb: 'Your WSU account in the browser; only AccessIDs the lab has approved continue.',
  async check(env) {
    const id = normaliseAccessId(env.settings.accessId ?? '');
    if (!id || !env.settings.wsuEmail) return report(this.id, this.title, 'todo', 'not signed in');
    // the license is checked against a sign-in Beethoven saw happen, not against settings
    if (env.license && !env.license.identity()) return report(this.id, this.title, 'todo', 'sign in once more: Beethoven checks your license against it');
    const lic = env.license?.check(true);
    if (lic && lic.status === 'wrong-person') return report(this.id, this.title, 'failed', lic.detail);
    const list = env.allowlist ? await env.allowlist() : null;
    if (list && !list.includes(id) && !(lic?.ok && lic.payload?.sub === id)) return report(this.id, this.title, 'failed', `${id} is not approved for Beethoven yet; ask for access on the lab's page`);
    return report(this.id, this.title, 'done', `${env.settings.wsuEmail} (AccessID ${id}; grid home ${gridHome(id)})`);
  },
  async run(env) {
    let email: string | undefined;
    if (env.signInWsu) {
      env.ui.progress('Opening the Wayne State sign-in in your browser...');
      try {
        email = (await env.signInWsu())?.email;
      } catch (e) {
        return report(this.id, this.title, 'failed', `the Wayne State sign-in did not complete (${(e as Error).message})`);
      }
      if (!email) return report(this.id, this.title, 'skipped', 'cancelled');
      if (!WSU_EMAIL.test(email)) return report(this.id, this.title, 'failed', `${email} is not a Wayne State account; sign in with AccessID@wayne.edu`);
    }
    let id = email ? normaliseAccessId(email.split('@')[0]) : null;
    if (!id) {
      const v = await env.ui.ask(email ? `Signed in as ${email}. Your AccessID (two letters and four digits)?` : 'Your Wayne State AccessID (two letters and four digits). It is your grid username.', {
        value: env.settings.accessId,
        placeholder: 'ab1234',
        validate: (x) => (normaliseAccessId(x) ? null : 'An AccessID looks like ab1234 (two letters, four digits).'),
      });
      if (!v) return report(this.id, this.title, 'skipped', 'cancelled');
      id = normaliseAccessId(v)!;
    }
    // A license your lead issued in your name is a pre-approval too; a site license is not.
    const email2 = email ?? `${id}@wayne.edu`;
    if (env.license) {
      await env.license.recordIdentity({ accessId: id, email: email2 });
      const lic = env.license.check(true);
      if (lic.status === 'wrong-person') return report(this.id, this.title, 'failed', `${lic.detail}. Sign in with the account the license names, or ask for a license in your name.`);
    }
    const lic2 = env.license?.check();
    const list = env.allowlist ? await env.allowlist() : null;
    if (list && !list.includes(id) && !(lic2?.ok && lic2.payload?.sub === id)) return report(this.id, this.title, 'failed', `${id} is not approved for Beethoven yet; ask for access on the lab's page, then sign in again`);
    await env.saveSetting('accessId', id);
    await env.saveSetting('wsuEmail', email ?? `${id}@wayne.edu`);
    env.settings.accessId = id;
    env.settings.wsuEmail = email ?? `${id}@wayne.edu`;
    return report(this.id, this.title, 'done', `${env.settings.wsuEmail} (AccessID ${id})`);
  },
};

export const stepTwoFactor: WizardStep = {
  id: 'gridTwoFactor',
  title: 'Grid account and Authenticator',
  blurb: 'A grid account, and Google Authenticator set up once on OnDemand (campus Wi-Fi or the WSU VPN).',
  async check(env) {
    if (env.settings.twoFactorDone) return report(this.id, this.title, 'done', 'confirmed');
    const t = await testConnection(env.settings.sshAlias);
    if (t.ok) {
      await env.saveSetting('twoFactorDone', true);
      env.settings.twoFactorDone = true;
      return report(this.id, this.title, 'done', 'the grid already accepts this laptop');
    }
    return report(this.id, this.title, 'todo', 'not confirmed yet');
  },
  async run(env) {
    const ui = env.ui;
    const first = await choose(ui, 'Do you already have a Wayne State grid account with Google Authenticator set up for it?', ['Yes, both', 'Not yet, walk me through it']);
    if (first === undefined) return report(this.id, this.title, 'skipped', 'cancelled');
    if (first !== 0) {
      for (;;) {
        const vpn = await onDemandReachable();
        const menu = [
          'Open the grid account request page',
          vpn.ok ? 'Open OnDemand (campus network reached) for 2FA Setup' : 'Check again (OnDemand not reachable: join the WSU Wi-Fi on campus, or connect the WSU VPN)',
          'Open the C&IT guide with screenshots',
          'Google Authenticator for iPhone',
          'Google Authenticator for Android',
          'I have scanned the code and the app shows six digits: continue',
          'Skip for now',
        ];
        const pick = await choose(
          ui,
          [
            'Three things only you can do, in order:',
            '1. A grid account: apply with your AccessID, naming your lead as sponsor (about two business days; hpc@wayne.edu, 313-577-4743).',
            `2. The campus network: OnDemand answers only from the WSU Wi-Fi on campus or through the WSU VPN (GlobalProtect) from anywhere else. Right now: ${vpn.ok ? 'reachable' : 'NOT reachable: join the campus Wi-Fi or connect the VPN, then choose "Check again"'}.`,
            '3. On OnDemand: sign in with your AccessID and password, open Interactive Apps, choose 2FA Setup, press Launch, then Launch 2FA Setup; a QR code appears. In Google Authenticator press + and Scan a QR code. The app now shows a six-digit code that changes every 30 seconds.',
            'The grid asks for that code and your password exactly once more, in the next steps; after that this laptop is trusted and nothing prompts again.',
          ].join('\n'),
          menu,
        );
        if (pick === undefined || pick === 6) return report(this.id, this.title, 'skipped', 'not confirmed yet');
        if (pick === 0) await ui.openUrl(GRID_ACCOUNT_URL);
        else if (pick === 1) {
          if (vpn.ok) await ui.openUrl(ONDEMAND_URL);
        } else if (pick === 2) await ui.openUrl(AUTHENTICATOR_KB_URL);
        else if (pick === 3) await ui.openUrl(AUTHENTICATOR_IOS_URL);
        else if (pick === 4) await ui.openUrl(AUTHENTICATOR_ANDROID_URL);
        else if (pick === 5) break;
      }
    }
    await env.saveSetting('twoFactorDone', true);
    env.settings.twoFactorDone = true;
    return report(this.id, this.title, 'done', 'confirmed; the next login step proves it');
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
    const r = await run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `${env.settings.accessId}@wayne.edu beethoven`, '-f', key], { timeoutMs: 60_000 });
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
      if (text) fs.copyFileSync(p, p + '.beethoven.bak');
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
        if (r.authFailure) {
          await env.saveSetting('twoFactorDone', false);
          env.settings.twoFactorDone = false;
          return report(this.id, this.title, 'failed', 'three rejected logins: check the account exists and redo the Authenticator setup (the previous step opens OnDemand), then run the wizard again');
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
      const remote = `umask 077; mkdir -p ~/.ssh; touch ~/.ssh/authorized_keys; grep -qF '${pub}' ~/.ssh/authorized_keys || echo '${pub}' >> ~/.ssh/authorized_keys; echo BEETHOVEN-KEY-INSTALLED`;
      await env.ui.info('A terminal will ask for your grid PASSWORD, then the six-digit Google Authenticator CODE. Once.');
      const code = await env.ui.runInteractive('Beethoven: install key on the grid', 'ssh', [
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
    const headers: Record<string, string> = { 'User-Agent': 'beethoven-wsu', Authorization: `Bearer ${token}` };
    Object.assign(headers, svc.validate.extraHeaders ?? {});
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
      if (!v) return report(svc.id, this.title, svc.optional ? 'skipped' : 'todo', svc.optional ? 'optional, not set' : 'not set');
      // live: a token the service now rejects (expired, revoked) shows as failed, with Renew next to it
      const c = await validateToken(svc, v);
      if (!c.ok && !c.network) return report(svc.id, this.title, 'failed', `no longer accepted (${c.detail}): press Renew`);
      return report(svc.id, this.title, 'done', c.ok ? `works (${c.detail})` : 'stored (could not check it online just now)');
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
      // renewing a token later updates the grid in the same click
      let grid = '';
      if (await gridInstalled(env)) {
        const pr = await pushTokens(env);
        grid = pr.ok ? '; updated on the grid' : `; the grid copy was not updated (${pr.detail})`;
      }
      return report(svc.id, this.title, 'done', (check.ok ? `${via}; verified as ${check.detail}` : `${via}; ${check.detail}; it will be verified on the grid`) + grid);
    },
  };
}

/** Claude Code's own account of its sign-in, on this laptop or (through the grid CLI) on the grid. Status only, never a credential. */
export async function localClaudeStatus(exe: string, env?: NodeJS.ProcessEnv): Promise<{ ok: boolean; loggedIn: boolean; subscription: boolean; detail: string }> {
  const r = await run(exe, ['auth', 'status'], { timeoutMs: 60_000, env });
  if (r.code === 127 || /ENOENT/.test(r.stderr)) return { ok: false, loggedIn: false, subscription: false, detail: 'Claude Code is not installed on this laptop' };
  let j: { loggedIn?: boolean; authMethod?: string; apiProvider?: string; email?: string; subscriptionType?: string } = {};
  try {
    j = JSON.parse(r.stdout.trim());
  } catch {
    return { ok: false, loggedIn: false, subscription: false, detail: `claude auth status did not answer (${(r.stderr || r.stdout).trim().slice(0, 100)})` };
  }
  // only the claude.ai sign-in billed by Anthropic itself counts: an API key, a key helper or a cloud
  // provider (Bedrock, Vertex, Foundry) bills by use
  const method = String(j.authMethod ?? '');
  const provider = String(j.apiProvider ?? 'firstParty');
  const subscription = !!j.loggedIn && method === 'claude.ai' && provider === 'firstParty';
  return {
    ok: true,
    loggedIn: !!j.loggedIn,
    subscription,
    detail: !j.loggedIn ? 'not signed in' : subscription ? `signed in${j.email ? ` as ${j.email}` : ''}${j.subscriptionType ? ` (${j.subscriptionType})` : ''}` : `signed in through ${provider === 'firstParty' ? method || 'an unknown method' : provider}, not a Claude subscription`,
  };
}

export const stepClaudeLocal: WizardStep = {
  id: 'claudeLocal',
  title: 'Claude on this laptop',
  blurb: 'Claude Code here is signed in with your own Claude Pro or Max subscription (Beethoven only checks; it stores nothing).',
  async check(env) {
    const s = await localClaudeStatus(env.settings.claudeExecutable);
    if (!s.ok) return report(this.id, this.title, 'todo', s.detail);
    if (!s.loggedIn) return report(this.id, this.title, 'todo', 'Claude Code on this laptop is not signed in');
    if (!s.subscription) return report(this.id, this.title, 'failed', `${s.detail}; Beethoven needs Claude Pro or Max (the account made with your Wayne State e-mail)`);
    return report(this.id, this.title, 'done', s.detail);
  },
  async run(env) {
    const cur = await this.check(env);
    if (cur.status === 'done') return cur;
    const who = env.settings.accessId ? `${env.settings.accessId}@wayne.edu` : 'your Wayne State e-mail';
    const go = await env.ui.confirm(`Sign in to Claude Code on this laptop with the Claude account you made with ${who} (Claude Pro at the minimum). Claude Code opens the browser and keeps its own sign-in; Beethoven never sees it.`, 'Sign in', 'Not now');
    if (!go) return report(this.id, this.title, 'skipped', 'not signed in');
    await env.ui.runInteractive('Claude sign-in', env.settings.claudeExecutable, ['auth', 'login']);
    return this.check(env);
  },
};

export const stepClaudeGrid: WizardStep = {
  id: 'claudeGrid',
  title: 'Sign in to Claude on the grid',
  blurb: 'Once, in a terminal: Claude Code signs you in inside your own grid account, for your worker and your phone.',
  async check(env) {
    const r = await ssh(env.settings.sshAlias, gridCli(['claude', 'status', '--json']), { timeoutMs: 60_000 });
    if (r.code !== 0) return report(this.id, this.title, 'todo', 'the grid did not answer (install on the grid first)');
    try {
      const j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}') as { dir_present?: boolean; consent?: boolean; login?: { loggedIn?: boolean; subscription?: boolean; detail?: string; email?: string } | null };
      // the worker runs nothing on a sign-in through an API key, a token or a cloud provider
      if (j.login && j.login.loggedIn && j.login.subscription === false) return report(this.id, this.title, 'failed', 'Claude on the grid is signed in, but not with a Claude subscription: sign in again with your own Claude subscription');
      if (j.login && j.login.loggedIn) return report(this.id, this.title, 'done', `signed in on the grid${j.login.email ? ` as ${j.login.email}` : ''}${j.consent ? '; phone access enabled' : ''}`);
      if (j.login && j.login.loggedIn === false && j.dir_present) return report(this.id, this.title, 'failed', 'the sign-in on the grid has ended (about a month): sign in again');
      if (j.dir_present) return report(this.id, this.title, 'done', 'signed in on the grid (a running worker will confirm it)');
      return report(this.id, this.title, 'todo', 'not signed in on the grid yet');
    } catch {
      return report(this.id, this.title, 'todo', 'the grid gave no readable answer');
    }
  },
  async run(env) {
    const who = env.settings.accessId ? `${env.settings.accessId}@wayne.edu` : 'your Wayne State e-mail';
    const go = await env.ui.confirm(
      `A terminal opens on the grid and Claude Code signs you in there, inside your own account: click the link it prints, sign in with the Claude account you made with ${who}, press Authorize, paste the code back into the terminal. Claude Code keeps its own sign-in in ~/.beethoven/claude; Beethoven never sees, copies or stores it. It lasts about a month; Beethoven tells you when to repeat it.`,
      'Open the terminal',
      'Not now',
    );
    if (!go) return report(this.id, this.title, 'skipped', 'not signed in');
    await env.ui.runInteractive('Sign in to Claude on the grid', 'ssh', ['-t', env.settings.sshAlias, gridCliLine(['claude', 'login'])]);
    return this.check(env);
  },
};

export const stepGithub = tokenStep(SERVICES.find((s) => s.id === 'github')!, 'Sign in to GitHub in the browser; the token arrives by itself.');
export const stepHuggingFace = tokenStep(SERVICES.find((s) => s.id === 'huggingface')!, 'On the page that opens press Create token, then Copy; the panel takes it.');

export function gridScriptFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).map((f) => path.join(dir, f)).filter((p) => fs.statSync(p).isFile());
}


/** Is Beethoven installed on the grid and reachable without a prompt? */
export async function gridInstalled(env: WizardEnv): Promise<boolean> {
  if (!env.settings.accessId) return false;
  const r = await ssh(env.settings.sshAlias, gridCli(['version']), { timeoutMs: 40_000 });
  return r.code === 0;
}

/** Every token on this laptop goes to the grid in one pass (files with mode 600, via ssh stdin, never argv). */
export async function pushTokens(env: WizardEnv): Promise<{ ok: boolean; detail: string }> {
  const alias = env.settings.sshAlias;
  // the worker runs only with the license of the account it runs under; the revocation lists go along
  const lic = env.license?.key();
  if (lic) {
    const r0 = await ssh(alias, ['bash', '-c', `${GRID_HOME_PICK} umask 077; mkdir -p $h; cat > $h/license.key.part && mv $h/license.key.part $h/license.key`], { input: lic + '\n' });
    if (r0.code !== 0) return { ok: false, detail: `copying the license: ${r0.stderr.trim()}` };
    const rev = env.license!.revocationTexts();
    if (rev.trim()) await ssh(alias, ['bash', '-c', `${GRID_HOME_PICK} umask 077; cat > $h/license.revoked`], { input: rev + '\n' });
  }
  const gh = await env.getSecret('github');
  const hf = await env.getSecret('huggingface');
  const secrets = [gh ? `GITHUB_TOKEN=${gh}\nGH_TOKEN=${gh}` : '', hf ? `HF_TOKEN=${hf}` : ''].filter(Boolean).join('\n') + '\n';
  const r = await ssh(alias, ['bash', '-c', `${GRID_HOME_PICK} umask 077; mkdir -p $h; cat > $h/secrets.env`], { input: secrets });
  if (r.code !== 0) return { ok: false, detail: `writing secrets.env: ${r.stderr.trim()}` };
  // Beethoven stores no Claude credential and copies none: an earlier version's stored token is deleted.
  // The API key builds up to 4.0.0 copied to accounts/apikey is left for the student, but marked disabled,
  // the one switch a worker still running grid scripts 7 honours (grid/beethoven, retire_apikey).
  await ssh(alias, ['bash', '-c', `${GRID_HOME_PICK} rm -f $h/accounts/*/token $h/accounts/*/minted_at $h/accounts/*/.credentials.json 2>/dev/null; [ ! -e $h/accounts/apikey/apikey ] || touch $h/accounts/apikey/disabled; true`]);
  return { ok: true, detail: 'tokens updated on the grid' };
}

/**
 * The grid folder was ~/.ashley before the rename. The first grid install of this version moves it to
 * ~/.beethoven in one step, so the Claude sign-in, the license and the workers' records move with it and
 * nothing is entered again, and leaves ~/.ashley as a link to the new folder: older builds still name
 * ~/.ashley (Ashley for VS Code 3.0.0, the browser edition up to 7.0.0, worker job files written before).
 * It never moves while one of our jobs runs, never moves a link, and never deletes anything.
 * Prints MOVED when it moved and BUSY when it could not. BOTH: both are folders already; the new
 * grid command's `migrate` then moves the old folder's contents in (grid/beethoven, migrate_home).
 */
export const GRID_HOME_MOVE = [
  'cd "$HOME" || exit 1;',
  'if [ -d .ashley ] && [ ! -L .ashley ]; then',
  "if squeue -h -u \"$USER\" -t RUNNING -o %j 2>/dev/null | grep -Eq '^(ashley|beethoven)_'; then echo BUSY; exit 3; fi;",
  'if [ -e .beethoven ] || [ -L .beethoven ]; then echo BOTH; else mv .ashley .beethoven || exit 5; ln -s .beethoven .ashley && echo MOVED; fi;',
  'fi;',
  'mkdir -p .beethoven/bin .beethoven/log .beethoven/accounts/default .beethoven/workers .beethoven/sessions || exit 6;',
  '[ -e .ashley ] || [ -L .ashley ] || ln -s .beethoven .ashley',
].join(' '); // one line: it reaches the grid through ssh and Windows argument quoting as a single argument

function bundledGridVersion(env: WizardEnv): string {
  try {
    return fs.readFileSync(path.join(env.settings.gridScriptsDir, 'VERSION'), 'utf8').trim();
  } catch {
    return '';
  }
}

export const stepGridInstall: WizardStep = {
  id: 'gridInstall',
  title: 'Install on the grid',
  blurb: 'Everything above goes to the grid in one pass: scripts, your tokens (private files), the VS Code settings.',
  async check(env) {
    const r = await ssh(env.settings.sshAlias, gridCli(['status', '--json']), { timeoutMs: 60_000 });
    if (r.code !== 0) return report(this.id, this.title, 'todo', 'not installed on the grid');
    try {
      const j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
      const want = bundledGridVersion(env);
      if (want && String(j.version) !== want) return report(this.id, this.title, 'todo', `the grid has Beethoven v${j.version}; this extension brings v${want}`);
      const missing: string[] = [];
      const gridSecrets: string[] = Array.isArray(j.secrets) ? j.secrets : [];
      if ((await env.getSecret('github')) && !gridSecrets.includes('GITHUB_TOKEN')) missing.push('GitHub token');
      if ((await env.getSecret('huggingface')) && !gridSecrets.includes('HF_TOKEN')) missing.push('Hugging Face token');
      const lic = env.license?.key();
      if (lic && String(j.license ?? '') !== licenseFingerprint(lic)) missing.push('your license');
      if (missing.length) return report(this.id, this.title, 'todo', `grid is missing: ${missing.join(', ')}`);
      if (j.ready) return report(this.id, this.title, 'done', `ready (Claude Code ${j.claude_version ?? '?'}${j.source === 'shared' ? `, the lab's shared container ${j.container}` : ''}, scripts v${j.version ?? '?'})`);
      if (j.awaiting_access) return report(this.id, this.title, 'done', `installed (scripts v${j.version ?? '?'}); the lab's container comes with lab access, the last step`);
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
    env.ui.progress('Preparing your folder on the grid...');
    let r = await ssh(alias, ['bash', '-c', GRID_HOME_MOVE], { timeoutMs: 60_000 });
    if (/\bBUSY\b/.test(r.stdout)) return report(this.id, this.title, 'failed', 'a Claude worker or another job of yours from this tool is running on the grid; your grid folder gets its new name once, while none runs. Stop the worker (Beethoven: Stop a Claude worker), then run this step again');
    const both = /\bBOTH\b/.test(r.stdout);
    if (r.code !== 0) return report(this.id, this.title, 'failed', `cannot create ~/.beethoven: ${(r.stderr || r.stdout).trim()}`);
    if (/\bMOVED\b/.test(r.stdout)) env.ui.progress('Your grid folder is now ~/.beethoven (the old name still leads there).');
    env.ui.progress('Uploading the grid scripts...');
    r = await scp(alias, files, '~/.beethoven/bin/');
    if (r.code !== 0) return report(this.id, this.title, 'failed', `upload failed: ${r.stderr.trim()}`);
    if (both) {
      // ~/.ashley and ~/.beethoven were both folders: the new grid command moves the old one's contents in
      env.ui.progress('Moving the contents of your old grid folder into the new one...');
      r = await ssh(alias, gridCli(['migrate']), { timeoutMs: 120_000 });
      if (r.code !== 0) return report(this.id, this.title, 'failed', `your grid account has an old folder (~/.ashley) beside the new one (~/.beethoven), and moving it in did not work: ${(r.stderr || r.stdout).trim()}`);
    }
    env.ui.progress('Writing your tokens to your grid home (private files, never on a command line)...');
    const pr = await pushTokens(env);
    if (!pr.ok) return report(this.id, this.title, 'failed', pr.detail);
    env.ui.progress('Installing on the grid...');
    const installArgs = ['install'];
    if (env.settings.gridRoot) installArgs.push('--root', env.settings.gridRoot);
    r = await ssh(alias, gridCli(installArgs), { timeoutMs: 180_000 });
    if (r.code !== 0) return report(this.id, this.title, 'failed', `beethoven install: ${(r.stderr || r.stdout).trim()}`);
    const jobId = parseSbatchId(r.stdout) ?? (/bootstrap job (\d+)/.exec(r.stdout)?.[1] ?? null);
    const already = /already ready/i.test(r.stdout);
    const awaiting = /comes with lab access/i.test(r.stdout);
    const adopted = /adopted shared container/i.test(r.stdout);
    const verify = await ssh(alias, gridCli(['verify-tokens']), { timeoutMs: 90_000 });
    const verified = verify.code === 0 ? verify.stdout.trim().split('\n').filter(Boolean).join('; ') : '';
    const head = already ? 'grid already ready' : adopted ? "adopted the lab's shared container (nothing to build)" : awaiting ? "installed; the lab's container comes with lab access, the last step" : jobId ? `bootstrap job ${jobId} submitted (5 to 15 minutes)` : r.stdout.trim().split('\n').pop() ?? 'submitted';
    return report(this.id, this.title, 'done', head + (verified ? `; tokens on the grid: ${verified}` : ''));
  },
};


/**
 * The LAST step: ask the lab admin for access to the lab folder (shared containers and anything the
 * lab adds). Refused until every other step is done and the tokens verify on the grid, so only
 * working environments join; the shared container is what access gives, not a precondition.
 */
export const stepLabAccess: WizardStep = {
  id: 'labAccess',
  title: 'Join the lab (shared folder and containers)',
  blurb: 'Last: one request to your lead once everything above works; approval opens the lab folder.',
  async check(env) {
    const r = await ssh(env.settings.sshAlias, gridCli(['access', 'whoami', '--json']), { timeoutMs: 60_000 });
    if (r.code !== 0) return report(this.id, this.title, 'todo', 'the grid part is not installed yet');
    let j: { admin?: boolean; granted?: boolean; state?: string; lab_admin?: string } = {};
    try {
      j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
    } catch {
      return report(this.id, this.title, 'todo', 'no answer');
    }
    if (j.admin) return report(this.id, this.title, 'done', 'you are the lab admin');
    if (j.granted) {
      // access arrived since the last install: adopt the lab's container now (a second, nothing to build)
      await ssh(env.settings.sshAlias, gridCli(['install']), { timeoutMs: 120_000 });
      return report(this.id, this.title, 'done', "granted; you use the lab's shared container");
    }
    if (j.state === 'pending') return report(this.id, this.title, 'done', `requested; waiting for ${j.lab_admin ?? 'your lead'} to decide`);
    if (j.state === 'denied' || j.state === 'removed') {
      const s = await ssh(env.settings.sshAlias, gridCli(['access', 'status', '--json']), { timeoutMs: 60_000 });
      const msg = /"message":"([^"]*)"/.exec(s.stdout)?.[1];
      return report(this.id, this.title, 'failed', `${j.state}${msg ? `: ${msg}` : ''}; ask your lead to reset your request to ask again`);
    }
    return report(this.id, this.title, 'todo', 'not requested yet');
  },
  async run(env) {
    // every earlier step must be done
    const missing: string[] = [];
    for (const s of STEPS.slice(0, STEPS.findIndex((x) => x.id === 'labAccess'))) {
      const c = await s.check(env);
      if (c.status !== 'done') missing.push(`${s.title}: ${c.detail}`);
    }
    if (env.extraRequirements) missing.push(...(await env.extraRequirements()));
    if (!missing.length) {
      const r = await ssh(env.settings.sshAlias, gridCli(['access', 'requirements', '--json']), { timeoutMs: 120_000 });
      try {
        const j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
        if (Array.isArray(j.missing)) missing.push(...j.missing);
      } catch {
        missing.push('the grid did not answer the requirements check');
      }
    }
    if (missing.length) {
      await env.ui.warn(`Lab access is requested last, once your environment works the way the lab works. Still missing: ${missing.join('; ')}`);
      return report(this.id, this.title, 'skipped', `not yet: ${missing.join('; ')}`);
    }
    const note = await env.ui.ask('Everything checks out. One request to your lead (you can ask once). A note for them: your project and lead, or anything they should know.', { placeholder: 'e.g. pelvic width project, lead: Ashley' });
    if (note === undefined) return report(this.id, this.title, 'skipped', 'cancelled');
    const r = await ssh(env.settings.sshAlias, gridCli(['access', 'request', '--note', note]), { timeoutMs: 120_000 });
    if (r.code !== 0) return report(this.id, this.title, 'failed', (r.stderr || r.stdout).trim());
    return report(this.id, this.title, 'done', 'requested; your lead approves it in Beethoven; then sign in to Claude on the grid (the next step)');
  },
};

// Strict order: who you are, then your accounts (tokens live on this laptop first), then the grid
// (tokens pushed in one pass), then the lab. A step never runs before every earlier step is done.
export const STEPS: WizardStep[] = [stepWsuSignIn, stepLicense, stepGithub, stepHuggingFace, stepClaudeLocal, stepTwoFactor, stepSshKey, stepSshConfig, stepInstallKey, stepGridInstall, stepLabAccess, stepClaudeGrid];

export interface RunOptions {
  force?: boolean;
  only?: string[];
  /** Called before a step runs and after it finishes, with the full report list so far. */
  onStep?(reports: StepReport[], current: string | null): void;
}

/** Run every step that is not done, in order. Stops at the first failure of a required step. */
export async function runWizard(env: WizardEnv, opts: RunOptions = {}): Promise<StepReport[]> {
  const out: StepReport[] = [];
  for (const [i, step] of STEPS.entries()) {
    if (opts.only && !opts.only.includes(step.id)) continue;
    if (opts.only) {
      // a single step (Renew, Run again) still needs every earlier step done
      for (const prev of STEPS.slice(0, i)) {
        const c = await prev.check(env);
        if (c.status !== 'done') {
          out.push(report(step.id, step.title, 'skipped', `first finish "${prev.title}"`));
          opts.onStep?.(out, null);
          return out;
        }
      }
    }
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
    if (res.status === 'failed' || res.status === 'skipped') break;
  }
  return out;
}

export async function checkAll(env: WizardEnv): Promise<StepReport[]> {
  const out: StepReport[] = [];
  for (const step of STEPS) out.push(await step.check(env));
  return out;
}
