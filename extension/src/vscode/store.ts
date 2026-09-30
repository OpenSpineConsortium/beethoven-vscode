// Settings, secrets, terminal environment and the host services the wizard can use
// (GitHub sign-in through VS Code, in-panel key installation): the VS Code side of WizardEnv.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SecretId, SERVICES, localEnvironment } from '../core/services';
import { WizardEnv, WizardSettings, WizardUI, localClaudeStatus } from '../core/wizard';
import { installPublicKey } from '../core/sshInstall';
import { isMcpRegistered, registerMcp } from './mcpRegister';
import type { LicenseGate } from './licenseGate';
import { settings, Settings } from './settings';
import { REQUEST_PAGE, SUPPORT_PAGE } from '../core/site';

const SECRET_PREFIX = 'beethoven.';
/** what the daily token check found, per secret id (VS Code state; cleared when the token changes) */
const TOKEN_CHECKS_KEY = 'beethoven.tokenChecks';
export const GITHUB_SCOPES = ['repo', 'workflow', 'read:org', 'gist'];

/** missing: nothing stored; expired: stored but the service rejected it at the last daily check; stored: present and not known to be bad */
export type SecretStatus = 'missing' | 'expired' | 'stored';
export interface SecretSummary {
  id: SecretId;
  name: string;
  present: boolean;
  optional: boolean;
  status: SecretStatus;
  /** why the service rejected it, when it did */
  detail?: string;
}
interface TokenCheck {
  ok: boolean;
  detail: string;
  at: string;
}

export class BeethovenStore {
  /** set by activate(): the license gate the wizard and the diagnostics use */
  licenseGate?: LicenseGate;
  constructor(public readonly context: vscode.ExtensionContext) {}

  /** beethoven.* settings, reading a value still set under the old name ashley.* (settings.ts) */
  get config(): Settings {
    return settings;
  }

  settings(): WizardSettings {
    const c = this.config;
    return {
      accessId: c.get<string>('accessId', ''),
      wsuEmail: c.get<string>('wsuEmail', ''),
      twoFactorDone: c.get<boolean>('twoFactorDone', false),
      loginHost: c.get<string>('loginHost', 'warrior.grid.wayne.edu'),
      sshAlias: c.get<string>('sshAlias', 'wsu-grid'),
      nodeDomain: c.get<string>('nodeDomain', 'nas.grid.wayne.edu'),
      identityFile: c.get<string>('identityFile', '~/.ssh/id_ed25519_wsu'),
      gridRoot: c.get<string>('gridRoot', ''),
      gridScriptsDir: path.join(this.context.extensionPath, 'dist', 'grid'),
      claudeExecutable: findClaudeExecutable(),
    };
  }

  async saveSetting<K extends keyof WizardSettings>(key: K, value: WizardSettings[K]): Promise<void> {
    if (key === 'gridScriptsDir' || key === 'claudeExecutable') return;
    await this.config.update(key as string, value, vscode.ConfigurationTarget.Global);
  }

  getSecret(id: SecretId): Promise<string | undefined> {
    return Promise.resolve(this.context.secrets.get(SECRET_PREFIX + id));
  }

  async setSecret(id: SecretId, value: string | undefined): Promise<void> {
    if (value === undefined || value === '') await this.context.secrets.delete(SECRET_PREFIX + id);
    else await this.context.secrets.store(SECRET_PREFIX + id, value);
    // a new value has not been checked yet: forget what the daily check said about the old one
    await this.recordTokenCheck(id, undefined);
  }

  /** What the daily check (checkTokensQuietly) found for a token; the Beethoven view reads this instead of asking the service again. */
  tokenCheck(id: SecretId): TokenCheck | undefined {
    return this.context.globalState.get<Record<string, TokenCheck>>(TOKEN_CHECKS_KEY, {})[id];
  }

  async recordTokenCheck(id: SecretId, result: { ok: boolean; detail: string } | undefined): Promise<void> {
    const all = { ...this.context.globalState.get<Record<string, TokenCheck>>(TOKEN_CHECKS_KEY, {}) };
    if (result) all[id] = { ok: result.ok, detail: result.detail, at: new Date().toISOString() };
    else delete all[id];
    await this.context.globalState.update(TOKEN_CHECKS_KEY, all);
  }

  /** keychain probe for the troubleshooter */
  async setSecretRaw(key: string, value: string | undefined): Promise<void> {
    if (value === undefined) await this.context.secrets.delete(key);
    else await this.context.secrets.store(key, value);
  }
  getSecretRaw(key: string): Promise<string | undefined> {
    return Promise.resolve(this.context.secrets.get(key));
  }

  async secretSummary(): Promise<SecretSummary[]> {
    const out: SecretSummary[] = [];
    for (const s of SERVICES) {
      const present = !!(await this.getSecret(s.id));
      const c = present ? this.tokenCheck(s.id) : undefined;
      out.push({ id: s.id, name: s.name, present, optional: s.optional, status: !present ? 'missing' : c && !c.ok ? 'expired' : 'stored', detail: c && !c.ok ? c.detail : undefined });
    }
    return out;
  }

  /**
   * Integrated terminals get GITHUB_TOKEN / HF_TOKEN and a few harmless variables.
   * ANTHROPIC_API_KEY is deliberately never injected: with it set, the local Claude Code
   * would bill the key instead of the student's subscription.
   */
  async hydrateEnvironment(): Promise<string[]> {
    const col = this.context.environmentVariableCollection;
    col.persistent = true;
    col.description = 'Beethoven: tokens and grid variables for this laptop';
    col.clear();
    const s = this.settings();
    const names: string[] = [];
    if (s.accessId) {
      for (const [k, v] of Object.entries(localEnvironment(s.accessId, s.sshAlias))) {
        col.replace(k, v);
        names.push(k);
      }
    }
    if (this.config.get<boolean>('injectTokensIntoTerminals', true)) {
      for (const svc of SERVICES.filter((x) => x.injectLocally)) {
        const v = await this.getSecret(svc.id);
        if (v)
          for (const name of svc.envVars) {
            col.replace(name, v);
            names.push(name);
          }
      }
    }
    return names;
  }

  /**
   * Wayne State sign-in: the university's Microsoft account through VS Code's own Microsoft
   * sign-in (browser, work or school accounts only). Only the account's e-mail is used.
   */
  async signInWsu(): Promise<{ email: string } | undefined> {
    const session = await vscode.authentication.getSession('microsoft', ['VSCODE_TENANT:organizations', 'User.Read'], { createIfNone: true, clearSessionPreference: true });
    return session ? { email: session.account.label } : undefined;
  }

  /**
   * Where the lab's services live: the file at beethoven.servicesUrl (published with the support site, so
   * the addresses can change without a new release), cached for an hour; a non-empty setting for a
   * particular address always wins. Keys: license_service, allowlist, revocation, report,
   * request_page, support_page. Empty means "not configured".
   */
  async services(): Promise<Record<string, string>> {
    const cached = this.context.globalState.get<{ at: number; map: Record<string, string> }>('beethoven.services');
    let map: Record<string, string> = cached && Date.now() - cached.at < 3_600_000 ? cached.map : {};
    const src = this.config.get<string>('servicesUrl', '').trim();
    if (src && !Object.keys(map).length) {
      try {
        const res = await fetch(src, { signal: AbortSignal.timeout(8_000), headers: { accept: 'application/json' } });
        if (res.ok) {
          const j = (await res.json()) as Record<string, unknown>;
          map = Object.fromEntries(Object.entries(j).filter(([, v]) => typeof v === 'string' && /^https:\/\//.test(v as string)).map(([k, v]) => [k, (v as string).trim()]));
          await this.context.globalState.update('beethoven.services', { at: Date.now(), map });
        }
      } catch {
        map = cached?.map ?? {};
      }
    }
    const setting = (k: string) => this.config.get<string>(k, '').trim();
    return {
      ...map,
      license_service: setting('licenseServiceUrl') || map.license_service || '',
      allowlist: setting('allowlistUrl') || map.allowlist || '',
      revocation: setting('licenseRevocationUrl') || map.revocation || '',
      report: setting('diagnostics.endpoint') || map.report || '',
      request_page: map.request_page || REQUEST_PAGE,
      support_page: map.support_page || SUPPORT_PAGE,
    };
  }
  async serviceUrl(name: 'license_service' | 'allowlist' | 'revocation' | 'report' | 'request_page' | 'support_page'): Promise<string> {
    return (await this.services())[name] || '';
  }

  /**
   * An access key from the lab's access service: the service checks the Wayne State sign-in itself
   * (it receives the Microsoft access token VS Code holds and asks Microsoft who it is), checks that
   * the AccessID is approved, and returns a signed key in that person's name. Nothing else is sent.
   */
  async requestTrial(): Promise<{ key?: string; detail: string; notApproved?: boolean; requestPage?: string }> {
    const svc = await this.services();
    const url = svc.license_service;
    if (!url) return { detail: 'No access service is configured for this build: your lead issues keys by hand (send them your AccessID).' };
    const session = await vscode.authentication.getSession('microsoft', ['VSCODE_TENANT:organizations', 'User.Read'], { createIfNone: true });
    if (!session) return { detail: 'the Wayne State sign-in was cancelled' };
    try {
      // the access service's name for this edition (it sent "ashley" before the rename; "beethoven" there is the browser edition)
      const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ product: 'beethoven-vscode', version: this.context.extension.packageJSON.version }), signal: AbortSignal.timeout(30_000) });
      const j = (await res.json().catch(() => ({}))) as { key?: string; error?: string; detail?: string; request_page?: string };
      if (res.status === 403) return { detail: j.detail || 'your AccessID is not approved for Beethoven yet', notApproved: true, requestPage: j.request_page || svc.request_page };
      if (!res.ok || !j.key) return { detail: j.detail || j.error || `the access service answered HTTP ${res.status}` };
      return { key: j.key, detail: j.detail ?? 'access key issued' };
    } catch (e) {
      return { detail: `the access service could not be reached (${(e as Error).message})` };
    }
  }

  /**
   * The approved AccessIDs: the published list when there is one; otherwise, when an access service
   * exists, no local list (the service decides); otherwise the list shipped in this build.
   */
  async allowlist(): Promise<string[] | null> {
    const svc = await this.services();
    const url = svc.allowlist;
    if (!url && svc.license_service) return null;
    if (url) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 10_000);
        const res = await fetch(url, { signal: ctl.signal });
        clearTimeout(timer);
        if (res.ok) {
          const j = (await res.json()) as { accessIds?: string[] };
          if (Array.isArray(j.accessIds)) return j.accessIds.map((x) => x.toLowerCase());
        }
      } catch {
        /* fall back to the bundled list */
      }
    }
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.context.extensionPath, 'media', 'allowlist.json'), 'utf8')) as { accessIds?: string[] };
      return Array.isArray(j.accessIds) ? j.accessIds.map((x) => x.toLowerCase()) : null;
    } catch {
      return null;
    }
  }

  /** GitHub through VS Code's own sign-in: the browser opens, the token comes back by itself. */
  async signInGitHub(): Promise<{ token: string; login?: string } | undefined> {
    const session = await vscode.authentication.getSession('github', GITHUB_SCOPES, { createIfNone: true });
    return session ? { token: session.accessToken, login: session.account?.label } : undefined;
  }

  wizardEnv(ui: WizardUI): WizardEnv {
    const s = this.settings();
    return {
      settings: s,
      saveSetting: (k, v) => this.saveSetting(k, v),
      getSecret: (id) => this.getSecret(id),
      setSecret: (id, v) => this.setSecret(id, v),
      ui,
      onTokensChanged: async () => {
        await this.hydrateEnvironment();
      },
      signInGitHub: () => this.signInGitHub(),
      signInWsu: () => this.signInWsu(),
      allowlist: () => this.allowlist(),
      services: () => this.services(),
      license: this.licenseGate,
      extraRequirements: async () => {
        const m: string[] = [];
        if (!vscode.extensions.getExtension('anthropic.claude-code')) m.push('the Claude Code extension (signed in to Claude Pro or Max)');
        const lc = await localClaudeStatus(s.claudeExecutable);
        if (!lc.subscription) m.push(`Claude Code on this laptop signed in with a Claude Pro or Max subscription (${lc.detail})`);
        if (!vscode.extensions.getExtension('ms-vscode-remote.remote-ssh')) m.push('the Remote-SSH extension');
        if (!(await isMcpRegistered())) {
          const r = await registerMcp(this.context.extensionPath, s.sshAlias, () => {});
          if (!r.ok) m.push(`the Claude Code bridge (${r.detail})`);
        }
        return m;
      },
      installKeyWithPassword: (pub) =>
        installPublicKey({
          host: s.loginHost,
          username: s.accessId,
          publicKey: pub,
          password: () => ui.ask(`Your grid password for ${s.accessId} (used once, never stored)`, { password: true }),
          prompt: (text, echo) => ui.ask(/verification|code|token/i.test(text) ? 'The six-digit code from Google Authenticator' : text, { password: !echo }),
          log: (l) => ui.progress(l),
        }),
    };
  }
}

/** `claude` from PATH if present, else the binary bundled with the Claude Code VS Code extension. */
export function findClaudeExecutable(): string {
  const ext = vscode.extensions.getExtension('anthropic.claude-code');
  if (ext) {
    const bin = path.join(ext.extensionPath, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (fs.existsSync(bin)) return bin;
  }
  return 'claude';
}
