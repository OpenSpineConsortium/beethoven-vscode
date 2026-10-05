// `beethoven install` on the grid, run unattended over ssh by the setup, its repair and the lab-access check.
// It must never drop a line of the student's ~/.bashrc (a start line whose end was deleted by hand used to
// take every line after it), must leave a linked ~/.bashrc a link, and must move a worker still running the
// daemon of older grid scripts onto the ones just installed (node keeps the old code in memory until the job
// ends). Lab access: the lab's folder stays readable to every account the volume root lets in, an applicant
// included, so readable is not approved; the lead's decision is. The real script runs in a made-up home with
// a Slurm that only records what it is asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(__dirname, '..', '..', '..', '..'); // dist-test/unit/core -> repository root
const skip = process.platform === 'linux' && spawnSync('script', ['--version'], { encoding: 'utf8' }).status === 0 ? false : 'needs bash, GNU awk and util-linux script, as on the grid';

function lab(library?: (h: string) => string) {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-install-'));
  const bh = path.join(h, '.beethoven');
  const bin = path.join(bh, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const f of ['beethoven', 'VERSION', 'bashrc.block', 'worker.sbatch.tpl']) fs.copyFileSync(path.join(repo, 'grid', f), path.join(bin, f));
  fs.chmodSync(path.join(bin, 'beethoven'), 0o755);
  fs.symlinkSync('.beethoven', path.join(h, '.ashley'));
  const fakeBin = path.join(h, 'fakebin');
  fs.mkdirSync(fakeBin);
  const calls = (name: string) => path.join(h, `${name}.calls`);
  fs.writeFileSync(path.join(fakeBin, 'scancel'), `#!/bin/sh\necho "$@" >> '${calls('scancel')}'\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'squeue'), '#!/bin/sh\necho RUNNING\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'sacct'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(fakeBin, 'sbatch'), `#!/bin/sh\necho "$@" >> '${calls('sbatch')}'\necho 777\n`, { mode: 0o755 });
  // the lab's shared library is not there: install stops at "comes with lab access" or "already ready"
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: h, USER: os.userInfo().username, PATH: `${fakeBin}:${process.env.PATH}`, BEETHOVEN_LIBRARY: library ? library(h) : path.join(h, 'no-lab', 'beethoven') };
  for (const k of ['CLAUDECODE', 'BEETHOVEN_REQUEST_ID', 'BEETHOVEN_WORKER', 'ASHLEY_REQUEST_ID', 'ASHLEY_WORKER', 'BEETHOVEN_HOME', 'ASHLEY_HOME']) delete env[k];
  const cli = path.join(bin, 'beethoven');
  const quote = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
  return {
    h, bh, calls,
    // over a pipe, as the setup's BatchMode ssh runs it
    pipe: (args: string[]) => {
      const r = spawnSync('bash', [cli, ...args], { env, encoding: 'utf8', input: '' });
      return { status: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
    },
    tty: (args: string[]) => {
      const r = spawnSync('script', ['-qec', ['bash', cli, ...args].map(quote).join(' '), '/dev/null'], { env, encoding: 'utf8', input: '' });
      return { status: r.status, out: (r.stdout + r.stderr).replace(/\r/g, '') };
    },
  };
}

test('install and uninstall keep every line after a block start whose end was deleted, and a linked ~/.bashrc stays a link', { skip }, () => {
  const l = lab();
  try {
    fs.writeFileSync(path.join(l.bh, 'config.env'), `ROOT=${path.join(l.h, 'work')}\n`);
    const mine = ['# the student\'s own line', '# >>> beethoven (its end line deleted by hand) >>>', 'export PATH=$HOME/old:$PATH', 'alias ll="ls -l"', '# >>> conda initialize >>>', 'conda init lines', '# <<< conda initialize <<<', 'export MYVAR=1', ''].join('\n');
    fs.mkdirSync(path.join(l.h, 'dotfiles'));
    const target = path.join(l.h, 'dotfiles', 'bashrc');
    fs.writeFileSync(target, mine, { mode: 0o640 });
    fs.symlinkSync('dotfiles/bashrc', path.join(l.h, '.bashrc'));
    for (let i = 0; i < 2; i++) {
      const r = l.pipe(['install']);
      assert.equal(r.status, 0, r.out);
    }
    const rc = path.join(l.h, '.bashrc');
    assert.ok(fs.lstatSync(rc).isSymbolicLink(), '~/.bashrc is still the link to the dotfiles');
    const after = fs.readFileSync(target, 'utf8');
    assert.ok(after.startsWith(mine), `every line of the student's is kept, in place:\n${after}`);
    assert.equal((after.match(/^# <<< beethoven <<<$/gm) ?? []).length, 1, 'one whole block, not two');
    assert.equal(fs.statSync(target).mode & 0o777, 0o640, 'the file keeps its mode');
    const u = l.tty(['uninstall', '--yes']);
    assert.equal(u.status, 0, u.out);
    const left = fs.readFileSync(target, 'utf8');
    assert.ok(left.startsWith(mine) && left.slice(mine.length).trim() === '', `uninstall takes away only the whole block:\n${left}`);
    assert.ok(fs.lstatSync(rc).isSymbolicLink(), 'still a link after uninstall');
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('install restarts a running worker whose daemon predates these scripts, and only that one', { skip }, () => {
  const l = lab();
  try {
    // a ready grid: a container with node and claude, a license, a worker template
    const sandbox = path.join(l.h, 'work', 'containers', 'c1');
    fs.mkdirSync(path.join(sandbox, 'usr', 'local', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'usr', 'local', 'bin', 'node'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(sandbox, 'usr', 'local', 'bin', 'claude'), '#!/bin/sh\n', { mode: 0o755 });
    fs.writeFileSync(path.join(l.bh, 'config.env'), `ROOT=${path.join(l.h, 'work')}\nSANDBOX=${sandbox}\nCLAUDE_BIN=${path.join(sandbox, 'usr', 'local', 'bin', 'claude')}\n`);
    fs.writeFileSync(path.join(l.bh, 'READY'), '{"claude_version":"2.1.283"}\n');
    fs.writeFileSync(path.join(l.bh, 'license.key'), 'a key\n');
    const worker = (name: string, job: string, state: Record<string, unknown>) => {
      const w = path.join(l.bh, 'workers', name);
      fs.mkdirSync(w, { recursive: true });
      fs.writeFileSync(path.join(w, 'job.id'), `${job}\n`);
      fs.writeFileSync(path.join(w, 'params'), ['--hours', '24', '--cpus', '4', '--mem', '16G', '--partition', 'reqp', '--qos', 'requeue', '--gpus', '0', '--concurrency', '2'].join('\n') + '\n');
      fs.writeFileSync(path.join(w, 'state.json'), JSON.stringify({ worker: name, job, claude_login: { loggedIn: true, subscription: true }, ...state }, null, 1));
    };
    worker('old', '123', {}); // grid scripts 8's heartbeat: no "scripts"
    worker('new', '456', { scripts: '9' });
    worker('gone', '789', {});
    fs.writeFileSync(path.join(l.bh, 'workers', 'gone', 'job.id'), '790\n'); // its heartbeat is a finished job's
    const r = l.pipe(['install']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /^restarted worker old: it ran grid scripts older than \d+$/m);
    assert.doesNotMatch(r.out, /worker (new|gone)/, 'the others are left alone');
    assert.equal(fs.readFileSync(l.calls('scancel'), 'utf8').trim(), '123', 'only the old daemon\'s job was cancelled');
    assert.equal(fs.readFileSync(l.calls('sbatch'), 'utf8').trim().split('\n').length, 1, 'one job submitted in its place');
    assert.equal(fs.readFileSync(path.join(l.bh, 'workers', 'old', 'job.id'), 'utf8').trim(), '777');
    assert.equal(fs.readFileSync(path.join(l.bh, 'workers', 'new', 'job.id'), 'utf8').trim(), '456');
    // the next install finds nothing to do once the new daemon writes its heartbeat
    fs.writeFileSync(path.join(l.bh, 'workers', 'old', 'state.json'), JSON.stringify({ worker: 'old', job: '777', scripts: '9' }, null, 1));
    const again = l.pipe(['install']);
    assert.doesNotMatch(again.out, /restarted worker/);
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});

test('lab access is the lead\'s decision, not whether the lab folder can be read', { skip }, () => {
  const lib = (h: string) => path.join(h, 'vol', 'shared', 'beethoven');
  const l = lab(lib);
  try {
    // the lab's library, readable to this account as it is to every account the volume root lets in
    fs.mkdirSync(lib(l.h), { recursive: true });
    fs.writeFileSync(path.join(lib(l.h), 'library.json'), '{"default":"c1","containers":{"c1":{"sandbox":"/nowhere"}}}\n');
    const status = path.join(l.h, 'vol', 'shared', 'access', 'status');
    fs.mkdirSync(status, { recursive: true });
    const me = os.userInfo().username;
    for (const [state, granted, shown] of [['pending', false, 'pending'], ['denied', false, 'denied'], ['removed', false, 'removed'], ['approved', true, 'approved'], ['', true, 'approved']] as const) {
      if (state) fs.writeFileSync(path.join(status, `${me}.json`), JSON.stringify({ user: me, state }) + '\n');
      else fs.rmSync(path.join(status, `${me}.json`), { force: true }); // no decision: let in by the grid's own list
      fs.rmSync(l.calls('scancel'), { force: true });
      const r = l.pipe(['access', 'status', '--json']);
      assert.equal(r.status, 0, r.out);
      if (state === 'pending') assert.equal(fs.existsSync(l.calls('scancel')), false, 'a pending request keeps its held job');
      const j = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}');
      assert.equal(j.granted, granted, `${state || 'no decision'}: granted ${granted}`);
      assert.equal(j.state, shown, `${state || 'no decision'}: shown as ${shown}`);
      if (!granted) {
        const a = l.pipe(['adopt']);
        assert.notEqual(a.status, 0, `${state}: the lab's container is not adopted`);
        assert.match(a.out, new RegExp(`your lab access is ${state}`));
      }
    }
  } finally {
    fs.rmSync(l.h, { recursive: true, force: true });
  }
});
