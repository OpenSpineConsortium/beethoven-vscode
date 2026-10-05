// beethoven_read_file and beethoven_list_dir, which the laptop's Claude can call, read the grid through
// GridApi.readFile and listDir. Beethoven never reads or relays a Claude credential: by the grid's resolved
// path nothing in a sign-in folder (the launcher's, the engine's accounts, through any link) or ~/.ssh is read,
// no file named like a credential or a token copy is read anywhere, and what is read loses credential-shaped
// text. The real remote line runs here through a stand-in ssh that hands it to bash in a made-up home.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GridApi } from './gridApi';
import { redactCredentials } from './redact';

const skip = process.platform === 'linux' ? false : 'needs bash and GNU readlink, as on the grid';
const CRED = '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-SECRETSECRETSECRET","refreshToken":"sk-ant-ort01-SECRETSECRETSECRET"}}';

test('the read tools never hand over a Claude sign-in, a key or a token, by any path to it', { skip }, async () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'beethoven-read-'));
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
  try {
    const put = (rel: string, body: string) => {
      fs.mkdirSync(path.dirname(path.join(h, rel)), { recursive: true });
      fs.writeFileSync(path.join(h, rel), body);
    };
    put('.beethoven/claude/.credentials.json', CRED);
    put('.beethoven/accounts/alt/claude/.credentials.json', CRED);
    put('elsewhere/signin/.credentials.json', CRED); // an engine account whose folder lives outside ~/.beethoven
    fs.symlinkSync(path.join(h, 'elsewhere', 'signin'), path.join(h, '.beethoven', 'accounts', 'far'));
    fs.mkdirSync(path.join(h, '.beethoven', 'accounts', 'outside'));
    fs.symlinkSync(path.join(h, 'elsewhere', 'signin'), path.join(h, '.beethoven', 'accounts', 'outside', 'claude'));
    fs.symlinkSync('../claude', path.join(h, '.beethoven', 'accounts', 'main'));
    fs.symlinkSync('.beethoven', path.join(h, '.ashley'));
    put('.claude/.credentials.json', CRED);
    put('.ssh/id_ed25519', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n');
    put('.beethoven/secrets.env', 'GITHUB_TOKEN=ghp_x\n');
    put('.beethoven/license.key', 'BEETHOVEN1.a.b\n');
    put('work/notes.md', 'my notes\n');
    put('work/run.log', `started\nAuthorization: Bearer abcdefghijklmnop\nANTHROPIC_API_KEY=sk-ant-api03-leak\n${CRED}\nfinished\n`);
    fs.symlinkSync(path.join(h, '.beethoven', 'claude', '.credentials.json'), path.join(h, 'work', 'innocent.txt'));
    fs.symlinkSync(path.join(h, '.beethoven', 'claude'), path.join(h, 'work', 'cfg'));
    // ssh as the grid runs it: the remote line goes to the login shell, ~ expands there
    const fakeBin = path.join(h, 'fakebin');
    fs.mkdirSync(fakeBin);
    fs.writeFileSync(path.join(fakeBin, 'ssh'), '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done; shift\nexec bash -c "$1"\n', { mode: 0o755 });
    process.env.PATH = `${fakeBin}:${saved.PATH}`;
    process.env.HOME = h;
    const grid = new GridApi('wsu-grid');

    for (const p of ['~/.beethoven/claude/.credentials.json', '~/.ashley/claude/.credentials.json', '~/.beethoven/accounts/alt/claude/.credentials.json', '~/.beethoven/accounts/main/.credentials.json', '~/elsewhere/signin/.credentials.json', '~/.claude/.credentials.json', '~/work/innocent.txt', '~/work/cfg/.credentials.json', '~/.ssh/id_ed25519', '~/.beethoven/secrets.env', '~/.beethoven/license.key', `${h}/.beethoven/claude/../claude/.credentials.json`]) {
      const r = await grid.readFile(p);
      assert.equal(r.ok, false, `${p} refused`);
      assert.doesNotMatch(r.text, /SECRET|PRIVATE KEY|ghp_x|BEETHOVEN1/, `${p}: nothing of it handed over`);
      assert.match(r.text, /Beethoven does not read/, p);
    }
    for (const p of ['~/.beethoven/claude', '~/work/cfg', '~/.beethoven/accounts', '~/.ssh']) {
      const r = await grid.listDir(p);
      assert.equal(r.ok, false, `${p} not listed`);
    }
    const notes = await grid.readFile('~/work/notes.md');
    assert.deepEqual(notes, { ok: true, text: 'my notes\n' });
    assert.equal((await grid.readFile('~/work/notes.md', 3)).text, 'my ');
    const log = await grid.readFile('~/work/run.log');
    assert.equal(log.ok, true);
    assert.match(log.text, /started[\s\S]*finished/);
    assert.doesNotMatch(log.text, /SECRET|sk-ant-|abcdefghijklmnop/, 'credential-shaped text in a readable file is removed');
    const listing = await grid.listDir('~/work');
    assert.equal(listing.ok, true);
    assert.match(listing.text, /notes\.md/);
  } finally {
    process.env.PATH = saved.PATH;
    process.env.HOME = saved.HOME;
    fs.rmSync(h, { recursive: true, force: true });
  }
});

test('credential-shaped text is removed, ordinary text kept', () => {
  assert.equal(redactCredentials('a 0123456789abcdef0123456789abcdef01234567 commit'), 'a 0123456789abcdef0123456789abcdef01234567 commit');
  assert.equal(redactCredentials('"accessToken": "abc"'), '"accessToken": "[redacted]"');
  assert.equal(redactCredentials('key sk-ant-oat01-XYZ end'), 'key [redacted] end');
});
