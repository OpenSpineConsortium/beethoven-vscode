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
 * ~/.beethoven/engine, the same lookup as the engine's registry_dir(), so both read one file: a value is
 * taken as written (the engine expands no `~` in it), a relative one from the working directory, as
 * os.path.abspath takes it.
 */
export function accountsFile(home = os.homedir(), environ: NodeJS.ProcessEnv = process.env): string {
  if (environ.BEE_REGISTRY_DIR) return path.join(path.resolve(environ.BEE_REGISTRY_DIR), 'accounts.json');
  if (environ.BEETHOVEN_HOME) return path.join(path.resolve(environ.BEETHOVEN_HOME), 'engine', 'accounts.json');
  return path.join(home, ENGINE_DIR, 'accounts.json');
}

// The engine's own model of the file (RegistryFile and AccountRecord in beethoven-research, bee/accounts.py):
// pydantic with extra="forbid" in its lax mode, which also takes "1" for an order and "no" for enabled.
const FILE_KEYS = new Set(['version', 'accounts']);
const ROW_KEYS = new Set(['label', 'path', 'enabled', 'order', 'hibernate_until']);
const TRUE = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE = new Set(['0', 'off', 'f', 'false', 'n', 'no']);
/** the engine writes YYYY-MM-DDTHH:MM:SSZ; this takes that and the usual ISO 8601 forms with a zone (a rarer form the engine also takes is refused here, and said) */
const ZONED = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2})(?::(\d{2})(?::(\d{2})(?:[.,]\d+)?)?)?(?:Z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:\.\d+)?)?)?)$/;

function laxBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 0 || v === 1) return v === 1;
  if (typeof v !== 'string') return undefined;
  const s = v.toLowerCase();
  return TRUE.has(s) ? true : FALSE.has(s) ? false : undefined;
}

function laxInt(v: unknown): number | undefined {
  if (typeof v === 'boolean') return Number(v);
  if (typeof v === 'number') return Number.isInteger(v) ? v : undefined;
  return typeof v === 'string' && /^\s*[+-]?\d+(?:_\d+)*(?:\.0*)?\s*$/.test(v) ? Number(v.replace(/_/g, '')) : undefined;
}

function zonedTime(s: string): boolean {
  const m = ZONED.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map((x) => Number(x ?? 0));
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && h < 24 && mi < 60 && se < 60;
}

/** The engine's is_absolute: rooted on either family of systems, whichever this computer is. */
function engineAbsolute(p: string): boolean {
  return /^[/\\]/.test(p) || /^\p{L}:[/\\]/u.test(p);
}

/** One row as the engine's AccountRecord takes it, or why it does not; a folder's name is never quoted, since the reason can reach an error report. */
function record(r: unknown, i: number): Account | string {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return `entry ${i + 1} is not an account`;
  const a = r as Record<string, unknown>;
  const who = typeof a.label === 'string' && ACCOUNT_LABEL.test(a.label) ? `the account "${a.label}"` : `entry ${i + 1}`;
  const extra = Object.keys(a).find((k) => !ROW_KEYS.has(k));
  if (extra !== undefined) return `${who} has a field the engine does not know ("${extra}")`;
  if (typeof a.label !== 'string' || !ACCOUNT_LABEL.test(a.label)) return `${who} has no valid label`;
  if (!('path' in a) || (a.path !== null && (typeof a.path !== 'string' || !engineAbsolute(a.path)))) return `${who} has no full path for its folder (null for ${DEFAULT_PLACE})`;
  const enabled = 'enabled' in a ? laxBool(a.enabled) : true;
  if (enabled === undefined) return `${who} is neither enabled nor disabled`;
  const order = 'order' in a ? laxInt(a.order) : undefined;
  if (order === undefined || order < 0) return `${who} has no place in the order (a whole number from 0)`;
  const until = a.hibernate_until ?? null;
  if (until !== null && (typeof until !== 'string' || !zonedTime(until))) return `${who} has a rest time that is not a time with its zone`;
  return { label: a.label, path: a.path as string | null, enabled, order, hibernateUntil: until };
}

/**
 * The list as the engine wrote it, judged by the engine's own model: a file `bee` refuses (an unknown field, a
 * row without its order, a folder that is not a full path, a label or a folder twice) is refused whole here too,
 * with the reason, so the setting never applies an account that `bee-use` would not; a null path is Claude
 * Code's default place. Never written here.
 */
export function readAccounts(file = accountsFile()): AccountList {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? { ok: false, file, reason: 'missing', detail: 'no such file' } : { ok: false, file, reason: 'unreadable', detail: (e as Error).message };
  }
  const refused = (detail: string): AccountList => ({ ok: false, file, reason: 'unreadable', detail });
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e) {
    // V8 quotes a few characters of the file in some of its messages, and a folder's name has no place in an error report
    const at = /at position \d+(?: \(line \d+ column \d+\))?/.exec((e as Error).message);
    return refused(`not valid JSON${at ? ` (${at[0]})` : ''}`);
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return refused('not the engine\'s list (an object with "accounts" in it)');
  const top = j as Record<string, unknown>;
  const extra = Object.keys(top).find((k) => !FILE_KEYS.has(k));
  if (extra !== undefined) return refused(`a field the engine does not know ("${extra}")`);
  if ('version' in top && top.version !== 1 && top.version !== true) return refused('a version other than 1');
  const rows = 'accounts' in top ? top.accounts : [];
  if (!Array.isArray(rows)) return refused('"accounts" is not a list');
  const accounts: Account[] = [];
  for (const [i, r] of rows.entries()) {
    const a = record(r, i);
    if (typeof a === 'string') return refused(a);
    accounts.push(a);
  }
  if (new Set(accounts.map((a) => a.label)).size !== accounts.length) return refused('a label appears twice');
  if (new Set(accounts.map((a) => a.path)).size !== accounts.length) return refused('one folder is listed under two labels');
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
  const fixes = (add = true) => `Pick a label from your account list, ${add ? `or add the account with "${ADD_COMMAND} ${want}" in a terminal` : `or add one with "${ADD_COMMAND} <label>" in a terminal`}. Until then Claude Code in the terminals signs in as it would without the setting.`;
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
  // the engine takes a Windows folder on any computer; here it would be a relative one, a different place in every terminal
  if (a.path !== null && !path.isAbsolute(a.path)) return { kind: 'invalid', label: want, problem: `The Beethoven setting "account" names "${want}", whose folder in your account list is not a full path on this computer. ${fixes(false)}` };
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

/**
 * What a process Beethoven itself starts gets (`claude auth status`, `claude mcp`, the sign-in terminal): the
 * choice's variables and, for an account at Claude Code's default place, CLAUDE_CONFIG_DIR taken away as
 * `bee-use` takes it away, so a folder VS Code was started with is never signed in, checked or given the bridge
 * under a label that names the default place. undefined is "unset": Node leaves such a variable out of a
 * process, and the sign-in terminal hands it to VS Code as null, which removes it.
 */
export function accountProcessEnv(choice: AccountChoice): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = accountEnvironment(choice);
  if (choice.kind === 'account' && choice.path === null) env.CLAUDE_CONFIG_DIR = undefined;
  return env;
}

/**
 * What an error report must not carry (core/diagReport.ts, scrub): the list's place, every listed folder and
 * label, the label in the setting, and the two account variables VS Code may have been started with, which
 * the privacy statement counts among the environment values a report never contains.
 */
export function accountValues(setting: string, list: AccountList = readAccounts(), environ: NodeJS.ProcessEnv = process.env): string[] {
  const rows = list.ok ? list.accounts.flatMap((a) => [a.label, a.path ?? '']) : [];
  return [...new Set([list.file, (setting ?? '').trim(), environ.CLAUDE_CONFIG_DIR ?? '', environ.BEE_ACCOUNT ?? '', ...rows])].filter((v) => v !== '');
}

/** The account's folder as a person reads it. */
export function accountPlace(choice: { path: string | null }): string {
  return choice.path ?? DEFAULT_PLACE;
}

/**
 * A CLAUDE_CONFIG_DIR VS Code itself was started with (from a shell after `bee-use`, say) reaches every
 * terminal unless the choice replaces it, and the collection every terminal gets can give a variable but never
 * take one away; so say where Claude Code really signs in rather than report a place it does not.
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
