// Sending error reports to Ashley's maintainer, when the person has left that on.
// Rules, all checkable: only after a troubleshooter run that found a failure or made a repair;
// only if ashley.diagnostics.share is "on" AND VS Code's own telemetry is enabled; only to the
// address in ashley.diagnostics.endpoint (empty = keep reports on this laptop and send nothing);
// the same failure at most once a day; every report that was sent is kept under the extension's
// storage so the person can read exactly what left. The report never contains an AccessID,
// e-mail, path, hostname, prompt, file content or token (core/diagReport.ts scrubs it).
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { DiagReport } from '../core/diagnostics';
import { buildSharedReport, worthSending, REPORT_FIELDS, SharedReport } from '../core/diagReport';

const INSTALL_KEY = 'ashley.installId';
const SENT_KEY = 'ashley.diagnostics.sent'; // signature -> iso time

export class DiagSharer {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
    private readonly identity: () => { accessId?: string; email?: string } | undefined,
  ) {}

  private cfg() {
    return vscode.workspace.getConfiguration('ashley');
  }
  enabled(): boolean {
    return this.cfg().get<string>('diagnostics.share', 'on') === 'on' && vscode.env.isTelemetryEnabled;
  }
  /** the report address from services.json, set by the extension once the lab's addresses are known */
  fallbackEndpoint = '';
  endpoint(): string {
    return this.cfg().get<string>('diagnostics.endpoint', '').trim() || this.fallbackEndpoint;
  }
  installId(): string {
    let id = this.context.globalState.get<string>(INSTALL_KEY);
    if (!id) {
      id = crypto.randomUUID();
      void this.context.globalState.update(INSTALL_KEY, id);
    }
    return id;
  }
  private dir(): string {
    const d = path.join(this.context.globalStorageUri.fsPath, 'diagnostics', 'reports');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  /** What would leave the laptop for this run: built, scrubbed, saved locally, whether or not it is sent. */
  prepare(rep: DiagReport, gridScriptsVersion?: string | null, errorLines?: string[]): SharedReport | null {
    if (!worthSending(rep)) return null;
    const id = this.identity();
    const report = buildSharedReport(
      rep,
      { installId: this.installId(), product: 'ashley', version: this.context.extension.packageJSON.version, gridScriptsVersion, vscode: vscode.version, os: `${os.platform()} ${os.release()}`, arch: os.arch(), errorLines },
      { accessId: id?.accessId, email: id?.email, home: os.homedir(), words: [os.hostname(), os.userInfo().username] },
    );
    fs.writeFileSync(path.join(this.dir(), `${report.when.replace(/[:.]/g, '-')}-${report.signature}.json`), JSON.stringify(report, null, 1));
    return report;
  }

  /** Send if allowed and not sent today for the same failure. Returns a one-line account of what happened. */
  async maybeSend(rep: DiagReport, gridScriptsVersion?: string | null, errorLines?: string[]): Promise<string> {
    const report = this.prepare(rep, gridScriptsVersion, errorLines);
    if (!report) return 'nothing to report (no failure, no repair)';
    if (!this.enabled()) return `report kept on this laptop only (${this.cfg().get('diagnostics.share') === 'off' ? 'sharing is off' : 'VS Code telemetry is off'})`;
    const url = this.endpoint();
    if (!url) return 'report kept on this laptop only (no report address is configured)';
    const sent = this.context.globalState.get<Record<string, string>>(SENT_KEY, {});
    const last = sent[report.signature] ? Date.parse(sent[report.signature]) : 0;
    if (Date.now() - last < 24 * 3600e3) return `same failure already reported at ${sent[report.signature]}`;
    try {
      const res = await fetch(url.replace(/\/$/, '') + '/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': `ashley/${report.version}` },
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      sent[report.signature] = new Date().toISOString();
      await this.context.globalState.update(SENT_KEY, sent);
      this.output.appendLine(`error report ${report.signature} sent (${report.nodes.filter((n) => n.status === 'fail').length} failures)`);
      return `report ${report.signature} sent`;
    } catch (e) {
      this.output.appendLine(`error report not sent: ${(e as Error).message}`);
      return `report not sent (${(e as Error).message}); kept on this laptop`;
    }
  }

  /** Ashley: Error reports. */
  async manage(): Promise<void> {
    const on = this.cfg().get<string>('diagnostics.share', 'on') === 'on';
    const files = fs.readdirSync(this.dir()).filter((f) => f.endsWith('.json')).sort();
    const items: Array<vscode.QuickPickItem & { id: string }> = [
      { id: 'state', label: `$(info) Error reports are ${on ? 'on' : 'off'}${on && !vscode.env.isTelemetryEnabled ? ' (but VS Code telemetry is off, so nothing is sent)' : ''}${on && !this.endpoint() ? ' (no report address configured: nothing is sent)' : ''}`, description: `${files.length} report(s) kept on this laptop` },
      { id: 'toggle', label: on ? 'Turn error reports off' : 'Turn error reports on', description: 'Settings > Ashley > Diagnostics: Share' },
      { id: 'fields', label: 'What a report contains', description: 'the field list' },
      { id: 'last', label: 'Open the latest report kept here', description: files[files.length - 1] ?? 'none yet' },
      { id: 'privacy', label: 'Read the privacy statement', description: 'PRIVACY.md' },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'Ashley error reports' });
    if (!pick) return;
    if (pick.id === 'toggle') {
      await this.cfg().update('diagnostics.share', on ? 'off' : 'on', vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(`Ashley error reports are now ${on ? 'off' : 'on'}.`);
    } else if (pick.id === 'fields') {
      const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: ['# What an Ashley error report contains', '', ...REPORT_FIELDS.map(([k, v]) => `- **${k}**: ${v}`), '', 'Never: prompts, file contents, tokens, your AccessID or e-mail, paths, hostnames, environment values.'].join('\n') });
      await vscode.window.showTextDocument(doc, { preview: true });
    } else if (pick.id === 'last' && files.length) {
      await vscode.window.showTextDocument(vscode.Uri.file(path.join(this.dir(), files[files.length - 1])), { preview: true });
    } else if (pick.id === 'privacy') {
      const f = vscode.Uri.file(path.join(this.context.extensionPath, 'PRIVACY.md'));
      await vscode.commands.executeCommand('markdown.showPreview', f).then(undefined, () => vscode.env.openExternal(f));
    }
  }
}
