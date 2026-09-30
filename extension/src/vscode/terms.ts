// First use: the signing dialog (termsPanel.ts) shows the Trial Edition agreement and privacy
// statement and records the acceptance (core/terms.ts). Beethoven does nothing (no sign-in, no files,
// no reports) until this is answered, and asks again when the terms version changes. Registering a
// Full Edition key opens the same dialog with the Full Edition agreement. Only a command the person
// ran opens it, never a background sweep, so the dialog is never a surprise.
import * as vscode from 'vscode';
import * as path from 'node:path';
import { TERMS_FILE, TERMS_VERSION, TermsEdition, TermsRecord } from '../core/terms';
import { TermsPanel } from './termsPanel';
import { SUPPORT_PAGE } from '../core/site';

export { TERMS_VERSION, TermsRecord, TermsEdition };

export function termsRecord(context: vscode.ExtensionContext, edition: TermsEdition = 'trial'): TermsRecord | undefined {
  return TermsPanel.current(context, edition);
}

export async function openTerms(context: vscode.ExtensionContext, which: 'license' | 'full' | 'privacy' = 'license'): Promise<void> {
  const file = which === 'privacy' ? 'PRIVACY.md' : which === 'full' ? TERMS_FILE.full : TERMS_FILE.trial;
  const f = vscode.Uri.file(path.join(context.extensionPath, file));
  try {
    if (which === 'privacy') await vscode.commands.executeCommand('markdown.showPreview', f);
    else await vscode.window.showTextDocument(f, { preview: true });
  } catch {
    await vscode.env.openExternal(f);
  }
}

const showing = new Map<TermsEdition, Promise<TermsRecord | undefined>>();

/** The record in force for an edition, or the signing dialog (once at a time per edition). Undefined when the person declined or closed it. */
export async function ensureTermsAccepted(context: vscode.ExtensionContext, output: vscode.OutputChannel, installId: () => string, edition: TermsEdition = 'trial'): Promise<TermsRecord | undefined> {
  const have = termsRecord(context, edition);
  if (have) return have;
  let p = showing.get(edition);
  if (!p) {
    p = TermsPanel.show(context, output, installId(), edition).finally(() => {
      showing.delete(edition);
    });
    showing.set(edition, p);
  }
  return p;
}

/** The support page both editions share (the notice address the agreements name is there). */
export function supportUrl(_context: vscode.ExtensionContext): string {
  return SUPPORT_PAGE;
}
