// `beethoven uninstall` on the grid takes away what `beethoven install` put in place and nothing else. Up to
// grid scripts 8 it removed all of ~/.beethoven, where the Claude sign-in hpcworker's workers use, the
// engine's sign-ins and account list and the session history live too, and --purge-root removed the work
// folder. `beethoven claude forget` deleted the sign-in. This runs the real script in a made-up home, under a
// pseudo-terminal from util-linux `script` (the grid's own), with a Slurm that only records what it is asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gridUninstallLine } from './shell';

const repo = path.resolve(__dirname, '..', '..', '..', '..'); // dist-test/unit/core -> repository root
const hasScript = process.platform === 'linux' && spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0;
const skip = hasScript ? false : 'needs bash and util-linux script, as on the grid';
const AGENT_MARKERS = ['CLAUDECODE', 'BEETHOVEN_REQUEST_ID', 'BEETHOVEN_WORKER', 'ASHLEY_REQUEST_ID', 'ASHLEY_WORKER'];

function lab() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-uninstall-'));
  const bh = path.join(h, '.beethoven');
  const root = path.join(h, 'work');
  const put = (rel: string, body = '') => {
    fs.mkdirSync(path.dirname(path.join(h, rel)), { recursive: true });
    fs.writeFileSync(path.join(h, rel), body);
  };
  // what install makes
  fs.mkdirSync(path.join(bh, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'grid', 'beethoven'), path.join(bh, 'bin', 'beethoven'));
  fs.chmodSync(path.join(bh, 'bin', 'beethoven'), 0o755); // as install leaves it
  fs.copyFileSync(path.join(repo, 'grid', 'VERSION'), path.join(bh, 'bin', 'VERSION'));
  put('.beethoven/config.env', `ROOT=${root}\n`);
  put('.beethoven/READY', '{"fake":true}\n');
  put('.beethoven/log/bootstrap_1.out', 'built\n');
  put('.beethoven/workers/w1/job.id', '123\n');
  fs.symlinkSync('.beethoven', path.join(h, '.ashley'));
  put('.bashrc', '# the student\'s own line\nalias ll="ls -l"\n# >>> beethoven (managed; "beethoven install" rewrites this block) >>>\nexport X=1\n# <<< beethoven <<<\n');
  // what is the student's, and other tools' in the same folder
  put('.beethoven/claude/.credentials.json', '{"fake":true}\n');
  put('.beethoven/claude/projects/-w/s1.jsonl', '{}\n');
  put('.beethoven/accounts/second/claude/.credentials.json', '{"fake":true}\n');
  fs.symlinkSync('../claude', path.join(bh, 'accounts', 'main'));
  put('.beethoven/engine/accounts.json', '{"accounts":[]}\n');
  put('.beethoven/projects/-w/s0.jsonl', '{}\n');
  put('.beethoven/sessions/1.json', '{}\n');
  put('.beethoven/secrets.env', 'GITHUB_TOKEN=x\n');
  put('work/workspaces/thesis/notes.md', 'mine\n');
  put('work/containers/node22-bookworm/usr/local/bin/node', '');
  // a Slurm that records what it is asked
  const fakeBin = path.join(h, 'fakebin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'scancel'), `#!/bin/sh\necho "$@" >> '${path.join(h, 'scancel.calls')}'\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'squeue'), '#!/bin/sh\necho RUNNING\n', { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: h, USER: os.userInfo().username, PATH: `${fakeBin}:${process.env.PATH}` };
  for (const k of [...AGENT_MARKERS, 'BEETHOVEN_HOME', 'ASHLEY_HOME']) delete env[k];
  const cli = path.join(bh, 'bin', 'beethoven');
  const quote = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
  return {
    h, bh, root, env,
    // under a pseudo-terminal, as a person at a terminal runs it
    tty: (args: string[], extra: NodeJS.ProcessEnv = {}) => {
      const r = spawnSync('script', ['-qec', ['bash', cli, ...args].map(quote).join(' '), '/dev/null'], { env: { ...env, ...extra }, encoding: 'utf8', input: '' });
      return { status: r.status, out: (r.stdout + r.stderr).replace(/\r/g, '') };
    },
    // over a pipe, as a non-interactive ssh or an agent runs it
    pipe: (args: string[], extra: NodeJS.ProcessEnv = {}) => {
      const r = spawnSync('bash', [cli, ...args], { env: { ...env, ...extra }, encoding: 'utf8', input: '' });
      return { status: r.status, out: r.stdout + r.stderr };
    },
    // Reset's own remote line (gridUninstallLine), as `ssh -t` runs it in the login shell
    line: () => {
      const r = spawnSync('script', ['-qec', ['bash', '-c', gridUninstallLine()].map(quote).join(' '), '/dev/null'], { env, encoding: 'utf8', input: '' });
      return { status: r.status, out: (r.stdout + r.stderr).replace(/\r/g, '') };
    },
    exists: (rel: string) => { try { fs.lstatSync(path.join(h, rel)); return true; } catch { return false; } },
  };
}

const THEIRS = ['.beethoven/claude/.credentials.json', '.beethoven/claude/projects/-w/s1.jsonl', '.beethoven/accounts/second/claude/.credentials.json', '.beethoven/accounts/main', '.beethoven/engine/accounts.json', '.beethoven/projects/-w/s0.jsonl', '.beethoven/sessions/1.json', '.beethoven/secrets.env', 'work/workspaces/thesis/notes.md', 'work/containers/node22-bookworm/usr/local/bin/node'];
const INSTALLED = ['.beethoven/bin', '.beethoven/config.env', '.beethoven/READY', '.beethoven/log', '.beethoven/workers'];

test('uninstall refuses without --yes, with --purge-root, without a terminal and inside an agent, and removes nothing', { skip }, () => {
  const l = lab();
  try {
    const cases: [string, { status: number | null; out: string }, RegExp][] = [
      ['no --yes', l.tty(['uninstall']), /your Claude sign-in, your other accounts, your session history and your work folder stay/],
      ['--purge-root', l.tty(['uninstall', '--yes', '--purge-root']), /your work folder is yours: Beethoven never deletes it/],
      ['--purge-root first', l.tty(['uninstall', '--purge-root', '--yes']), /never deletes it/],
      ['over a pipe', l.pipe(['uninstall', '--yes']), /without a terminal/],
      ...AGENT_MARKERS.map((k) => [`with ${k}`, l.tty(['uninstall', '--yes'], { [k]: '1' }), /inside a Claude Code session or worker/] as [string, { status: number | null; out: string }, RegExp]),
    ];
    for (const [what, r, want] of cases) {
      assert.notEqual(r.status, 0, `${what}: refused (${r.out})`);
      assert.match(r.out, want, what);
    }
    for (const rel of [...THEIRS, ...INSTALLED, '.ashley']) assert.ok(l.exists(rel), `${rel} is still there`);
    assert.equal(l.exists('scancel.calls'), false, 'no worker was stopped');
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('uninstall removes what install made and keeps the sign-ins, the accounts, the history and the work folder', { skip }, () => {
  const l = lab();
  try {
    const r = l.tty(['uninstall', '--yes']);
    assert.equal(r.status, 0, r.out);
    for (const rel of INSTALLED) assert.equal(l.exists(rel), false, `${rel} removed`);
    for (const rel of THEIRS) assert.ok(l.exists(rel), `${rel} kept`);
    assert.equal(fs.readFileSync(path.join(l.bh, 'claude', '.credentials.json'), 'utf8'), '{"fake":true}\n', 'the sign-in untouched');
    assert.ok(fs.lstatSync(path.join(l.bh, 'accounts', 'main')).isSymbolicLink(), 'the engine\'s link untouched');
    assert.ok(l.exists('.ashley'), 'the old name stays while the folder it leads to stays');
    assert.equal(fs.readFileSync(path.join(l.h, '.bashrc'), 'utf8'), '# the student\'s own line\nalias ll="ls -l"\n', 'only the block left .bashrc');
    assert.equal(fs.readFileSync(path.join(l.h, 'scancel.calls'), 'utf8').trim(), '123', 'the worker was stopped');
    assert.match(r.out, /kept in .*claude/);
    assert.match(r.out, /copies of your tokens and license key \(secrets\.env, license\.key\) stay until you delete them yourself/, 'says the token file stays for the student to delete');
    assert.doesNotMatch(r.out, /did not install/, 'never calls what install or the setup made someone else\'s');
    assert.match(r.out, /your work folder .* is untouched/);
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('uninstall of an install alone leaves no folder and no dangling old name', { skip }, () => {
  const l = lab();
  try {
    for (const rel of ['claude', 'accounts', 'engine', 'projects', 'sessions', 'secrets.env']) fs.rmSync(path.join(l.bh, rel), { recursive: true, force: true });
    const r = l.tty(['uninstall', '--yes']);
    assert.equal(r.status, 0, r.out);
    assert.equal(l.exists('.beethoven'), false, 'nothing of ours is left');
    assert.equal(l.exists('.ashley'), false, 'the old name led nowhere and went with it');
    assert.ok(l.exists('work/workspaces/thesis/notes.md'), 'the work folder stays');
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('claude forget refuses in one plain sentence and deletes nothing', { skip }, () => {
  const l = lab();
  try {
    for (const run of [l.tty(['claude', 'forget']), l.tty(['claude', 'forget', '--yes']), l.pipe(['claude', 'forget', '--yes'])]) {
      assert.notEqual(run.status, 0);
      assert.match(run.out, /Beethoven never deletes or signs out a Claude sign-in\. To sign out, run claude auth logout yourself on a compute node\./);
    }
    for (const rel of THEIRS) assert.ok(l.exists(rel), `${rel} kept`);
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('Reset\'s line uninstalls only through grid scripts 9 or later: older scripts, whose uninstall deletes the sign-in, are never run', { skip }, () => {
  // an older uninstall, by the version it reports: it only leaves a mark here, where grid scripts 7 and 8 removed all of ~/.beethoven
  const old = (version: string) => `#!/bin/bash\ncase "$1" in version) echo '${version}';; uninstall) touch "$HOME/old-uninstall-ran";; esac\n`;
  for (const [what, version, ashleyOnly] of [['grid scripts 8', '8', false], ['grid scripts 7', '7', false], ['a version of the 1.0.0 form', '1.0.0', false], ['an account never moved to ~/.beethoven, on Ashley\'s scripts', '6', true]] as const) {
    const l = lab();
    try {
      if (ashleyOnly) {
        fs.unlinkSync(path.join(l.h, '.ashley'));
        fs.rmSync(path.join(l.bh, 'bin'), { recursive: true, force: true });
        fs.mkdirSync(path.join(l.h, '.ashley', 'bin'), { recursive: true });
        fs.writeFileSync(path.join(l.h, '.ashley', 'bin', 'ashley'), old(version), { mode: 0o755 });
      } else {
        fs.writeFileSync(path.join(l.bh, 'bin', 'beethoven'), old(version), { mode: 0o755 });
      }
      const r = l.line();
      assert.notEqual(r.status, 0, `${what}: refused (${r.out})`);
      assert.match(r.out, /Nothing was removed: the Beethoven scripts on the grid are an older version/, what);
      assert.equal(l.exists('old-uninstall-ran'), false, `${what}: the old uninstall never ran`);
      for (const rel of THEIRS) assert.ok(l.exists(rel), `${what}: ${rel} kept`);
    } finally {
      fs.rmSync(l.h, { recursive: true, force: true });
    }
  }
  const l = lab();
  try {
    const r = l.line();
    assert.equal(r.status, 0, `grid scripts ${fs.readFileSync(path.join(repo, 'grid', 'VERSION'), 'utf8').trim()} run it (${r.out})`);
    for (const rel of INSTALLED) assert.equal(l.exists(rel), false, `${rel} removed`);
    for (const rel of THEIRS) assert.ok(l.exists(rel), `${rel} kept`);
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});
