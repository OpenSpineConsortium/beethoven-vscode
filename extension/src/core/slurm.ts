// Parsing of Slurm output and rendering of the few Slurm commands the laptop issues.
// The grid-side CLI (grid/bin/ashley) does the real work; these helpers keep the laptop
// side to one layer of quoting (a lesson written down in Student_Projects/tools/grid.sh).

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
}

/** Arguments for `ashley worker start` on the grid; the grid CLI renders the sbatch file. */
export function workerStartArgs(s: WorkerJobSpec): string[] {
  const args = [
    'worker', 'start',
    '--name', s.name,
    '--hours', String(s.hours),
    '--cpus', String(s.cpus),
    '--mem', s.memory,
    '--concurrency', String(s.concurrency),
  ];
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
