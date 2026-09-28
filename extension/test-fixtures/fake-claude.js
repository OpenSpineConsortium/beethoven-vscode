#!/usr/bin/env node
// A stand-in for `claude -p ... --output-format stream-json` used by the daemon tests.
// Behaviour is steered by files in CLAUDE_CONFIG_DIR (the account directory):
//   fake_rate_limit   -> answer like an exhausted subscription window
//   fake_crash        -> exit 1 with no result
// It records the argv it received in <cwd>/fake_argv.json so tests can assert on it.
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
fs.writeFileSync(path.join(process.cwd(), 'fake_argv.json'), JSON.stringify({ args, env: { CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || null, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null, HF_TOKEN: process.env.HF_TOKEN || null } }));
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
