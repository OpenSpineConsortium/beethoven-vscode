#!/usr/bin/env node
// A stand-in for `claude -p ... --output-format stream-json` used by the daemon tests.
// Behaviour is steered by files in CLAUDE_CONFIG_DIR (the sign-in folder):
//   fake_rate_limit   -> answer like an exhausted subscription window
//   fake_crash        -> exit 1 with no result
// It records the argv it received in <cwd>/fake_argv.json so tests can assert on it.
// Like Claude Code 2.1.283 (measured), it keeps transcripts in
// <CLAUDE_CONFIG_DIR>/projects/<cwd with every non-alphanumeric replaced by '-'>/<session>.jsonl,
// creates that file as soon as a run starts, and refuses --resume when it is not there
// ("No conversation found with session ID: ..."), so tests catch a resume that looks in a folder without the shared history.
// For phone access it also answers `auth status`, `auth login` (code 'goodcode' signs in) and
// `remote-control` (prints a session link, records its environment, runs until killed).
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const cfg = process.env.CLAUDE_CONFIG_DIR || '';
const prompt = args[args.indexOf('-p') + 1] || '';
const resumeIdx = args.indexOf('--resume');
const sidIdx = args.indexOf('--session-id');
const sessionId = resumeIdx >= 0 ? args[resumeIdx + 1] : sidIdx >= 0 ? args[sidIdx + 1] : 'fake-session';
if (args[0] === '--version') {
  console.log('9.9.9 (fake claude)');
  process.exit(0);
}
const AUTH_VARS = ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];
if (args[0] === 'auth' && args[1] === 'status') {
  // like Claude Code 2.1.283: JSON with loggedIn and authMethod; the e-mail when signed in
  const on = fs.existsSync(path.join(cfg, 'fake_logged_in'));
  console.log(JSON.stringify(on ? { loggedIn: true, authMethod: 'claude.ai', email: 'ab1234@wayne.edu', subscriptionType: 'pro' } : { loggedIn: false, authMethod: 'none' }));
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'login') {
  process.stdout.write('Open this link to sign in: https://claude.ai/oauth/authorize?fake=1\nPaste code here if prompted > ');
  let buf = '';
  process.stdin.on('data', (d) => {
    buf += d.toString('utf8');
    const lines = buf.split(/[\r\n]/);
    buf = lines.pop();
    for (const l of lines.map((x) => x.trim()).filter(Boolean)) {
      if (l === 'goodcode') {
        fs.mkdirSync(cfg, { recursive: true });
        fs.writeFileSync(path.join(cfg, 'fake_logged_in'), '');
        process.stdout.write('\nLogin successful\n');
        process.exit(0);
      }
      process.stdout.write('\nInvalid code. Please make sure the full code was copied.\nPaste code here if prompted > ');
    }
  });
  return;
}
if (args[0] === 'remote-control') {
  if (!fs.existsSync(path.join(cfg, 'fake_logged_in'))) {
    process.stdout.write('Error: You must be logged in to use Remote Control.\n');
    process.exit(1);
  }
  const seen = {};
  for (const k of AUTH_VARS) seen[k] = process.env[k] ?? null;
  fs.writeFileSync(path.join(cfg, 'fake_rc_env.json'), JSON.stringify({ env: seen, cwd: process.cwd(), pid: process.pid }));
  process.stdout.write('Remote Control active: https://claude.ai/code/session_fake123\n');
  setInterval(() => {}, 1000);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGHUP', () => process.exit(0));
  return;
}
fs.writeFileSync(path.join(process.cwd(), 'fake_argv.json'), JSON.stringify({ args, env: { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || null, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null, HF_TOKEN: process.env.HF_TOKEN || null } }));
// -p needs a credential: the stored sign-in (fake_logged_in in the config folder) or, as Claude Code would take one,
// an API key in the environment (which is why the daemon strips every such variable; the tests check it is absent)
if (!fs.existsSync(path.join(cfg, 'fake_logged_in')) && !process.env.ANTHROPIC_API_KEY && !process.env.CLAUDE_CODE_OAUTH_TOKEN) {
  process.stdout.write('Not logged in · Please run /login\n');
  process.exit(1);
}
const transcriptDir = path.join(cfg, 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
const transcript = path.join(transcriptDir, `${sessionId}.jsonl`);
if (resumeIdx >= 0 && !fs.existsSync(transcript)) {
  process.stderr.write(`No conversation found with session ID: ${sessionId}\n`);
  process.exit(1);
}
fs.mkdirSync(transcriptDir, { recursive: true });
fs.appendFileSync(transcript, JSON.stringify({ type: 'user', prompt }) + '\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', cwd: process.cwd(), session_id: sessionId, tools: ['Read', 'Bash'] });
if (fs.existsSync(path.join(cfg, 'fake_crash'))) {
  process.stderr.write('fake crash\n');
  process.exit(1);
}
if (fs.existsSync(path.join(cfg, 'fake_rate_limit'))) {
  out({ type: 'result', subtype: 'success', is_error: true, result: "You've hit your limit. Your limit will reset at 11pm.", session_id: sessionId, total_cost_usd: 0, duration_ms: 5, num_turns: 1, usage: {} });
  process.exit(1);
}
out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'echo hi' } }] } });
out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `echo: ${prompt}` }] } });
out({ type: 'result', subtype: 'success', is_error: false, result: `echo: ${prompt}${resumeIdx >= 0 ? ' (resumed)' : ''}`, session_id: sessionId, total_cost_usd: 0.001, duration_ms: 12, num_turns: 2, usage: { input_tokens: 1, output_tokens: 2 } });
