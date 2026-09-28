// The signing dialog: a webview that shows the full agreement and privacy statement, requires the
// person to scroll to the end, tick each affirmation (each names the button that forms the
// agreement), type their name, and choose "I agree". It records what was shown (versions and
// SHA-256 of the texts), what was ticked, the typed name, the surface and the time, and keeps the
// texts beside the record so the person can store and print them (Michigan UETA, MCL 450.838(3)).
// Built to the assent pattern the cases enforce: conspicuous notice, un-prechecked boxes whose
// sentence names the exact button (Berman, Chabolla, In re StockX), never install-equals-accept.
// Accessible: real inputs with labels, keyboard operable, focus visible, theme tokens, text
// selectable and copyable; "Open in editor" gives a plain, printable view.
import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AFFIRMATIONS, AGREE_BUTTON, Affirmation, TERMS_VERSION, TermsRecord, acceptanceComplete, readTermsRecord, sha256, writeTermsRecord } from '../core/terms';

export interface SigningResult {
  record: TermsRecord;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class TermsPanel {
  static async show(context: vscode.ExtensionContext, output: vscode.OutputChannel, installId: string): Promise<TermsRecord | undefined> {
    const license = fs.readFileSync(path.join(context.extensionPath, 'LICENSE.txt'), 'utf8');
    const privacy = fs.readFileSync(path.join(context.extensionPath, 'PRIVACY.md'), 'utf8');
    const licenseHash = sha256(license);
    const privacyHash = sha256(privacy);
    const panel = vscode.window.createWebviewPanel('ashley.terms', 'Ashley: license terms', { viewColumn: vscode.ViewColumn.Active, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true, enableFindWidget: true, localResourceRoots: [] });
    const nonce = crypto.randomBytes(16).toString('base64');
    const summary = [
      'Ashley is licensed software. It is licensed, not sold: you receive a license to use it, not the software itself.',
      'Every copy needs a license key for the person using it, checked against your Wayne State sign-in. Trials are free, one per person, and end by themselves; nothing converts to a paid license and no payment details are taken.',
      'Ashley depends on your university\'s grid and network, on Anthropic (Claude and Claude Code), on Microsoft (VS Code and its Marketplace), on GitHub and on Hugging Face. Any of them can stop it working, and that is not refunded (section 7 to 9; a long outage extends a paid license).',
      'Ashley stores no Claude credential: you sign in to Claude Code yourself, on the laptop and once on the grid. Your GitHub and Hugging Face tokens are kept in your keychain and copied, with your consent, into your own grid account.',
      'Disputes: a signed written notice and 60 days to resolve it before any lawsuit; individual claims only (class-action waiver); Michigan courts, or small claims where you live; a jury waiver; one year to bring contract and warranty claims (sections 19 and 20). No arbitration in this version.',
      'Refunds: a paid key can be refunded on request within 14 days; after that, an outage caused by an outside dependency is not refunded but a long one extends your license.',
      'Electronic records: you receive the agreement and notices electronically, can save and print them ("Open in editor", "Save a copy"), can ask for a paper copy, and can withdraw this consent by stopping use. You need VS Code or a web browser to read them.',
      'No warranty; liability is limited (sections 12 and 13). Ashley is a research tool and never for clinical use.',
      'Error reports: with your permission, when one of Ashley\'s checks fails it sends its maintainer the versions, which checks failed and their messages with names, paths and secrets replaced. Never prompts, files, tokens or your AccessID. You choose below and can change it any time in Settings.',
    ];
    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ashley: license terms</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); margin: 0; padding: 0 16px 24px; line-height: 1.45; }
  h1 { font-size: 1.35em; margin: 16px 0 4px; }
  h2 { font-size: 1.05em; margin: 18px 0 6px; }
  .lead { margin: 0 0 10px; color: var(--vscode-descriptionForeground); }
  .summary li { margin: 4px 0; }
  .doc { border: 1px solid var(--vscode-panel-border, #888); background: var(--vscode-textBlockQuote-background, transparent); padding: 12px; height: 46vh; overflow: auto; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); font-size: 0.95em; user-select: text; }
  .doc:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .hint { font-size: 0.95em; color: var(--vscode-descriptionForeground); margin: 6px 0 12px; }
  .box { display: grid; grid-template-columns: 1.4em 1fr; gap: 8px; align-items: start; margin: 8px 0; }
  .box input { margin: 4px 0 0; width: 1.1em; height: 1.1em; }
  label { cursor: pointer; }
  input[type=text] { font: inherit; padding: 6px 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); min-width: 22em; }
  input:focus, button:focus { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .row { margin: 12px 0; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  button { font: inherit; padding: 6px 14px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); font-weight: 600; }
  button[disabled] { opacity: 0.55; cursor: not-allowed; }
  .status { margin-top: 8px; min-height: 1.4em; color: var(--vscode-errorForeground); }
  fieldset { border: 1px solid var(--vscode-panel-border, #888); padding: 8px 12px; margin: 10px 0; }
  legend { padding: 0 6px; }
  .note { font-size: 0.92em; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h1>Ashley Software License Agreement (version ${TERMS_VERSION}) and Privacy Statement</h1>
<p class="lead">Read the summary, then the full text (scroll to its end), tick each statement, type your name, and choose <strong>${esc(AGREE_BUTTON)}</strong>. Choosing that button forms the agreement between you and the licensor; opening the text in an editor also counts as reading it. You can save or print the text at any time: "Open in editor" shows it as plain text.</p>
<h2>In short</h2>
<ul class="summary">${summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<h2>The full text</h2>
<div class="doc" id="doc" tabindex="0" role="region" aria-label="License agreement and privacy statement, scrollable">${esc(license)}\n\n\n==================== PRIVACY STATEMENT ====================\n\n${esc(privacy)}</div>
<p class="hint" id="scrollhint">Scroll the text above to its end to continue.</p>
<div class="row">
  <button id="open" type="button">Open in editor (plain text, printable)</button>
  <button id="save" type="button">Save a copy</button>
  <button id="privacy" type="button">Open the privacy statement</button>
</div>
<h2>Your statements</h2>
<fieldset>
<legend>Tick each box only if it is true. None is ticked for you.</legend>
${AFFIRMATIONS.map((a) => `<div class="box"><input type="checkbox" id="aff-${a.id}" data-id="${a.id}"><label for="aff-${a.id}">${esc(a.label)}</label></div>`).join('')}
</fieldset>
<fieldset>
<legend>Error reports</legend>
<div class="box"><input type="checkbox" id="diag" checked><label for="diag">Send Ashley's maintainer an error report when one of its checks fails (scrubbed of names, paths and secrets; never prompts, files, tokens or my AccessID). I can turn this off any time in Settings.</label></div>
</fieldset>
<div class="row">
  <label for="name">Type your full name as your signature:</label>
  <input type="text" id="name" autocomplete="name" aria-describedby="namehint">
</div>
<p class="note" id="namehint">Your typed name, the boxes you tick, the time, and the version and hash of this text are recorded on this computer and, with your license record, by the licensor, to prove the agreement. Nothing else is recorded here.</p>
<div class="row">
  <button id="agree" class="primary" type="button" disabled aria-describedby="status">${esc(AGREE_BUTTON)}</button>
  <button id="decline" type="button">Decline</button>
</div>
<div class="status" id="status" role="status" aria-live="polite"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const doc = document.getElementById('doc');
  const agree = document.getElementById('agree');
  const status = document.getElementById('status');
  const hint = document.getElementById('scrollhint');
  let scrolled = false;
  function check() {
    const boxes = [...document.querySelectorAll('input[data-id]')];
    const all = boxes.every((b) => b.checked);
    const name = document.getElementById('name').value.trim();
    const ok = scrolled && all && name.length >= 2;
    agree.disabled = !ok;
    const missing = [];
    if (!scrolled) missing.push('read the full text to its end');
    if (!all) missing.push('tick every statement that is true (all are needed to continue)');
    if (name.length < 2) missing.push('type your name');
    status.textContent = ok ? '' : 'To continue: ' + missing.join('; ') + '.';
  }
  function onScroll() {
    if (doc.scrollTop + doc.clientHeight >= doc.scrollHeight - 8) {
      scrolled = true;
      hint.textContent = 'You have reached the end of the text.';
      check();
    }
  }
  doc.addEventListener('scroll', onScroll);
  if (doc.scrollHeight <= doc.clientHeight + 8) { scrolled = true; hint.textContent = ''; }
  document.querySelectorAll('input').forEach((i) => i.addEventListener('input', check));
  document.getElementById('open').addEventListener('click', () => { vscode.postMessage({ type: 'open' }); scrolled = true; hint.textContent = 'The full text is open in an editor tab.'; check(); });
  document.getElementById('save').addEventListener('click', () => vscode.postMessage({ type: 'save' }));
  document.getElementById('privacy').addEventListener('click', () => vscode.postMessage({ type: 'privacy' }));
  document.getElementById('decline').addEventListener('click', () => vscode.postMessage({ type: 'decline' }));
  agree.addEventListener('click', () => {
    const affirmations = [...document.querySelectorAll('input[data-id]')].map((b) => ({ id: b.dataset.id, label: b.nextElementSibling.textContent, checked: b.checked }));
    vscode.postMessage({ type: 'agree', affirmations, name: document.getElementById('name').value.trim(), diagnostics: document.getElementById('diag').checked ? 'on' : 'off', scrolled });
  });
  check();
  document.getElementById('doc').focus();
</script>
</body>
</html>`;
    return new Promise<TermsRecord | undefined>((resolve) => {
      let done = false;
      const finish = (r: TermsRecord | undefined) => {
        if (done) return;
        done = true;
        resolve(r);
        panel.dispose();
      };
      panel.onDidDispose(() => finish(undefined));
      panel.webview.onDidReceiveMessage(async (m: { type: string; affirmations?: Affirmation[]; name?: string; diagnostics?: 'on' | 'off'; scrolled?: boolean }) => {
        if (m.type === 'open') {
          const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: `${license}\n\n\n==================== PRIVACY STATEMENT ====================\n\n${privacy}` });
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        } else if (m.type === 'save') {
          const target = await vscode.window.showSaveDialog({ title: 'Save the Ashley agreement and privacy statement', defaultUri: vscode.Uri.file(path.join(os.homedir(), `Ashley-license-v${TERMS_VERSION}.txt`)), filters: { Text: ['txt'] } });
          if (target) {
            fs.writeFileSync(target.fsPath, `${license}\n\n\n==================== PRIVACY STATEMENT ====================\n\n${privacy}`);
            void vscode.window.showInformationMessage(`Saved to ${target.fsPath}`);
          }
        } else if (m.type === 'privacy') {
          const f = vscode.Uri.file(path.join(context.extensionPath, 'PRIVACY.md'));
          await vscode.commands.executeCommand('markdown.showPreviewToSide', f).then(undefined, () => vscode.window.showTextDocument(f, { viewColumn: vscode.ViewColumn.Beside }));
        } else if (m.type === 'decline') {
          output.appendLine(`terms ${TERMS_VERSION}: declined`);
          finish(undefined);
        } else if (m.type === 'agree') {
          const affirmations = (m.affirmations ?? []).map((a) => ({ id: a.id, label: AFFIRMATIONS.find((x) => x.id === a.id)?.label ?? a.label, checked: !!a.checked }));
          const complete = acceptanceComplete(affirmations, m.name ?? '', !!m.scrolled);
          if (!complete.ok) {
            void panel.webview.postMessage({ type: 'incomplete', missing: complete.missing });
            return;
          }
          const record: TermsRecord = {
            v: 1,
            terms_version: TERMS_VERSION,
            license_sha256: licenseHash,
            privacy_sha256: privacyHash,
            accepted_at: new Date().toISOString(),
            surface: 'dialog',
            button_label: AGREE_BUTTON,
            affirmations,
            signed_name: (m.name ?? '').trim(),
            scrolled_to_end: true,
            diagnostics: m.diagnostics === 'off' ? 'off' : 'on',
            product_version: context.extension.packageJSON.version,
            host: vscode.env.appName,
            host_version: vscode.version,
            platform: `${os.platform()} ${os.release()} ${os.arch()}`,
            locale: vscode.env.language,
            install_id: installId,
          };
          try {
            const where = writeTermsRecord(record, { license, privacy });
            await context.globalState.update('ashley.terms', record);
            await vscode.workspace.getConfiguration('ashley').update('diagnostics.share', record.diagnostics, vscode.ConfigurationTarget.Global);
            output.appendLine(`terms ${TERMS_VERSION} accepted ${record.accepted_at} by "${record.signed_name}" (license ${licenseHash.slice(0, 12)}, privacy ${privacyHash.slice(0, 12)}); record ${where}; error reports ${record.diagnostics}`);
            finish(record);
          } catch (e) {
            void vscode.window.showErrorMessage(`Ashley could not save the acceptance record: ${(e as Error).message}`);
          }
        }
      });
    });
  }

  /** The record in force, from the file (shared with the CLI and MCP server) or VS Code's state. */
  static current(context: vscode.ExtensionContext): TermsRecord | undefined {
    const fromFile = readTermsRecord();
    if (fromFile) return fromFile;
    const r = context.globalState.get<TermsRecord>('ashley.terms');
    return r && r.terms_version === TERMS_VERSION ? r : undefined;
  }
}
