// Everything the laptop asks the grid to do, as typed calls over `ssh <alias> ~/.beethoven/bin/beethoven ...`
// (gridCli in shell.ts: an account not yet moved answers with ~/.ashley/bin/ashley).
// Shared by the extension, the MCP server and the CLI.
import { ssh, RunResult, RunOptions, shq, remotePath, gridCli } from './shell';
import { BeethovenRequest, BeethovenResult, WorkerState, makeRequest, PermissionMode, checkRequestId, checkWorkerName } from './protocol';
import { parseSqueue, SqueueRow, SQUEUE_FORMAT, workerStartArgs, WorkerJobSpec } from './slurm';
import { GridRelay } from './relay';
import { redactCredentials } from './redact';

/**
 * The grid half of readFile and listDir, which the laptop's Claude can call (beethoven_read_file,
 * beethoven_list_dir). Beethoven never reads or relays a Claude credential, so by the grid's own resolved
 * path (a link leads nowhere new) nothing inside a Claude sign-in folder (~/.claude, ~/.beethoven/claude, the
 * engine's ~/.beethoven/accounts and each sign-in an account there leads to, the same under ~/.ashley) or
 * ~/.ssh is read or listed, and no file is read whose name holds a credential, a key or a token anywhere (the
 * desktop edition's refused names, plus Beethoven's own copies: secrets.env, license.key, apikey).
 * $1 the path, $2 read|list, $3 the byte limit.
 */
export const GRID_READ_GUARD = [
  'p=$(readlink -f -- "$1" 2>/dev/null) || { echo "no such file or folder: $1" >&2; exit 2; };',
  'refuse() { echo "Beethoven does not read $1: it is, or is inside, a Claude sign-in, a key or a token" >&2; exit 3; };',
  'for d in "$HOME/.claude" "$HOME/.beethoven/claude" "$HOME/.beethoven/accounts" "$HOME"/.beethoven/accounts/*/claude "$HOME/.ashley/claude" "$HOME/.ashley/accounts" "$HOME/.ssh"; do',
  'r=$(readlink -f -- "$d" 2>/dev/null) && [ -e "$r" ] || continue; case "$p/" in "$r"/*) refuse "$1";; esac; done;',
  'n=${p##*/}; n=${n,,};',
  'if [ "$2" != list ]; then case "$n" in .credentials.json|.claude.json|job.token|*.token|.netrc|.env|.env.*|*.pem|*.key|secrets.env|apikey|id_rsa|id_dsa|id_ecdsa|id_ed25519|id_ecdsa_sk|id_ed25519_sk) refuse "$1";; esac; fi;',
  'if [ "$2" = list ]; then exec ls -la -- "$p"; else exec head -c "$3" -- "$p"; fi',
].join(' '); // one line: a newline is not sure to cross Windows argument quoting

export interface GridStatus {
  version?: string;
  host?: string;
  ready: boolean;
  root?: string;
  runtime?: string;
  claude_version?: string;
  bootstrap_job?: string;
  bootstrap_state?: string;
  home_used_gb?: number;
  home_soft_gb?: number;
  workers?: WorkerState[];
  accounts?: Array<{ name: string; kind: string; enabled: boolean; cooldown_until?: string | null }>;
  jobs?: SqueueRow[];
  error?: string;
}

/** `beethoven claude status --json`: whether Claude Code's own sign-in exists on the grid, never the credential. */
export interface GridClaudeStatus {
  /** Claude Code's credential file exists in ~/.beethoven/claude */
  dir_present: boolean;
  /** the student answered Claude Code's Remote Control question (phone access) */
  consent: boolean;
  /** what the newest running worker's Claude Code reported about the sign-in; null when no worker runs.
   *  subscription is false when it is signed in some other way (grid scripts 8; absent before), an API
   *  key behind the sign-in included (grid scripts 9, which also report apiKey; a worker without it
   *  judged by the earlier rule until it restarts) */
  login: { loggedIn?: boolean; subscription?: boolean; apiKey?: boolean; detail?: string; email?: string } | null;
}

/**
 * A sign-in reported by a worker whose daemon is from grid scripts 8 or older: it judged the sign-in without
 * looking for an API key behind it, and its heartbeat has no apiKey (grid scripts 9 always report one with an
 * answer). Such a worker keeps its old daemon until the job ends or `beethoven install` restarts it, so the
 * laptop says "restart it" as the grid's doctor does (claude_login_old_rule), never "signed in".
 */
export function judgedByOldRule(login: GridClaudeStatus['login'] | undefined): boolean {
  return !!login?.loggedIn && login.apiKey === undefined;
}

export interface AskEvents {
  onEvent?(event: Record<string, unknown>): void;
  onLine?(line: string): void;
}

export class GridApi {
  /**
   * @param relay an open message channel (see relay.ts). With it, send/ask/result cost one
   * network round trip instead of one ssh connection each; without it every call is its own ssh.
   */
  constructor(public alias: string, private log: (line: string) => void = () => {}, public relay?: GridRelay) {}

  beethoven(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    this.log(`$ ssh ${this.alias} beethoven ${args.join(' ')}`);
    return ssh(this.alias, gridCli(args), opts);
  }

  async hostname(): Promise<{ ok: boolean; hostname: string; error: string }> {
    const r = await ssh(this.alias, ['hostname'], { timeoutMs: 40_000 });
    return { ok: r.code === 0, hostname: r.stdout.trim(), error: r.stderr.trim() };
  }

  async status(): Promise<GridStatus> {
    const r = await this.beethoven(['status', '--json'], { timeoutMs: 90_000 });
    if (r.code !== 0) {
      return { ready: false, error: r.code === 127 || /No such file/.test(r.stderr) ? 'Beethoven is not installed on the grid yet' : (r.stderr || r.stdout).trim() };
    }
    return parseLastJson<GridStatus>(r.stdout) ?? { ready: false, error: 'status did not return JSON' };
  }

  async squeue(): Promise<SqueueRow[]> {
    // $USER must be expanded on the grid: a quoted '$USER' reached squeue literally and every list came back empty
    const r = await ssh(this.alias, ['bash', '-c', `squeue -u "$USER" -h -o ${shq(SQUEUE_FORMAT)}`], { timeoutMs: 60_000 });
    return r.code === 0 ? parseSqueue(r.stdout) : [];
  }

  /** The lab's shared container library, if this account can read it. */
  async library(): Promise<{ available: boolean; root?: string; default?: string; containers: Record<string, { purpose?: string; claude_version?: string; gpu?: boolean; image?: string; built?: string }> }> {
    const r = await this.beethoven(['library', '--json'], { timeoutMs: 60_000 });
    const j = r.code === 0 ? parseLastJson<any>(r.stdout) : null;
    if (!j || !j.available) return { available: false, containers: {} };
    return { available: true, root: j.root, default: j.library?.default, containers: j.library?.containers ?? {} };
  }

  async claudeStatus(): Promise<GridClaudeStatus | null> {
    const r = await this.beethoven(['claude', 'status', '--json'], { timeoutMs: 60_000 });
    return r.code === 0 ? parseLastJson(r.stdout) : null;
  }

  async accessWhoami(): Promise<{ user: string; admin: boolean; lab_admin: string; granted: boolean; state: string } | null> {
    const r = await this.beethoven(['access', 'whoami', '--json'], { timeoutMs: 60_000 });
    return r.code === 0 ? parseLastJson(r.stdout) : null;
  }

  async accessList(): Promise<Array<{ user: string; state: string; note?: string; message?: string; requested?: string; decided?: string }>> {
    const r = await this.beethoven(['access', 'admin', 'list', '--json'], { timeoutMs: 60_000 });
    return (r.code === 0 && parseLastJson<{ requests: any[] }>(r.stdout)?.requests) || [];
  }

  async accessRequirements(): Promise<{ ok: boolean; missing: string[] }> {
    const r = await this.beethoven(['access', 'requirements', '--json'], { timeoutMs: 120_000 });
    return parseLastJson<{ ok: boolean; missing: string[] }>(r.stdout) ?? { ok: false, missing: ['the grid did not answer'] };
  }

  async access(args: string[]): Promise<string> {
    const r = await this.beethoven(['access', ...args], { timeoutMs: 120_000 });
    return (r.stdout + r.stderr).trim();
  }

  /** Phone access (Claude Code Remote Control hosted by a worker). */
  async phone(action: 'on' | 'off', worker = 'default'): Promise<string> {
    const r = await this.beethoven(['phone', action, '--worker', worker], { timeoutMs: 60_000 });
    return (r.stdout + r.stderr).trim();
  }

  async phoneStatus(worker = 'default'): Promise<{ job_running: boolean; enabled: boolean; status: { phase: string; url?: string | null; session_url?: string | null; message?: string; attempts?: number } } | null> {
    const r = await this.beethoven(['phone', 'status', '--worker', worker, '--json'], { timeoutMs: 60_000 });
    return r.code === 0 ? parseLastJson(r.stdout) : null;
  }

  async phoneCode(code: string, worker = 'default'): Promise<string> {
    const r = await this.beethoven(['phone', 'code', '--worker', worker], { input: code + '\n', timeoutMs: 60_000 });
    return (r.stdout + r.stderr).trim();
  }

  async workers(): Promise<WorkerState[]> {
    const r = await this.beethoven(['worker', 'list', '--json'], { timeoutMs: 60_000 });
    return (r.code === 0 && parseLastJson<{ workers: WorkerState[] }>(r.stdout)?.workers) || [];
  }

  async workerStart(spec: WorkerJobSpec): Promise<{ ok: boolean; jobId?: string; message: string }> {
    let args: string[];
    try {
      args = workerStartArgs(spec);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
    const r = await this.beethoven(args, { timeoutMs: 120_000 });
    const m = /job (\d+)/.exec(r.stdout);
    return { ok: r.code === 0, jobId: m?.[1], message: (r.stdout + r.stderr).trim() };
  }

  async workerStop(name: string): Promise<string> {
    const r = await this.beethoven(['worker', 'stop', '--name', name], { timeoutMs: 60_000 });
    return (r.stdout + r.stderr).trim();
  }

  async workerLog(name: string, lines = 80): Promise<string> {
    const r = await this.beethoven(['worker', 'log', '--name', name, '--lines', String(lines)], { timeoutMs: 60_000 });
    return (r.stdout + r.stderr).trim();
  }

  /** Queue a prompt; returns the request id immediately. */
  async send(req: Partial<BeethovenRequest> & { prompt: string }, worker = 'default'): Promise<{ id: string; message: string }> {
    const full = makeRequest({ ...req, from: req.from ?? 'laptop' });
    // checked here as well as in the relay: when the relay fails, the same values go to a fresh ssh
    checkWorkerName(worker);
    checkRequestId(full.id);
    if (this.relay) {
      try {
        const q = await this.relay.send(full, worker);
        return { id: full.id, message: `queued ${full.id} on worker ${worker} (relay, grid time ${new Date(q.queuedGridMs).toISOString()})` };
      } catch (e) {
        this.log(`relay send failed (${(e as Error).message}); using a fresh ssh`);
      }
    }
    const r = await this.beethoven(['send', '--worker', worker, '--json'], { input: JSON.stringify(full), timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`send failed: ${(r.stderr || r.stdout).trim()}`);
    return { id: full.id, message: r.stdout.trim() };
  }

  /** Fetch a result if it exists (null otherwise). */
  async result(id: string, worker = 'default'): Promise<BeethovenResult | null> {
    checkWorkerName(worker);
    checkRequestId(id);
    if (this.relay) {
      try {
        return await this.relay.result(id, worker);
      } catch (e) {
        this.log(`relay result failed (${(e as Error).message}); using a fresh ssh`);
      }
    }
    const r = await this.beethoven(['result', '--worker', worker, id], { timeoutMs: 60_000 });
    if (r.code !== 0) return null;
    return parseLastJson<BeethovenResult>(r.stdout);
  }

  /**
   * Queue a prompt and hold one ssh connection open until the answer arrives.
   * The grid CLI prints `EVENT {json}` lines as Claude works and a final `RESULT {json}`.
   */
  async ask(
    req: Partial<BeethovenRequest> & { prompt: string },
    worker = 'default',
    timeoutSec = 3600,
    events: AskEvents = {},
    signal?: AbortSignal,
  ): Promise<BeethovenResult> {
    const full = makeRequest({ ...req, from: req.from ?? 'laptop' });
    checkWorkerName(worker);
    checkRequestId(full.id);
    if (this.relay) {
      try {
        return await this.relay.ask(full, worker, timeoutSec, (ev) => events.onEvent?.(ev));
      } catch (e) {
        this.log(`relay ask failed (${(e as Error).message}); using a fresh ssh`);
      }
    }
    let buffer = '';
    let result: BeethovenResult | null = null;
    const r = await this.beethoven(['ask', '--worker', worker, '--json', '--stream', '--timeout', String(timeoutSec)], {
      input: JSON.stringify(full),
      timeoutMs: (timeoutSec + 120) * 1000,
      signal,
      onStdout: (chunk) => {
        buffer += chunk;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trimEnd();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          events.onLine?.(line);
          if (line.startsWith('EVENT ')) {
            try {
              events.onEvent?.(JSON.parse(line.slice(6)));
            } catch {
              /* partial line */
            }
          } else if (line.startsWith('RESULT ')) {
            try {
              result = JSON.parse(line.slice(7));
            } catch {
              /* ignore */
            }
          }
        }
      },
    });
    if (result) return result;
    return {
      v: 1,
      id: full.id,
      status: r.timedOut ? 'timeout' : 'error',
      result: '',
      session: full.session,
      started: full.created,
      finished: new Date().toISOString(),
      error: r.timedOut ? `no answer within ${timeoutSec}s (request ${full.id} is still queued; fetch it later with result)` : (r.stderr || r.stdout).trim() || `ssh exited ${r.code}`,
    };
  }

  /** Small, read-only commands on the login node (what the lab allows there). */
  async readFile(path: string, maxBytes = 200_000): Promise<{ ok: boolean; text: string }> {
    const r = await ssh(this.alias, ['bash', '-c', GRID_READ_GUARD, 'beethoven-read', path, 'read', String(maxBytes)], { timeoutMs: 60_000 });
    return { ok: r.code === 0, text: r.code === 0 ? redactCredentials(r.stdout) : r.stderr };
  }

  async listDir(path: string): Promise<{ ok: boolean; text: string }> {
    const r = await ssh(this.alias, ['bash', '-c', GRID_READ_GUARD, 'beethoven-read', path, 'list'], { timeoutMs: 60_000 });
    return { ok: r.code === 0, text: (r.stdout || r.stderr).trim() };
  }

  async sbatch(scriptPath: string, cwd: string, extraArgs: string[] = []): Promise<{ ok: boolean; jobId?: string; message: string }> {
    const r = await ssh(this.alias, ['bash', '-c', `cd ${remotePath(cwd)} && sbatch --parsable ${extraArgs.map(shq).join(' ')} ${remotePath(scriptPath)}`], { timeoutMs: 60_000 });
    const m = /^(\d+)/.exec(r.stdout.trim());
    return { ok: r.code === 0 && !!m, jobId: m?.[1], message: (r.stdout + r.stderr).trim() };
  }

  async sessions(): Promise<Array<{ session: string; session_id: string; cwd: string; updated: string; account?: string }>> {
    const r = await this.beethoven(['sessions', '--json'], { timeoutMs: 60_000 });
    return (r.code === 0 && parseLastJson<{ sessions: Array<{ session: string; session_id: string; cwd: string; updated: string }> }>(r.stdout)?.sessions) || [];
  }
}

export function parseLastJson<T>(text: string): T | null {
  const lines = text.trim().split('\n').reverse();
  for (const l of lines) {
    const s = l.trim();
    if (s.startsWith('{') || s.startsWith('[')) {
      try {
        return JSON.parse(s) as T;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

export type { PermissionMode };
