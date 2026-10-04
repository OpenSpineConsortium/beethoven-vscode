// The Beethoven setup panel: a webview that shows the wizard's steps with their state, asks its
// questions inline (text, password, buttons), watches the clipboard for a token the student
// just copied, and keeps the log one click away. It implements the wizard's UI contract, so
// the step logic in core/wizard.ts does not know it is talking to a webview.
import * as vscode from 'vscode';
import { WizardUI, StepReport, TokenAskOptions, STEPS } from '../core/wizard';
import { resolveExecutable } from './ui';
import { extractWrappedToken } from '../core/services';

type Pending = { resolve: (v: any) => void; kind: string };

export class SetupPanel implements WizardUI, vscode.Disposable {
  private panel: vscode.WebviewPanel;
  private pending: Pending | null = null;
  private log: string[] = [];
  private disposed = false;
  private clipboardTimer: NodeJS.Timeout | null = null;
  /** Set by the extension: the student clicked Renew / Run next to a step. */
  onRunStep?: (id: string) => void;

  constructor(context: vscode.ExtensionContext, private output: vscode.OutputChannel, title = 'Beethoven setup') {
    this.panel = vscode.window.createWebviewPanel('beethoven.setup', title, vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'beethoven.svg');
    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    this.panel.onDidDispose(() => {
      this.disposed = true;
      this.stopClipboard();
      this.pending?.resolve(undefined);
      this.pending = null;
    });
  }

  dispose(): void {
    this.panel.dispose();
  }

  reveal(): void {
    this.panel.reveal();
  }

  // ---- step list --------------------------------------------------------------------
  setSteps(reports: StepReport[], current: string | null): void {
    this.post({ type: 'steps', steps: STEPS.map((s) => ({ id: s.id, title: s.title, blurb: s.blurb })), reports, current });
  }

  finish(headline: string, ok: boolean): void {
    this.post({ type: 'finish', headline, ok });
  }

  // ---- WizardUI ---------------------------------------------------------------------
  async info(message: string): Promise<void> {
    await this.prompt({ kind: 'info', message, buttons: ['Continue'] });
  }
  async warn(message: string): Promise<void> {
    this.appendLog(`warning: ${message}`);
    this.post({ type: 'toast', message, level: 'warn' });
  }
  async ask(prompt: string, opts: { password?: boolean; placeholder?: string; value?: string; validate?: (v: string) => string | null } = {}): Promise<string | undefined> {
    for (;;) {
      const v = (await this.prompt({ kind: 'input', message: prompt, password: !!opts.password, placeholder: opts.placeholder ?? '', value: opts.value ?? '' })) as string | undefined;
      if (v === undefined) return undefined;
      const err = opts.validate?.(v);
      if (err) {
        this.post({ type: 'toast', message: err, level: 'warn' });
        continue;
      }
      return v;
    }
  }
  async confirm(message: string, yes: string, no: string): Promise<boolean> {
    const r = (await this.prompt({ kind: 'choice', message, buttons: [yes, no] })) as number | undefined;
    return r === 0;
  }
  async choose(message: string, buttons: string[]): Promise<number | undefined> {
    return (await this.prompt({ kind: 'choice', message, buttons })) as number | undefined;
  }
  async openUrl(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }
  async runInteractive(title: string, command: string, args: string[], env?: Record<string, string>): Promise<number | null> {
    // Only the Claude sign-ins still need a terminal (Claude Code draws its own prompts there); env carries
    // the chosen account's directory for the laptop one (core/accounts.ts)
    const shellPath = resolveExecutable(command);
    const term = vscode.window.createTerminal({ name: title, shellPath, shellArgs: args, isTransient: true, env });
    term.show(false);
    this.post({ type: 'toast', message: `A terminal "${title}" opened below. Follow it: open the link it prints in any browser, paste the code back, come back here when it says Done.`, level: 'info' });
    const deadline = Date.now() + 15 * 60_000;
    return new Promise<number | null>((resolve) => {
      const poll = setInterval(() => {
        if (term.exitStatus !== undefined) {
          clearInterval(poll);
          resolve(term.exitStatus.code ?? null);
        } else if (Date.now() > deadline || this.disposed) {
          clearInterval(poll);
          resolve(null);
        }
      }, 500);
    });
  }
  progress(message: string): void {
    this.appendLog(message);
    this.post({ type: 'progress', message });
  }
  /**
   * Shell integration lets the extension read what a command prints in the terminal, so the token
   * that a command prints is captured without the student copying it. If the shell has
   * no integration within a few seconds, falls back to the plain terminal (clipboard capture).
   */
  async runCapturing(title: string, command: string, args: string[], pattern: RegExp): Promise<{ code: number | null; match?: string }> {
    // hidden: the student sees only the browser; the terminal appears only if something needs typing
    // a shell VS Code integrates with, whatever the student's default profile is (cmd.exe has none)
    const shellPath = process.platform === 'win32' ? 'powershell.exe' : /(bash|zsh|fish)$/.test(process.env.SHELL ?? '') ? process.env.SHELL : '/bin/bash';
    const term = vscode.window.createTerminal({ name: title, isTransient: true, hideFromUser: true, shellPath });
    const si = await new Promise<vscode.TerminalShellIntegration | undefined>((resolve) => {
      if (term.shellIntegration) return resolve(term.shellIntegration);
      const d = vscode.window.onDidChangeTerminalShellIntegration((e) => {
        if (e.terminal === term) {
          d.dispose();
          resolve(e.shellIntegration);
        }
      });
      setTimeout(() => {
        d.dispose();
        resolve(undefined);
      }, 6000);
    });
    if (!si) {
      term.dispose();
      this.post({ type: 'toast', message: 'This terminal has no shell integration; the token will be picked up from your clipboard instead.', level: 'info' });
      const code = await this.runInteractive(title, command, args);
      return { code };
    }
    this.post({ type: 'toast', message: 'Your browser opens claude.ai: sign in and press Authorize.', level: 'info' });
    this.progress('Waiting for you to press Authorize in the browser...');
    const reveal = setTimeout(() => {
      if (!match) {
        term.show(false);
        this.post({ type: 'toast', message: 'If the browser page shows a code, paste it into the terminal that just opened below.', level: 'warn' });
      }
    }, 60_000);
    const exec = si.executeCommand(command, args);
    let text = '';
    let match: string | undefined;
    const done = new Promise<number | null>((resolve) => {
      const d = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution === exec) {
          d.dispose();
          resolve(e.exitCode ?? null);
        }
      });
      setTimeout(() => {
        d.dispose();
        resolve(null);
      }, 15 * 60_000);
    });
    (async () => {
      try {
        for await (const chunk of exec.read()) {
          text += chunk.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
          const got = extractWrappedToken(text, pattern);
          if (got?.complete && !match) {
            match = got.token;
            this.post({ type: 'toast', message: 'Token captured from the terminal.', level: 'info' });
          }
        }
      } catch {
        /* stream closed */
      }
    })();
    const code = await done;
    clearTimeout(reveal);
    if (!match) match = extractWrappedToken(text, pattern)?.token; // the command ended: take what arrived
    if (match) setTimeout(() => term.dispose(), 2000);
    return { code, match };
  }
  async askToken(prompt: string, opts: TokenAskOptions): Promise<string | undefined> {
    this.startClipboard(opts.pattern);
    try {
      for (;;) {
        const v = (await this.prompt({ kind: 'token', message: prompt, instructions: opts.instructions ?? '', url: opts.url ?? '', optional: !!opts.optional })) as string | undefined;
        if (v === undefined) return undefined;
        if (v === '' && opts.optional) return '';
        if (v === '__open__') {
          if (opts.url) await this.openUrl(opts.url);
          continue;
        }
        if (!opts.pattern.test(v.trim())) {
          this.post({ type: 'toast', message: 'That does not look like the right kind of token.', level: 'warn' });
          continue;
        }
        return v.trim();
      }
    } finally {
      this.stopClipboard();
    }
  }

  // ---- plumbing ---------------------------------------------------------------------
  private prompt(p: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) return Promise.resolve(undefined);
    this.pending?.resolve(undefined);
    this.panel.reveal(undefined, true);
    return new Promise((resolve) => {
      this.pending = { resolve, kind: String(p.kind) };
      this.post({ type: 'prompt', ...p });
    });
  }
  private onMessage(m: any): void {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'answer') {
      const p = this.pending;
      this.pending = null;
      this.post({ type: 'prompt', kind: 'none' });
      p?.resolve(m.value);
    } else if (m.type === 'cancel') {
      const p = this.pending;
      this.pending = null;
      this.post({ type: 'prompt', kind: 'none' });
      p?.resolve(undefined);
    } else if (m.type === 'command' && typeof m.command === 'string' && m.command.startsWith('beethoven.')) {
      void vscode.commands.executeCommand(m.command);
    } else if (m.type === 'runStep' && typeof m.id === 'string') {
      this.onRunStep?.(m.id);
    } else if (m.type === 'showLog') {
      this.output.show(true);
    }
  }
  private startClipboard(pattern: RegExp): void {
    this.stopClipboard();
    let last = '';
    this.clipboardTimer = setInterval(async () => {
      try {
        const t = (await vscode.env.clipboard.readText()).trim();
        if (t && t !== last && pattern.test(t)) {
          last = t;
          this.post({ type: 'clipboard', preview: `${t.slice(0, 10)}…${t.slice(-4)}`, value: t });
        }
      } catch {
        /* clipboard unavailable */
      }
    }, 1000);
  }
  private stopClipboard(): void {
    if (this.clipboardTimer) clearInterval(this.clipboardTimer);
    this.clipboardTimer = null;
    this.post({ type: 'clipboard', preview: '', value: '' });
  }
  private appendLog(line: string): void {
    const stamped = `${new Date().toLocaleTimeString()} ${line}`;
    this.log.push(stamped);
    this.output.appendLine(line);
    this.post({ type: 'log', line: stamped });
  }
  private post(m: Record<string, unknown>): void {
    if (!this.disposed) void this.panel.webview.postMessage(m);
  }

  private html(): string {
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const csp = `default-src 'none'; style-src 'unsafe-inline' ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${this.panel.webview.cspSource} data:;`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Beethoven setup</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0 16px 40px; }
  .wrap { max-width: 880px; margin: 0 auto; }
  header { display: flex; align-items: baseline; gap: 14px; padding: 18px 0 6px; }
  header h1 { font-size: 22px; margin: 0; font-weight: 600; }
  header .sub { color: var(--vscode-descriptionForeground); }
  .grid { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 18px; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  ol.steps { list-style: none; margin: 0; padding: 0; border: 1px solid var(--vscode-widget-border, #555); border-radius: 10px; overflow: hidden; }
  ol.steps li { display: grid; grid-template-columns: 30px 1fr; gap: 10px; padding: 9px 12px; border-bottom: 1px solid var(--vscode-widget-border, #555); align-items: start; transition: background .3s; }
  ol.steps li:last-child { border-bottom: 0; }
  ol.steps li.current { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  ol.steps li .t { font-weight: 600; }
  ol.steps li .b { font-size: 12px; opacity: .8; }
  ol.steps li .d { font-size: 12px; opacity: .9; margin-top: 2px; }
  ol.steps li .act { margin-top: 4px; padding: 2px 10px; font-size: 12px; }
  ol.steps li.failed .d { color: var(--vscode-errorForeground); }
  .dot { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; border: 2px solid var(--vscode-descriptionForeground); color: transparent; margin-top: 2px; }
  .dot.done { background: var(--vscode-testing-iconPassed, #2e7d32); border-color: var(--vscode-testing-iconPassed, #2e7d32); color: #fff; animation: pop .35s ease; }
  .dot.failed { background: var(--vscode-testing-iconFailed, #b71c1c); border-color: var(--vscode-testing-iconFailed, #b71c1c); color: #fff; }
  .dot.skipped { border-style: dashed; }
  .dot.current { border-color: var(--vscode-progressBar-background, #3794ff); border-top-color: transparent; animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pop { 0% { transform: scale(.6); } 70% { transform: scale(1.15); } 100% { transform: scale(1); } }
  .card { border: 1px solid var(--vscode-widget-border, #555); border-radius: 10px; padding: 16px; min-height: 180px; }
  .card h2 { margin: 0 0 8px; font-size: 16px; }
  .msg { white-space: pre-wrap; line-height: 1.45; margin-bottom: 12px; }
  input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: 8px 10px; font-size: 14px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; outline: none; }
  input:focus { border-color: var(--vscode-focusBorder); }
  .row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
  button { padding: 7px 14px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; font-size: 13px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.link { background: none; color: var(--vscode-textLink-foreground); padding: 0; border: 0; }
  .clip { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: var(--vscode-inputValidation-infoBackground, rgba(55,148,255,.12)); border: 1px solid var(--vscode-inputValidation-infoBorder, #3794ff); display: none; align-items: center; gap: 10px; animation: fade .3s ease; }
  .clip.show { display: flex; }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .bar { height: 6px; border-radius: 3px; background: var(--vscode-progressBar-background, #3794ff); width: 0; transition: width .5s ease; margin: 6px 0 14px; opacity: .9; }
  .status { color: var(--vscode-descriptionForeground); font-size: 12.5px; min-height: 18px; margin-top: 8px; }
  .toast { position: fixed; right: 16px; bottom: 16px; max-width: 420px; padding: 10px 14px; border-radius: 8px; background: var(--vscode-notifications-background); color: var(--vscode-notifications-foreground); border: 1px solid var(--vscode-notifications-border, #555); box-shadow: 0 4px 18px rgba(0,0,0,.3); opacity: 0; transform: translateY(8px); transition: all .25s; }
  .toast.show { opacity: 1; transform: none; }
  .toast.warn { border-color: var(--vscode-inputValidation-warningBorder, #c90); }
  details { margin-top: 16px; } summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
  pre.log { font-family: var(--vscode-editor-font-family); font-size: 12px; max-height: 200px; overflow: auto; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 6px; }
  .finish { display: none; padding: 14px; border-radius: 10px; margin-top: 14px; }
  .finish.ok { display: block; background: rgba(46,125,50,.15); border: 1px solid #2e7d32; }
  .finish.bad { display: block; background: rgba(183,28,28,.12); border: 1px solid #b71c1c; }
</style></head><body><div class="wrap">
<header><h1>Beethoven setup</h1><span class="sub">${STEPS.length} steps. Finished ones are skipped; rerun any time.</span></header>
<div class="bar" id="bar"></div>
<div class="grid">
  <ol class="steps" id="steps"></ol>
  <div>
    <div class="card" id="card">
      <h2 id="title">Getting ready</h2>
      <div class="msg" id="msg">Checking what is already done on this laptop and on the grid...</div>
      <div id="controls"></div>
      <div class="clip" id="clip"><span>Found a token on your clipboard: <b id="clipPreview"></b></span><button id="clipUse">Use it</button><button class="secondary" id="clipNo">No</button></div>
      <div class="status" id="status"></div>
    </div>
    <div class="finish" id="finish"></div>
    <div class="row"><button class="secondary" id="btnWorker">Start a worker</button><button class="secondary" id="btnConnect">Open my grid files</button><button class="secondary" id="btnDoctor">Run the doctor</button><button class="link" id="btnLog">Show the full log</button></div>
    <details><summary>Log</summary><pre class="log" id="log"></pre></details>
  </div>
</div>
<div class="toast" id="toast"></div>
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let clipValue = '';
let pendingKind = 'none';
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function answer(v){ vscode.postMessage({ type: 'answer', value: v }); }
function toast(m, level){ const t = $('toast'); t.textContent = m; t.className = 'toast show ' + (level||''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 6000); }
function renderSteps(steps, reports, current){
  const byId = Object.fromEntries(reports.map(r => [r.id, r]));
  const done = reports.filter(r => r.status === 'done').length;
  $('bar').style.width = Math.round(100 * done / steps.length) + '%';
  $('steps').innerHTML = steps.map((s, i) => {
    const r = byId[s.id];
    const st = current === s.id ? 'current' : r ? r.status : '';
    const mark = st === 'done' ? '✓' : st === 'failed' ? '!' : st === 'skipped' ? '–' : '';
    const tokenStep = ['github', 'huggingface'].includes(s.id);
    const act = !current && r ? '<button class="act secondary" data-step="' + s.id + '">' + (tokenStep ? 'Renew' : (r.status === 'done' ? 'Run again' : 'Run')) + '</button>' : '';
    return '<li class="' + (current === s.id ? 'current ' : '') + (r && r.status === 'failed' ? 'failed' : '') + '"><span class="dot ' + st + '">' + mark + '</span><div><div class="t">' + (i+1) + '. ' + esc(s.title) + '</div><div class="b">' + esc(s.blurb) + '</div>' + (r ? '<div class="d">' + esc(r.detail) + '</div>' : '') + act + '</div></li>';
  }).join('');
  document.querySelectorAll('button[data-step]').forEach(b => b.onclick = () => vscode.postMessage({ type: 'runStep', id: b.dataset.step }));
  if (current) { const s = steps.find(x => x.id === current); if (s) { $('title').textContent = s.title; } }
}
function renderPrompt(p){
  pendingKind = p.kind;
  const c = $('controls'); c.innerHTML = '';
  $('clip').classList.remove('show');
  if (p.kind === 'none') { $('status').textContent = ''; return; }
  $('msg').textContent = p.message || '';
  if (p.kind === 'info') {
    c.innerHTML = '<div class="row"><button id="ok">' + esc(p.buttons[0]) + '</button></div>';
    $('ok').onclick = () => answer(0);
  } else if (p.kind === 'choice') {
    c.innerHTML = '<div class="row">' + p.buttons.map((b, i) => '<button class="' + (i ? 'secondary' : '') + '" data-i="' + i + '">' + esc(b) + '</button>').join('') + '</div>';
    c.querySelectorAll('button').forEach(b => b.onclick = () => answer(parseInt(b.dataset.i, 10)));
  } else if (p.kind === 'input') {
    c.innerHTML = '<input id="in" type="' + (p.password ? 'password' : 'text') + '" placeholder="' + esc(p.placeholder) + '" value="' + esc(p.value) + '" autocomplete="off"><div class="row"><button id="ok">Continue</button><button class="secondary" id="cancel">Cancel</button></div>';
    const inp = $('in'); inp.focus(); inp.select();
    const go = () => answer(inp.value);
    $('ok').onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    $('cancel').onclick = () => vscode.postMessage({ type: 'cancel' });
  } else if (p.kind === 'token') {
    $('msg').textContent = p.message + (p.instructions ? '\\n\\n' + p.instructions : '');
    c.innerHTML = (p.url ? '<div class="row"><button id="open">Open the page in my browser</button></div>' : '') +
      '<div class="row" style="margin-top:14px"><input id="in" type="password" placeholder="or paste the token here" autocomplete="off"></div>' +
      '<div class="row"><button id="ok">Save token</button>' + (p.optional ? '<button class="secondary" id="skip">Skip</button>' : '') + '<button class="secondary" id="cancel">Cancel</button></div>' +
      '<div class="status">Waiting: copy the token and it appears here by itself.</div>';
    if (p.url) $('open').onclick = () => answer('__open__');
    $('ok').onclick = () => answer($('in').value);
    $('in').onkeydown = (e) => { if (e.key === 'Enter') answer($('in').value); };
    if (p.optional) $('skip').onclick = () => answer('');
    $('cancel').onclick = () => vscode.postMessage({ type: 'cancel' });
    if (clipValue) showClip();
  }
}
function showClip(){ if (pendingKind === 'token' && clipValue) { $('clip').classList.add('show'); } }
$('clipUse').onclick = () => { if (clipValue) answer(clipValue); };
$('clipNo').onclick = () => { clipValue = ''; $('clip').classList.remove('show'); };
$('btnWorker').onclick = () => vscode.postMessage({ type: 'command', command: 'beethoven.workerStart' });
$('btnConnect').onclick = () => vscode.postMessage({ type: 'command', command: 'beethoven.connect' });
$('btnDoctor').onclick = () => vscode.postMessage({ type: 'command', command: 'beethoven.doctor' });
$('btnLog').onclick = () => vscode.postMessage({ type: 'showLog' });
window.addEventListener('message', (e) => {
  const m = e.data;
  if (m.type === 'steps') renderSteps(m.steps, m.reports, m.current);
  else if (m.type === 'prompt') renderPrompt(m);
  else if (m.type === 'progress') $('status').textContent = m.message;
  else if (m.type === 'log') { const l = $('log'); l.textContent += m.line + '\\n'; l.scrollTop = l.scrollHeight; }
  else if (m.type === 'toast') toast(m.message, m.level);
  else if (m.type === 'clipboard') { clipValue = m.value || ''; $('clipPreview').textContent = m.preview || ''; if (clipValue) showClip(); else $('clip').classList.remove('show'); }
  else if (m.type === 'finish') { const f = $('finish'); f.textContent = m.headline; f.className = 'finish ' + (m.ok ? 'ok' : 'bad'); $('title').textContent = m.ok ? 'Done' : 'Stopped'; $('msg').textContent = m.ok ? 'The Beethoven view in the activity bar shows when the grid container is ready. Then start a worker.' : 'Fix what the step says and run the wizard again; finished steps are skipped.'; $('controls').innerHTML=''; }
});
</script></body></html>`;
  }
}
