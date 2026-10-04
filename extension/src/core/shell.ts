// Process helpers with one rule: never build a command line by string concatenation for a
// local process. spawn() with an argv array means no local quoting. The ONLY string we
// ever quote is the remote command handed to ssh, and that is done once, here, with POSIX
// single quotes. (Student_Projects/tools/grid.sh records why: every multi-layer quoting
// attempt through wsl -> ssh -> heredoc got mangled.)
import { spawn, SpawnOptions } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  command: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  /** Called with each stdout chunk as it arrives (for live event streams). */
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const so: SpawnOptions = {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    let child;
    if (OPENSSH_TOOLS.has(cmd)) cmd = resolveExecutable(cmd);
    try {
      child = spawn(cmd, args, so);
    } catch (e) {
      resolve({ code: 127, signal: null, stdout: '', stderr: String(e), timedOut: false, command: describe(cmd, args) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, opts.timeoutMs)
      : undefined;
    opts.signal?.addEventListener('abort', () => child.kill());
    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString('utf8');
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 127, signal: null, stdout, stderr: stderr + String(e), timedOut, command: describe(cmd, args) });
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut, command: describe(cmd, args) });
    });
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    } else {
      child.stdin?.end();
    }
  });
}

export function describe(cmd: string, args: string[]): string {
  return [cmd, ...args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a))].join(' ');
}

/** POSIX single-quote for the remote side of ssh. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function shjoin(args: string[]): string {
  return args.map(shq).join(' ');
}

/** A remote path: a leading '~/' stays unquoted so the remote shell expands it; the rest is quoted. */
export function remotePath(p: string): string {
  if (p === '~') return '~';
  return p.startsWith('~/') ? '~/' + shq(p.slice(2)) : shq(p);
}

/**
 * The remote command line for an argv: every argument quoted once, with a leading '~/' left
 * unquoted in EVERY argument (not only the first). A quoted '~/x' is a literal folder named '~':
 * `mkdir -p '~/.ashley/bin'` made exactly that on the grid on 2026-09-27 (the folder's name before the rename).
 * Nothing else is expanded: pass `$USER` and the like through ['bash', '-c', '...'].
 */
export function renderRemote(args: string[]): string {
  return args.map(remotePath).join(' ');
}

/**
 * The OpenSSH tools, found the way Remote-SSH finds them. On Windows a bare 'ssh' resolves by PATH,
 * where Git's usr/bin ssh (different config, different home) can come first; System32\OpenSSH is
 * the one the wizard configures. Elsewhere PATH is right.
 */
export function resolveExecutable(command: string): string {
  if (command.includes('/') || command.includes('\\')) return command;
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot ?? 'C:\\Windows';
    const candidates: Record<string, string[]> = {
      ssh: [`${sys}\\System32\\OpenSSH\\ssh.exe`],
      scp: [`${sys}\\System32\\OpenSSH\\scp.exe`],
      'ssh-keygen': [`${sys}\\System32\\OpenSSH\\ssh-keygen.exe`],
    };
    for (const c of candidates[command] ?? []) if (fs.existsSync(c)) return c;
    return command.endsWith('.exe') ? command : `${command}.exe`;
  }
  return command;
}
const OPENSSH_TOOLS = new Set(['ssh', 'scp', 'ssh-keygen']);

// Repeated on every call so they hold even when the student's config lacks our block
// (the alias itself must still resolve, so the block is not optional).
export const SSH_BATCH_OPTS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'MACs=+hmac-sha1', '-o', 'AddressFamily=inet', '-o', 'GSSAPIAuthentication=no'];

/**
 * Run a command on the grid. `remoteArgs` is an argv on the remote side; it is quoted once.
 * Example: ssh('wsu-grid', gridCli(['status'])).
 * A leading '~/' in any argument is left unquoted so the remote shell expands it (renderRemote).
 */
export function ssh(alias: string, remoteArgs: string[], opts: RunOptions = {}): Promise<RunResult> {
  return run('ssh', [...SSH_BATCH_OPTS, alias, '--', renderRemote(remoteArgs)], { timeoutMs: 120_000, ...opts });
}

/** The folder in the grid account and the grid command, since the rename (4.0.0). */
export const GRID_HOME = '~/.beethoven';
export const GRID_CLI = '~/.beethoven/bin/beethoven';
/**
 * Picks the grid command: ~/.beethoven/bin/beethoven, or ~/.ashley/bin/ashley on an account whose grid
 * install predates the rename (kept so such an account answers, and is offered the update, instead of
 * looking "not installed"; the next grid install moves the folder). No double quotes, so the line passes
 * through Windows argument quoting unchanged; $HOME holds no spaces on the grid.
 * Before the command it puts an empty `disabled` file beside an API key a build up to 4.0.0 stored, the
 * one switch a worker still running grid scripts 7 honours: a laptop updated to 5.0.0 talks to such a
 * grid until the grid step runs, and its first contact must already stop that worker spending on the
 * key. It deletes nothing.
 */
const GRID_CLI_PICK = 'b=$HOME/.beethoven/bin/beethoven; [ -x $b ] || b=$HOME/.ashley/bin/ashley; k=${b%/bin/*}/accounts/apikey; [ ! -e $k/apikey ] || [ -e $k/disabled ] || touch $k/disabled 2>/dev/null; exec $b';
/**
 * Sets $h to the grid folder: ~/.beethoven, or ~/.ashley on an account the rename has not moved yet.
 * Files the laptop writes (license, tokens) go where that account's grid command reads them.
 */
export const GRID_HOME_PICK = 'h=$HOME/.beethoven; [ -d $h ] || [ ! -d $HOME/.ashley ] || h=$HOME/.ashley;';
/** The remote argv for ssh(): the grid command with these arguments (stdin and the exit code pass through). */
export function gridCli(args: string[]): string[] {
  return ['bash', '-c', `${GRID_CLI_PICK} "$@"`, 'beethoven', ...args];
}
/** The same as one remote command line, for `ssh -t <alias> <line>` in a terminal and for the relay. */
export function gridCliLine(args: string[]): string {
  return [GRID_CLI_PICK, ...args.map(shq)].join(' ');
}

/** scp local files to a remote directory (files are given explicitly: no globbing on Windows). */
export function scp(alias: string, localFiles: string[], remoteDir: string, opts: RunOptions = {}): Promise<RunResult> {
  return run('scp', ['-q', ...SSH_BATCH_OPTS, ...localFiles, `${alias}:${remoteDir}`], { timeoutMs: 120_000, ...opts });
}

export function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') return path.join(os.homedir(), p.slice(1));
  return p;
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

/** Is an executable reachable on PATH? Resolved by trying to run it. */
export async function which(cmd: string, versionArg = '--version'): Promise<{ ok: boolean; output: string }> {
  const r = await run(cmd, [versionArg], { timeoutMs: 15_000 });
  return { ok: r.code === 0 || (r.code !== 127 && (r.stdout + r.stderr).length > 0), output: (r.stdout + r.stderr).trim() };
}

export async function wslAvailable(): Promise<boolean> {
  if (!isWindows()) return false;
  const r = await run('wsl.exe', ['-e', 'true'], { timeoutMs: 20_000 });
  return r.code === 0;
}

/** Run a bash command line inside WSL (used only to mirror ssh setup; one layer of quoting). */
export function wslBash(script: string, opts: RunOptions = {}): Promise<RunResult> {
  return run('wsl.exe', ['-e', 'bash', '-lc', script], { timeoutMs: 60_000, ...opts });
}

/** Windows path -> /mnt/c/... for WSL. */
export function toWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}
