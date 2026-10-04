// The student's own Claude accounts on this computer, as the engine's `bee` command lists them in
// ~/.beethoven/engine/accounts.json (label, path, enabled, order, hibernate_until; nothing from inside a
// sign-in directory). The setting beethoven.account names one label; every integrated terminal of a
// local window then gets that account's directory as CLAUDE_CONFIG_DIR and the label as BEE_ACCOUNT,
// exactly what `bee-use <label>` does, so the edition and the command line share one list (the
// maintainer, 2026-10-04: several accounts of one person, each their own; never pooled, never anyone
// else's). Beethoven reads the list and never writes it; what it asks of a sign-in directory it asks of
// Claude Code started there (`claude auth status`, and `claude mcp` for the bridge), never of the files
// inside. No 'vscode' import.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** a label: lower-case letters, digits and hyphens, not starting with a hyphen, at most 32 (the engine's AccountRecord) */
export const ACCOUNT_LABEL = /^[a-z0-9][a-z0-9-]{0,31}$/;
/** the engine's own folder under the student's home; `accounts.json` and `usage/<label>.json` live there */
export const ENGINE_DIR = path.join('.beethoven', 'engine');
/** the engine's command that makes an account (not installed with this edition; named in the fixes) */
export const ADD_COMMAND = 'bee account add';
/** the two variables a choice sets, and the only two this module ever touches in a terminal's environment */
export const ACCOUNT_VARS = ['CLAUDE_CONFIG_DIR', 'BEE_ACCOUNT'] as const;
/** how the engine and bee-use name an account listed with `--default-location` (CLAUDE_CONFIG_DIR unset) */
export const DEFAULT_PLACE = "Claude Code's default place";

export interface Account {
  label: string;
  /** the sign-in directory (CLAUDE_CONFIG_DIR), absolute; null is Claude Code's default place, where the variable stays unset */
  path: string | null;
  /** the engine's rotation only: false when `bee account disable` or a failed sign-in check took it out */
  enabled: boolean;
  order: number;
  /** ISO time until which the engine rests the account (its window is spent), or null */
  hibernateUntil: string | null;
}

export type AccountList = { ok: true; file: string; accounts: Account[] } | { ok: false; file: string; reason: 'missing' | 'unreadable'; detail: string };

export type AccountChoice =
  /** the setting is empty: Claude Code's own sign-in on this computer, as before */
  | { kind: 'default' }
  /** a listed label; outOfRotation when the engine turned it off, which bee-use ignores and so does this edition */
  | { kind: 'account'; label: string; path: string | null; hibernateUntil: string | null; outOfRotation: boolean }
  /** the setting names something the list does not offer; the terminals keep the default and `problem` says why, in plain words */
  | { kind: 'invalid'; label: string; problem: string }
  /** a remote window (Remote-SSH, WSL, a container): its terminals run on another computer, where this laptop's folders mean nothing */
  | { kind: 'remote'; label: string; problem: string };

/**
 * Where the engine keeps the list: `$BEE_REGISTRY_DIR`, else `$BEETHOVEN_HOME/engine`, else
 * ~/.beethoven/engine, the same lookup as the engine's registry_dir(), so both read one file.
 */
export function accountsFile(home = os.homedir(), environ: NodeJS.ProcessEnv = process.env): string {
  const expand = (p: string) => (p === '~' || p.startsWith('~/') ? path.join(home, p.slice(1)) : p);
  if (environ.BEE_REGISTRY_DIR) return path.join(path.resolve(expand(environ.BEE_REGISTRY_DIR)), 'accounts.json');
  if (environ.BEETHOVEN_HOME) return path.join(path.resolve(expand(environ.BEETHOVEN_HOME)), 'engine', 'accounts.json');
  return path.join(home, ENGINE_DIR, 'accounts.json');
}

/**
 * The list as the engine wrote it. A row without a valid label, or whose path is missing, empty or
 * relative, is dropped rather than trusted (the engine refuses all of them); `~/` in a path means the
 * student's home; a null path is Claude Code's default place. Never written here.
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
    if (typeof a.label !== 'string' || !ACCOUNT_LABEL.test(a.label)) return;
    let p: string | null = null;
    if (a.path !== null) {
      if (typeof a.path !== 'string' || !a.path) return;
      p = a.path === '~' || a.path.startsWith('~/') ? path.join(home, a.path.slice(1)) : a.path;
      // a relative folder would land in each terminal's own working directory, a different one in every terminal
      if (!path.isAbsolute(p)) return;
    }
    accounts.push({ label: a.label, path: p, enabled: a.enabled !== false, order: typeof a.order === 'number' ? a.order : i, hibernateUntil: typeof a.hibernate_until === 'string' ? a.hibernate_until : null });
  });
  accounts.sort((x, y) => x.order - y.order || x.label.localeCompare(y.label));
  return { ok: true, file, accounts };
}

/**
 * What the setting means: nothing (the default), one listed account, or a problem said in plain words.
 * `remoteName` is VS Code's name for a remote window, which keeps every label out of its terminals.
 */
export function chooseAccount(label: string, list: AccountList = readAccounts(), remoteName?: string): AccountChoice {
  const want = (label ?? '').trim();
  if (!want) return { kind: 'default' };
  if (remoteName) return { kind: 'remote', label: want, problem: `The Beethoven setting "account" names "${want}", but this is a remote window (Remote-SSH, WSL or a container): its terminals run on another computer, where the sign-in folders of this laptop mean nothing, so the setting is not applied in this window. Beethoven's checks here use Claude Code's usual sign-in on this laptop.` };
  const fixes = (add = true) => `Pick a label from your account list, ${add ? `or add the account with "${ADD_COMMAND} ${want}" in a terminal` : `or add one with "${ADD_COMMAND} <label>" in a terminal`}. Until then Claude Code in the terminals uses the usual sign-in.`;
  if (!ACCOUNT_LABEL.test(want)) return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" is "${want}", which is not an account label (lower-case letters, digits and hyphens, not starting with a hyphen, up to 32). ${fixes(false)}` };
  if (!list.ok) {
    if (list.reason === 'missing') return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" names "${want}", but this computer has no account list yet. ${fixes()}` };
    return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" names "${want}", but your account list could not be read (${list.detail}). ${fixes()}` };
  }
  const a = list.accounts.find((x) => x.label === want);
  if (!a) {
    const have = list.accounts.map((x) => x.label);
    return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" names "${want}", which is not in your account list${have.length ? ` (${have.join(', ')})` : ' (it is empty)'}. ${fixes()}` };
  }
  // enabled is the engine's rotation and nothing more: bee-use and `bee account login` take a turned-off
  // account all the same, which is also how the student signs one in again after the engine set it aside
  return { kind: 'account', label: a.label, path: a.path, hibernateUntil: a.hibernateUntil, outOfRotation: !a.enabled };
}

/**
 * What a Claude Code terminal or process gets: both variables for an account with its own folder, the
 * label alone for one at Claude Code's default place (bee-use unsets the folder there), nothing otherwise.
 */
export function accountEnvironment(choice: AccountChoice): Record<string, string> {
  if (choice.kind !== 'account') return {};
  return choice.path === null ? { BEE_ACCOUNT: choice.label } : { CLAUDE_CONFIG_DIR: choice.path, BEE_ACCOUNT: choice.label };
}

/** The account's folder as a person reads it. */
export function accountPlace(choice: { path: string | null }): string {
  return choice.path ?? DEFAULT_PLACE;
}

/**
 * A CLAUDE_CONFIG_DIR VS Code itself was started with (from a shell after `bee-use`, say) reaches every
 * terminal unless the choice replaces it, and a terminal's environment can be given a variable but never
 * have one taken away; so say where Claude Code really signs in rather than report a place it does not.
 * '' when nothing is inherited or the choice sets the folder itself.
 */
export function inheritedConfigDir(choice: AccountChoice, environ: NodeJS.ProcessEnv = process.env): string {
  const dir = environ.CLAUDE_CONFIG_DIR;
  if (!dir || choice.kind === 'remote' || 'CLAUDE_CONFIG_DIR' in accountEnvironment(choice)) return '';
  const who = environ.BEE_ACCOUNT ? ` (the account ${environ.BEE_ACCOUNT})` : '';
  return `VS Code itself was started with CLAUDE_CONFIG_DIR set to ${dir}${who}, so Claude Code in its terminals uses that folder${choice.kind === 'account' ? `, not ${DEFAULT_PLACE}` : ''}; start VS Code from a shell without it to change that`;
}

/**
 * Before a sign-in under a chosen account: the directory exists, empty if new and readable by the
 * student alone (Claude Code creates its files there). Nothing inside is read, changed or removed.
 */
export function ensureAccountDir(choice: AccountChoice): void {
  if (choice.kind !== 'account' || choice.path === null || fs.existsSync(choice.path)) return;
  fs.mkdirSync(choice.path, { recursive: true, mode: 0o700 });
}

/** The row in the Beethoven view and the wizard's detail: "as <label>" beside the sign-in, when one is chosen. */
export function asLabel(choice: AccountChoice): string {
  return choice.kind === 'account' ? `, as ${choice.label}` : '';
}
