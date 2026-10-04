// The variables that could put Claude Code on a key, a token or another provider are taken away in five
// places: the laptop's terminals (services.ts), the grid daemon and phone access (AUTH_VARS), the grid's
// sign-in sitting (claude_in_alloc) and the sign-in relay. They are kept equal to hpcworker's CLEAN_ENV by
// hand, so this reads all five as text and fails the moment one drifts. Tokens Beethoven passes on purpose
// (GitHub, Hugging Face) must never be on the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CLAUDE_CREDENTIAL_ENV } from './services';

const repo = path.resolve(__dirname, '..', '..', '..', '..'); // dist-test/unit/core -> repository root
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

function jsList(rel: string): string[] {
  const m = /const AUTH_VARS = \[([^\]]*)\]/.exec(read(rel));
  assert.ok(m, `${rel} declares AUTH_VARS`);
  return [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]);
}
function shellList(rel: string, decl: RegExp): string[] {
  const line = read(rel).split('\n').find((l) => decl.test(l));
  assert.ok(line, `${rel} declares auth_unset`);
  return [...line.matchAll(/-u ([A-Z0-9_]+)/g)].map((x) => x[1]);
}

const lists: Record<string, string[]> = {
  'extension/src/core/services.ts (CLAUDE_CREDENTIAL_ENV)': [...CLAUDE_CREDENTIAL_ENV],
  'grid/beethovend.js (AUTH_VARS)': jsList('grid/beethovend.js'),
  'grid/phone.js (AUTH_VARS)': jsList('grid/phone.js'),
  'grid/beethoven (claude_in_alloc)': shellList('grid/beethoven', /^\s*local auth_unset=\(/),
  'grid/login_relay.sh': shellList('grid/login_relay.sh', /^\s*auth_unset="/),
};
const sorted = (a: string[]) => [...new Set(a)].sort();

test('the five strip lists are one list', () => {
  const [first, ...rest] = Object.entries(lists);
  assert.ok(first[1].length >= 15, `${first[0]} has the whole list`);
  for (const [where, l] of Object.entries(lists)) assert.equal(new Set(l).size, l.length, `${where} names a variable twice`);
  for (const [where, l] of rest) assert.deepEqual(sorted(l), sorted(first[1]), `${where} differs from ${first[0]}`);
});

test('the strip list takes away keys, tokens, gateways and other providers, never the tokens passed on purpose', () => {
  const l = new Set(CLAUDE_CREDENTIAL_ENV as readonly string[]);
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) assert.ok(l.has(k), k);
  for (const [where, list] of Object.entries(lists)) {
    for (const k of ['GITHUB_TOKEN', 'GH_TOKEN', 'HF_TOKEN']) assert.ok(!list.includes(k), `${where} must not strip ${k}`);
  }
});

// hpcworker's own list, when its checkout is beside this one (HPCWORKER_DIR); the browser and desktop
// editions follow that repository, so this is the comparison that keeps the three editions one rule
const hpcworker = process.env.HPCWORKER_DIR ? path.join(process.env.HPCWORKER_DIR, 'framework', 'jobs', 'worker.sbatch.tpl') : '';
test('the strip list equals hpcworker\'s CLEAN_ENV credential variables', { skip: hpcworker && fs.existsSync(hpcworker) ? false : 'set HPCWORKER_DIR to an hpcworker checkout' }, () => {
  const t = fs.readFileSync(hpcworker, 'utf8');
  const m = /CLEAN_ENV=\(env ([^)]*)\)/.exec(t);
  assert.ok(m, 'hpcworker declares CLEAN_ENV');
  // the two Remote Control switches are not credentials: the daemon sets one of them on purpose
  const theirs = [...m[1].matchAll(/-u ([A-Z0-9_]+)/g)].map((x) => x[1]).filter((k) => k !== 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' && k !== 'DISABLE_GROWTHBOOK');
  assert.deepEqual(sorted([...CLAUDE_CREDENTIAL_ENV]), sorted(theirs));
});
