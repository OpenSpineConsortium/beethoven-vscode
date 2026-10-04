// The wire format between a laptop (extension, CLI, MCP server) and a Claude worker on the
// grid. It is a directory of JSON files on the grid's shared filesystem:
//
//   ~/.beethoven/workers/<worker>/inbox/<id>.json          request (written .part, then renamed)
//   ~/.beethoven/workers/<worker>/outbox/<id>.events.jsonl claude's stream-json events, live
//   ~/.beethoven/workers/<worker>/outbox/<id>.json          final result
//   ~/.beethoven/workers/<worker>/state.json                daemon heartbeat
//   ~/.beethoven/sessions/<session>.json                    session name -> claude session id
//
// Why files and not a socket: the laptop only ever talks to the login node over ssh; the
// daemon runs on whatever compute node Slurm gave it; both see the same home directory.
// A file queue survives daemon restarts and requeues, needs no open ports, and is
// inspectable with ls and cat. Latency is one ssh round trip plus one poll interval.

export const PROTOCOL_VERSION = 1;

export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export interface BeethovenRequest {
  v: number;
  id: string;
  prompt: string;
  /** Resumable conversation name (maps to a Claude session id on the grid). */
  session: string;
  /** Working directory on the grid. Sessions are bound to their cwd. */
  cwd?: string;
  mode: PermissionMode;
  max_turns?: number;
  model?: string;
  /** Force a particular credential (account directory name); since grid scripts 8 the sign-in, "claude", is the only one. */
  account?: string;
  /** Restrict tools, e.g. ["Read","Grep","Bash(python *)"]. */
  allowed_tools?: string[];
  /** Extra system prompt appended by the daemon (project rules, lab recipe). */
  append_system_prompt?: string;
  created: string;
  from: string;
  attempt?: number;
  /** rotation bookkeeping of grid scripts up to 7 (moving a limited request to the API key); kept on the v1 wire */
  exclude_accounts?: string[];
}

export type ResultStatus = 'ok' | 'error' | 'rate_limited' | 'timeout' | 'cancelled';

export interface BeethovenResult {
  v: number;
  id: string;
  status: ResultStatus;
  result: string;
  session: string;
  session_id?: string;
  account?: string;
  /** Claude Code's list-price estimate (total_cost_usd), kept on the v1 wire; never shown, because on the
   *  student's subscription it is not a bill */
  cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  usage?: Record<string, unknown>;
  started: string;
  finished: string;
  node?: string;
  job?: string;
  claude_rc?: number;
  error?: string;
  /** ISO time after which a rate-limited request may be retried. */
  retry_after?: string;
}

export interface WorkerState {
  worker: string;
  node: string;
  job: string;
  pid: number;
  started: string;
  last_beat: string;
  status: 'starting' | 'idle' | 'busy' | 'stopping' | 'blocked';
  concurrency: number;
  running: string[];
  queued: number;
  processed: number;
  claude_version?: string;
  accounts: Array<{ name: string; kind: string; enabled: boolean; cooldown_until?: string | null }>;
  blocked_until?: string | null;
}

export function newRequestId(now = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', 'T');
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rnd}`;
}

export function makeRequest(p: Partial<BeethovenRequest> & { prompt: string; from: string }): BeethovenRequest {
  return {
    v: PROTOCOL_VERSION,
    id: p.id ?? newRequestId(),
    prompt: p.prompt,
    session: p.session ?? 'default',
    cwd: p.cwd,
    mode: p.mode ?? 'acceptEdits',
    max_turns: p.max_turns ?? 50,
    model: p.model,
    account: p.account,
    allowed_tools: p.allowed_tools,
    append_system_prompt: p.append_system_prompt,
    created: p.created ?? new Date().toISOString(),
    from: p.from,
    attempt: p.attempt ?? 1,
    exclude_accounts: p.exclude_accounts ?? [],
  };
}

/** Text patterns that mean "this credential's window is exhausted". Kept in one place so the
 *  daemon, the tests and the docs agree. Matched case-insensitively against the result text. */
export const RATE_LIMIT_PATTERNS: RegExp[] = [
  /hit your (usage )?limit/i,
  /usage limit reached/i,
  /rate[ _-]?limit/i,
  /too many requests/i,
  /\b429\b/,
  /out of (extra )?usage/i,
  /overloaded_error/i,
];

export function looksRateLimited(text: string | undefined | null): boolean {
  if (!text) return false;
  return RATE_LIMIT_PATTERNS.some((r) => r.test(text));
}

/** Try to read a reset time from a limit message ("resets at 3pm", "resets 4:30pm (America/Detroit)",
 *  "try again in 2 hours"). Returns an ISO string or null. */
export function parseResetTime(text: string, now = new Date()): string | null {
  const m1 = /try again in (\d+)\s*(minute|min|hour|hr|second|sec)s?/i.exec(text);
  if (m1) {
    const n = parseInt(m1[1], 10);
    const unit = m1[2].toLowerCase();
    const ms = unit.startsWith('h') ? n * 3600e3 : unit.startsWith('m') ? n * 60e3 : n * 1e3;
    return new Date(now.getTime() + ms).toISOString();
  }
  const m2 = /resets? (?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (m2) {
    let h = parseInt(m2[1], 10);
    const min = m2[2] ? parseInt(m2[2], 10) : 0;
    const ap = m2[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  return null;
}
