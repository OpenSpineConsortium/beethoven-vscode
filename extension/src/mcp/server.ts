// MCP server that the Claude Code extension launches as a child process. It gives the
// local Claude a small, typed set of tools for the Wayne State grid: check status, start a
// worker, send a prompt to the worker Claude and wait for its answer, read small files,
// submit a job script. Everything goes over `ssh <alias>`; nothing here needs the grid's
// password, and nothing heavy runs on the login node.
//
// Configuration comes from the environment Claude Code passes:
//   BEETHOVEN_GRID        ssh alias (default wsu-grid)
//   BEETHOVEN_WORKER      default worker name (default "default")
// (ASHLEY_GRID and ASHLEY_WORKER, the names before the rename, are still read.)
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as os from 'node:os';
import { GridApi } from '../core/gridApi';
import { GridRelay } from '../core/relay';
import { PermissionMode, REQUEST_ID, WORKER_NAME } from '../core/protocol';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { checkLicense, readIdentity, unlicensedMessage } from '../core/license';
import { readTermsRecord, TERMS_REFUSAL } from '../core/terms';

const alias = process.env.BEETHOVEN_GRID || process.env.ASHLEY_GRID || 'wsu-grid';
const defaultWorker = process.env.BEETHOVEN_WORKER || process.env.ASHLEY_WORKER || 'default';
// One relay session for the life of this server: prompts cost a network round trip, not an ssh handshake.
const relay = new GridRelay(alias, { onStatus: (s, d) => process.stderr.write(`relay ${s} ${d ?? ''}\n`) });
const grid = new GridApi(alias, (l) => process.stderr.write(l + '\n'), relay);
process.on('exit', () => relay.close());

const server = new McpServer({ name: 'beethoven', version: process.env.BEETHOVEN_VERSION ?? 'dev' });

// Every tool refuses without a valid license on this computer, checked on each call (a key entered
// or renewed in VS Code takes effect at once). The identity is the Wayne State sign-in the extension recorded.
function bundledRevoked(): string {
  try {
    return fs.readFileSync(path.join(__dirname, '..', 'media', 'revoked.txt'), 'utf8');
  } catch {
    return '';
  }
}
function licenseRefusal(): string | null {
  if (!readTermsRecord()) return TERMS_REFUSAL;
  const c = checkLicense({ identity: readIdentity(), bundledRevoked: bundledRevoked() });
  if (!c.ok) return unlicensedMessage(c);
  if (c.identity === null) return 'Beethoven is licensed on this computer, but the setup is not finished: run the Beethoven setup in VS Code (Sign in with Wayne State).';
  return null;
}
const registerTool = server.registerTool.bind(server);
(server as unknown as { registerTool: (name: unknown, def: unknown, handler: (...a: unknown[]) => unknown) => unknown }).registerTool = (name: unknown, def: unknown, handler: (...a: unknown[]) => unknown) =>
  registerTool(name as never, def as never, (async (...a: unknown[]) => {
    const refusal = licenseRefusal();
    if (refusal) return { content: [{ type: 'text' as const, text: refusal }], isError: true };
    return handler(...a);
  }) as never);

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

server.registerTool(
  'beethoven_status',
  {
    title: 'Grid status',
    description:
      'Status of the Wayne State grid for this student: whether Beethoven is installed and ready, running Slurm jobs, Claude workers (node, queue, accounts), home quota. Call this first.',
    inputSchema: {},
  },
  async () => text(JSON.stringify(await grid.status(), null, 2)),
);

server.registerTool(
  'beethoven_workers',
  { title: 'List Claude workers', description: 'List the persistent Claude Code workers (Slurm jobs) and their heartbeat state.', inputSchema: {} },
  async () => text(JSON.stringify(await grid.workers(), null, 2)),
);

server.registerTool(
  'beethoven_worker_start',
  {
    title: 'Start a Claude worker',
    description:
      'Submit a Slurm job that runs a persistent Claude Code worker in a Singularity container. Returns the job id; the worker is usable once its state is idle (see beethoven_workers). Use a GPU only when the work needs one.',
    inputSchema: {
      name: z.string().regex(WORKER_NAME, 'letters, digits, - and _ only').default('default').describe('worker name'),
      hours: z.number().int().min(1).max(720).default(24),
      cpus: z.number().int().min(1).max(64).default(4),
      memory: z.string().regex(/^[0-9]+[KMGTkmgt]?$/, 'a number with an optional K, M, G or T, like 16G').default('16G'),
      gpus: z.number().int().min(0).max(4).default(0),
      qos: z.enum(['requeue', 'primary', 'secondary']).default('requeue').describe('requeue = shared pool, may be requeued (worker resumes); primary = dedicated'),
      concurrency: z.number().int().min(1).max(8).default(2),
    },
  },
  async (a) => {
    const r = await grid.workerStart({ name: a.name, hours: a.hours, cpus: a.cpus, memory: a.memory, gpus: a.gpus, qos: a.qos, partition: 'reqp', concurrency: a.concurrency });
    return text(r.message);
  },
);

server.registerTool(
  'beethoven_ask',
  {
    title: 'Ask the grid Claude (wait for the answer)',
    description:
      'Send a prompt to the persistent Claude Code worker on the grid and wait for its answer. The worker runs with the student\'s own Claude subscription, in the given working directory on the grid, and can read/write files, run Python, submit Slurm jobs, download data. Use a session name to continue a conversation later. Long tasks: set timeout_sec high, or use beethoven_send and fetch with beethoven_result.',
    inputSchema: {
      prompt: z.string().describe('what the grid Claude should do'),
      session: z.string().default('default').describe('conversation to continue (resumable by name)'),
      cwd: z.string().optional().describe('working directory on the grid, e.g. ~/Student_Projects/projects/me. Sessions stay bound to their cwd.'),
      mode: z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions']).default('acceptEdits'),
      max_turns: z.number().int().min(1).max(500).default(50),
      timeout_sec: z.number().int().min(10).max(86400).default(1800),
      worker: z.string().regex(WORKER_NAME, 'letters, digits, - and _ only').default(defaultWorker),
      model: z.string().optional(),
    },
  },
  async (a) => {
    const r = await grid.ask(
      { prompt: a.prompt, session: a.session, cwd: a.cwd, mode: a.mode as PermissionMode, max_turns: a.max_turns, model: a.model, from: `mcp@${os.hostname()}` },
      a.worker,
      a.timeout_sec,
    );
    const head = `[${r.status}] request ${r.id} session=${r.session} account=${r.account ?? '?'} turns=${r.num_turns ?? '?'} ${r.duration_ms ? Math.round(r.duration_ms / 1000) + 's' : ''}`;
    return text(`${head}\n\n${r.result || r.error || ''}${r.retry_after ? `\n\nretry after ${r.retry_after}` : ''}`);
  },
);

server.registerTool(
  'beethoven_send',
  {
    title: 'Queue a prompt for the grid Claude (do not wait)',
    description: 'Queue a prompt for the worker and return the request id at once. Fetch the answer later with beethoven_result.',
    inputSchema: {
      prompt: z.string(),
      session: z.string().default('default'),
      cwd: z.string().optional(),
      mode: z.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions']).default('acceptEdits'),
      max_turns: z.number().int().min(1).max(500).default(50),
      worker: z.string().regex(WORKER_NAME, 'letters, digits, - and _ only').default(defaultWorker),
    },
  },
  async (a) => {
    const r = await grid.send({ prompt: a.prompt, session: a.session, cwd: a.cwd, mode: a.mode as PermissionMode, max_turns: a.max_turns, from: `mcp@${os.hostname()}` }, a.worker);
    return text(`queued request ${r.id} on worker ${a.worker}. ${r.message}`);
  },
);

server.registerTool(
  'beethoven_result',
  {
    title: 'Fetch a queued answer',
    description: 'Return the result of a request queued with beethoven_send, or say it is not finished yet.',
    inputSchema: { id: z.string().regex(REQUEST_ID, 'the id beethoven_send returned'), worker: z.string().regex(WORKER_NAME, 'letters, digits, - and _ only').default(defaultWorker) },
  },
  async (a) => {
    const r = await grid.result(a.id, a.worker);
    // without cost_usd: a list-price estimate that reads like a bill, and on the subscription it is none
    return text(r ? JSON.stringify({ ...r, cost_usd: undefined }, null, 2) : `request ${a.id} has no result yet`);
  },
);

server.registerTool(
  'beethoven_sessions',
  { title: 'List conversations', description: 'List the named, resumable conversations kept on the grid and the directory each is bound to.', inputSchema: {} },
  async () => text(JSON.stringify(await grid.sessions(), null, 2)),
);

server.registerTool(
  'beethoven_read_file',
  {
    title: 'Read a small file on the grid',
    description: 'Read up to max_bytes of a file in the student\'s grid home (logs, results, CSV heads). Reading is cheap on the login node; large data is not. A Claude sign-in folder, ~/.ssh and files named like a credential, key or token are never read, and credential-shaped text is removed.',
    inputSchema: { path: z.string(), max_bytes: z.number().int().min(1).max(2_000_000).default(200_000) },
  },
  async (a) => text((await grid.readFile(a.path, a.max_bytes)).text),
);

server.registerTool(
  'beethoven_list_dir',
  { title: 'List a directory on the grid', description: 'ls -la of a directory in the grid home (never inside a Claude sign-in folder or ~/.ssh).', inputSchema: { path: z.string() } },
  async (a) => text((await grid.listDir(a.path)).text),
);

server.registerTool(
  'beethoven_squeue',
  { title: 'My Slurm jobs', description: 'squeue for the student: job id, name, state, node, elapsed, limit, partition, reason.', inputSchema: {} },
  async () => text(JSON.stringify(await grid.squeue(), null, 2)),
);

server.registerTool(
  'beethoven_sbatch',
  {
    title: 'Submit a job script',
    description:
      'Run sbatch on a job script that already exists on the grid (a file in the repository, never an inline script). Returns the job id. The lab rule: Claude drafts, the student sees the script, then it is submitted.',
    inputSchema: { script: z.string().describe('path to the job script, relative to cwd'), cwd: z.string().describe('directory to submit from (SLURM_SUBMIT_DIR)'), extra_args: z.array(z.string()).default([]) },
  },
  async (a) => {
    const r = await grid.sbatch(a.script, a.cwd, a.extra_args);
    return text(r.message);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  process.stderr.write(`beethoven mcp server failed: ${e}\n`);
  process.exit(1);
});
