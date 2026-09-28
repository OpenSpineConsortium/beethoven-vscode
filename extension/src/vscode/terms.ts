// First run: the license terms and the error-report choice, before anything else happens.
// A blocking dialog whose button text says that choosing it forms the agreement, with the full
// text one click away; the version and time of acceptance are recorded. Ashley does nothing
// (no sign-in, no files, no reports) until this is answered. The report choice is an opt-out made
// at installation and changeable at any time in Settings (Ashley > Diagnostics).
import * as vscode from 'vscode';
import * as path from 'node:path';

export const TERMS_VERSION = '2.0';
const KEY = 'ashley.terms';

export interface TermsRecord {
  version: string;
  acceptedAt: string;
  diagnostics: 'on' | 'off';
}

export function termsRecord(context: vscode.ExtensionContext): TermsRecord | undefined {
  const r = context.globalState.get<TermsRecord>(KEY);
  return r && r.version === TERMS_VERSION ? r : undefined;
}

export async function openTerms(context: vscode.ExtensionContext, which: 'license' | 'privacy' = 'license'): Promise<void> {
  const f = vscode.Uri.file(path.join(context.extensionPath, which === 'license' ? 'LICENSE.txt' : 'PRIVACY.md'));
  try {
    if (which === 'privacy') await vscode.commands.executeCommand('markdown.showPreview', f);
    else await vscode.window.showTextDocument(f, { preview: true });
  } catch {
    await vscode.env.openExternal(f);
  }
}

/**
 * Ask once per terms version. Returns the record when accepted (now or earlier), undefined when
 * the person chose not to decide yet. Never called from a background sweep: only from a command the
 * person ran, so the dialog is never a surprise.
 */
export async function ensureTermsAccepted(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<TermsRecord | undefined> {
  const have = termsRecord(context);
  if (have) return have;
  for (;;) {
    const pick = await vscode.window.showInformationMessage(
      'Ashley license terms',
      {
        modal: true,
        detail: [
          'Ashley is licensed software. Choosing "I agree" forms the Ashley Software License Agreement (LICENSE.txt) between you and its licensor, and accepts the Privacy statement (PRIVACY.md).',
          '',
          'In short: one license key per person, tied to your Wayne State sign-in; your accounts (Wayne State, Claude, GitHub, Hugging Face) stay yours and you use them within their terms; Ashley stores no Claude credential; it is a research tool, not for clinical use; no warranty; the grid, Anthropic, Microsoft or your institution can stop it working, and that is not refunded.',
          '',
          'Error reports: to fix problems, Ashley can send its maintainer a report when a check fails: Ashley and VS Code versions, the operating system, which checks failed and their messages with names, e-mails, paths and anything secret replaced by placeholders. Never your prompts, files, tokens or AccessID. Nothing has been sent yet. You can turn this off now, or any time in Settings > Ashley > Diagnostics, and VS Code\'s own telemetry setting is honoured.',
        ].join('\n'),
      },
      'I agree',
      'I agree, but do not send reports',
      'Read the terms',
    );
    if (pick === 'Read the terms') {
      await openTerms(context, 'license');
      continue;
    }
    if (!pick) return undefined;
    const rec: TermsRecord = { version: TERMS_VERSION, acceptedAt: new Date().toISOString(), diagnostics: pick === 'I agree' ? 'on' : 'off' };
    await context.globalState.update(KEY, rec);
    await vscode.workspace.getConfiguration('ashley').update('diagnostics.share', rec.diagnostics, vscode.ConfigurationTarget.Global);
    output.appendLine(`terms ${rec.version} accepted ${rec.acceptedAt}; error reports ${rec.diagnostics}`);
    return rec;
  }
}
