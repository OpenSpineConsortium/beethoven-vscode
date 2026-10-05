// The variables that could put Claude Code on a key, a token or another provider are taken away in five
// places: the laptop's terminals (services.ts), the grid daemon and phone access (AUTH_VARS), the grid's
// sign-in sitting (claude_in_alloc) and the sign-in relay. They are kept equal to hpcworker's CLEAN_ENV by
// hand, so this reads all five as text and fails the moment one drifts from the others or from the copy of
// hpcworker's list below. Tokens Beethoven passes on purpose (GitHub, Hugging Face) must never be on the list.
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

// hpcworker's own list: the browser and desktop editions follow that repository, so this is the comparison
// that keeps the three editions one rule. A verbatim copy of its CLEAN_ENV is kept with the tests and compared
// on every run; when HPCWORKER_DIR names a checkout, the copy is compared with hpcworker's own as well, so a
// change there fails here until the copy and the five lists follow it.
function cleanEnvCredentials(text: string): string[] {
  const m = /CLEAN_ENV=\(env ([^)]*)\)/.exec(text);
  assert.ok(m, 'declares CLEAN_ENV');
  // the two Remote Control switches are not credentials: the daemon sets one of them on purpose
  return [...m[1].matchAll(/-u ([A-Z0-9_]+)/g)].map((x) => x[1]).filter((k) => k !== 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC' && k !== 'DISABLE_GROWTHBOOK');
}
const copy = cleanEnvCredentials(read('extension/test-fixtures/hpcworker/clean_env.txt'));

test('the strip list equals hpcworker\'s CLEAN_ENV credential variables (the copy kept with the tests)', () => {
  assert.deepEqual(sorted([...CLAUDE_CREDENTIAL_ENV]), sorted(copy));
});

const hpcworker = process.env.HPCWORKER_DIR ? path.join(process.env.HPCWORKER_DIR, 'framework', 'jobs', 'worker.sbatch.tpl') : '';
test('and that copy equals hpcworker\'s own', { skip: hpcworker && fs.existsSync(hpcworker) ? false : 'set HPCWORKER_DIR to an hpcworker checkout to check the copy is current' }, () => {
  assert.deepEqual(sorted(cleanEnvCredentials(fs.readFileSync(hpcworker, 'utf8'))), sorted(copy), 'hpcworker changed its list: copy its CLEAN_ENV into test-fixtures/hpcworker/clean_env.txt and the five lists here');
});
