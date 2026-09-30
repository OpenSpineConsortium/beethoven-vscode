// The license gate in VS Code. Every Beethoven command passes through allowed(); without a valid
// license only setup (whose first step is the license), the license command, the manual, the
// log and the troubleshooter work. The person a license names is checked against the Wayne
// State sign-in, which is recorded here (VS Code's own state, not a file anyone edits by hand).
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  checkLicense,
  describeLicense,
  findKey,
  Identity,
  KEY_PATTERN,
  LicenseCheck,
  readLicenseKey,
  removeLicenseKey,
  storeRevocationList,
  unlicensedMessage,
  writeIdentity,
  writeLicenseKey,
  cachedRevocationText,
  TRUSTED_KEYS,
} from '../core/license';
import { editionForKey } from '../core/terms';
import { settings } from './settings';

/** Commands that work without a license: getting one, reading about it, and finding out what is wrong. */
export const UNGATED = new Set([
  'beethoven.setup',
  'beethoven.license',
  'beethoven.openManual',
  'beethoven.showLog',
  'beethoven.healthMenu',
  'beethoven.troubleshoot',
  'beethoven.doctor',
  'beethoven.investigate',
  'beethoven.reset',
  'beethoven.refresh',
]);
export const REFUSED = 'beethoven:unlicensed';
const IDENTITY_KEY = 'beethoven.licenseIdentity';

export class LicenseGate implements vscode.Disposable {
  private cache: { at: number; check: LicenseCheck } | null = null;
  private readonly item: vscode.StatusBarItem;
  private readonly changed = new vscode.EventEmitter<LicenseCheck>();
  readonly onDidChange = this.changed.event;
  lastRefusal: { command: string; reason: string } | null = null;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    this.item = vscode.window.createStatusBarItem('beethoven.license', vscode.StatusBarAlignment.Left, 99);
    this.item.name = 'Beethoven license';
    this.item.command = 'beethoven.license';
    this.paint();
  }

  dispose(): void {
    this.item.dispose();
    this.changed.dispose();
    if (this.timer) clearInterval(this.timer);
  }

  private bundledRevoked(): string {
    try {
      return fs.readFileSync(path.join(this.context.extensionPath, 'media', 'revoked.txt'), 'utf8');
    } catch {
      return '';
    }
  }

  /** The Wayne State identity recorded at sign-in (VS Code state; mirrored to identity.json for the CLI and MCP server). */
  identity(): Identity | undefined {
    return this.context.globalState.get<Identity>(IDENTITY_KEY);
  }
  async recordIdentity(id: Identity): Promise<void> {
    await this.context.globalState.update(IDENTITY_KEY, { accessId: id.accessId?.toLowerCase(), email: id.email?.toLowerCase() });
    try {
      writeIdentity(id);
    } catch (e) {
      this.output.appendLine(`license: could not write identity.json (${e})`);
    }
    this.refresh();
  }

  check(force = false): LicenseCheck {
    if (!force && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.check;
    const c = checkLicense({ identity: this.identity(), bundledRevoked: this.bundledRevoked() });
    this.cache = { at: Date.now(), check: c };
    return c;
  }
  refresh(): LicenseCheck {
    const c = this.check(true);
    this.paint();
    this.changed.fire(c);
    return c;
  }

  /** May this command run? */
  allowed(command: string): { ok: boolean; reason: string } {
    if (UNGATED.has(command)) return { ok: true, reason: 'not gated' };
    const c = this.check();
    if (!c.ok) return { ok: false, reason: c.detail };
    if (c.identity === null) return { ok: false, reason: 'finish the setup first: Beethoven checks the license against your Wayne State sign-in' };
    return { ok: true, reason: c.detail };
  }

  /** Called by every gated command; shows why it refused. */
  refuse(command: string, reason: string): typeof REFUSED {
    this.lastRefusal = { command, reason };
    this.output.appendLine(`license: refused ${command}: ${reason}`);
    void vscode.window.showWarningMessage(`Beethoven: ${reason}.`, 'License', 'Set up').then((pick) => {
      if (pick === 'License') void vscode.commands.executeCommand('beethoven.license');
      else if (pick === 'Set up') void vscode.commands.executeCommand('beethoven.setup');
    });
    return REFUSED;
  }

  /** Verify a key and keep it only if it is valid for this person (or nobody has signed in yet). */
  async set(text: string): Promise<LicenseCheck> {
    const key = findKey(text);
    if (!key) return { ok: false, status: 'invalid', detail: 'that is not a Beethoven for VS Code license key (it starts with ASHLEY1. or BEETHOVEN1.)', identity: null };
    const c = checkLicense({ key, identity: this.identity(), bundledRevoked: this.bundledRevoked() });
    if (!c.ok) return c;
    // a Full Edition key is kept only once the Full Edition agreement is on record (the dialog opens here)
    if (editionForKey(c.payload?.edition) === 'full' && this.requireFullTerms && !(await this.requireFullTerms())) {
      return { ok: false, status: 'invalid', detail: 'the Full Edition agreement was not accepted, so the key was not kept', identity: null };
    }
    writeLicenseKey(key);
    this.output.appendLine(`license: stored ${c.payload?.lid} (${c.status})`);
    this.refresh();
    return c;
  }
  async remove(): Promise<void> {
    removeLicenseKey();
    this.refresh();
  }
  key(): string | undefined {
    return readLicenseKey();
  }
  /** set by the extension: the access-key request through the store (needs the Microsoft session) */
  requestTrial?: () => Promise<{ key?: string; detail: string; notApproved?: boolean; requestPage?: string }>;
  /** set by the extension: shows the Full Edition agreement and resolves true once it is accepted */
  requireFullTerms?: () => Promise<boolean>;
  /** set by the extension: where the signed revocation list is published (services.json or the setting) */
  revocationUrl?: () => Promise<string>;

  /** The revocation lists the grid should know about (bundled and fetched). */
  revocationTexts(): string {
    return [this.bundledRevoked(), cachedRevocationText()].filter((t) => t.trim()).join('\n');
  }

  private paint(): void {
    const c = this.check();
    if (c.ok && c.status === 'valid' && (c.daysLeft ?? 999) > 30 && c.identity !== false) {
      this.item.hide();
      return;
    }
    if (!c.ok) {
      this.item.text = '$(key) Beethoven: license needed';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      this.item.text = c.status === 'grace' ? '$(key) Beethoven: license ended' : `$(key) Beethoven: license ${c.daysLeft} d`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    this.item.tooltip = describeLicense(c);
    this.item.show();
  }

  /** Daily: fetch the revocation list if one is published (beethoven.licenseRevocationUrl); network failures keep the last list. */
  startRevocationChecks(): void {
    const run = async () => {
      const url = (this.revocationUrl ? await this.revocationUrl() : settings.get<string>('licenseRevocationUrl', '')).trim();
      if (!url) return;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = storeRevocationList(await res.text());
        this.output.appendLine(`license: revocation list ${r.ok ? r.detail : `rejected (${r.detail})`}`);
        this.refresh();
      } catch (e) {
        this.output.appendLine(`license: revocation list not fetched (${(e as Error).message}); keeping the last one`);
      }
    };
    setTimeout(() => void run(), 30_000);
    this.timer = setInterval(() => void run(), 24 * 3600_000);
  }

  /** Beethoven: License. */
  async manage(): Promise<void> {
    const c = this.refresh();
    const items: Array<vscode.QuickPickItem & { id: string }> = [
      { id: 'info', label: c.ok ? '$(pass) ' + describeLicense(c) : '$(error) ' + c.detail, description: c.payload?.name ?? '' },
      { id: 'enter', label: c.ok ? 'Replace the license key' : 'Enter a license key', description: 'paste the key you received (it starts with ASHLEY1. or BEETHOVEN1.)' },
      { id: 'terms', label: 'Read the license terms', description: 'LICENSE.txt (plain text, printable)' },
      { id: 'privacy', label: 'Read the privacy statement', description: 'PRIVACY.md' },
      { id: 'support', label: 'Support page and notice address', description: 'contact; where a notice of dispute goes (section 19)' },
    ];
    if (c.payload?.lid) items.push({ id: 'copy', label: 'Copy the license id', description: c.payload.lid });
    if (readLicenseKey()) items.push({ id: 'remove', label: 'Remove the license key from this computer' });
    const pick = await vscode.window.showQuickPick(items, { title: 'Beethoven license' });
    if (!pick) return;
    if (pick.id === 'enter') await this.enter();
    else if (pick.id === 'terms') await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(this.context.extensionPath, 'LICENSE.txt'))).then(undefined, () => vscode.env.openExternal(vscode.Uri.file(path.join(this.context.extensionPath, 'LICENSE.txt'))));
    else if (pick.id === 'copy' && c.payload?.lid) await vscode.env.clipboard.writeText(c.payload.lid);
    else if (pick.id === 'privacy') await vscode.commands.executeCommand('beethoven.errorReports');
    else if (pick.id === 'support') await vscode.commands.executeCommand('beethoven.support');
    else if (pick.id === 'remove') {
      const sure = await vscode.window.showWarningMessage('Remove the Beethoven license key from this computer? Beethoven stops working until a key is entered again.', { modal: true }, 'Remove');
      if (sure) await this.remove();
    }
  }

  async enter(): Promise<LicenseCheck | undefined> {
    let value = '';
    try {
      value = findKey(await vscode.env.clipboard.readText()) ?? '';
    } catch {
      /* no clipboard */
    }
    const text = await vscode.window.showInputBox({
      title: 'Beethoven license key',
      prompt: 'Paste the license key you received. It starts with ASHLEY1. or BEETHOVEN1. and names you.',
      value,
      ignoreFocusOut: true,
      validateInput: (v) => (KEY_PATTERN.test(v) ? null : 'A Beethoven for VS Code license key starts with ASHLEY1. or BEETHOVEN1. and is one long line.'),
    });
    if (!text) return undefined;
    const c = await this.set(text);
    if (c.ok) void vscode.window.showInformationMessage(`Beethoven: ${describeLicense(c)}`);
    else void vscode.window.showErrorMessage(`Beethoven: that key was not accepted: ${c.detail}`);
    return c;
  }
}

export { unlicensedMessage, TRUSTED_KEYS };
