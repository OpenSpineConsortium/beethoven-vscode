// Diagnostic reports that may leave the laptop (when the student has left sharing on): what goes in,
// and the scrubbing that keeps identity out. Modelled on the .NET SDK and Homebrew programmes:
// product and platform versions, the troubleshooter's node ids and statuses, the extension's own
// error strings; never an AccessID, e-mail, hostname, path, prompt, file content, token or
// environment value. A random install id (kept on this laptop) replaces any identifier.
// No 'vscode' import: the CLI and tests use it too.
import * as crypto from 'node:crypto';
import type { DiagReport, NodeReport } from './diagnostics';

export interface ScrubContext {
  accessId?: string;
  email?: string;
  home?: string;
  /** extra words that identify the person or their machines (hostnames, job ids) */
  words?: string[];
}

export interface SharedReport {
  v: 1;
  install_id: string;
  product: string;
  version: string;
  grid_scripts_version: string | null;
  vscode: string;
  os: string;
  arch: string;
  when: string;
  /** the troubleshooter's verdicts, ids and statuses only, details scrubbed */
  nodes: Array<{ id: string; status: string; ms: number; detail: string; root_cause?: string; repair?: string }>;
  root_causes: string[];
  /** ERROR lines from the extension's log, scrubbed */
  errors: string[];
  /** a stable hash of ids+statuses+root causes: the same failure is sent once a day */
  signature: string;
}

const TOKEN_LIKE = /\b(?:sk-ant-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|hf_[A-Za-z0-9]{8,}|(?:ASHLEY|BEETHOVEN)(?:REV)?1\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ACCESS_ID = /\b[a-z]{2}\d{4}\b/gi;
const WIN_PATH = /[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']*/g;
const POSIX_PATH = /(?:\/wsu\/home|\/rs\/rs_grp_[A-Za-z0-9_]+|\/home|\/Users|\/tmp|\/dev\/shm)\/[^\s"':;,)]*/g;
const HOSTNAME = /\b(?:[a-z]{3}\d{1,3}|warrior|grid|wsu\d*)(?:\.[a-z]+)*\.grid\.wayne\.edu\b|\bwarrior\b|\b[a-z]{3}\d{1,3}\b(?=\s|$|[,;:)])/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const JOB_ID = /\bjob\s+\d{5,}\b/gi;

/** Remove identity from a free-text detail. Order matters: tokens, e-mails and paths before words. */
export function scrub(text: string, ctx: ScrubContext = {}): string {
  let s = String(text ?? '');
  s = s.replace(TOKEN_LIKE, '<token>');
  s = s.replace(EMAIL, '<email>');
  s = s.replace(WIN_PATH, '<path>');
  s = s.replace(POSIX_PATH, '<path>');
  if (ctx.home) s = s.split(ctx.home).join('<home>');
  s = s.replace(IPV4, '<ip>');
  s = s.replace(JOB_ID, 'job <n>');
  s = s.replace(HOSTNAME, '<host>');
  for (const w of [ctx.accessId, ctx.email?.split('@')[0], ...(ctx.words ?? [])].filter((x): x is string => !!x && x.length >= 3)) {
    s = s.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<id>');
  }
  s = s.replace(ACCESS_ID, '<id>');
  return s.length > 400 ? s.slice(0, 400) + '…' : s;
}

export function signature(nodes: NodeReport[]): string {
  const key = nodes
    .filter((n) => n.status !== 'ok' && n.status !== 'skipped')
    .map((n) => `${n.id}=${n.status}${n.rootCause ? `<${n.rootCause}` : ''}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function buildSharedReport(
  rep: DiagReport,
  info: { installId: string; product: string; version: string; gridScriptsVersion?: string | null; vscode: string; os: string; arch: string; errorLines?: string[] },
  ctx: ScrubContext = {},
): SharedReport {
  const nodes = rep.reports.map((n) => ({
    id: n.id,
    status: n.status,
    ms: n.ms,
    detail: n.status === 'ok' || n.status === 'skipped' ? '' : scrub(n.detail, ctx),
    ...(n.rootCause ? { root_cause: n.rootCause } : {}),
    ...(n.repair ? { repair: scrub(n.repair, ctx) } : {}),
  }));
  return {
    v: 1,
    install_id: info.installId,
    product: info.product,
    version: info.version,
    grid_scripts_version: info.gridScriptsVersion ?? null,
    vscode: info.vscode,
    os: info.os,
    arch: info.arch,
    when: new Date().toISOString(),
    nodes,
    root_causes: rep.rootCauses.map((r) => r.id),
    errors: (info.errorLines ?? []).slice(-20).map((l) => scrub(l, ctx)),
    signature: signature(rep.reports),
  };
}

/** Is there anything worth sending? Only failures and repairs are; a clean run is not. */
export function worthSending(rep: DiagReport): boolean {
  return rep.reports.some((n) => n.status === 'fail' || n.status === 'repaired' || n.status === 'blocked');
}

/** The fields a report can contain, for the privacy statement and the "what is sent" view. */
export const REPORT_FIELDS: Array<[string, string]> = [
  ['install_id', 'a random id made on this laptop; not derived from you or the machine'],
  ['product, version, grid_scripts_version', 'which Beethoven this is'],
  ['vscode, os, arch', 'VS Code version, operating system and processor family'],
  ['when', 'the time of the check'],
  ['nodes[].id, status, ms', 'each troubleshooter check, its verdict and how long it took'],
  ['nodes[].detail, repair', 'the check\'s message with e-mails, AccessIDs, paths, hostnames, addresses, job ids and anything token-shaped replaced by placeholders'],
  ['root_causes', 'which checks were the cause'],
  ['errors', 'the last ERROR lines of the Beethoven log, scrubbed the same way'],
  ['signature', 'a hash of the failing checks, so one failure is reported once a day'],
];
