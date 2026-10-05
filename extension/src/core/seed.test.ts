// Claude Code's .claude.json in a sign-in folder is Claude Code's own record (the student's Remote Control
// answer, their account, every folder's trust). Three places seed it with first-run settings: phone access
// before Remote Control starts (grid/phone.js), the grid's sign-in sitting (grid/beethoven claude_in_alloc)
// and the sign-in relay (grid/login_relay.sh). Each may only add the three keys the rule allows, and a file
// that exists but does not parse must be left as it is: treated as empty, it was replaced by those keys alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(__dirname, '..', '..', '..', '..'); // dist-test/unit/core -> repository root
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

// the shell seeds, as the scripts carry them
const gridSeed = /^\s*local seed='([^']*)'$/m.exec(read('grid/beethoven'))?.[1] ?? '';
const relaySeed = /<<'JS'\n([\s\S]*?)\nJS\n/.exec(read('grid/login_relay.sh'))?.[1] ?? '';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { seedClaudeJson } = require(path.join(repo, 'grid', 'phone.js'));
const node = (js: string) => (dir: string, cwd: string) => {
  const r = spawnSync(process.execPath, ['-e', js], { cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
const SEEDS: [string, (dir: string, cwd: string) => void][] = [
  ['grid/phone.js (phone access)', (dir, cwd) => void seedClaudeJson(dir, cwd)],
  ['grid/beethoven (claude login)', node(gridSeed)],
  ['grid/login_relay.sh (the sign-in relay)', node(relaySeed)],
];

const THEIRS = { numStartups: 7, userID: 'u1', theme: 'light', remoteDialogSeen: true, remoteControlMachineId: 'm1', oauthAccount: { emailAddress: 'ab1234@wayne.edu' }, projects: { '/elsewhere': { hasTrustDialogAccepted: true } } };

test('the shell seeds are found where the scripts keep them', () => {
  assert.match(gridSeed, /\.claude\.json/);
  assert.match(relaySeed, /\.claude\.json/);
});

for (const [where, seed] of SEEDS) {
  test(`${where}: adds the three keys and keeps every other, leaves a file that does not parse as it is`, () => {
    const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-seed-'));
    try {
      const dir = path.join(h, 'claude');
      fs.mkdirSync(path.join(h, 'phone'));
      const cwd = fs.realpathSync(path.join(h, 'phone')); // what process.cwd() gives the shell seeds
      fs.mkdirSync(dir);
      const f = path.join(dir, '.claude.json');
      // none yet: the three keys
      seed(dir, cwd);
      let j = JSON.parse(fs.readFileSync(f, 'utf8'));
      assert.equal(j.hasCompletedOnboarding, true);
      assert.equal(j.theme, 'dark');
      assert.equal(j.projects[cwd].hasTrustDialogAccepted, true);
      // Claude Code's own record: everything kept, the student's theme too
      fs.writeFileSync(f, JSON.stringify(THEIRS, null, 2));
      seed(dir, cwd);
      j = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const [k, v] of Object.entries(THEIRS)) if (k !== 'projects') assert.deepEqual(j[k], v, `${k} kept`);
      assert.equal(j.projects['/elsewhere'].hasTrustDialogAccepted, true, 'another folder\'s trust kept');
      assert.equal(j.projects[cwd].hasTrustDialogAccepted, true);
      // already there: not written again (a write races Claude Code's own)
      const settled = JSON.stringify({ ...THEIRS, hasCompletedOnboarding: true, projects: { [cwd]: { hasTrustDialogAccepted: true } } });
      fs.writeFileSync(f, settled);
      seed(dir, cwd);
      assert.equal(fs.readFileSync(f, 'utf8'), settled, 'nothing to add, nothing written');
      // cut off mid-write, or damaged: left byte for byte
      const cut = JSON.stringify(THEIRS, null, 2).slice(0, 150);
      fs.writeFileSync(f, cut);
      seed(dir, cwd);
      assert.equal(fs.readFileSync(f, 'utf8'), cut, 'a file that does not parse is left as it is');
      assert.equal(fs.existsSync(f + '.part'), false);
    } finally {
      fs.rmSync(h, { recursive: true, force: true });
    }
  });
}
