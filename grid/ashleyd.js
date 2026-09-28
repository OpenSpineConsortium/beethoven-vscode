#!/usr/bin/env node
'use strict';
/*! Ashley (c) 2026 OpenSpineConsortium. Licensed software: use requires a license key. See LICENSE.txt. */
// ashleyd: the persistent Claude Code worker. Runs inside the container on a compute node.
//
//   inbox/<id>.json  ->  claim (rename to .claimed)  ->  claude -p ... --output-format stream-json
//                    ->  outbox/<id>.events.jsonl (live)  ->  outbox/<id>.json (final)
//
// One credential per account directory (~/.ashley/accounts/<name>/):
//   .credentials.json  a copied Claude Code login (CLAUDE_CONFIG_DIR style)
//   apikey             an Anthropic API key (pay-per-use overflow)
//   disabled           present = hold this account out of rotation
//   state.json         written here: {"cooldown_until": iso|null, "last_error": ...}
// Each account directory is also that account's CLAUDE_CONFIG_DIR, so sessions, settings and
// caches never mix between accounts.
//
// Rate limits: when Claude reports that a subscription window is exhausted, the account is
// put on cooldown until the reset time it names (or 60 min), the request is re-queued for the
// next enabled account, and if none is left the result is written with status rate_limited
// and a retry_after so the laptop can wait instead of failing.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');
const crypto = require('crypto');

const argv = parseArgs(process.argv.slice(2));
const WORKER_DIR = must(argv['worker-dir'], '--worker-dir');
const CLAUDE = must(argv.claude, '--claude');
const CONCURRENCY = parseInt(argv.concurrency || '2', 10);
// 250 ms: a readdir of a tiny directory four times a second is nothing for the filesystem,
// and it takes the poll out of the latency budget (measured 2026-09-28).
const POLL_MS = parseInt(argv['poll-ms'] || '250', 10);
const ASHLEY_HOME = process.env.ASHLEY_HOME || path.join(os.homedir(), '.ashley');
const ROOT = process.env.ASHLEY_ROOT || path.join(os.homedir(), 'ashley');
const WORKER = path.basename(WORKER_DIR);
const INBOX = path.join(WORKER_DIR, 'inbox');
const OUTBOX = path.join(WORKER_DIR, 'outbox');
const LOGDIR = path.join(WORKER_DIR, 'log');
const SESSIONS = path.join(ASHLEY_HOME, 'sessions');
const ACCOUNTS = path.join(ASHLEY_HOME, 'accounts');
// The student's own Claude sign-in, made by Claude Code itself (`ashley claude login` runs
// `claude auth login` in the student's allocation). Ashley never reads, copies or relays it; it
// only points every Claude Code process it starts at this folder. One person, one login.
const CLAUDE_HOME = process.env.ASHLEY_CLAUDE_HOME || path.join(ASHLEY_HOME, 'claude');
const AUTH_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR'];
const SECRETS = path.join(ASHLEY_HOME, 'secrets.env');
const STATE = path.join(WORKER_DIR, 'state.json');
const STOP = path.join(WORKER_DIR, 'stop');
const HARD_CAP_MS = 6 * 3600e3;
const MAX_ATTEMPTS = 3;

// ---- license ------------------------------------------------------------------------------
// The worker runs only for the person the license names: the key the laptop copied to
// ~/.ashley/license.key must verify against the keys shipped beside this file, name this unix
// account (the AccessID), and be in date. Checked at start and every minute; a clock set back
// does not revive an ended key (the latest time seen is kept in license.state).
const LIC = require(path.join(__dirname, 'license.js'));
const LIC_KEYS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'license_keys.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const LICENSE_RECHECK_MS = parseInt(process.env.ASHLEY_LICENSE_RECHECK_MS || '60000', 10);
let license = { ok: false, status: 'missing', detail: 'not checked yet' };
function checkLicense() {
  const read = (f) => {
    try {
      return fs.readFileSync(path.join(ASHLEY_HOME, f), 'utf8');
    } catch {
      return '';
    }
  };
  let lastSeen = 0;
  try {
    lastSeen = JSON.parse(read('license.state') || '{}').last_seen || 0;
  } catch {
    lastSeen = 0;
  }
  const now = LIC.effectiveNow(Date.now() / 1000, lastSeen);
  try {
    fs.writeFileSync(path.join(ASHLEY_HOME, 'license.state'), JSON.stringify({ last_seen: now }));
  } catch {
    /* read-only home: keep going */
  }
  const rev = LIC.verifyRevocationList(read('license.revoked'), LIC_KEYS);
  const user = os.userInfo().username;
  const c = LIC.verifyLicense(read('license.key').trim(), { keys: LIC_KEYS, now, identity: { accessId: user, email: `${user}@wayne.edu` }, revoked: rev.ok ? rev.revoked : [] });
  const before = license.status;
  license = { ok: c.ok, status: c.status, detail: c.detail, lid: c.payload ? c.payload.lid : undefined, edition: c.payload ? c.payload.edition : undefined, exp: c.payload ? c.payload.exp : undefined, days_left: c.daysLeft };
  if (before !== license.status) log(`license: ${license.status} (${license.detail})`);
}

for (const d of [INBOX, OUTBOX, LOGDIR, SESSIONS, ACCOUNTS]) fs.mkdirSync(d, { recursive: true });
const logStream = fs.createWriteStream(path.join(LOGDIR, 'ashleyd.log'), { flags: 'a' });
function log(...a) {
  const line = `${new Date().toISOString()} ${a.join(' ')}`;
  logStream.write(line + '\n');
  process.stdout.write(line + '\n');
}

const RATE_LIMIT_PATTERNS = [/hit your (usage )?limit/i, /usage limit reached/i, /rate[ _-]?limit/i, /too many requests/i, /\b429\b/, /out of (extra )?usage/i, /overloaded_error/i];
function looksRateLimited(t) {
  return !!t && RATE_LIMIT_PATTERNS.some((r) => r.test(t));
}
function parseResetTime(text, now = new Date()) {
  const m1 = /try again in (\d+)\s*(minute|min|hour|hr|second|sec)s?/i.exec(text || '');
  if (m1) {
    const n = parseInt(m1[1], 10);
    const u = m1[2].toLowerCase();
    return new Date(now.getTime() + (u.startsWith('h') ? n * 3600e3 : u.startsWith('m') ? n * 60e3 : n * 1e3)).toISOString();
  }
  const m2 = /resets? (?:at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text || '');
  if (m2) {
    let h = parseInt(m2[1], 10);
    const min = m2[2] ? parseInt(m2[2], 10) : 0;
    const ap = m2[3] && m2[3].toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  return null;
}

// ---------------------------------------------------------------------------------------
const running = new Map(); // id -> { child, req, started, account }
let stopping = false;
let processed = 0;
// --claude may point at a .js file (the test stand-in); then run it with this node binary.
function claudeCommand(args) {
  return CLAUDE.endsWith('.js') ? { cmd: process.execPath, args: [CLAUDE, ...args] } : { cmd: CLAUDE, args };
}
// Slurm inside the container (see worker.sbatch.tpl): tested once at start by asking for this job
const SLURM_BIN = process.env.ASHLEY_SLURM_BIN || '';
const SLURM = (() => {
  if (!SLURM_BIN) return { ok: false, detail: 'the worker job found no Slurm client to bind' };
  const r = spawnSync(path.join(SLURM_BIN, 'squeue'), ['-h', '-j', String(process.env.SLURM_JOB_ID || ''), '-o', '%T'], { encoding: 'utf8', timeout: 30_000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  return /RUNNING/.test(out) ? { ok: true, detail: 'squeue answers from inside the container' } : { ok: false, detail: (out || String(r.error || `exit ${r.status}`)).slice(0, 200) };
})();
const claudeVersion = (() => {
  const c = claudeCommand(['--version']);
  const r = spawnSync(c.cmd, c.args, { encoding: 'utf8', timeout: 60000 });
  return ((r.stdout || '') + (r.stderr || '')).trim().split('\n').pop() || 'unknown';
})();
const secretsEnv = readEnvFile(SECRETS);
const node = readFirstLine(path.join(WORKER_DIR, 'node')) || os.hostname();
const job = readFirstLine(path.join(WORKER_DIR, 'job.id')) || process.env.SLURM_JOB_ID || 'x';
const startedAt = new Date().toISOString();
// phone access (Remote Control) lives in its own module and only acts when <worker>/rc/enable exists
let phone = null;
try {
  phone = require(path.join(__dirname, 'phone.js')).startPhone({ workerDir: WORKER_DIR, ashleyHome: ASHLEY_HOME, claudeHome: CLAUDE_HOME, root: ROOT, claude: CLAUDE, node, job, log });
} catch (e) {
  log(`phone access unavailable: ${e.message}`);
}
checkLicense();
const licenseTimer = setInterval(checkLicense, LICENSE_RECHECK_MS);

// What Claude Code says about the sign-in in CLAUDE_HOME (`claude auth status`): status only, never the credential.
let claudeLogin = { loggedIn: false, checked: null, detail: 'not checked yet' };
function checkClaudeLogin() {
  const env = Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: CLAUDE_HOME, DISABLE_AUTOUPDATER: '1' });
  for (const k of AUTH_VARS) delete env[k];
  const c = claudeCommand(['auth', 'status']);
  const r = spawnSync(c.cmd, c.args, { env, encoding: 'utf8', timeout: 60_000 });
  let j = null;
  try {
    j = JSON.parse((r.stdout || '').trim());
  } catch {
    j = null;
  }
  const before = claudeLogin.loggedIn;
  claudeLogin = j
    ? { loggedIn: !!j.loggedIn, authMethod: j.authMethod || null, email: j.email || j.emailAddress || null, subscriptionType: j.subscriptionType || null, checked: new Date().toISOString(), detail: j.loggedIn ? `signed in${j.email ? ` as ${j.email}` : ''}` : 'not signed in on the grid' }
    : { loggedIn: false, checked: new Date().toISOString(), detail: `auth status did not answer (${(r.stderr || r.stdout || String(r.error || '')).trim().slice(0, 120)})` };
  if (before !== claudeLogin.loggedIn) log(`claude sign-in: ${claudeLogin.detail}`);
}
checkClaudeLogin();
const loginTimer = setInterval(checkClaudeLogin, 30 * 60_000);
// notice a fresh sign-in at once: the credentials file appears or changes
try {
  fs.mkdirSync(CLAUDE_HOME, { recursive: true, mode: 0o700 });
  fs.watch(CLAUDE_HOME, { persistent: false }, (_ev, f) => {
    if (f === '.credentials.json') setTimeout(checkClaudeLogin, 1500);
  });
} catch {
  /* watch unsupported: the timer covers it */
}
// phone access needs a valid license too; without one it is stopped, never started
const phoneTimer = setInterval(() => {
  if (!phone) return;
  if (license.ok) phone.tick();
  else if (phone.phase() !== 'off') phone.stop();
}, 1000);

recoverClaimed();
log(`ashleyd start worker=${WORKER} node=${node} job=${job} pid=${process.pid} claude=${claudeVersion} concurrency=${CONCURRENCY}`);
writeState('starting');
process.on('SIGTERM', () => beginStop('SIGTERM'));
process.on('SIGINT', () => beginStop('SIGINT'));
process.on('uncaughtException', (e) => log('uncaughtException', e && e.stack ? e.stack : String(e)));

const timer = setInterval(tick, POLL_MS);
const beat = setInterval(() => writeState(), 10000);
tick();

function tick() {
  try {
    if (!stopping && fs.existsSync(STOP)) beginStop('stop file');
    if (stopping) {
      if (running.size === 0) finish();
      return;
    }
    const files = fs
      .readdirSync(INBOX)
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const f of files) {
      if (running.size >= CONCURRENCY) break;
      const src = path.join(INBOX, f);
      const claimed = src + '.claimed';
      try {
        fs.renameSync(src, claimed);
      } catch {
        continue;
      }
      let req;
      try {
        req = JSON.parse(fs.readFileSync(claimed, 'utf8'));
      } catch (e) {
        log(`bad request file ${f}: ${e.message}`);
        fs.renameSync(claimed, path.join(OUTBOX, f.replace(/\.json$/, '.bad.json')));
        continue;
      }
      if (!req.id) req.id = f.replace(/\.json$/, '');
      startRequest(req, claimed);
    }
    writeState();
  } catch (e) {
    log('tick error', e && e.stack ? e.stack : String(e));
  }
}

function startRequest(req, claimedPath) {
  const started = new Date();
  if (!license.ok) {
    writeResult(req, { status: 'error', result: '', error: `Ashley license: ${license.detail}. Open VS Code and run "Ashley: License", then the setup's grid step.`, started: started.toISOString() });
    fs.rmSync(claimedPath, { force: true });
    log(`refused ${req.id}: license ${license.status}`);
    return;
  }
  const excluded = new Set(req.exclude_accounts || []);
  const account = chooseAccount(req.account, excluded);
  if (!account) {
    const cool = soonestCooldown();
    const status = cool ? 'rate_limited' : 'error';
    writeResult(req, {
      status,
      result: '',
      error: cool ? `your Claude account is on cooldown until ${cool}` : 'Claude is not signed in on the grid: run "Ashley: Sign in to Claude on the grid" (on the grid: ashley claude login)',
      retry_after: cool || undefined,
      started: started.toISOString(),
    });
    fs.rmSync(claimedPath, { force: true });
    return;
  }
  const session = resolveSession(req);
  const cwd = session.cwd;
  fs.mkdirSync(cwd, { recursive: true });
  const args = ['-p', req.prompt, '--output-format', 'stream-json', '--verbose'];
  if (req.mode === 'bypassPermissions') args.push('--dangerously-skip-permissions');
  else args.push('--permission-mode', req.mode || 'acceptEdits');
  args.push('--max-turns', String(req.max_turns || 50));
  if (req.model) args.push('--model', req.model);
  if (Array.isArray(req.allowed_tools) && req.allowed_tools.length) args.push('--allowedTools', req.allowed_tools.join(','));
  args.push('--append-system-prompt', req.append_system_prompt || peerNote());
  if (session.resume) args.push('--resume', session.session_id);
  else args.push('--session-id', session.session_id);

  const env = Object.assign({}, process.env, secretsEnv, {
    CLAUDE_CONFIG_DIR: account.dir,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_TELEMETRY: '1',
    ASHLEY_REQUEST_ID: req.id,
    ASHLEY_WORKER: WORKER,
    ASHLEY_ROOT: ROOT,
    // the ashley CLI and (when the worker job set it up) the host's Slurm client, for Claude's shell
    PATH: [path.dirname(CLAUDE), path.join(ASHLEY_HOME, 'bin'), SLURM.ok ? SLURM_BIN : '', process.env.PATH || ''].filter(Boolean).join(':'),
  });
  // only the chosen account's credential: nothing from the job environment or secrets.env may
  // override it (ANTHROPIC_AUTH_TOKEN) or send it elsewhere (ANTHROPIC_BASE_URL)
  for (const k of AUTH_VARS) delete env[k];
  shareTranscripts(account.dir);
  if (account.kind === 'api-key') env.ANTHROPIC_API_KEY = account.secret; // the login kind: Claude Code uses what it stored itself

  const eventsPath = path.join(OUTBOX, `${req.id}.events.jsonl`);
  const events = fs.createWriteStream(eventsPath, { flags: 'a' });
  events.write(JSON.stringify({ type: 'ashley', event: 'start', id: req.id, worker: WORKER, node, job, account: account.name, session: req.session, session_id: session.session_id, resume: session.resume, cwd, ts: started.toISOString() }) + '\n');
  log(`start ${req.id} session=${req.session} sid=${session.session_id} resume=${session.resume} account=${account.name} cwd=${cwd} attempt=${req.attempt || 1}`);

  const cc = claudeCommand(args);
  const child = spawn(cc.cmd, cc.args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const entry = { child, req, started, account: account.name, stderr: '' };
  running.set(req.id, entry);
  let result = null;
  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    events.write(line + '\n');
    try {
      const ev = JSON.parse(line);
      if (ev.type === 'result') result = ev;
    } catch {
      /* not JSON */
    }
  });
  child.stderr.on('data', (d) => {
    entry.stderr += d.toString('utf8');
    if (entry.stderr.length > 200000) entry.stderr = entry.stderr.slice(-100000);
  });
  const cap = setTimeout(() => {
    log(`hard cap reached for ${req.id}; killing`);
    child.kill('SIGTERM');
  }, HARD_CAP_MS);
  child.on('close', (code, signal) => {
    clearTimeout(cap);
    running.delete(req.id);
    processed++;
    const finished = new Date();
    events.write(JSON.stringify({ type: 'ashley', event: 'exit', code, signal, ts: finished.toISOString() }) + '\n');
    events.end();
    const text = result ? String(result.result || '') : '';
    const errText = `${text}\n${entry.stderr}`;
    const limited = (result && result.is_error && looksRateLimited(errText)) || (!result && looksRateLimited(entry.stderr));
    if (limited) {
      const until = parseResetTime(errText) || new Date(Date.now() + 60 * 60e3).toISOString();
      setCooldown(account, until, text || entry.stderr.slice(-500));
      log(`rate limited on ${account.name} until ${until} (${req.id})`);
      const attempt = (req.attempt || 1) + 1;
      const nextExcluded = [...excluded, account.name];
      const another = chooseAccount(undefined, new Set(nextExcluded));
      if (attempt <= MAX_ATTEMPTS && another) {
        const requeued = Object.assign({}, req, { attempt, exclude_accounts: nextExcluded });
        atomicWrite(path.join(INBOX, `${req.id}.json`), JSON.stringify(requeued));
        fs.rmSync(claimedPath, { force: true });
        log(`requeued ${req.id} for account ${another.name}`);
        return;
      }
      writeResult(req, { status: 'rate_limited', result: text, error: 'subscription window exhausted', retry_after: until, account: account.name, session_id: session.session_id, started: started.toISOString(), claude_rc: code, usage: result && result.usage, cost_usd: result && result.total_cost_usd, duration_ms: result && result.duration_ms, num_turns: result && result.num_turns });
      fs.rmSync(claimedPath, { force: true });
      return;
    }
    let status = 'ok';
    let error;
    if (!result) {
      status = signal ? 'cancelled' : 'error';
      error = `claude exited ${code}${signal ? ' by ' + signal : ''} without a result: ${entry.stderr.trim().slice(-2000)}`;
    } else if (result.is_error) {
      status = 'error';
      error = result.subtype || 'error';
    }
    if (status === 'ok' || (result && result.session_id)) saveSession(req, session, account.name, (result && result.session_id) || session.session_id, cwd);
    writeResult(req, {
      status,
      result: text,
      error,
      account: account.name,
      session_id: (result && result.session_id) || session.session_id,
      cost_usd: result && result.total_cost_usd,
      duration_ms: result && result.duration_ms,
      num_turns: result && result.num_turns,
      usage: result && result.usage,
      started: started.toISOString(),
      claude_rc: code,
    });
    fs.rmSync(claimedPath, { force: true });
    log(`done ${req.id} status=${status} turns=${result && result.num_turns} cost=${result && result.total_cost_usd} ${Math.round((finished - started) / 1000)}s`);
  });
}

function writeResult(req, r) {
  const out = Object.assign(
    { v: 1, id: req.id, status: 'ok', result: '', session: req.session || 'default', started: r.started, finished: new Date().toISOString(), node, job },
    r,
  );
  atomicWrite(path.join(OUTBOX, `${req.id}.json`), JSON.stringify(out, null, 1));
}

// ---- peers ----------------------------------------------------------------------------
// The worker Claude is told who it is and which other workers of this account are alive, and how
// to hand them work: the same inbox mechanism, from its own shell. This is how one lead worker
// can fan a task out to several others (each its own Slurm job, possibly a different container).
function peerNote() {
  const peers = [];
  try {
    for (const name of fs.readdirSync(path.join(ASHLEY_HOME, 'workers'))) {
      if (name === WORKER) continue;
      const st = safe(() => JSON.parse(fs.readFileSync(path.join(ASHLEY_HOME, 'workers', name, 'state.json'), 'utf8')), null);
      if (st && Date.now() - Date.parse(st.last_beat) < 90e3) peers.push(`${name} (node ${st.node}, ${st.status})`);
    }
  } catch {
    /* no workers dir */
  }
  return [
    `You are the Ashley worker "${WORKER}" of user ${os.userInfo().username} on Wayne State grid node ${node}, inside Slurm job ${job} (${process.env.SLURM_CPUS_PER_TASK || '?'} CPUs), in a container; the ashley command is on PATH.`,
    SLURM.ok
      ? 'Slurm works from your shell (sbatch, squeue, scancel, sacct): submit heavy or long work as its own job instead of running it in this allocation; a submitted job runs on the host with the student\'s normal environment, not in this container.'
      : `Slurm is NOT available from your shell (${SLURM.detail}): run work inside this job's allocation, and ask the student to start more workers from the laptop.`,
    peers.length ? `Other live workers of this account: ${peers.join('; ')}.` : 'No other worker of this account is alive right now.',
    'To hand work to another worker, write a request from your shell: printf \'%s\' \'{"v":1,"id":"<unique>","prompt":"...","session":"<name>","mode":"acceptEdits","max_turns":50,"created":"<iso>","from":"' + WORKER + '"}\' | ashley send --worker <name> --json ; collect it later with: ashley result --worker <name> <id> (or ashley wait). Start one with: ashley worker start --name <name> [--container <library entry>] [--gpus 1].',
    'Never run heavy work on the login node; submit jobs. Read files before changing them; keep results in files.',
  ].join(' ');
}

// ---- accounts -------------------------------------------------------------------------
// --resume finds a session only under <CLAUDE_CONFIG_DIR>/projects (measured on Claude Code
// 2.1.283: "No conversation found" from another config folder), so a request moved to another of
// the student's accounts would lose its conversation. Every account's projects/ is therefore a link
// to one ~/.ashley/projects. All accounts belong to one person, so this shares nothing between people.
const SHARED_PROJECTS = path.join(ASHLEY_HOME, 'projects');
function shareTranscripts(dir) {
  const p = path.join(dir, 'projects');
  try {
    fs.mkdirSync(SHARED_PROJECTS, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(p, { throwIfNoEntry: false });
    if (st && st.isSymbolicLink()) return;
    if (st && st.isDirectory()) {
      for (const proj of fs.readdirSync(p)) {
        const src = path.join(p, proj);
        const dst = path.join(SHARED_PROJECTS, proj);
        if (!fs.statSync(src).isDirectory()) continue;
        fs.mkdirSync(dst, { recursive: true });
        for (const f of fs.readdirSync(src)) if (!fs.existsSync(path.join(dst, f))) fs.renameSync(path.join(src, f), path.join(dst, f));
      }
      fs.renameSync(p, `${p}.before-sharing.${Date.now()}`); // anything left (a name clash) is kept, not deleted
    }
    fs.symlinkSync(SHARED_PROJECTS, p, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    if (e.code !== 'EEXIST') log(`could not share transcripts for account ${path.basename(dir)}: ${e.message}`);
  }
}
function listAccounts() {
  const out = [];
  const stateOf = (dir) => {
    let st = {};
    try {
      st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    } catch {
      /* none */
    }
    return st.cooldown_until && new Date(st.cooldown_until) > new Date() ? st.cooldown_until : null;
  };
  // the sign-in: present when Claude Code has stored its credential there (Ashley checks presence, never content)
  if (fs.existsSync(path.join(CLAUDE_HOME, '.credentials.json'))) {
    out.push({ name: 'claude', dir: CLAUDE_HOME, kind: 'login', secret: null, enabled: !fs.existsSync(path.join(CLAUDE_HOME, 'disabled')), cooldown_until: stateOf(CLAUDE_HOME) });
  }
  // the student's own Anthropic Console key (Commercial Terms), used only when the subscription window is exhausted
  const keyDir = path.join(ACCOUNTS, 'apikey');
  if (fs.existsSync(path.join(keyDir, 'apikey'))) {
    out.push({ name: 'apikey', dir: keyDir, kind: 'api-key', secret: readFirstLine(path.join(keyDir, 'apikey')), enabled: !fs.existsSync(path.join(keyDir, 'disabled')), cooldown_until: stateOf(keyDir) });
  }
  return out;
}
function chooseAccount(forced, excluded) {
  const all = listAccounts().filter((a) => a.kind !== 'login' || claudeLogin.loggedIn || claudeLogin.checked === null);
  if (forced) return all.find((a) => a.name === forced && a.enabled) || null;
  return all.find((a) => a.enabled && !a.cooldown_until && !excluded.has(a.name)) || null;
}
function soonestCooldown() {
  const c = listAccounts()
    .filter((a) => a.enabled && a.cooldown_until)
    .map((a) => a.cooldown_until)
    .sort();
  return c[0] || null;
}
function setCooldown(account, until, why) {
  atomicWrite(path.join(account.dir, 'state.json'), JSON.stringify({ cooldown_until: until, last_error: (why || '').slice(0, 500), updated: new Date().toISOString() }, null, 1));
}

// ---- sessions -------------------------------------------------------------------------
function sessionPath(name) {
  return path.join(SESSIONS, `${name.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
}
function resolveSession(req) {
  const name = req.session || 'default';
  let stored = null;
  try {
    stored = JSON.parse(fs.readFileSync(sessionPath(name), 'utf8'));
  } catch {
    /* new */
  }
  const wantCwd = req.cwd ? expandHome(req.cwd) : null;
  if (stored && stored.session_id && (!wantCwd || wantCwd === stored.cwd) && fs.existsSync(stored.cwd)) {
    return { session_id: stored.session_id, cwd: stored.cwd, resume: true };
  }
  const cwd = wantCwd || (stored && stored.cwd) || path.join(ROOT, 'workspaces', name.replace(/[^A-Za-z0-9_.-]/g, '_'));
  return { session_id: crypto.randomUUID(), cwd, resume: false };
}
function saveSession(req, session, account, sessionId, cwd) {
  const name = req.session || 'default';
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(sessionPath(name), 'utf8'));
  } catch {
    /* new */
  }
  atomicWrite(sessionPath(name), JSON.stringify({ session: name, session_id: sessionId, cwd, account, updated: new Date().toISOString(), requests: (prev.requests || 0) + 1, worker: WORKER }, null, 1));
}

// ---- state / stop ---------------------------------------------------------------------
function writeState(status) {
  const queued = safe(() => fs.readdirSync(INBOX).filter((f) => f.endsWith('.json')).length, 0);
  const accounts = listAccounts().map((a) => ({ name: a.name, kind: a.kind, enabled: a.enabled, cooldown_until: a.cooldown_until }));
  const allCooling = accounts.length > 0 && accounts.every((a) => !a.enabled || a.cooldown_until);
  const st = {
    worker: WORKER,
    node,
    job,
    pid: process.pid,
    started: startedAt,
    last_beat: new Date().toISOString(),
    status: status || (stopping ? 'stopping' : !license.ok ? 'unlicensed' : allCooling ? 'blocked' : running.size ? 'busy' : 'idle'),
    concurrency: CONCURRENCY,
    running: [...running.keys()],
    queued,
    processed,
    claude_version: claudeVersion,
    accounts,
    blocked_until: allCooling ? soonestCooldown() : null,
    phone: phone ? phone.phase() : 'unavailable',
    slurm: SLURM,
    license,
    claude_login: claudeLogin,
  };
  atomicWrite(STATE, JSON.stringify(st, null, 1));
}
function beginStop(why) {
  if (stopping) return;
  stopping = true;
  log(`stopping (${why}); ${running.size} running`);
  if (phone) phone.stop();
  writeState('stopping');
  setTimeout(() => {
    for (const [id, e] of running) {
      log(`killing ${id} after grace`);
      e.child.kill('SIGTERM');
    }
  }, 90000).unref();
}
function finish() {
  clearInterval(timer);
  clearInterval(beat);
  clearInterval(phoneTimer);
  clearInterval(licenseTimer);
  clearInterval(loginTimer);
  if (phone) phone.stop();
  writeState('stopping');
  log('exit');
  safe(() => fs.rmSync(STOP, { force: true }));
  logStream.end(() => process.exit(0));
}
function recoverClaimed() {
  for (const f of fs.readdirSync(INBOX)) {
    if (f.endsWith('.json.claimed')) {
      fs.renameSync(path.join(INBOX, f), path.join(INBOX, f.replace(/\.claimed$/, '')));
      log(`recovered ${f}`);
    }
  }
}

// ---- utils ----------------------------------------------------------------------------
function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) {
      const k = a[i].slice(2);
      const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : 'true';
      o[k] = v;
    }
  }
  return o;
}
function must(v, name) {
  if (!v) {
    process.stderr.write(`ashleyd: ${name} is required\n`);
    process.exit(2);
  }
  return v;
}
function atomicWrite(p, data) {
  fs.writeFileSync(p + '.part', data);
  fs.renameSync(p + '.part', p);
}
function readFirstLine(p) {
  try {
    return fs.readFileSync(p, 'utf8').split('\n')[0].trim();
  } catch {
    return '';
  }
}
function readEnvFile(p) {
  const out = {};
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  } catch {
    /* no secrets */
  }
  return out;
}
function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}
function safe(fn, dflt) {
  try {
    return fn();
  } catch {
    return dflt;
  }
}
