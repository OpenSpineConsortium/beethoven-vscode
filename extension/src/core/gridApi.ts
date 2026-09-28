// Everything the laptop asks the grid to do, as typed calls over `ssh <alias> ~/.ashley/bin/ashley ...`.
// Shared by the extension, the MCP server and the CLI.
import { ssh, RunResult, RunOptions } from './shell';
import { AshleyRequest, AshleyResult, WorkerState, makeRequest, PermissionMode } from './protocol';
import { parseSqueue, SqueueRow, SQUEUE_FORMAT, workerStartArgs, WorkerJobSpec } from './slurm';
import { GridRelay } from './relay';

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

  ashley(args: string[], opts: RunOptions = {}): Promise<RunResult> {
    this.log(`$ ssh ${this.alias} ashley ${args.join(' ')}`);
    return ssh(this.alias, ['~/.ashley/bin/ashley', ...args], opts);
  }

  async hostname(): Promise<{ ok: boolean; hostname: string; error: string }> {
    const r = await ssh(this.alias, ['hostname'], { timeoutMs: 40_000 });
    return { ok: r.code === 0, hostname: r.stdout.trim(), error: r.stderr.trim() };
  }

  async status(): Promise<GridStatus> {
    const r = await this.ashley(['status', '--json'], { timeoutMs: 90_000 });
    if (r.code !== 0) {
      return { ready: false, error: r.code === 127 || /No such file/.test(r.stderr) ? 'Ashley is not installed on the grid yet' : (r.stderr || r.stdout).trim() };
    }
    return parseLastJson<GridStatus>(r.stdout) ?? { ready: false, error: 'status did not return JSON' };
  }

  async squeue(): Promise<SqueueRow[]> {
    const r = await ssh(this.alias, ['squeue', '-u', '$USER', '-h', '-o', SQUEUE_FORMAT], { timeoutMs: 60_000 });
    return r.code === 0 ? parseSqueue(r.stdout) : [];
  }

  /** The lab's shared container library, if this account can read it. */
  async library(): Promise<{ available: boolean; root?: string; default?: string; containers: Record<string, { purpose?: string; claude_version?: string; gpu?: boolean; image?: string; built?: string }> }> {
    const r = await this.ashley(['library', '--json'], { timeoutMs: 60_000 });
    const j = r.code === 0 ? parseLastJson<any>(r.stdout) : null;
    if (!j || !j.available) return { available: false, containers: {} };
    return { available: true, root: j.root, default: j.library?.default, containers: j.library?.containers ?? {} };
  }

  async workers(): Promise<WorkerState[]> {
    const r = await this.ashley(['worker', 'list', '--json'], { timeoutMs: 60_000 });
    return (r.code === 0 && parseLastJson<{ workers: WorkerState[] }>(r.stdout)?.workers) || [];
  }

  async workerStart(spec: WorkerJobSpec): Promise<{ ok: boolean; jobId?: string; message: string }> {
    const r = await this.ashley(workerStartArgs(spec), { timeoutMs: 120_000 });
    const m = /job (\d+)/.exec(r.stdout);
    return { ok: r.code === 0, jobId: m?.[1], message: (r.stdout + r.stderr).trim() };
  }

  async workerStop(name: string): Promise<string> {
    const r = await this.ashley(['worker', 'stop', '--name', name], { timeoutMs: 60_000 });
    return (r.stdout + r.stderr).trim();
  }

  async workerLog(name: string, lines = 80): Promise<string> {
    const r = await this.ashley(['worker', 'log', '--name', name, '--lines', String(lines)], { timeoutMs: 60_000 });
    return (r.stdout + r.stderr).trim();
  }

  /** Queue a prompt; returns the request id immediately. */
  async send(req: Partial<AshleyRequest> & { prompt: string }, worker = 'default'): Promise<{ id: string; message: string }> {
    const full = makeRequest({ ...req, from: req.from ?? 'laptop' });
    if (this.relay) {
      try {
        const q = await this.relay.send(full, worker);
        return { id: full.id, message: `queued ${full.id} on worker ${worker} (relay, grid time ${new Date(q.queuedGridMs).toISOString()})` };
      } catch (e) {
        this.log(`relay send failed (${(e as Error).message}); using a fresh ssh`);
      }
    }
    const r = await this.ashley(['send', '--worker', worker, '--json'], { input: JSON.stringify(full), timeoutMs: 60_000 });
    if (r.code !== 0) throw new Error(`send failed: ${(r.stderr || r.stdout).trim()}`);
    return { id: full.id, message: r.stdout.trim() };
  }

  /** Fetch a result if it exists (null otherwise). */
  async result(id: string, worker = 'default'): Promise<AshleyResult | null> {
    if (this.relay) {
      try {
        return await this.relay.result(id, worker);
      } catch (e) {
        this.log(`relay result failed (${(e as Error).message}); using a fresh ssh`);
      }
    }
    const r = await this.ashley(['result', '--worker', worker, id], { timeoutMs: 60_000 });
    if (r.code !== 0) return null;
    return parseLastJson<AshleyResult>(r.stdout);
  }

  /**
   * Queue a prompt and hold one ssh connection open until the answer arrives.
   * The grid CLI prints `EVENT {json}` lines as Claude works and a final `RESULT {json}`.
   */
  async ask(
    req: Partial<AshleyRequest> & { prompt: string },
    worker = 'default',
    timeoutSec = 3600,
    events: AskEvents = {},
    signal?: AbortSignal,
  ): Promise<AshleyResult> {
    const full = makeRequest({ ...req, from: req.from ?? 'laptop' });
    if (this.relay) {
      try {
        return await this.relay.ask(full, worker, timeoutSec, (ev) => events.onEvent?.(ev));
      } catch (e) {
        this.log(`relay ask failed (${(e as Error).message}); using a fresh ssh`);
      }
    }
    let buffer = '';
    let result: AshleyResult | null = null;
    const r = await this.ashley(['ask', '--worker', worker, '--json', '--stream', '--timeout', String(timeoutSec)], {
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
    const r = await ssh(this.alias, ['head', '-c', String(maxBytes), path], { timeoutMs: 60_000 });
    return { ok: r.code === 0, text: r.code === 0 ? r.stdout : r.stderr };
  }

  async listDir(path: string): Promise<{ ok: boolean; text: string }> {
    const r = await ssh(this.alias, ['ls', '-la', path], { timeoutMs: 60_000 });
    return { ok: r.code === 0, text: (r.stdout || r.stderr).trim() };
  }

  async sbatch(scriptPath: string, cwd: string, extraArgs: string[] = []): Promise<{ ok: boolean; jobId?: string; message: string }> {
    const r = await ssh(this.alias, ['bash', '-c', `cd ${cwd} && sbatch --parsable ${extraArgs.join(' ')} ${scriptPath}`], { timeoutMs: 60_000 });
    const m = /^(\d+)/.exec(r.stdout.trim());
    return { ok: r.code === 0 && !!m, jobId: m?.[1], message: (r.stdout + r.stderr).trim() };
  }

  async sessions(): Promise<Array<{ session: string; session_id: string; cwd: string; updated: string; account?: string }>> {
    const r = await this.ashley(['sessions', '--json'], { timeoutMs: 60_000 });
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
