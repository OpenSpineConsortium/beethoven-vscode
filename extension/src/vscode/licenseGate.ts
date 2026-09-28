// The license gate in VS Code. Every Ashley command passes through allowed(); without a valid
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

/** Commands that work without a license: getting one, reading about it, and finding out what is wrong. */
export const UNGATED = new Set([
  'ashley.setup',
  'ashley.license',
  'ashley.openManual',
  'ashley.showLog',
  'ashley.healthMenu',
  'ashley.troubleshoot',
  'ashley.doctor',
  'ashley.investigate',
  'ashley.reset',
  'ashley.refresh',
]);
export const REFUSED = 'ashley:unlicensed';
const IDENTITY_KEY = 'ashley.licenseIdentity';

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
    this.item = vscode.window.createStatusBarItem('ashley.license', vscode.StatusBarAlignment.Left, 99);
    this.item.name = 'Ashley license';
    this.item.command = 'ashley.license';
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
    if (c.identity === null) return { ok: false, reason: 'finish the setup first: Ashley checks the license against your Wayne State sign-in' };
    return { ok: true, reason: c.detail };
  }

  /** Called by every gated command; shows why it refused. */
  refuse(command: string, reason: string): typeof REFUSED {
    this.lastRefusal = { command, reason };
    this.output.appendLine(`license: refused ${command}: ${reason}`);
    void vscode.window.showWarningMessage(`Ashley: ${reason}.`, 'License', 'Set up').then((pick) => {
      if (pick === 'License') void vscode.commands.executeCommand('ashley.license');
      else if (pick === 'Set up') void vscode.commands.executeCommand('ashley.setup');
    });
    return REFUSED;
  }

  /** Verify a key and keep it only if it is valid for this person (or nobody has signed in yet). */
  async set(text: string): Promise<LicenseCheck> {
    const key = findKey(text);
    if (!key) return { ok: false, status: 'invalid', detail: 'that is not an Ashley license key (it starts with ASHLEY1.)', identity: null };
    const c = checkLicense({ key, identity: this.identity(), bundledRevoked: this.bundledRevoked() });
    if (!c.ok) return c;
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
  /** set by the extension: the trial request through the store (needs the Microsoft session) */
  requestTrial?: () => Promise<{ key?: string; detail: string }>;

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
      this.item.text = '$(key) Ashley: license needed';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      this.item.text = c.status === 'grace' ? '$(key) Ashley: license ended' : `$(key) Ashley: license ${c.daysLeft} d`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    this.item.tooltip = describeLicense(c);
    this.item.show();
  }

  /** Daily: fetch the revocation list if one is published (ashley.licenseRevocationUrl); network failures keep the last list. */
  startRevocationChecks(): void {
    const run = async () => {
      const url = vscode.workspace.getConfiguration('ashley').get<string>('licenseRevocationUrl', '').trim();
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

  /** Ashley: License. */
  async manage(): Promise<void> {
    const c = this.refresh();
    const items: Array<vscode.QuickPickItem & { id: string }> = [
      { id: 'info', label: c.ok ? '$(pass) ' + describeLicense(c) : '$(error) ' + c.detail, description: c.payload?.name ?? '' },
      { id: 'enter', label: c.ok ? 'Replace the license key' : 'Enter a license key', description: 'paste the key you received (it starts with ASHLEY1.)' },
      { id: 'terms', label: 'Read the license terms', description: 'LICENSE.txt (plain text, printable)' },
      { id: 'privacy', label: 'Read the privacy statement', description: 'PRIVACY.md' },
      { id: 'support', label: 'Support page and notice address', description: 'contact; where a notice of dispute goes (section 19)' },
    ];
    if (c.payload?.lid) items.push({ id: 'copy', label: 'Copy the license id', description: c.payload.lid });
    if (readLicenseKey()) items.push({ id: 'remove', label: 'Remove the license key from this computer' });
    const pick = await vscode.window.showQuickPick(items, { title: 'Ashley license' });
    if (!pick) return;
    if (pick.id === 'enter') await this.enter();
    else if (pick.id === 'terms') await vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(path.join(this.context.extensionPath, 'LICENSE.txt'))).then(undefined, () => vscode.env.openExternal(vscode.Uri.file(path.join(this.context.extensionPath, 'LICENSE.txt'))));
    else if (pick.id === 'copy' && c.payload?.lid) await vscode.env.clipboard.writeText(c.payload.lid);
    else if (pick.id === 'privacy') await vscode.commands.executeCommand('ashley.errorReports');
    else if (pick.id === 'support') await vscode.commands.executeCommand('ashley.support');
    else if (pick.id === 'remove') {
      const sure = await vscode.window.showWarningMessage('Remove the Ashley license key from this computer? Ashley stops working until a key is entered again.', { modal: true }, 'Remove');
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
      title: 'Ashley license key',
      prompt: 'Paste the license key you received. It starts with ASHLEY1. and names you.',
      value,
      ignoreFocusOut: true,
      validateInput: (v) => (KEY_PATTERN.test(v) ? null : 'An Ashley license key starts with ASHLEY1. and is one long line.'),
    });
    if (!text) return undefined;
    const c = await this.set(text);
    if (c.ok) void vscode.window.showInformationMessage(`Ashley: ${describeLicense(c)}`);
    else void vscode.window.showErrorMessage(`Ashley: that key was not accepted: ${c.detail}`);
    return c;
  }
}

export { unlicensedMessage, TRUSTED_KEYS };
