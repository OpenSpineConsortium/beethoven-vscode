// Bundles the extension, the MCP server and (with --tests) the test files.
// Everything the extension needs at run time ends up under dist/, so the .vsix
// carries no node_modules ("vsce package --no-dependencies").
import * as esbuild from 'esbuild';
import { readdirSync, statSync, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey } from 'node:crypto';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';

if (production && tests) throw new Error('a production build never includes the tests or their signing key');

// Test builds trust one extra license signing key whose private half is committed under
// test-fixtures (so tests can issue keys). Production builds trust only grid/license_keys.json.
function testKeys() {
  const pem = readFileSync('test-fixtures/license/test-signing-key.pem', 'utf8');
  const der = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'der' });
  return { test: der.subarray(der.length - 32).toString('base64') };
}
if (production && Object.keys(JSON.parse(readFileSync('../grid/license_keys.json', 'utf8'))).length === 0) {
  throw new Error('grid/license_keys.json trusts no signing key: run tools/license/beethoven-license.mjs init before a release build');
}

const NOTICE = '/*! Beethoven for VS Code (c) 2026 OpenSpineConsortium. Licensed software: use requires an access key. See LICENSE.txt (Trial Edition), LICENSE-FULL.txt (Full Edition) and THIRD_PARTY_NOTICES.md. */';
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // releases ship readable (unminified) code and no source maps: the Marketplace's scanners have
  // removed minified bundles before, and a map would carry the whole TypeScript source
  sourcemap: !production,
  minify: false,
  legalComments: 'eof',
  logLevel: 'info',
  metafile: true,
  define: {
    'process.env.BEETHOVEN_BUILD': JSON.stringify(new Date().toISOString()),
    // the CLI and the MCP server report the extension's version (they cannot read package.json at run time)
    'process.env.BEETHOVEN_VERSION': JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version),
    __BEETHOVEN_TEST_KEYS__: tests ? JSON.stringify(testKeys()) : 'undefined',
  },
};

const builds = [
  // The VS Code extension host entry point. 'vscode' is provided by the host.
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode', 'cpu-features', '*.node'], banner: { js: NOTICE } },
  // The MCP server Claude Code launches as a child process (plain Node, no vscode).
  { ...common, entryPoints: ['src/mcp/server.ts'], outfile: 'dist/mcp-server.js', external: ['cpu-features', '*.node'], banner: { js: `#!/usr/bin/env node\n${NOTICE}` } },
  // The local CLI (plain Node), used by Xcode / terminal users and by the tests.
  { ...common, entryPoints: ['src/cli/main.ts'], outfile: 'dist/beethoven-cli.js', external: ['cpu-features', '*.node'], banner: { js: `#!/usr/bin/env node\n${NOTICE}` } },
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
  builds.push({ ...common, entryPoints: unit, outdir: 'dist-test/unit', external: ['vscode', 'cpu-features', '*.node'], outbase: 'src' });
  builds.push({ ...common, entryPoints: integ, outdir: 'dist-test/vscode', external: ['vscode', 'mocha', 'cpu-features', '*.node'], outbase: 'src' });
}

// The grid-side scripts ship inside the extension so the wizard can upload them. They are
// copied with LF line endings whatever the checkout did: CR breaks bash and sbatch on the grid.
// The folder is emptied first, so a script renamed in grid/ (ashley -> beethoven) leaves no stale copy.
rmSync('dist/grid', { recursive: true, force: true });
mkdirSync('dist/grid', { recursive: true });
const gridSrc = join('..', 'grid');
if (existsSync(gridSrc)) {
  for (const f of readdirSync(gridSrc)) {
    const src = join(gridSrc, f);
    if (!statSync(src).isFile() || f.endsWith('.d.ts')) continue;
    writeFileSync(join('dist/grid', f), readFileSync(src, 'utf8').replace(/\r\n/g, '\n'));
  }
}

// a release must not carry maps left over from an earlier development build
if (production) for (const f of readdirSync('dist')) if (f.endsWith('.map')) rmSync(join('dist', f));
mkdirSync('build-meta', { recursive: true });
for (const cfg of builds) {
  if (watch) {
    const ctx = await esbuild.context(cfg);
    await ctx.watch();
  } else {
    const res = await esbuild.build(cfg);
    // which packages went into each bundle: tools/third_party_notices.mjs reads these
    if (res.metafile && cfg.outfile) writeFileSync(join('build-meta', cfg.outfile.replace(/^dist\//, '') + '.json'), JSON.stringify(res.metafile));
  }
}
if (watch) console.log('watching...');
