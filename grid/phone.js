'use strict';
/*! Ashley (c) 2026. Licensed software: use requires a license key. See LICENSE.txt. */
// Phone access: Claude Code's Remote Control, hosted by the worker job, so the Claude app (or
// claude.ai/code) drives a Claude session on the grid with no workstation.
//
// Ashley never signs in for the student and never handles a Claude credential. The student signs
// in once, in a terminal, through Claude Code's own flow (`ashley claude login` runs
// `claude auth login` inside their allocation), and Claude Code keeps its credential in
// ~/.ashley/claude, the one CLAUDE_CONFIG_DIR every Claude Code process Ashley starts on the grid
// uses. The student also answers Claude Code's one-time "Enable Remote Control?" question
// themselves (`ashley claude remote-consent`), which writes the marker file below. Only then does
// this module run `claude remote-control` in a pseudo-terminal in a trusted folder, restart it if
// it exits, and report the session link. Everything is driven by files:
//   <worker>/rc/enable         present = phone access wanted
//   <worker>/rc/status.json    {phase, session_url, message, updated}
//   <worker>/rc/session.log    the pseudo-terminal transcript
//   ~/.ashley/claude/.ashley-remote-consent   the student answered "Enable Remote Control?" once
//   ~/.ashley/remote/host.lock/holder.json    which worker hosts the phone (one at a time)
// phases: off, need_login, need_consent, starting, running, elsewhere, error
//
// Only ONE worker may host: every worker shares the one login, and two Remote Control hosts on
// one login would fight over it. The host holds a lease, a directory made with mkdir (atomic on
// the shared home; flock is not reliable across nodes), touched every 5 s and treated as
// abandoned after 60 s, the timings Claude Code uses for its own credential locks. Turning phone
// access off only stops processes: `claude auth logout` would revoke the login, so it is never run.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[()][A-Za-z0-9]|\r/g;
const URL_RE = /https:\/\/claude\.(?:com|ai)\/[^\s\x07\x1b\]"'<>]+/g;
const CONSENT_RE = /\(y\/n\)|\[y\/n\]|\[Y\/n\]|\[y\/N\]|yes\/no/i;
const AUTH_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'];

function clean(s) {
  return String(s).replace(ANSI, '');
}

function startPhone(o) {
  const RC = path.join(o.workerDir, 'rc');
  const CFG = o.claudeHome || path.join(o.ashleyHome, 'claude');
  const PROJ = path.join(o.root, 'workspaces', 'phone');
  const ENABLE = path.join(RC, 'enable');
  const STATUS = path.join(RC, 'status.json');
  const CONSENT = path.join(CFG, '.ashley-remote-consent');
  const LEASE = path.join(o.ashleyHome, 'remote', 'host.lock');
  const HOLDER = path.join(LEASE, 'holder.json');
  const log = o.log || (() => {});
  const me = { worker: path.basename(o.workerDir), node: o.node, job: o.job, pid: process.pid };
  let session = null; // {child, out, lastAnswer}
  let st = { phase: 'off', session_url: null, message: '' };
  let loggedInCache = { at: 0, value: false };
  let restartAt = 0;
  let backoff = 10_000;
  let holding = false;
  let leaseBeat = 0;

  function write(patch) {
    st = { ...st, ...patch, updated: new Date().toISOString(), node: o.node, job: o.job };
    try {
      fs.mkdirSync(RC, { recursive: true });
      fs.writeFileSync(STATUS + '.part', JSON.stringify(st, null, 1));
      fs.renameSync(STATUS + '.part', STATUS);
    } catch (e) {
      log(`phone status write failed: ${e.message}`);
    }
  }
  function env() {
    const e = { ...process.env, CLAUDE_CONFIG_DIR: CFG, BROWSER: '/bin/false', DISABLE_AUTOUPDATER: '1', TERM: 'xterm-256color' };
    // no other credential may override the student's own login; ANTHROPIC_BASE_URL also disables Remote Control
    for (const k of AUTH_VARS) delete e[k];
    delete e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; // it switches Remote Control off
    return e;
  }
  function claudeCmd(args) {
    return o.claude.endsWith('.js') ? `'${process.execPath}' '${o.claude}' ${args}` : `'${o.claude}' ${args}`;
  }
  /** Claude Code's own answer about its stored login; Ashley reads status, never the credential. */
  function loggedIn(force) {
    if (!force && Date.now() - loggedInCache.at < 60_000) return loggedInCache.value;
    const cmd = o.claude.endsWith('.js') ? process.execPath : o.claude;
    const args = o.claude.endsWith('.js') ? [o.claude, 'auth', 'status'] : ['auth', 'status'];
    const r = spawnSync(cmd, args, { env: env(), encoding: 'utf8', timeout: 60_000 });
    let v = false;
    try {
      v = !!JSON.parse(r.stdout || '{}').loggedIn;
    } catch {
      v = /"loggedIn":\s*true/.test(r.stdout || '');
    }
    loggedInCache = { at: Date.now(), value: v };
    return v;
  }
  function pty(cmdline, transcript, cwd) {
    // `script` gives the child a real terminal. Errors on the process or its pipes are logged, never
    // thrown: this runs inside the worker daemon.
    fs.mkdirSync(cwd, { recursive: true });
    const child = spawn('script', ['-qfc', cmdline, transcript], { cwd, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
    child.on('error', (e) => log(`phone: ${e.message}`));
    for (const s of [child.stdin, child.stdout, child.stderr]) if (s) s.on('error', () => {});
    return child;
  }
  function pretrust() {
    // Remote Control refuses an untrusted folder; mark the phone folder trusted in this login's config
    const f = path.join(CFG, '.claude.json');
    let j = {};
    try {
      j = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      /* new */
    }
    j.hasCompletedOnboarding = true;
    j.theme = j.theme || 'dark';
    j.projects = j.projects || {};
    j.projects[PROJ] = { ...(j.projects[PROJ] || {}), hasTrustDialogAccepted: true };
    fs.mkdirSync(CFG, { recursive: true, mode: 0o700 });
    fs.writeFileSync(f + '.part', JSON.stringify(j, null, 1), { mode: 0o600 });
    fs.renameSync(f + '.part', f);
  }
  function startSession() {
    pretrust();
    const child = pty(claudeCmd('remote-control'), path.join(RC, 'session.log'), PROJ);
    const mine = { child, out: '', lastAnswer: 0 };
    session = mine;
    write({ phase: 'starting', message: 'starting Remote Control' });
    child.stdout.on('data', (d) => {
      if (session !== mine) return;
      mine.out = (mine.out + clean(d.toString('utf8'))).slice(-20000);
      const tail = mine.out.slice(-400);
      // Claude Code's consent question: the student answered it once (marker file); repeat the answer they gave
      if (CONSENT_RE.test(tail) && Date.now() - mine.lastAnswer > 5000) {
        mine.lastAnswer = Date.now();
        if (fs.existsSync(CONSENT)) child.stdin.write('y\r');
        else {
          write({ phase: 'need_consent', session_url: null, message: 'Claude Code asks once whether to enable Remote Control; answer it yourself with: ashley claude remote-consent (Ashley: Phone access does this)' });
          child.kill('SIGTERM');
        }
        return;
      }
      const urls = mine.out.match(URL_RE);
      const sessionUrl = urls ? urls.filter((u) => /\/code/.test(u)).pop() : null;
      const lines = mine.out.split('\n').map((l) => l.trim()).filter(Boolean);
      write({ phase: 'running', session_url: sessionUrl || st.session_url, message: (lines[lines.length - 1] || '').slice(0, 200) });
    });
    child.on('close', (code) => {
      if (session !== mine) return;
      const out = mine.out;
      session = null;
      if (st.phase === 'need_consent') return;
      if (/must be logged in|not logged in|log in again|expired|Please run \/login/i.test(out)) {
        loggedInCache = { at: 0, value: false };
        write({ phase: 'need_login', message: 'the Claude sign-in on the grid ended; sign in again with: ashley claude login (Ashley: Sign in to Claude on the grid)', session_url: null });
      } else if (fs.existsSync(ENABLE)) {
        restartAt = Date.now() + backoff;
        backoff = Math.min(backoff * 2, 5 * 60_000);
        write({ phase: 'starting', message: `Remote Control stopped (exit ${code}); restarting in ${Math.round((restartAt - Date.now()) / 1000)} s` });
      }
    });
  }
  function readHolder() {
    try {
      const h = JSON.parse(fs.readFileSync(HOLDER, 'utf8'));
      h.age_s = Math.round((Date.now() - fs.statSync(HOLDER).mtimeMs) / 1000);
      return h;
    } catch {
      return null;
    }
  }
  function beat() {
    fs.writeFileSync(HOLDER + '.part', JSON.stringify({ ...me, beat: new Date().toISOString() }));
    fs.renameSync(HOLDER + '.part', HOLDER);
    leaseBeat = Date.now();
  }
  function acquire() {
    if (holding) {
      if (Date.now() - leaseBeat > 5000) {
        const h = readHolder();
        if (h && (h.worker !== me.worker || h.job !== me.job || h.pid !== me.pid)) {
          holding = false; // taken over after we stalled past 60 s
          return h;
        }
        beat();
      }
      return true;
    }
    fs.mkdirSync(path.dirname(LEASE), { recursive: true, mode: 0o700 });
    for (let i = 0; i < 2; i++) {
      try {
        fs.mkdirSync(LEASE, { mode: 0o700 });
        holding = true;
        beat();
        log('phone: this worker now hosts phone access');
        return true;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const h = readHolder();
        if (h && h.worker === me.worker && h.job === me.job && h.pid === me.pid) {
          holding = true;
          beat();
          return true;
        }
        const stale = !h || h.age_s > 60 || (h.worker === me.worker && h.pid !== me.pid && h.age_s > 10);
        if (!stale) return h;
        fs.rmSync(LEASE, { recursive: true, force: true });
      }
    }
    return readHolder() || {};
  }
  function release() {
    if (!holding) return;
    holding = false;
    const h = readHolder();
    if (!h || (h.worker === me.worker && h.pid === me.pid)) fs.rmSync(LEASE, { recursive: true, force: true });
  }
  function stopAll() {
    if (session) try { session.child.kill('SIGTERM'); } catch { /* gone */ }
    session = null;
  }

  function tick() {
    try {
      const enabled = fs.existsSync(ENABLE);
      if (!enabled) {
        if (session) stopAll();
        release();
        if (st.phase !== 'off') write({ phase: 'off', session_url: null, message: '' });
        return;
      }
      const lease = acquire();
      if (lease !== true) {
        if (session) stopAll();
        const where = `worker ${lease.worker || '?'}${lease.node ? ` on ${lease.node}` : ''}`;
        if (st.phase !== 'elsewhere') log(`phone: ${where} already hosts phone access`);
        write({ phase: 'elsewhere', session_url: null, message: `phone access is hosted by ${where}; turn it on here with Ashley: Phone access to move it` });
        return;
      }
      if (session) return;
      if (!loggedIn(false)) {
        if (st.phase !== 'need_login') write({ phase: 'need_login', session_url: null, message: 'sign in to Claude on the grid first: ashley claude login (Ashley: Sign in to Claude on the grid)' });
        return;
      }
      if (!fs.existsSync(CONSENT)) {
        if (st.phase !== 'need_consent') write({ phase: 'need_consent', session_url: null, message: 'answer Claude Code\'s one-time Remote Control question yourself: ashley claude remote-consent (Ashley: Phone access does this)' });
        return;
      }
      if (Date.now() >= restartAt) startSession();
    } catch (e) {
      write({ phase: 'error', message: String(e && e.message ? e.message : e).slice(0, 200) });
    }
  }

  return {
    tick,
    stop() {
      stopAll();
      release();
    },
    phase: () => st.phase,
  };
}

module.exports = { startPhone, clean, URL_RE, AUTH_VARS };
