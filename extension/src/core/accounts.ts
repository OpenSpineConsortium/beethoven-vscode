// The student's own Claude accounts on this computer, as the engine's `bee` command lists them in
// ~/.beethoven/engine/accounts.json (label, path, enabled, order, hibernate_until; nothing from inside a
// sign-in directory). The setting beethoven.account names one label; the Claude Code terminals this
// edition opens or configures then get that account's directory as CLAUDE_CONFIG_DIR and the label as
// BEE_ACCOUNT, exactly what `bee-use <label>` does, so the edition and the command line share one list
// (the maintainer, 2026-10-04: several accounts of one person, each their own; never pooled, never
// anyone else's). Beethoven reads the list and never writes it; the only thing it ever asks of a
// sign-in directory is `claude auth status` (wizard.ts, localClaudeStatus). No 'vscode' import.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** a label: lower-case letters, digits and hyphens, the engine's rule */
export const ACCOUNT_LABEL = /^[a-z0-9-]{1,32}$/;
/** the engine's own folder under the student's home; `accounts.json` and `usage/<label>.json` live there */
export const ENGINE_DIR = path.join('.beethoven', 'engine');
/** the engine's command that makes an account (not installed with this edition; named in the fixes) */
export const ADD_COMMAND = 'bee account add';

export interface Account {
  label: string;
  /** the sign-in directory (CLAUDE_CONFIG_DIR), absolute */
  path: string;
  enabled: boolean;
  order: number;
  /** ISO time until which the engine rests the account (its window is spent), or null */
  hibernateUntil: string | null;
}

export type AccountList = { ok: true; file: string; accounts: Account[] } | { ok: false; file: string; reason: 'missing' | 'unreadable'; detail: string };

export type AccountChoice =
  /** the setting is empty: Claude Code's own sign-in on this computer, as before */
  | { kind: 'default' }
  | { kind: 'account'; label: string; path: string; hibernateUntil: string | null }
  /** the setting names something the list does not offer; the terminals keep the default and `problem` says why, in plain words */
  | { kind: 'invalid'; label: string; problem: string };

export function accountsFile(home = os.homedir()): string {
  return path.join(home, ENGINE_DIR, 'accounts.json');
}

/**
 * The list as the engine wrote it. A row without a valid label or a path is dropped rather than
 * trusted; `~/` in a path means the student's home. Never written here.
 */
export function readAccounts(file = accountsFile(), home = os.homedir()): AccountList {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { ok: false, file, reason: 'missing', detail: 'no such file' } : { ok: false, file, reason: 'unreadable', detail: (e as Error).message };
  }
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e) {
    return { ok: false, file, reason: 'unreadable', detail: `not valid JSON (${(e as Error).message})` };
  }
  const rows = Array.isArray(j) ? j : j && typeof j === 'object' && Array.isArray((j as { accounts?: unknown }).accounts) ? (j as { accounts: unknown[] }).accounts : null;
  if (!rows) return { ok: false, file, reason: 'unreadable', detail: 'no "accounts" list in it' };
  const accounts: Account[] = [];
  rows.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const a = r as Record<string, unknown>;
    if (typeof a.label !== 'string' || !ACCOUNT_LABEL.test(a.label) || typeof a.path !== 'string' || !a.path) return;
    const p = a.path === '~' || a.path.startsWith('~/') ? path.join(home, a.path.slice(1)) : a.path;
    accounts.push({ label: a.label, path: p, enabled: a.enabled !== false, order: typeof a.order === 'number' ? a.order : i, hibernateUntil: typeof a.hibernate_until === 'string' ? a.hibernate_until : null });
  });
  accounts.sort((x, y) => x.order - y.order || x.label.localeCompare(y.label));
  return { ok: true, file, accounts };
}

/** What the setting means: nothing (the default), one listed and enabled account, or a problem said in plain words. */
export function chooseAccount(label: string, list: AccountList = readAccounts()): AccountChoice {
  const want = (label ?? '').trim();
  if (!want) return { kind: 'default' };
  const fixes = (add = true) => `Pick a label from your account list, ${add ? `or add the account with "${ADD_COMMAND} ${want}" in a terminal` : `or add one with "${ADD_COMMAND} <label>" in a terminal`}. Until then the Claude Code terminals use the usual sign-in.`;
  if (!ACCOUNT_LABEL.test(want)) return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" is "${want}", which is not an account label (lower-case letters, digits and hyphens, up to 32). ${fixes(false)}` };
  if (!list.ok) {
    if (list.reason === 'missing') return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" names "${want}", but this computer has no account list yet. ${fixes()}` };
    return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" names "${want}", but your account list could not be read (${list.detail}). ${fixes()}` };
  }
  const a = list.accounts.find((x) => x.label === want);
  if (!a) {
    const have = list.accounts.map((x) => x.label);
    return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" names "${want}", which is not in your account list${have.length ? ` (${have.join(', ')})` : ' (it is empty)'}. ${fixes()}` };
  }
  if (!a.enabled) return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" names "${want}", which is in your account list but turned off. Pick another label from the list, or turn this one back on with the bee command. Until then the Claude Code terminals use the usual sign-in.` };
  return { kind: 'account', label: a.label, path: a.path, hibernateUntil: a.hibernateUntil };
}

/** What a Claude Code terminal or process gets: both variables for a chosen account, nothing otherwise. */
export function accountEnvironment(choice: AccountChoice): Record<string, string> {
  return choice.kind === 'account' ? { CLAUDE_CONFIG_DIR: choice.path, BEE_ACCOUNT: choice.label } : {};
}

/**
 * Before a sign-in under a chosen account: the directory exists, empty if new and readable by the
 * student alone (Claude Code creates its files there). Nothing inside is read, changed or removed.
 */
export function ensureAccountDir(choice: AccountChoice): void {
  if (choice.kind !== 'account' || fs.existsSync(choice.path)) return;
  fs.mkdirSync(choice.path, { recursive: true, mode: 0o700 });
}

/** The row in the Beethoven view and the wizard's detail: "as <label>" beside the sign-in, when one is chosen. */
export function asLabel(choice: AccountChoice): string {
  return choice.kind === 'account' ? `, as ${choice.label}` : '';
}
