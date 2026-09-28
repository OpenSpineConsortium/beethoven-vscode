// The acceptance record for the license terms: what was shown, what was ticked, who signed, when.
// Shared by the extension (which shows the dialog), the CLI (text-mode acceptance) and the MCP
// server (which refuses until a record exists). No 'vscode' import.
//
// Why so much detail: the cases that enforce click-through terms turn on what the screen said and
// what the click meant (Berman, Chabolla, Sellers, Kauders, In re StockX). The vendor bears that
// proof, so every acceptance stores the terms version and the SHA-256 of the exact text shown, the
// state of each checkbox with its exact label, the typed name, the surface (webview dialog or
// terminal), the extension and VS Code versions and the time. The text itself stays retrievable:
// the accepted LICENSE.txt is copied beside the record (Michigan UETA, MCL 450.838(3): a record the
// recipient cannot store or print is not enforceable against them).
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Bump when LICENSE.txt or PRIVACY.md changes in substance; every install re-accepts. Integer, never fractional. */
export const TERMS_VERSION = 3;

export interface Affirmation {
  id: string;
  /** the exact sentence shown next to the box */
  label: string;
  checked: boolean;
}

export interface TermsRecord {
  v: 1;
  terms_version: number;
  /** SHA-256 of LICENSE.txt as shown */
  license_sha256: string;
  /** SHA-256 of PRIVACY.md as shown */
  privacy_sha256: string;
  accepted_at: string;
  /** 'dialog' (the extension's signing panel) or 'terminal' (the CLI) */
  surface: 'dialog' | 'terminal';
  /** the label of the control that formed the agreement, exactly as shown */
  button_label: string;
  affirmations: Affirmation[];
  /** the name the person typed as their signature */
  signed_name: string;
  /** whether the person scrolled the full text to its end before the button became available */
  scrolled_to_end: boolean;
  /** error reports: the choice made in the same dialog */
  diagnostics: 'on' | 'off';
  product_version: string;
  host: string;
  host_version: string;
  platform: string;
  locale: string;
  /** the random install id (never an identity) */
  install_id: string;
}

/** The affirmations the signing dialog shows, in order. The wording is part of the record. */
export const AFFIRMATIONS: Array<{ id: string; label: string }> = [
  {
    id: 'read_agree',
    label: 'By ticking this box and choosing "Accept and Continue" below, I agree to the Ashley Software License Agreement (version 3, 2026-09-28) and the Privacy Statement, which I have read.',
  },
  {
    id: 'rights',
    label:
      'I specifically consent to the terms that change how a dispute is handled and what I can recover: written notice and 60 days to resolve it before any lawsuit, individual claims only with a class-action waiver, Michigan courts with small claims allowed where I live (section 19), the WAIVER OF JURY TRIAL (section 20), the one-year limit on contract and warranty claims, and the warranty disclaimer, exclusive remedy and liability limits (sections 12 and 13).',
  },
  {
    id: 'risks',
    label:
      'Known risks: Ashley depends on my university\'s grid and network, Anthropic, Microsoft, GitHub and Hugging Face; any of them can stop it working; after the 14-day refund window that is not refunded (a long outage extends a paid license); nothing releases the licensor from its own gross negligence, wilful misconduct or fraud; and Ashley is a research tool, never for clinical use. I accept these risks (section 8).',
  },
  {
    id: 'age_authority',
    label: 'I am 18 or older (or a parent or guardian accepting for me), and each account Ashley touches (Wayne State, Claude, GitHub, Hugging Face) is my own.',
  },
];
export const AGREE_BUTTON = 'Accept and Continue';

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function termsDir(): string {
  return process.env.ASHLEY_LICENSE_DIR || path.join(os.homedir(), '.ashley-local');
}

/** The record on this computer, if the terms in force are the ones it accepted. */
export function readTermsRecord(): TermsRecord | undefined {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(termsDir(), 'terms.json'), 'utf8')) as TermsRecord;
    return r && r.v === 1 && r.terms_version === TERMS_VERSION ? r : undefined;
  } catch {
    return undefined;
  }
}

/** Write the record and keep the exact texts beside it (terms/<version>/LICENSE.txt, PRIVACY.md). */
export function writeTermsRecord(rec: TermsRecord, texts: { license: string; privacy: string }): string {
  const dir = termsDir();
  const keep = path.join(dir, 'terms', String(rec.terms_version));
  fs.mkdirSync(keep, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(keep, 'LICENSE.txt'), texts.license);
  fs.writeFileSync(path.join(keep, 'PRIVACY.md'), texts.privacy);
  fs.writeFileSync(path.join(keep, `accepted-${rec.accepted_at.replace(/[:.]/g, '-')}.json`), JSON.stringify(rec, null, 1));
  const f = path.join(dir, 'terms.json');
  fs.writeFileSync(`${f}.part`, JSON.stringify(rec, null, 1));
  fs.renameSync(`${f}.part`, f);
  return f;
}

/** True when every required affirmation is ticked and a name is typed. */
export function acceptanceComplete(affirmations: Affirmation[], signedName: string, scrolledToEnd: boolean): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const a of AFFIRMATIONS) if (!affirmations.find((x) => x.id === a.id && x.checked)) missing.push(a.id);
  if (!signedName || signedName.trim().length < 2) missing.push('signed_name');
  if (!scrolledToEnd) missing.push('scrolled_to_end');
  return { ok: missing.length === 0, missing };
}

/** The one-line refusal every tool prints without a record. */
export const TERMS_REFUSAL = 'The Ashley license terms have not been accepted on this computer yet: run any Ashley command in VS Code (the terms are shown), or ashley-cli terms.';
