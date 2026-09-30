import { defineConfig } from '@vscode/test-cli';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Integration tests run inside a real VS Code (downloaded once to .vscode-test/).
// 'unit' (default): no network; the license files live in a fresh temporary folder.
// 'live': runs the whole troubleshooter against the real grid, read-only, using this machine's
//   SSH setup and license; run with: npx vscode-test --label live
// 'package': the packaged extension, unpacked (tools/release.mjs does this), minified and trusting
//   only the release keys; run with: BEETHOVEN_PACKAGED_EXT=<dir> npx vscode-test --label package
const scratch = (p) => mkdtempSync(join(tmpdir(), p));
export default defineConfig([
  {
    label: 'unit',
    files: 'dist-test/vscode/**/extension.test.js',
    version: 'stable',
    workspaceFolder: './test-fixtures/workspace',
    launchArgs: ['--disable-extensions', '--disable-gpu'],
    env: { BEETHOVEN_LICENSE_DIR: scratch('beethoven-vsc-lic-') },
    mocha: { ui: 'tdd', timeout: 60_000 },
  },
  {
    label: 'live',
    files: 'dist-test/vscode/**/live.test.js',
    version: 'stable',
    workspaceFolder: './test-fixtures/live',
    launchArgs: ['--disable-gpu'],
    env: { BEETHOVEN_LIVE: '1' },
    mocha: { ui: 'tdd', timeout: 600_000 },
  },
  {
    label: 'package',
    files: 'dist-test/vscode/**/package.test.js',
    version: 'stable',
    extensionDevelopmentPath: resolve(process.env.BEETHOVEN_PACKAGED_EXT || '../dist/unpacked/extension'),
    workspaceFolder: './test-fixtures/workspace',
    launchArgs: ['--disable-extensions', '--disable-gpu'],
    env: { BEETHOVEN_LICENSE_DIR: scratch('beethoven-pkg-lic-'), BEETHOVEN_RELEASE_TEST_LICENSE: process.env.BEETHOVEN_RELEASE_TEST_LICENSE || '' },
    mocha: { ui: 'tdd', timeout: 120_000 },
  },
]);
