'use strict';
// Phone access: Claude Code's Remote Control, hosted by the worker job, so the Claude app (or
// claude.ai/code) drives a Claude session on the grid with no workstation.
//
// Remote Control needs a full claude.ai login (the one-year setup-token the worker uses for
// prompts is refused for it), so this keeps a SEPARATE login in ~/.ashley/remote/config and never
// mixes it with the prompt accounts. The login is headless: `claude auth login` in a pseudo-terminal
// (util-linux `script`) prints a sign-in link and waits for the code the claude.ai page shows; the
// laptop opens the link, the student presses Authorize and hands the code back through
// rc/code. Then `claude remote-control` runs in a pseudo-terminal in a trusted project folder and is
// restarted if it exits. Only outbound HTTPS is needed. Everything is driven by files:
//   <worker>/rc/enable       present = phone access wanted
//   <worker>/rc/code         the code from the claude.ai page (read once, then deleted)
//   <worker>/rc/status.json  {phase, url, session_url, message, attempts, updated}
//   <worker>/rc/login.log, rc/session.log   the two pseudo-terminal transcripts
// phases: off, login, need_code, verifying, starting, running, error
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ANSI = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b[()][A-Za-z0-9]|\r/g;
const URL_RE = /https:\/\/claude\.(?:com|ai)\/[^\s\x07\x1b\]"'<>]+/g;

function clean(s) {
  return String(s).replace(ANSI, '');
}

function startPhone(o) {
  const RC = path.join(o.workerDir, 'rc');
  const CFG = path.join(o.ashleyHome, 'remote', 'config');
  const PROJ = path.join(o.root, 'workspaces', 'phone');
  const ENABLE = path.join(RC, 'enable');
  const CODE = path.join(RC, 'code');
  const STATUS = path.join(RC, 'status.json');
  const log = o.log || (() => {});
  let login = null; // {child, out}
  let session = null; // {child, out, lastAnswer}
  let st = { phase: 'off', url: null, session_url: null, message: '', attempts: 0 };
  let loggedInCache = { at: 0, value: false };
  let restartAt = 0;
  let backoff = 10_000;

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
    delete e.CLAUDE_CODE_OAUTH_TOKEN;
    delete e.ANTHROPIC_API_KEY;
    delete e.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC; // it switches Remote Control off
    return e;
  }
  function claudeCmd(args) {
    return o.claude.endsWith('.js') ? `'${process.execPath}' '${o.claude}' ${args}` : `'${o.claude}' ${args}`;
  }
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
    // `script` gives the child a real terminal; its stdin is forwarded to that terminal
    fs.mkdirSync(cwd, { recursive: true });
    return spawn('script', ['-qfc', cmdline, transcript], { cwd, env: env(), stdio: ['pipe', 'pipe', 'pipe'] });
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
    j.projects = j.projects || {};
    j.projects[PROJ] = { ...(j.projects[PROJ] || {}), hasTrustDialogAccepted: true };
    fs.mkdirSync(CFG, { recursive: true, mode: 0o700 });
    fs.writeFileSync(f + '.part', JSON.stringify(j, null, 1), { mode: 0o600 });
    fs.renameSync(f + '.part', f);
  }
  function startLogin() {
    if (st.attempts >= 3) {
      write({ phase: 'error', message: 'three sign-in attempts did not work; turn phone access off and on to try again' });
      return;
    }
    fs.mkdirSync(CFG, { recursive: true, mode: 0o700 });
    const child = pty(claudeCmd('auth login'), path.join(RC, 'login.log'), PROJ);
    login = { child, out: '' };
    write({ phase: 'login', url: null, message: 'starting the sign-in', attempts: st.attempts + 1 });
    child.stdout.on('data', (d) => {
      const chunk = clean(d.toString('utf8'));
      login.out += chunk;
      // Claude answers a wrong code at once and keeps waiting for another
      if (/Invalid code|code (is )?(invalid|expired)/i.test(chunk) && st.phase === 'verifying') {
        write({ phase: 'need_code', message: 'Claude did not accept that code: copy the whole code from the page (it is long) and send it again' });
        log('phone: code rejected');
      }
      const urls = login.out.match(URL_RE);
      if (urls && st.phase === 'login') {
        const url = urls.find((u) => /oauth\/authorize/.test(u)) || urls[0];
        write({ phase: 'need_code', url, message: 'open the link, press Authorize, bring back the code the page shows' });
        log('phone: sign-in link ready');
      }
    });
    child.on('close', (code) => {
      const out = login ? login.out : '';
      login = null;
      if (loggedIn(true)) {
        write({ phase: 'starting', url: null, message: 'signed in', attempts: 0 });
        log('phone: signed in');
      } else if (fs.existsSync(ENABLE)) {
        write({ phase: 'login', message: `that did not complete (exit ${code}): ${out.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 200)}; a new link is coming` });
      }
    });
  }
  function startSession() {
    pretrust();
    const child = pty(claudeCmd('remote-control'), path.join(RC, 'session.log'), PROJ);
    session = { child, out: '', lastAnswer: 0 };
    write({ phase: 'starting', message: 'starting Remote Control' });
    child.stdout.on('data', (d) => {
      session.out = (session.out + clean(d.toString('utf8'))).slice(-20000);
      const tail = session.out.slice(-400);
      // answer a yes/no question once in a while (enable / trust prompts); the folder is pretrusted
      if (/\(y\/n\)|\[y\/n\]|\[Y\/n\]|\[y\/N\]|yes\/no/i.test(tail) && Date.now() - session.lastAnswer > 5000) {
        session.lastAnswer = Date.now();
        child.stdin.write('y\r');
      }
      const urls = session.out.match(URL_RE);
      const sessionUrl = urls ? urls.filter((u) => /\/code/.test(u)).pop() : null;
      const lines = session.out.split('\n').map((l) => l.trim()).filter(Boolean);
      write({ phase: 'running', session_url: sessionUrl || st.session_url, message: (lines[lines.length - 1] || '').slice(0, 200) });
    });
    child.on('close', (code) => {
      const out = session ? session.out : '';
      session = null;
      if (/must be logged in|not logged in|log in again|expired/i.test(out)) {
        loggedInCache = { at: 0, value: false };
        write({ phase: 'login', message: 'the phone sign-in expired; sign in again', session_url: null });
      } else if (fs.existsSync(ENABLE)) {
        restartAt = Date.now() + backoff;
        backoff = Math.min(backoff * 2, 5 * 60_000);
        write({ phase: 'starting', message: `Remote Control stopped (exit ${code}); restarting in ${Math.round((restartAt - Date.now()) / 1000)} s` });
      }
    });
  }
  function stopAll() {
    for (const c of [login, session]) if (c) try { c.child.kill('SIGTERM'); } catch { /* gone */ }
    login = null;
    session = null;
  }

  function tick() {
    try {
      const enabled = fs.existsSync(ENABLE);
      if (!enabled) {
        if (login || session) stopAll();
        if (st.phase !== 'off') write({ phase: 'off', url: null, session_url: null, message: '', attempts: 0 });
        return;
      }
      if (login) {
        if (fs.existsSync(CODE)) {
          const code = fs.readFileSync(CODE, 'utf8').trim();
          fs.rmSync(CODE, { force: true });
          if (code) {
            login.child.stdin.write(code + '\r');
            login.sentAt = Date.now();
            write({ phase: 'verifying', message: 'checking the code' });
            log('phone: code handed to the sign-in');
          }
        } else if (st.phase === 'verifying' && login.sentAt && Date.now() - login.sentAt > 60_000) {
          write({ phase: 'need_code', message: 'no answer to that code within a minute; send it again, or turn phone access off and on' });
        }
        return;
      }
      if (session) return;
      if (!loggedIn(false)) {
        startLogin();
        return;
      }
      if (Date.now() >= restartAt) startSession();
    } catch (e) {
      write({ phase: 'error', message: String(e && e.message ? e.message : e).slice(0, 200) });
    }
  }

  return {
    tick,
    stop: stopAll,
    phase: () => st.phase,
  };
}

module.exports = { startPhone, clean, URL_RE };
