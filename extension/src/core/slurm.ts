// Parsing of Slurm output and rendering of the few Slurm commands the laptop issues.
// The grid-side CLI (grid/bin/beethoven) does the real work; these helpers keep the laptop
// side to one layer of quoting (a lesson written down in Student_Projects/tools/grid.sh).
import { checkWorkerName } from './protocol';

export interface SqueueRow {
  jobId: string;
  name: string;
  state: string;
  node: string;
  elapsed: string;
  timeLimit: string;
  partition: string;
  reason: string;
}

/** Format string we always pass: squeue -h -o '%i|%j|%T|%N|%M|%l|%P|%R' */
export const SQUEUE_FORMAT = '%i|%j|%T|%N|%M|%l|%P|%R';

export function parseSqueue(text: string): SqueueRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [jobId, name, state, node, elapsed, timeLimit, partition, ...rest] = l.split('|');
      return {
        jobId: jobId ?? '',
        name: name ?? '',
        state: state ?? '',
        node: node === '(null)' ? '' : node ?? '',
        elapsed: elapsed ?? '',
        timeLimit: timeLimit ?? '',
        partition: partition ?? '',
        reason: rest.join('|'),
      };
    })
    .filter((r) => /^\d+/.test(r.jobId));
}

export function parseSbatchId(text: string): string | null {
  const m = /Submitted batch job (\d+)/.exec(text) ?? /^(\d+)(?:;|$)/m.exec(text.trim());
  return m ? m[1] : null;
}

export interface WorkerJobSpec {
  name: string;
  partition: string;
  qos: 'requeue' | 'primary' | 'secondary' | 'gpu';
  hours: number;
  cpus: number;
  memory: string;
  gpus: number;
  concurrency: number;
  /** A shared-library container name; empty = the account's configured container. */
  container?: string;
}

// The grid writes every one of these into the job script with sed, and the job's shell runs it: the values
// can come from a workspace's settings or the laptop's Claude, so only plain words and numbers pass (the grid
// checks the same in cmd_worker).
const SLURM_WORD = /^[A-Za-z0-9_-]+$/;
const PARTITIONS = /^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$/;
const MEMORY = /^[0-9]+[KMGTkmgt]?$/;
const LIBRARY_NAME = /^[A-Za-z0-9_.-]+$/;
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Arguments for `beethoven worker start` on the grid; the grid CLI renders the sbatch file. Throws on a value
 *  the grid would refuse. */
export function workerStartArgs(s: WorkerJobSpec): string[] {
  checkWorkerName(s.name);
  if (!isCount(s.hours) || s.hours < 1) throw new Error('hours must be a whole number, 1 or more');
  if (!isCount(s.cpus) || s.cpus < 1) throw new Error('cpus must be a whole number, 1 or more');
  if (!isCount(s.gpus)) throw new Error('gpus must be a whole number');
  if (!isCount(s.concurrency) || s.concurrency < 1) throw new Error('concurrency must be a whole number, 1 or more');
  if (typeof s.memory !== 'string' || !MEMORY.test(s.memory)) throw new Error('memory must be a number with an optional K, M, G or T, like 16G');
  if (s.container && !LIBRARY_NAME.test(s.container)) throw new Error('the container must be a name from the lab library');
  if (s.gpus === 0 && (typeof s.partition !== 'string' || !PARTITIONS.test(s.partition))) throw new Error('the partition must be partition names separated by commas');
  if (s.gpus === 0 && (typeof s.qos !== 'string' || !SLURM_WORD.test(s.qos))) throw new Error('the qos must be letters, digits, - and _ only');
  const args = [
    'worker', 'start',
    '--name', s.name,
    '--hours', String(s.hours),
    '--cpus', String(s.cpus),
    '--mem', s.memory,
    '--concurrency', String(s.concurrency),
  ];
  if (s.container) args.push('--container', s.container);
  if (s.gpus > 0) {
    args.push('--gpus', String(s.gpus), '--partition', 'gmsap,gvohp,galhp', '--qos', 'gpu');
  } else {
    args.push('--partition', s.partition, '--qos', s.qos);
  }
  return args;
}

/** Human summary of a wall-time string like 1-00:00:00 or 04:00:00. */
export function describeWall(limit: string): string {
  const m = /^(?:(\d+)-)?(\d+):(\d+)(?::(\d+))?$/.exec(limit);
  if (!m) return limit;
  const d = parseInt(m[1] ?? '0', 10);
  const h = parseInt(m[2], 10) + d * 24;
  return h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h} h ${m[3]} min`;
}
