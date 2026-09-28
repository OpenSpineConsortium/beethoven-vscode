// Settings, secrets, terminal environment and the host services the wizard can use
// (GitHub sign-in through VS Code, in-panel key installation): the VS Code side of WizardEnv.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SecretId, SERVICES, localEnvironment } from '../core/services';
import { WizardEnv, WizardSettings, WizardUI } from '../core/wizard';
import { installPublicKey } from '../core/sshInstall';
import { isMcpRegistered, registerMcp } from './mcpRegister';

const SECRET_PREFIX = 'ashley.';
export const GITHUB_SCOPES = ['repo', 'workflow', 'read:org', 'gist'];

export class AshleyStore {
  constructor(public readonly context: vscode.ExtensionContext) {}

  get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('ashley');
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
  }

  /** keychain probe for the troubleshooter */
  async setSecretRaw(key: string, value: string | undefined): Promise<void> {
    if (value === undefined) await this.context.secrets.delete(key);
    else await this.context.secrets.store(key, value);
  }
  getSecretRaw(key: string): Promise<string | undefined> {
    return Promise.resolve(this.context.secrets.get(key));
  }

  async secretSummary(): Promise<Array<{ id: SecretId; name: string; present: boolean }>> {
    const out = [];
    for (const s of SERVICES) out.push({ id: s.id, name: s.name, present: !!(await this.getSecret(s.id)) });
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
    col.description = 'Ashley: tokens and grid variables for this laptop';
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

  /** The lab's pre-approved AccessIDs: the list shipped in this build, or a newer one from ashley.allowlistUrl. */
  async allowlist(): Promise<string[] | null> {
    const url = this.config.get<string>('allowlistUrl', '');
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
      extraRequirements: async () => {
        const m: string[] = [];
        if (!vscode.extensions.getExtension('anthropic.claude-code')) m.push('the Claude Code extension (signed in to Claude Pro or Max)');
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
