import { defineConfig } from '@vscode/test-cli';

// Integration tests run inside a real VS Code (downloaded once to .vscode-test/).
// 'unit' (default): no network. 'live': runs the whole troubleshooter against the real grid,
// read-only, using this machine's SSH setup; run with: npx vscode-test --label live
export default defineConfig([
  {
    label: 'unit',
    files: 'dist-test/vscode/**/extension.test.js',
    version: 'stable',
    workspaceFolder: './test-fixtures/workspace',
    launchArgs: ['--disable-extensions', '--disable-gpu'],
    mocha: { ui: 'tdd', timeout: 60_000 },
  },
  {
    label: 'live',
    files: 'dist-test/vscode/**/live.test.js',
    version: 'stable',
    workspaceFolder: './test-fixtures/live',
    launchArgs: ['--disable-gpu'],
    env: { ASHLEY_LIVE: '1' },
    mocha: { ui: 'tdd', timeout: 600_000 },
  },
]);
