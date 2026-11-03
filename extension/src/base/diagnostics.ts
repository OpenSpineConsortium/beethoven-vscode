// The check engine of the editions' diagnostics: every assumption an edition rests on is a node with
// a check, an optional safe repair and the fix only a person can do. A run goes in dependency order,
// one check at a time (later checks read what earlier ones learned); a node whose dependency failed is
// reported blocked, with the failing ancestor that is the real cause named, so a failure names the one
// broken piece instead of a cascade; a slow check runs only in a full run, never in a quick sweep.
//
// Its source is the two engines the browser edition (extension/src/core/diagnostics.ts at
// beethoven-extension ae11a00) and VS Code (extension/src/core/diagnostics.ts at beethoven-vscode
// e7526f9) ran: the same algorithm, ported from VS Code to the browser, differing only in their layers,
// their fix (the browser's action name, VS Code's command), three sentences and their text report.
// Base keeps the algorithm and nothing an edition says or does. What stays in each edition: its
// layers and fix type (the type parameters L and F), its nodes and their documentation (assumption,
// futureRisk, source), every sentence (its DiagWords, handed to the run; base returns codes), the text
// report (formatReport), and the time limit around a check and a repair, which needs a timer: the
// edition's guard wraps each call. Base reads no clock either: it calls the edition's `now`, when given.

/** a check's verdict, as the edition's check returns it */
export interface CheckResult {
  ok: boolean;
  /** the edition's words for what the check found */
  detail: string;
  /** passed, with something to say (an ageing session, a quota near its end) */
  warn?: boolean;
  /** not applicable here (an admin-only node for a student, no run yet); it wins over ok */
  skip?: boolean;
}

/** what a repair says it did */
export interface RepairResult {
  ok: boolean;
  detail: string;
}

/** what the order reads of a node */
export interface GraphNode {
  id: string;
  dependsOn: readonly string[];
}

/**
 * One assumption. L is the edition's layer, F its fix (the browser's action name, VS Code's command);
 * an edition's own node type extends this one with its documentation, which the engine never reads.
 */
export interface DiagNode<C = unknown, L extends string = string, F = never> extends GraphNode {
  title: string;
  layer: L;
  check(ctx: C): Promise<CheckResult> | CheckResult;
  /** a safe automatic repair, run only when the run asks for repairs; omitted when only a person can fix it */
  repair?(ctx: C): Promise<RepairResult> | RepairResult;
  /** the edition's words for the fix a person must do, copied into a failure's report */
  manualFix: string;
  /** the button that starts that fix, copied into a failure's report */
  fix?: F;
  /** a check too costly for a quick sweep (a shell opened, a probe read): it runs only in a full run */
  slow?: boolean;
}

export const NODE_STATUSES = ['ok', 'warn', 'fail', 'repaired', 'blocked', 'skipped'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

/**
 * When the engine, not the check, decided a node's first verdict: `dependency-failed` (blocked: a
 * dependency failed or is blocked), `dependency-skipped` (skipped: a dependency was), `full-run-only`
 * (skipped: a slow check in a quick run) and `crashed` (failed: the check threw, the edition's guard
 * refused it, or it answered with no verdict). Absent when the check's own verdict stands.
 */
export const REASONS = ['dependency-failed', 'dependency-skipped', 'full-run-only', 'crashed'] as const;
export type Reason = (typeof REASONS)[number];

/**
 * How a repair went: `repaired` (it worked and the check passes now), `failed` (it said it could not),
 * `still-fails` (it said it worked and the check still fails), `crashed` (it threw, or answered with
 * no result) and `recheck-crashed` (it worked and the check after it threw). The text in `repair` is
 * the same for the last two, as both editions wrote it; the code tells them apart.
 */
export const REPAIR_OUTCOMES = ['repaired', 'failed', 'still-fails', 'crashed', 'recheck-crashed'] as const;
export type RepairOutcome = (typeof REPAIR_OUTCOMES)[number];

export interface NodeReport<L extends string = string, F = never> {
  id: string;
  title: string;
  layer: L;
  status: NodeStatus;
  /** the check's own detail, or the edition's words for what the engine decided */
  detail: string;
  reason?: Reason;
  /** blocked and dependency-skipped nodes: the dependency that decided, the first in dependsOn's order */
  waitsOn?: string;
  /** blocked nodes: the failing ancestor that is the real cause */
  rootCause?: string;
  /** what the repair said it did, or the edition's words for its crash */
  repair?: string;
  repairOutcome?: RepairOutcome;
  manualFix?: string;
  fix?: F;
  /** how long the first check took, by the edition's clock; 0 without one and for a check not run */
  ms: number;
}

export interface DiagReport<L extends string = string, F = never> {
  /** when the run began, by the edition's clock, as an ISO 8601 UTC time; '' without a clock */
  started: string;
  finished: string;
  /** every node, in the order it ran */
  reports: NodeReport<L, F>[];
  /** the failing nodes, whose dependencies all passed: the things to fix */
  rootCauses: NodeReport<L, F>[];
  ok: boolean;
}

/** a node as the edition's words name it */
export interface NodeName {
  id: string;
  title: string;
}

/**
 * The edition's words for what the engine decided. Each edition writes its own (the browser quotes a
 * title where VS Code does not); a word left out gives what the edition already said, never base's:
 * the empty string for the three skips and blocks, the thrown text for a crash, the check's detail
 * after a repair.
 */
export interface DiagWords {
  /** blocked: `on` failed or is blocked */
  blocked(on: NodeName): string;
  /** skipped because `on` was skipped */
  notApplicable(on: NodeName): string;
  /** a slow check left out of a quick run */
  fullRunOnly(): string;
  /** the check threw or the guard refused it; `message` is the thrown text, '' when it had none */
  crashed(message: string): string;
  /** the repair worked: `now` is the check's detail after it, `was` before */
  repaired(now: string, was: string): string;
  /** the repair said it worked, and the check after it still fails */
  stillFails(was: string, repair: string, again: string): string;
  /** the repair, or the check after it, threw */
  repairCrashed(message: string): string;
}

export const GUARD_PHASES = ['check', 'repair', 'recheck'] as const;
export type GuardPhase = (typeof GUARD_PHASES)[number];

/** the call a guard wraps: the node, and whether it is its check, its repair or the check after the repair */
export interface GuardStep {
  id: string;
  title: string;
  phase: GuardPhase;
}

export interface RunOpts<L extends string = string, F = never> {
  /** run each failing node's safe repair, then its check again */
  repair?: boolean;
  /** the quick sweep: slow checks are skipped */
  quick?: boolean;
  /** the edition's clock, milliseconds since the epoch (Date.now); without it no time is recorded */
  now?(): number;
  /**
   * Wraps each call to a check or a repair: the edition's time limit lives here, since it needs a
   * timer. A rejection counts as the call's crash, its message as the thrown text. Without a guard a
   * call that never answers holds the run.
   */
  guard?(work: () => Promise<unknown>, step: GuardStep): Promise<unknown>;
  words?: Partial<DiagWords>;
  /** each node's report as it is made, with how many are done of how many */
  onNode?(r: NodeReport<L, F>, done: number, total: number): void;
}

/**
 * A graph the engine refuses, found before any check runs: `duplicate` (two nodes share an id),
 * `unknown` (a node depends on an id no node has) and `cycle` (the ids from the first node met twice
 * on a dependency path back to itself, e.g. ['a', 'b', 'a']; ['a', 'a'] for a node that depends on
 * itself). All three are bugs in the edition's graph, which its own test of the graph catches.
 */
export type GraphProblem = { code: 'duplicate'; id: string } | { code: 'unknown'; id: string; dependency: string } | { code: 'cycle'; cycle: string[] };

/** what order and runDiagnostics throw for a graph with a problem; its message holds only the code and ids */
export class GraphError extends Error {
  readonly problem: GraphProblem;

  constructor(problem: GraphProblem) {
    super(`diagnostics graph ${problem.code}: ${idsOf(problem).join(' -> ')}`);
    this.name = 'GraphError';
    this.problem = problem;
  }
}

function idsOf(p: GraphProblem): string[] {
  if (p.code === 'cycle') return p.cycle;
  return p.code === 'unknown' ? [p.id, p.dependency] : [p.id];
}

/**
 * The one walk behind graphProblem and order, so that what one accepts the other orders. It looks for
 * duplicates first, then unknown dependencies, then cycles, each time in the list's order and each
 * node's dependsOn order, so the same list always names the same problem. The order is the depth-first
 * post-order both editions used: dependencies first, otherwise the list's order, so a list whose every
 * dependency is earlier comes back unchanged. Iterative, so a long chain cannot overflow the stack.
 */
function walk<N extends GraphNode>(nodes: readonly N[]): { order: N[] } | { problem: GraphProblem } {
  const byId = new Map<string, N>();
  for (const n of nodes) {
    if (byId.has(n.id)) return { problem: { code: 'duplicate', id: n.id } };
    byId.set(n.id, n);
  }
  for (const n of nodes) {
    for (const d of n.dependsOn) if (!byId.has(d)) return { problem: { code: 'unknown', id: n.id, dependency: d } };
  }
  const out: N[] = [];
  const done = new Set<string>();
  for (const root of nodes) {
    if (done.has(root.id)) continue;
    // each frame: a node on the current path, and the next of its dependencies to visit
    const path: Array<{ node: N; next: number }> = [{ node: root, next: 0 }];
    const open = new Set<string>([root.id]);
    while (path.length > 0) {
      const top = path[path.length - 1] as { node: N; next: number };
      if (top.next >= top.node.dependsOn.length) {
        path.pop();
        open.delete(top.node.id);
        done.add(top.node.id);
        out.push(top.node);
        continue;
      }
      const d = top.node.dependsOn[top.next] as string;
      top.next += 1;
      if (done.has(d)) continue;
      if (open.has(d)) {
        const ids = path.map((f) => f.node.id);
        return { problem: { code: 'cycle', cycle: [...ids.slice(ids.indexOf(d)), d] } };
      }
      open.add(d);
      path.push({ node: byId.get(d) as N, next: 0 });
    }
  }
  return { order: out };
}

/** what is wrong with a graph, or undefined when the engine can run it; never throws */
export function graphProblem(nodes: readonly GraphNode[]): GraphProblem | undefined {
  const w = walk(nodes);
  return 'problem' in w ? w.problem : undefined;
}

/** the nodes in the order a run takes them; throws GraphError for a graph with a problem */
export function order<N extends GraphNode>(nodes: readonly N[]): N[] {
  const w = walk(nodes);
  if ('problem' in w) throw new GraphError(w.problem);
  return w.order;
}

/**
 * The edition's words, each called on the object the edition gave (so its own `this` holds), and for a
 * word it left out what it already said, never base's own (see DiagWords).
 */
function wordsOf(given: Partial<DiagWords> | undefined): DiagWords {
  const g = given ?? {};
  return {
    blocked: (on) => (g.blocked ? g.blocked(on) : ''),
    notApplicable: (on) => (g.notApplicable ? g.notApplicable(on) : ''),
    fullRunOnly: () => (g.fullRunOnly ? g.fullRunOnly() : ''),
    crashed: (message) => (g.crashed ? g.crashed(message) : message),
    repaired: (now, was) => (g.repaired ? g.repaired(now, was) : now),
    stillFails: (was, repair, again) => (g.stillFails ? g.stillFails(was, repair, again) : was),
    repairCrashed: (message) => (g.repairCrashed ? g.repairCrashed(message) : message),
  };
}

/** the text of what a check or a repair threw: an Error's message, a thrown string, else '' */
function messageOf(e: unknown): string {
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') return e.message;
  return '';
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** a check's answer as a verdict, or undefined when it gave none (counted as a crash, so one bad check fails alone) */
function verdictOf(v: unknown): CheckResult | undefined {
  if (!isObject(v) || typeof v.ok !== 'boolean') return undefined;
  return { ok: v.ok, detail: typeof v.detail === 'string' ? v.detail : '', warn: v.warn === true, skip: v.skip === true };
}

function repairOf(v: unknown): RepairResult | undefined {
  if (!isObject(v) || typeof v.ok !== 'boolean') return undefined;
  return { ok: v.ok, detail: typeof v.detail === 'string' ? v.detail : '' };
}

/** one call through the edition's guard; a throw, a rejection or a throw before the first await is caught alike */
async function call(work: () => unknown, step: GuardStep, opts: Pick<RunOpts, 'guard'>): Promise<{ value: unknown } | { thrown: string }> {
  const run = async (): Promise<unknown> => work();
  try {
    return { value: await (opts.guard ? opts.guard(run, step) : run()) };
  } catch (e) {
    return { thrown: messageOf(e) };
  }
}

/** the edition's clock read, or undefined without one or when it gives no finite time */
function timeOf(opts: Pick<RunOpts, 'now'>): number | undefined {
  const t = opts.now ? opts.now() : undefined;
  return t !== undefined && Number.isFinite(t) ? t : undefined;
}

// the range of times an ECMAScript Date holds, in milliseconds either side of the epoch
const DATE_RANGE_MS = 8.64e15;

/** an ISO 8601 UTC time by the edition's clock; this formats its number and reads no clock itself */
function stamp(opts: Pick<RunOpts, 'now'>): string {
  const t = timeOf(opts);
  return t !== undefined && Math.abs(t) <= DATE_RANGE_MS ? new Date(t).toISOString() : '';
}

async function runNode<C, L extends string, F>(
  n: DiagNode<C, L, F>,
  ctx: C,
  opts: RunOpts<L, F>,
  words: DiagWords,
  byId: Map<string, NodeReport<L, F>>,
): Promise<NodeReport<L, F>> {
  const named = { id: n.id, title: n.title, layer: n.layer };
  // every dependency ran before this node (order), so each has a report
  const deps = n.dependsOn.map((d) => byId.get(d) as NodeReport<L, F>);
  const bad = deps.find((d) => d.status === 'fail' || d.status === 'blocked');
  if (bad) {
    const on = { id: bad.id, title: bad.title };
    return { ...named, status: 'blocked', detail: words.blocked(on), reason: 'dependency-failed', waitsOn: bad.id, rootCause: bad.rootCause ?? bad.id, ms: 0 };
  }
  const skipped = deps.find((d) => d.status === 'skipped');
  if (skipped) {
    const on = { id: skipped.id, title: skipped.title };
    return { ...named, status: 'skipped', detail: words.notApplicable(on), reason: 'dependency-skipped', waitsOn: skipped.id, ms: 0 };
  }
  if (opts.quick && n.slow) return { ...named, status: 'skipped', detail: words.fullRunOnly(), reason: 'full-run-only', ms: 0 };

  const step = (phase: GuardPhase): GuardStep => ({ id: n.id, title: n.title, phase });
  const t0 = timeOf(opts);
  const got = await call(() => n.check(ctx), step('check'), opts);
  const t1 = timeOf(opts);
  const ms = t0 !== undefined && t1 !== undefined ? Math.max(0, t1 - t0) : 0;
  const answered = 'value' in got ? verdictOf(got.value) : undefined;
  const c: CheckResult = answered ?? { ok: false, detail: words.crashed('thrown' in got ? got.thrown : '') };
  const crashed = answered === undefined ? { reason: 'crashed' as const } : {};

  if (c.skip) return { ...named, status: 'skipped', detail: c.detail, ms };
  if (c.ok) return { ...named, status: c.warn ? 'warn' : 'ok', detail: c.detail, ms };
  const r: NodeReport<L, F> = { ...named, status: 'fail', detail: c.detail, ...crashed, manualFix: n.manualFix, ...(n.fix !== undefined ? { fix: n.fix } : {}), ms };
  if (!opts.repair || !n.repair) return r;

  const rp = await call(() => n.repair?.(ctx), step('repair'), opts);
  const done = 'value' in rp ? repairOf(rp.value) : undefined;
  if (!done) return { ...r, repair: words.repairCrashed('thrown' in rp ? rp.thrown : ''), repairOutcome: 'crashed' };
  if (!done.ok) return { ...r, repair: done.detail, repairOutcome: 'failed' };
  const again = await call(() => n.check(ctx), step('recheck'), opts);
  const a = 'value' in again ? verdictOf(again.value) : undefined;
  if (!a) return { ...r, repair: words.repairCrashed('thrown' in again ? again.thrown : ''), repairOutcome: 'recheck-crashed' };
  // the check after a repair is judged by ok alone, as both editions did
  if (a.ok) return { ...r, status: 'repaired', detail: words.repaired(a.detail, c.detail), repair: done.detail, repairOutcome: 'repaired' };
  return { ...r, detail: words.stillFails(c.detail, done.detail, a.detail), repair: done.detail, repairOutcome: 'still-fails' };
}

/**
 * Runs every node once, in order, one at a time. A graph with a problem is refused (GraphError)
 * before any check runs. A check that throws, is refused by the guard or answers with no verdict
 * fails alone, as `crashed`; the run itself rejects only for a bad graph or a throw from the edition's
 * own words, clock or onNode.
 */
export async function runDiagnostics<C, L extends string = string, F = never>(
  nodes: readonly DiagNode<C, L, F>[],
  ctx: C,
  opts: RunOpts<L, F> = {},
): Promise<DiagReport<L, F>> {
  const started = stamp(opts);
  const ordered = order(nodes);
  const words = wordsOf(opts.words);
  const byId = new Map<string, NodeReport<L, F>>();
  const reports: NodeReport<L, F>[] = [];
  for (const n of ordered) {
    const r = await runNode(n, ctx, opts, words, byId);
    byId.set(n.id, r);
    reports.push(r);
    opts.onNode?.(r, reports.length, ordered.length);
  }
  const rootCauses = reports.filter((r) => r.status === 'fail');
  return { started, finished: stamp(opts), reports, rootCauses, ok: rootCauses.length === 0 };
}
