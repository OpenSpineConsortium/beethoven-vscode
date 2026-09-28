// First use: the signing dialog (termsPanel.ts) shows the agreement and privacy statement and
// records the acceptance (core/terms.ts). Ashley does nothing (no sign-in, no files, no reports)
// until this is answered, and asks again when the terms version changes. Only a command the person
// ran opens it, never a background sweep, so the dialog is never a surprise.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { TERMS_VERSION, TermsRecord } from '../core/terms';
import { TermsPanel } from './termsPanel';

export { TERMS_VERSION, TermsRecord };

export function termsRecord(context: vscode.ExtensionContext): TermsRecord | undefined {
  return TermsPanel.current(context);
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

let showing: Promise<TermsRecord | undefined> | null = null;

/** The record in force, or the signing dialog (once at a time). Undefined when the person declined or closed it. */
export async function ensureTermsAccepted(context: vscode.ExtensionContext, output: vscode.OutputChannel, installId: () => string): Promise<TermsRecord | undefined> {
  const have = termsRecord(context);
  if (have) return have;
  if (!showing) {
    showing = TermsPanel.show(context, output, installId()).finally(() => {
      showing = null;
    });
  }
  return showing;
}

export function supportUrl(context: vscode.ExtensionContext): string {
  return String(context.extension.packageJSON.homepage ?? '').replace(/\/$/, '') + '/support.html';
}
