// The troubleshooter's face: a status-bar item that turns red and names the root cause, a panel
// that shows every node as it is checked (root causes first, with Repair / Investigate with Claude),
// Show log, and an hourly quiet sweep. Borrowed from the Windows troubleshooters: detect, name the
// cause, offer the fix, apply what is safe, keep a report.
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runDiagnostics, formatReport, DiagReport, NodeReport } from '../core/diagnostics';
import { buildGraph, makeCtx } from './diagNodes';
import { BeethovenStore, findClaudeExecutable } from './store';
import { VsCodeUI } from './ui';
import { run } from '../core/shell';
import { withoutClaudeCredentials } from '../core/services';
import { accountEnvironment } from '../core/accounts';
import { localClaudeStatus } from '../core/wizard';

/** the fix that only opens the Settings editor: a person changes the value, and the change starts the check */
const SETTINGS_COMMAND = 'workbench.action.openSettings';
/** the nodes a changed beethoven.account or account list can turn */
const ACCOUNT_NODES = ['account.list', 'account.choice', 'account.claude', 'vscode.mcp-bridge'];

export class Troubleshooter implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private last: DiagReport | null = null;
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  /** the open troubleshooter panel, so a check started elsewhere (a changed setting) can repaint it */
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private context: vscode.ExtensionContext,
    private store: BeethovenStore,
    private output: vscode.OutputChannel,
    /** called with every finished report (error reports to the maintainer, when the person allows them) */
    private afterRun?: (rep: DiagReport, gridScriptsVersion: string | null) => Promise<string>,
  ) {
    this.item = vscode.window.createStatusBarItem('beethoven.health', vscode.StatusBarAlignment.Left, 50);
    this.item.name = 'Beethoven health';
    this.item.command = 'beethoven.healthMenu';
    this.item.text = '$(sync~spin) Beethoven';
    this.item.tooltip = 'Beethoven is checking your setup';
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
    if (this.timer) clearInterval(this.timer);
  }

  /** Quiet background sweep: no repairs, no slow node probe; hourly. */
  startSweeps(): void {
    const sweep = () => void this.run({ repair: false, quick: true, quiet: true }).catch((e) => this.output.appendLine(`sweep: ${e}`));
    setTimeout(sweep, 45_000);
    this.timer = setInterval(sweep, 60 * 60_000);
  }

  private reportsDir(): string {
    const d = path.join(this.context.globalStorageUri.fsPath, 'diagnostics');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  private paint(rep: DiagReport): void {
    const warn = rep.reports.some((r) => r.status === 'warn');
    if (!this.store.settings().accessId && rep.rootCauses.every((r) => r.id.startsWith('account.') || r.layer !== 'laptop')) {
      this.item.text = '$(rocket) Beethoven: set up';
      this.item.tooltip = 'Beethoven is not set up yet: click to run the wizard or troubleshoot';
      this.item.backgroundColor = undefined;
      return;
    }
    if (rep.ok) {
      this.item.text = warn ? '$(warning) Beethoven' : '$(pass) Beethoven';
      this.item.backgroundColor = warn ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      this.item.tooltip = `Beethoven: everything works${warn ? ' (with warnings)' : ''}; checked ${new Date(rep.finished).toLocaleTimeString()}`;
    } else {
      const first = rep.rootCauses[0];
      this.item.text = `$(error) Beethoven: ${first.title}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      this.item.tooltip = `${rep.rootCauses.length} problem(s). ${first.title}: ${first.detail}\nClick: Troubleshoot, Show log`;
    }
  }

  async menu(): Promise<void> {
    const items: Array<vscode.QuickPickItem & { id: string }> = [
      { id: 'fix', label: '$(tools) Troubleshoot and repair', description: 'check every piece, fix what is safe' },
      { id: 'log', label: '$(output) Show log' },
    ];
    if (this.last && !this.last.ok) items.push({ id: 'claude', label: '$(sparkle) Investigate with Claude', description: 'ask your Claude to research the failure' });
    if (this.last) items.push({ id: 'report', label: '$(file) Open the last report', description: new Date(this.last.finished).toLocaleString() });
    if (!this.store.settings().accessId) items.unshift({ id: 'setup', label: '$(rocket) Set up Beethoven', description: 'the wizard' });
    const pick = await vscode.window.showQuickPick(items, { title: this.item.tooltip as string });
    if (!pick) return;
    if (pick.id === 'fix') await this.run({ repair: true, quick: false, quiet: false });
    else if (pick.id === 'log') this.output.show(true);
    else if (pick.id === 'claude') await this.investigate();
    else if (pick.id === 'report' && this.last) await this.openReport(this.last);
    else if (pick.id === 'setup') await vscode.commands.executeCommand('beethoven.setup');
  }

  async run(o: { repair: boolean; quick: boolean; quiet: boolean }): Promise<DiagReport | null> {
    if (this.running) {
      if (!o.quiet) void vscode.window.showInformationMessage('Beethoven is already checking; the result appears in the status bar.');
      return null;
    }
    this.running = true;
    this.item.text = '$(sync~spin) Beethoven: checking';
    const panel = o.quiet ? null : this.openPanel();
    try {
      const env = this.store.wizardEnv(new VsCodeUI(this.output));
      const ctx = makeCtx(this.store, env, this.context.extensionPath, !o.quick, (l) => this.output.appendLine(l));
      const graph = buildGraph();
      const rep = await runDiagnostics(graph, ctx, {
        repair: o.repair,
        quick: o.quick,
        onNode: (r, done, total) => {
          panel?.webview.postMessage({ type: 'node', r, done, total });
          this.item.text = `$(sync~spin) Beethoven: checking ${done}/${total}`;
        },
      });
      this.last = rep;
      this.paint(rep);
      const text = formatReport(rep);
      this.output.appendLine(text);
      fs.writeFileSync(path.join(this.reportsDir(), `${rep.started.replace(/[:.]/g, '-')}.json`), JSON.stringify(rep, null, 1));
      if (this.afterRun) {
        try {
          const gv = (await ctx.grid())?.version ?? null;
          this.output.appendLine(`error reports: ${await this.afterRun(rep, gv == null ? null : String(gv))}`);
        } catch (e) {
          this.output.appendLine(`error reports: ${(e as Error).message}`);
        }
      }
      panel?.webview.postMessage({ type: 'done', rep });
      if (!o.quiet && rep.ok) void vscode.window.showInformationMessage(`Beethoven: everything works${rep.reports.some((r) => r.status === 'repaired') ? ` (repaired: ${rep.reports.filter((r) => r.status === 'repaired').map((r) => r.title).join(', ')})` : ''}.`);
      return rep;
    } finally {
      this.running = false;
    }
  }

  private openPanel(): vscode.WebviewPanel {
    const p = vscode.window.createWebviewPanel('beethoven.troubleshoot', 'Beethoven troubleshooter', vscode.ViewColumn.One, { enableScripts: true });
    p.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'beethoven.svg');
    p.webview.html = this.html(p.webview.cspSource);
    this.panel = p;
    p.onDidDispose(() => {
      if (this.panel === p) this.panel = undefined;
    });
    p.webview.onDidReceiveMessage(async (m) => {
      if (m?.type === 'log') this.output.show(true);
      else if (m?.type === 'claude') await this.investigate();
      else if (m?.type === 'again') await this.run({ repair: true, quick: false, quiet: true }).then((rep) => rep && p.webview.postMessage({ type: 'done', rep }));
      else if (m?.type === 'fix' && typeof m.id === 'string') await this.fix(m.id, p);
      else if (m?.type === 'copy' && this.last) {
        await vscode.env.clipboard.writeText(formatReport(this.last));
        void vscode.window.showInformationMessage('The report is on your clipboard (paste it to your lead).');
      }
    });
    return p;
  }

  /**
   * The button beside a failing check: start the fix only a person can do (a sign-in, a renewal), then
   * check again. The webview names the node; the command comes from the graph, never from the page.
   */
  private async fix(id: string, p: vscode.WebviewPanel): Promise<void> {
    const fc = this.last?.rootCauses.find((r) => r.id === id)?.fixCommand;
    if (!fc) return;
    try {
      await vscode.commands.executeCommand(fc.command, ...(fc.arguments ?? []));
    } catch (e) {
      this.output.appendLine(`fix for ${id} (${fc.command}): ${(e as Error).message}`);
    }
    // the Settings editor is open now and nothing is changed yet: the check runs when the setting
    // changes (recheckAfterAccountChange), not now, when it could only fail again
    if (fc.command === SETTINGS_COMMAND) return;
    const rep = await this.run({ repair: true, quick: false, quiet: true });
    if (rep) p.webview.postMessage({ type: 'done', rep });
  }

  /**
   * The account setting or the engine's list changed. When the last report had something to say about the
   * account, check again quietly (no repairs, no node probe), so neither the status bar nor an open panel keeps,
   * until the next hourly sweep, a state the change has just fixed. Overlapping calls are dropped by run().
   */
  async recheckAfterAccountChange(): Promise<void> {
    if (!this.last?.reports.some((r) => ACCOUNT_NODES.includes(r.id) && r.status !== 'ok')) return;
    const rep = await this.run({ repair: false, quick: true, quiet: true });
    if (rep) this.panel?.webview.postMessage({ type: 'done', rep });
  }

  private async openReport(rep: DiagReport): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ content: formatReport(rep), language: 'plaintext' });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  /** For failures no rule covers: the student's own Claude researches it (web only, no shell). */
  async investigate(): Promise<void> {
    if (!this.last || this.last.ok) return void vscode.window.showInformationMessage('Nothing is broken right now.');
    const causes = this.last.rootCauses.map((r: NodeReport) => ({ id: r.id, title: r.title, detail: r.detail, manual_fix: r.manualFix, repair_tried: r.repair }));
    // only on the student's own subscription: an API key or token in VS Code's environment would bill it instead;
    // under the account beethoven.account names, like every Claude Code the edition starts on this laptop
    const exe = findClaudeExecutable();
    const env = { ...withoutClaudeCredentials(), ...accountEnvironment(this.store.accountChoice()) };
    const lc = await localClaudeStatus(exe, env);
    if (!lc.subscription) return void vscode.window.showWarningMessage(`Investigating with Claude runs only on your own Claude Pro or Max subscription, and Claude Code on this laptop is ${lc.ok ? lc.detail : 'not ready'}. Sign in with your subscription (Beethoven: Sign in to Claude on this laptop), then try again.`);
    const prompt = [
      'You are helping a Wayne State University medical student whose research tool "Beethoven for VS Code" (a VS Code extension that connects a laptop to the Wayne State HPC grid,',
      'CentOS 7, Slurm, Apptainer, VS Code Remote-SSH with the C&IT glibc sysroot, and a Claude Code worker) reports these failing checks.',
      'Research the most likely cause of each (search the web, vendor docs, Wayne State C&IT knowledge base) and give the exact steps to fix it,',
      'in plain words a first-year medical student can follow. Say what you are unsure of. Do not suggest disabling security.',
      `Laptop: ${process.platform} ${process.arch}, VS Code ${vscode.version}.`,
      `Failing checks (JSON): ${JSON.stringify(causes)}`,
    ].join(' ');
    const doc = await vscode.workspace.openTextDocument({ content: `# Investigating with Claude\n\n_Asking your Claude (web search only, no commands run)..._\n`, language: 'markdown' });
    const ed = await vscode.window.showTextDocument(doc, { preview: false });
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Claude is investigating the failure' }, () =>
      run(exe, ['-p', prompt, '--output-format', 'text', '--allowedTools', 'WebSearch,WebFetch', '--max-turns', '12'], { timeoutMs: 6 * 60_000, env }),
    );
    const text = r.code === 0 ? r.stdout.trim() : `Claude could not answer (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 500)}`;
    await ed.edit((e) => e.replace(new vscode.Range(0, 0, doc.lineCount, 0), `# Investigating with Claude\n\n${text}\n\n---\nFailing checks: ${causes.map((c) => c.id).join(', ')}\n`));
  }

  private html(csp: string): string {
    const nonce = Math.random().toString(36).slice(2);
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${csp}; script-src 'nonce-${nonce}';">
<style>
 body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);padding:0 16px 40px}
 .wrap{max-width:900px;margin:0 auto} h1{font-size:20px;margin:18px 0 4px} .sub{color:var(--vscode-descriptionForeground)}
 .bar{height:6px;border-radius:3px;background:var(--vscode-progressBar-background,#3794ff);width:0;transition:width .3s;margin:10px 0}
 .causes{margin:12px 0}.cause{border:1px solid var(--vscode-inputValidation-errorBorder,#b71c1c);background:rgba(183,28,28,.10);border-radius:8px;padding:10px 12px;margin:8px 0}
 .cause b{display:block;margin-bottom:4px}.fix{margin-top:6px;color:var(--vscode-descriptionForeground)}
 .ok{border:1px solid #2e7d32;background:rgba(46,125,50,.12);border-radius:8px;padding:10px 12px;display:none}
 h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--vscode-descriptionForeground);margin:16px 0 4px}
 .row{display:grid;grid-template-columns:22px 260px 1fr;gap:8px;padding:3px 0;border-bottom:1px solid var(--vscode-widget-border,#444);font-size:12.5px;align-items:start}
 .i{font-weight:700}.i.ok{color:#2e7d32}.i.warn{color:#c90}.i.fail{color:#e53935}.i.blocked{color:#888}.i.skipped{color:#888}.i.repaired{color:#1e88e5}
 .btns{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0} button{padding:6px 12px;border-radius:6px;border:0;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
 button.s{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
</style></head><body><div class="wrap">
<h1>Beethoven troubleshooter</h1><div class="sub" id="sub">Checking every piece Beethoven relies on, from your laptop to the compute node...</div>
<div class="bar" id="bar"></div><div class="ok" id="ok">Everything works.</div><div class="causes" id="causes"></div>
<div class="btns"><button id="again">Check and repair again</button><button class="s" id="claude">Investigate with Claude</button><button class="s" id="copy">Copy report</button><button class="s" id="log">Show log</button></div>
<div id="list"></div></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);
const icon={ok:'&#10003;',warn:'!',fail:'&#10007;',blocked:'&#8212;',skipped:'&#183;',repaired:'&#8635;'};
function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
let layer='';
function row(r){ if(r.layer!==layer){layer=r.layer;$('list').insertAdjacentHTML('beforeend','<h2>'+esc(layer)+'</h2>')}
 $('list').insertAdjacentHTML('beforeend','<div class="row"><span class="i '+r.status+'">'+icon[r.status]+'</span><span>'+esc(r.title)+'</span><span>'+esc(r.detail)+(r.rootCause?' <i>(because of '+esc(r.rootCause)+')</i>':'')+(r.repair?' <b>repair:</b> '+esc(r.repair):'')+'</span></div>')}
window.addEventListener('message',e=>{const m=e.data;
 if(m.type==='node'){row(m.r);$('bar').style.width=Math.round(100*m.done/m.total)+'%';$('sub').textContent='Checked '+m.done+' of '+m.total}
 if(m.type==='done'){const rep=m.rep;$('bar').style.width='100%';$('sub').textContent='Finished '+new Date(rep.finished).toLocaleTimeString();
  $('ok').style.display=rep.ok?'block':'none';
  $('causes').innerHTML=rep.rootCauses.map(c=>'<div class="cause"><b>'+esc(c.title)+'</b>'+esc(c.detail)+(c.repair?'<div class="fix">Tried: '+esc(c.repair)+'</div>':'')+(c.manualFix?'<div class="fix">What to do: '+esc(c.manualFix)+'</div>':'')+(c.fixCommand?'<div class="fix"><button class="fixbtn" data-id="'+esc(c.id)+'" data-settings="'+(c.fixCommand.command==='${SETTINGS_COMMAND}'?'1':'')+'">'+esc(c.fixCommand.title)+'</button></div>':'')+'</div>').join('');
  document.querySelectorAll('.fixbtn').forEach(b=>b.onclick=()=>fix(b.dataset.id,b.dataset.settings==='1'));
  $('list').innerHTML='';layer='';rep.reports.forEach(row) }});
function clear(){$('list').innerHTML='';layer='';$('causes').innerHTML='';$('ok').style.display='none'}
function fix(id,settings){if(settings){$('sub').textContent='Change the setting; Beethoven checks again when it changes.'}else{clear();$('sub').textContent='Checking again once that is done...'}vscode.postMessage({type:'fix',id})}
$('again').onclick=()=>{clear();vscode.postMessage({type:'again'})};
$('claude').onclick=()=>vscode.postMessage({type:'claude'});$('copy').onclick=()=>vscode.postMessage({type:'copy'});$('log').onclick=()=>vscode.postMessage({type:'log'});
</script></body></html>`;
  }
}
