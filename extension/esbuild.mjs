// Bundles the extension, the MCP server and (with --tests) the test files.
// Everything the extension needs at run time ends up under dist/, so the .vsix
// carries no node_modules ("vsce package --no-dependencies").
import * as esbuild from 'esbuild';
import { readdirSync, statSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: !production,
  minify: false,
  logLevel: 'info',
  define: { 'process.env.ASHLEY_BUILD': JSON.stringify(new Date().toISOString()) },
};

const builds = [
  // The VS Code extension host entry point. 'vscode' is provided by the host.
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] },
  // The MCP server Claude Code launches as a child process (plain Node, no vscode).
  { ...common, entryPoints: ['src/mcp/server.ts'], outfile: 'dist/mcp-server.js', banner: { js: '#!/usr/bin/env node' } },
  // The local CLI (plain Node), used by Xcode / terminal users and by the tests.
  { ...common, entryPoints: ['src/cli/main.ts'], outfile: 'dist/ashley-cli.js', banner: { js: '#!/usr/bin/env node' } },
];

function listTests(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...listTests(p));
    else if (/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
}

if (tests) {
  // Unit tests run with node --test against dist-test/unit; VS Code integration tests
  // are compiled one file per suite so @vscode/test-cli can pick them up.
  const unit = listTests('src').filter((p) => !p.includes('vscode-test'));
  const integ = listTests('src').filter((p) => p.includes('vscode-test'));
  builds.push({ ...common, entryPoints: unit, outdir: 'dist-test/unit', external: ['vscode'], outbase: 'src' });
  builds.push({ ...common, entryPoints: integ, outdir: 'dist-test/vscode', external: ['vscode', 'mocha'], outbase: 'src' });
}

// The grid-side scripts ship inside the extension so the wizard can upload them. They are
// copied with LF line endings whatever the checkout did: CR breaks bash and sbatch on the grid.
mkdirSync('dist/grid', { recursive: true });
const gridSrc = join('..', 'grid');
if (existsSync(gridSrc)) {
  for (const f of readdirSync(gridSrc)) {
    const src = join(gridSrc, f);
    if (!statSync(src).isFile()) continue;
    writeFileSync(join('dist/grid', f), readFileSync(src, 'utf8').replace(/\r\n/g, '\n'));
  }
}

for (const cfg of builds) {
  if (watch) {
    const ctx = await esbuild.context(cfg);
    await ctx.watch();
  } else {
    await esbuild.build(cfg);
  }
}
if (watch) console.log('watching...');
