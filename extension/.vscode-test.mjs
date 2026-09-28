import { defineConfig } from '@vscode/test-cli';

// Integration tests run inside a real VS Code (downloaded once to .vscode-test/).
export default defineConfig({
  files: 'dist-test/vscode/**/*.test.js',
  version: 'stable',
  workspaceFolder: './test-fixtures/workspace',
  launchArgs: ['--disable-extensions', '--disable-gpu'],
  mocha: { ui: 'tdd', timeout: 60_000 },
});
