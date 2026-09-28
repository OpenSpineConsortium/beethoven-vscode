// A persistent message channel to the grid: one ssh session to the login node running
// `ashley relay`, kept open; each prompt is one line on its stdin, answers come back as lines.
// No per-message handshake, so a prompt reaches the worker's inbox in the network round trip
// (tens of milliseconds) instead of a fresh ssh connection (about two seconds). Reconnects
// on its own if the session drops; callers see a rejected promise for whatever was in flight.
import { ChildProcess, spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { SSH_BATCH_OPTS } from './shell';
import { AshleyRequest, AshleyResult } from './protocol';

export interface RelayEvents {
  onEvent?(id: string, event: Record<string, unknown>): void;
  onLine?(line: string): void;
  onStatus?(status: 'connecting' | 'ready' | 'closed', detail?: string): void;
}

interface Waiter {
  resolveQueued?: (ms: number) => void;
  resolveResult?: (r: AshleyResult) => void;
  reject: (e: Error) => void;
  onEvent?: (event: Record<string, unknown>) => void;
  timer?: NodeJS.Timeout;
}

export class GridRelay {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private waiters = new Map<string, Waiter>();
  private pings: Array<(ms: number) => void> = [];
  private version = '';

  constructor(public alias: string, private events: RelayEvents = {}) {}

  /** Open the session if needed. Resolves when the grid side says READY. */
  ensure(): Promise<void> {
    if (this.child && this.ready) return this.ready;
    this.events.onStatus?.('connecting');
    this.ready = new Promise<void>((resolve, reject) => {
      // the path is left unquoted so the remote shell expands ~ (it contains no spaces)
      const child = spawn('ssh', [...SSH_BATCH_OPTS, '-o', 'ServerAliveInterval=30', this.alias, '--', '~/.ashley/bin/ashley relay'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      this.child = child;
      let settled = false;
      let stderr = '';
      const rl = readline.createInterface({ input: child.stdout! });
      rl.on('line', (line) => {
        this.events.onLine?.(line);
        if (line.startsWith('READY ')) {
          this.version = line.split(' ')[2] ?? '';
          settled = true;
          this.events.onStatus?.('ready', this.version);
          resolve();
          return;
        }
        this.handle(line);
      });
      child.stderr!.on('data', (d: Buffer) => (stderr += d.toString()));
      child.on('error', (e) => {
        if (!settled) reject(e);
        this.dropAll(e);
      });
      child.on('close', (code) => {
        const e = new Error(`relay closed (ssh exit ${code}) ${stderr.trim().slice(-300)}`);
        if (!settled) reject(e);
        this.dropAll(e);
        this.child = null;
        this.ready = null;
        this.events.onStatus?.('closed', e.message);
      });
    });
    return this.ready;
  }

  close(): void {
    try {
      this.child?.stdin?.write('QUIT\n');
      this.child?.stdin?.end();
    } catch {
      /* already gone */
    }
    this.child?.kill();
    this.child = null;
    this.ready = null;
  }

  private write(line: string): void {
    if (!this.child?.stdin?.writable) throw new Error('relay is not connected');
    this.child.stdin.write(line + '\n');
  }

  private handle(line: string): void {
    const sp = line.indexOf(' ');
    const kind = sp < 0 ? line : line.slice(0, sp);
    const rest = sp < 0 ? '' : line.slice(sp + 1);
    if (kind === 'PONG') {
      const p = this.pings.shift();
      p?.(parseInt(rest, 10));
      return;
    }
    if (kind === 'QUEUED') {
      const [id, ms] = rest.split(' ');
      this.waiters.get(id)?.resolveQueued?.(parseInt(ms, 10));
      return;
    }
    if (kind === 'EVENT') {
      const sp2 = rest.indexOf(' ');
      const id = rest.slice(0, sp2);
      try {
        const ev = JSON.parse(rest.slice(sp2 + 1));
        this.waiters.get(id)?.onEvent?.(ev);
        this.events.onEvent?.(id, ev);
      } catch {
        /* partial */
      }
      return;
    }
    if (kind === 'RESULT') {
      const sp2 = rest.indexOf(' ');
      const id = rest.slice(0, sp2);
      const w = this.waiters.get(id);
      if (!w) return;
      try {
        const r = JSON.parse(rest.slice(sp2 + 1)) as AshleyResult;
        this.waiters.delete(id);
        if (w.timer) clearTimeout(w.timer);
        w.resolveResult?.(r);
      } catch (e) {
        w.reject(new Error(`bad result line: ${(e as Error).message}`));
      }
      return;
    }
    if (kind === 'ERROR') {
      // no id on the wire; fail the newest waiter without a queued ack
      for (const [id, w] of [...this.waiters].reverse()) {
        if (w.resolveQueued) {
          this.waiters.delete(id);
          w.reject(new Error(rest));
          break;
        }
      }
    }
  }

  private dropAll(e: Error): void {
    for (const [, w] of this.waiters) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(e);
    }
    this.waiters.clear();
    for (const p of this.pings) p(-1);
    this.pings = [];
  }

  /** Round trip laptop -> login node -> laptop over the open session, in ms; also returns the grid clock. */
  async ping(): Promise<{ rttMs: number; gridMs: number; localMidMs: number }> {
    await this.ensure();
    const t0 = Date.now();
    const gridMs = await new Promise<number>((resolve) => {
      this.pings.push(resolve);
      this.write('PING');
    });
    const t1 = Date.now();
    return { rttMs: t1 - t0, gridMs, localMidMs: Math.round((t0 + t1) / 2) };
  }

  /** Queue a request; resolves with the grid's queue time (epoch ms, grid clock) as soon as the file is written. */
  async send(req: AshleyRequest, worker = 'default'): Promise<{ queuedGridMs: number }> {
    await this.ensure();
    return new Promise((resolve, reject) => {
      const w: Waiter = { reject, resolveQueued: (ms) => resolve({ queuedGridMs: ms }) };
      this.waiters.set(req.id, { ...w, resolveResult: () => {} });
      this.write(`SEND ${worker} ${JSON.stringify(req)}`);
      setTimeout(() => {
        if (this.waiters.get(req.id)?.resolveQueued) reject(new Error('no QUEUED ack from the relay within 30 s'));
      }, 30_000).unref();
    });
  }

  /** Queue a request and wait for its result, receiving events as they stream. */
  async ask(req: AshleyRequest, worker = 'default', timeoutSec = 3600, onEvent?: (ev: Record<string, unknown>) => void): Promise<AshleyResult> {
    await this.ensure();
    return new Promise<AshleyResult>((resolve, reject) => {
      const w: Waiter = { reject, onEvent, resolveResult: resolve, resolveQueued: () => {} };
      w.timer = setTimeout(() => {
        this.waiters.delete(req.id);
        resolve({ v: 1, id: req.id, status: 'timeout', result: '', session: req.session, started: req.created, finished: new Date().toISOString(), error: `no answer within ${timeoutSec}s; request ${req.id} stays queued` });
      }, timeoutSec * 1000);
      this.waiters.set(req.id, w);
      this.write(`SEND ${worker} ${JSON.stringify(req)}`);
    });
  }

  async result(id: string, worker = 'default'): Promise<AshleyResult | null> {
    await this.ensure();
    return new Promise((resolve, reject) => {
      const w: Waiter = { reject, resolveResult: (r) => resolve(r), resolveQueued: () => {} };
      this.waiters.set(id, w);
      this.write(`RESULT ${worker} ${id}`);
      setTimeout(() => {
        if (this.waiters.get(id) === w) {
          this.waiters.delete(id);
          resolve(null);
        }
      }, 10_000).unref();
    });
  }
}
