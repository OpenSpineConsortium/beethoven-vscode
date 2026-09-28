// The diagnostics engine: every tool, package, account, file and assumption Ashley depends on is a
// node with a cheap check, an optional safe repair, a manual fix and the risk it guards against.
// A run goes in dependency order; a node whose dependency failed is reported "blocked" with the
// root cause, so a failure names the one broken piece instead of a cascade.
//
// Rule for this project: no feature integrates until its pieces are nodes here.
// No 'vscode' import: the CLI and tests use the same engine.

export type Layer = 'laptop' | 'vscode' | 'network' | 'account' | 'grid-login' | 'grid-slurm' | 'grid-node' | 'container' | 'lab-folder' | 'external';

export interface CheckResult {
  ok: boolean;
  detail: string;
  /** a check may pass with a warning (e.g. quota at 90 %) */
  warn?: boolean;
  /** not applicable here (e.g. an admin-only node for a student, no running worker) */
  skip?: boolean;
}

/**
 * A host command that starts the fix a person must do themselves (a sign-in, a token renewal, the
 * license dialog): the same click-through the wizard uses for that item. Shown as a button beside
 * the failing check; the host runs it and checks again.
 */
export interface FixCommand {
  command: string;
  /** the button's label */
  title: string;
  arguments?: unknown[];
}

export interface DiagNode<C = unknown> {
  id: string;
  title: string;
  layer: Layer;
  dependsOn: string[];
  /** what must be true, in one sentence */
  assumption: string;
  check(ctx: C): Promise<CheckResult>;
  /** a safe automatic repair; returns what it did. Omitted when only a person can fix it. */
  repair?(ctx: C): Promise<{ ok: boolean; detail: string }>;
  /** what to tell the student (or the lab admin) when there is no automatic repair or it failed */
  manualFix: string;
  /** the command that starts the fix only a person can do (a sign-in, a renewal), when there is one */
  fixCommand?: FixCommand;
  /** how a Wayne State or vendor update could break this */
  futureRisk?: string;
  /** file:line in the repository */
  source?: string;
  /** cost hint: checks marked slow run only in a full Troubleshoot, not in the background sweep */
  slow?: boolean;
}

export type NodeStatus = 'ok' | 'warn' | 'fail' | 'repaired' | 'blocked' | 'skipped';

export interface NodeReport {
  id: string;
  title: string;
  layer: Layer;
  status: NodeStatus;
  detail: string;
  /** for blocked nodes: the failing ancestor that is the real cause */
  rootCause?: string;
  repair?: string;
  manualFix?: string;
  /** for failing nodes: the command that starts the fix a person must do (a button in the panel) */
  fixCommand?: FixCommand;
  ms: number;
}

export interface DiagReport {
  started: string;
  finished: string;
  reports: NodeReport[];
  /** failing nodes whose dependencies all passed: the things to fix */
  rootCauses: NodeReport[];
  ok: boolean;
}

export interface RunOpts {
  repair?: boolean;
  /** skip nodes marked slow (the background sweep) */
  quick?: boolean;
  timeoutMs?: number;
  onNode?(r: NodeReport, done: number, total: number): void;
}

/** Topological order; throws on an unknown dependency or a cycle (both are bugs in the graph). */
export function order<C>(nodes: DiagNode<C>[]): DiagNode<C>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) for (const d of n.dependsOn) if (!byId.has(d)) throw new Error(`diagnostics graph: ${n.id} depends on unknown ${d}`);
  const out: DiagNode<C>[] = [];
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (n: DiagNode<C>, stack: string[]) => {
    const s = state.get(n.id) ?? 0;
    if (s === 2) return;
    if (s === 1) throw new Error(`diagnostics graph: cycle ${[...stack, n.id].join(' -> ')}`);
    state.set(n.id, 1);
    for (const d of n.dependsOn) visit(byId.get(d)!, [...stack, n.id]);
    state.set(n.id, 2);
    out.push(n);
  };
  for (const n of nodes) visit(n, []);
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, rej) => (t = setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms)))]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export async function runDiagnostics<C>(nodes: DiagNode<C>[], ctx: C, opts: RunOpts = {}): Promise<DiagReport> {
  const started = new Date().toISOString();
  const ordered = order(nodes);
  const byId = new Map<string, NodeReport>();
  const reports: NodeReport[] = [];
  let done = 0;
  for (const n of ordered) {
    const t0 = Date.now();
    let r: NodeReport;
    const badDep = n.dependsOn.map((d) => byId.get(d)!).find((d) => d.status === 'fail' || d.status === 'blocked');
    const skippedDep = n.dependsOn.map((d) => byId.get(d)!).find((d) => d.status === 'skipped');
    if (badDep) {
      r = { id: n.id, title: n.title, layer: n.layer, status: 'blocked', detail: `waits on ${badDep.title}`, rootCause: badDep.rootCause ?? badDep.id, ms: 0 };
    } else if (skippedDep) {
      r = { id: n.id, title: n.title, layer: n.layer, status: 'skipped', detail: `not applicable (${skippedDep.title} is not)`, ms: 0 };
    } else if (opts.quick && n.slow) {
      r = { id: n.id, title: n.title, layer: n.layer, status: 'skipped', detail: 'checked in a full Troubleshoot', ms: 0 };
    } else {
      let c: CheckResult;
      try {
        c = await withTimeout(n.check(ctx), opts.timeoutMs ?? 90_000, n.title);
      } catch (e) {
        c = { ok: false, detail: `check crashed: ${(e as Error).message}` };
      }
      if (c.skip) r = { id: n.id, title: n.title, layer: n.layer, status: 'skipped', detail: c.detail, ms: Date.now() - t0 };
      else if (c.ok) r = { id: n.id, title: n.title, layer: n.layer, status: c.warn ? 'warn' : 'ok', detail: c.detail, ms: Date.now() - t0 };
      else {
        r = { id: n.id, title: n.title, layer: n.layer, status: 'fail', detail: c.detail, manualFix: n.manualFix, ...(n.fixCommand ? { fixCommand: n.fixCommand } : {}), ms: Date.now() - t0 };
        if (opts.repair && n.repair) {
          try {
            const rp = await withTimeout(n.repair(ctx), 300_000, `repair of ${n.title}`);
            r.repair = rp.detail;
            if (rp.ok) {
              const again = await withTimeout(n.check(ctx), opts.timeoutMs ?? 90_000, n.title);
              if (again.ok) r = { ...r, status: 'repaired', detail: `${again.detail} (was: ${c.detail})` };
              else r.detail = `${c.detail}; repair ran (${rp.detail}) but the check still fails: ${again.detail}`;
            }
          } catch (e) {
            r.repair = `repair crashed: ${(e as Error).message}`;
          }
        }
      }
    }
    byId.set(n.id, r);
    reports.push(r);
    opts.onNode?.(r, ++done, ordered.length);
  }
  const rootCauses = reports.filter((r) => r.status === 'fail');
  return { started, finished: new Date().toISOString(), reports, rootCauses, ok: rootCauses.length === 0 };
}

/** A short text report for the log, grouped by layer, root causes first. */
export function formatReport(rep: DiagReport): string {
  const icon: Record<NodeStatus, string> = { ok: 'PASS', warn: 'WARN', fail: 'FAIL', repaired: 'FIXD', blocked: 'BLKD', skipped: 'SKIP' };
  const lines = [`Ashley troubleshooter ${rep.started} -> ${rep.finished}: ${rep.ok ? 'everything works' : `${rep.rootCauses.length} root cause(s)`}`];
  for (const r of rep.rootCauses) lines.push(`  ROOT CAUSE ${r.id}: ${r.detail}${r.manualFix ? `\n             fix: ${r.manualFix}` : ''}${r.fixCommand ? `\n             one click: ${r.fixCommand.title} (${r.fixCommand.command})` : ''}`);
  let layer = '';
  for (const r of rep.reports) {
    if (r.layer !== layer) {
      layer = r.layer;
      lines.push(`[${layer}]`);
    }
    lines.push(`  ${icon[r.status]}  ${r.id.padEnd(34)} ${r.detail}${r.rootCause ? ` (root cause: ${r.rootCause})` : ''}${r.repair ? ` [repair: ${r.repair}]` : ''}`);
  }
  return lines.join('\n');
}
