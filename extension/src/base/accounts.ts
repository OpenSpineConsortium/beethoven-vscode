// The student's own Claude accounts on a computer, as the engine's account switcher (bee, in
// beethoven-agents) keeps them in accounts.json: a version and a list of labels, the folder each
// account signs in to, on or off, its place in the rotation and a resting time. The file's truth is
// beethoven-agents' export `registry`, version 1: accounts.schema.json, its RegistryFile and
// AccountRecord. What that schema cannot say is bee's own validator (bee/accounts.py, read at a40a71a):
// an absolute folder, a resting time with its zone, no label and no folder twice; over any of them bee
// refuses the whole file, and so does this reader, so an edition never uses an account bee would not.
// Base reads no file: the edition reads accounts.json (a plain file, never through a link) and hands
// the text here. The list holds nothing from inside a sign-in folder, and nothing here opens, lists or
// names one, so no credential can be reached through it.
//
// Stricter than bee, on purpose, and each a whole-file refusal: a value bee's lax parsing would coerce
// ("1" for an order, "no" for enabled, true for the version; the schema's types are the rule here), a
// folder with a ".." step or a control character in it (bee-grid.sh reads bee's rows as tab-separated
// lines, and an edition hands the folder to Claude Code as CLAUDE_CONFIG_DIR), a drive letter outside
// A to Z, and a resting time in any form but the one bee writes with a fraction or an hours-and-minutes
// offset added. bee writes none of these itself; only a hand-edited list holds one. A refusal bee may
// not share carries beeMayTake, so an edition sends the student to `bee account list` only when bee
// will say what is wrong (beeRefusesToo).
//
// What stays in the editions: where the file is ($BEE_REGISTRY_DIR, else <$BEETHOVEN_HOME or
// ~/.beethoven>/engine), reading it, the usage readings beside it (usage/<label>.json: only desktop
// reads them, so they are not here), whether a folder means anything on this computer, and every word
// about an account or a refusal.

/** RegistryFile.version: the one version of accounts.json this reads */
export const ACCOUNTS_VERSION = 1;

/** the most an account list may hold, in UTF-8 bytes: desktop's own limit (bee sets none) */
export const ACCOUNTS_MAX_BYTES = 65536;

/** AccountRecord.label's pattern in the registry export, character for character */
export const ACCOUNT_LABEL = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** RegistryFile's keys, in the schema's order; the file may hold no other */
export const ACCOUNTS_FILE_KEYS = ['version', 'accounts'] as const;

/** AccountRecord's keys, in the schema's order; an entry may hold no other */
export const ACCOUNT_KEYS = ['label', 'path', 'enabled', 'order', 'hibernate_until'] as const;

/** the AccountRecord keys the schema requires; an absent `enabled` is true and an absent `hibernate_until` null */
export const ACCOUNT_REQUIRED = ['label', 'path', 'order'] as const;

export type AccountsFileKey = (typeof ACCOUNTS_FILE_KEYS)[number];
export type AccountKey = (typeof ACCOUNT_KEYS)[number];

export interface Account {
  label: string;
  /** the folder the account signs in to (CLAUDE_CONFIG_DIR), absolute; null is Claude Code's default place. Never opened here. */
  path: string | null;
  /** bee's rotation only: false while the account is taken out of it */
  enabled: boolean;
  /** the account's place in bee's rotation, a whole number from 0 */
  order: number;
  /** until when bee rests the account, exactly as the file holds it, or null */
  hibernate_until: string | null;
  /** the same moment in whole epoch seconds, as bee reads it; 0 when the file names none */
  hibernate_epoch: number;
}

/**
 * Why a list is refused: `size` (more text than ACCOUNTS_MAX_BYTES), `unknown` (a key the schema does
 * not allow), `missing` (a key the schema requires is absent), `type` (not the schema's type), `shape`
 * (of the type, but not a value bee takes), `newer` (a version above ACCOUNTS_VERSION), `twice` (a label,
 * or a folder, an earlier entry already holds).
 */
export type AccountsCode = 'size' | 'unknown' | 'missing' | 'type' | 'shape' | 'newer' | 'twice';

export interface AccountsRefusal {
  /** the entry's index in the file's list, from 0; null for the file as a whole */
  entry: number | null;
  /**
   * the entry's label, when it has a valid one, so the edition can name the account. No other text of
   * the file is ever carried: anyone could have written it, and a refusal can reach a model or a report.
   */
  label?: string;
  /** the key refused; absent for the size, an unknown key (its name is the file's own text) and an entry that is no object */
  key?: AccountsFileKey | AccountKey;
  code: AccountsCode;
  /**
   * Present when bee's own reading may take what this reader refuses: the size (bee sets no limit), a
   * value of another type for enabled, order or the version (pydantic's lax mode coerces some), an
   * order past what JavaScript holds exactly, a folder bee calls absolute (a ".." step, a control
   * character, a drive letter of another script), and every form of a resting time (which ones
   * fromisoformat takes depends on the Python that runs bee). Absent, bee refuses the file too.
   */
  beeMayTake?: true;
}

/** A list read whole, in bee's order, or refused whole with every reason found. */
export type AccountsRead = { ok: true; accounts: Account[] } | { ok: false; refused: AccountsRefusal[] };

// bee's is_absolute, with the drive letter in ASCII: rooted on either family of systems, whatever this computer is
const ABSOLUTE = /^(?:[/\\]|[A-Za-z]:[/\\])/;
// a C0 or C1 control character (a newline among them) or a line or paragraph separator
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// a ".." step, between either separator
const PARENT_STEP = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
// bee's is_absolute itself: a separator first, or a letter of any script (Python's isalpha), a colon and a separator
const BEE_ABSOLUTE = /^(?:[/\\]|\p{L}:[/\\])/u;
// bee's utc_text form, YYYY-MM-DDTHH:MM:SSZ, with what Python's fromisoformat also takes in that form: a
// fraction of a second, and an offset of hours and minutes in place of the Z
const ZONED_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
// 10000-01-01T00:00:00Z: bee's utc_text prints nothing from then on, and `bee account list` stops on such a time
const MAX_EPOCH = 253402300800;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** the text's length in UTF-8, as the file on disk holds it, counted no further than one past `limit` */
function utf8Length(text: string, limit: number): number {
  let n = 0;
  for (let i = 0; i < text.length && n <= limit; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** days from 1970-01-01 to a date of the proleptic Gregorian calendar (Howard Hinnant's days_from_civil) */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * A resting time in whole epoch seconds as bee's _parse_utc gives it (Python's int() of the timestamp,
 * toward zero, the fraction cut at microseconds as fromisoformat cuts it), or null for a text bee would
 * not take or `bee account list` could not print: no date is rolled over, the year is from 1, the moment
 * before the year 10000.
 */
function epochOf(text: string): number | null {
  const m = ZONED_TIME.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [number, number, number, number, number, number];
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || days === undefined || day < 1 || day > days || hour > 23 || minute > 59 || second > 59) return null;
  let offset = 0;
  if (m[8] !== undefined) {
    const oh = Number(m[9]);
    const om = Number(m[10]);
    if (oh > 23 || om > 59) return null;
    offset = (m[8] === '-' ? -1 : 1) * (oh * 3600 + om * 60);
  }
  let t = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offset;
  if (t < 0 && /[1-9]/.test((m[7] ?? '').slice(0, 6))) t += 1;
  return t < MAX_EPOCH ? t : null;
}

/** a folder bee takes and this reader does not refuse: absolute, no ".." step, no control character */
function isFolder(p: string): boolean {
  return ABSOLUTE.test(p) && !CONTROL.test(p) && !PARENT_STEP.test(p);
}

/** one entry, or undefined with every reason it is not one pushed to `refused` */
function entryOf(row: unknown, i: number, refused: AccountsRefusal[]): Account | undefined {
  if (!isObject(row)) {
    refused.push({ entry: i, code: 'type' });
    return undefined;
  }
  const label = typeof row.label === 'string' && ACCOUNT_LABEL.test(row.label) ? row.label : undefined;
  const before = refused.length;
  const refuse = (code: AccountsCode, key?: AccountKey, beeMayTake = false): void => {
    refused.push({ entry: i, ...(label === undefined ? {} : { label }), ...(key === undefined ? {} : { key }), code, ...(beeMayTake ? { beeMayTake: true as const } : {}) });
  };
  for (const k of Object.keys(row)) if (!(ACCOUNT_KEYS as readonly string[]).includes(k)) refuse('unknown');

  if (!Object.hasOwn(row, 'label')) refuse('missing', 'label');
  else if (typeof row.label !== 'string') refuse('type', 'label');
  else if (label === undefined) refuse('shape', 'label');

  const path = row.path;
  if (!Object.hasOwn(row, 'path')) refuse('missing', 'path');
  else if (path !== null && typeof path !== 'string') refuse('type', 'path');
  else if (typeof path === 'string' && !isFolder(path)) refuse('shape', 'path', BEE_ABSOLUTE.test(path));

  const enabled = Object.hasOwn(row, 'enabled') ? row.enabled : true;
  if (typeof enabled !== 'boolean') refuse('type', 'enabled', true);

  const order = row.order;
  if (!Object.hasOwn(row, 'order')) refuse('missing', 'order');
  else if (typeof order !== 'number' || !Number.isInteger(order)) refuse('type', 'order', true);
  else if (order < 0) refuse('shape', 'order');
  else if (order > Number.MAX_SAFE_INTEGER) refuse('shape', 'order', true);

  const until = Object.hasOwn(row, 'hibernate_until') ? row.hibernate_until : null;
  const epoch = typeof until === 'string' ? epochOf(until) : 0;
  if (until !== null && typeof until !== 'string') refuse('type', 'hibernate_until');
  else if (epoch === null) refuse('shape', 'hibernate_until', true);

  // the checks above refused anything else; these restate what they proved, for the compiler
  if (refused.length > before || label === undefined || typeof enabled !== 'boolean' || typeof order !== 'number' || epoch === null) return undefined;
  if (path !== null && typeof path !== 'string') return undefined;
  return { label, path, enabled, order, hibernate_until: typeof until === 'string' ? until : null, hibernate_epoch: epoch };
}

/**
 * accounts.json's text -> its accounts in bee's order (by `order`; two of one order keep the file's,
 * as Python's sorted does), or every reason the list is refused, each a code; null for a text that is
 * not JSON or not an object, which is no account list at all. A missing version is 1 and a missing
 * list empty, as bee's defaults have them. The size is judged first, so a long text is never parsed.
 */
export function parseAccounts(text: string): AccountsRead | null {
  if (utf8Length(text, ACCOUNTS_MAX_BYTES) > ACCOUNTS_MAX_BYTES) return { ok: false, refused: [{ entry: null, code: 'size', beeMayTake: true }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const refused: AccountsRefusal[] = [];
  for (const k of Object.keys(raw)) if (!(ACCOUNTS_FILE_KEYS as readonly string[]).includes(k)) refused.push({ entry: null, code: 'unknown' });

  if (Object.hasOwn(raw, 'version')) {
    const v = raw.version;
    if (typeof v !== 'number' || !Number.isInteger(v)) refused.push({ entry: null, key: 'version', code: 'type', beeMayTake: true });
    else if (v > ACCOUNTS_VERSION) refused.push({ entry: null, key: 'version', code: 'newer' });
    else if (v !== ACCOUNTS_VERSION) refused.push({ entry: null, key: 'version', code: 'shape' });
  }

  let rows: unknown[] = [];
  if (Object.hasOwn(raw, 'accounts')) {
    if (Array.isArray(raw.accounts)) rows = raw.accounts;
    else refused.push({ entry: null, key: 'accounts', code: 'type' });
  }

  const accounts: Account[] = [];
  const labels = new Set<string>();
  const paths = new Set<string | null>();
  rows.forEach((row, i) => {
    const a = entryOf(row, i, refused);
    // bee's RegistryFile: one label names one account, and one folder (the default place included) is
    // one account. An entry refused here for another reason still holds its label and folder, and bee
    // may take that entry and then refuse the list for the repeat (_distinct), so they count too
    const label = isObject(row) && typeof row.label === 'string' && ACCOUNT_LABEL.test(row.label) ? row.label : undefined;
    const path = isObject(row) && Object.hasOwn(row, 'path') && (row.path === null || typeof row.path === 'string') ? row.path : undefined;
    const named = label === undefined ? {} : { label };
    if (label !== undefined && labels.has(label)) refused.push({ entry: i, ...named, key: 'label', code: 'twice' });
    if (path !== undefined && paths.has(path)) refused.push({ entry: i, ...named, key: 'path', code: 'twice' });
    if (label !== undefined) labels.add(label);
    if (path !== undefined) paths.add(path);
    if (a !== undefined) accounts.push(a);
  });

  if (refused.length > 0) return { ok: false, refused };
  return { ok: true, accounts: [...accounts].sort((x, y) => x.order - y.order) };
}

/**
 * Whether bee refuses the same list: some reason given is one bee shares, and bee refuses the whole
 * file over any one, so `bee account list` will say what is wrong. False for none.
 */
export function beeRefusesToo(refused: readonly AccountsRefusal[]): boolean {
  return refused.some((r) => r.beeMayTake !== true);
}

/**
 * Whether bee rests the account at `now` (epoch seconds, the edition's clock): its resting time is still
 * ahead. bee's _awake is this one's opposite together with `enabled`; an edition shows the rest only
 * while it lasts.
 */
export function restingAt(account: Pick<Account, 'hibernate_epoch'>, now: number): boolean {
  return account.hibernate_epoch > now;
}
