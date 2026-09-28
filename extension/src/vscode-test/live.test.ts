// Live: the whole troubleshooter against the real grid, read-only (no repairs), through VS Code's
// own APIs. Needs this machine's SSH setup for the grid. npx vscode-test --label live
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Ashley live troubleshooter', () => {
  test('walks the whole graph against the grid and names root causes', async function () {
    if (process.env.ASHLEY_LIVE !== '1') this.skip();
    const ext = vscode.extensions.getExtension('openspineconsortium.ashley')!;
    await ext.activate();
    const { buildGraph, runDiagnostics, formatReport, makeCtx, storeFor } = (ext.exports as any)._internal;
    const ctx = makeCtx(storeFor(), true, (l: string) => console.log(`  [log] ${l}`));
    const rep = await runDiagnostics(buildGraph(), ctx, { repair: false, quick: false });
    console.log(formatReport(rep));
    const by = Object.fromEntries(rep.reports.map((r: any) => [r.id, r]));
    assert.equal(by['laptop.openssh'].status, 'ok');
    assert.equal(by['network.grid-login'].status, 'ok', `grid login: ${by['network.grid-login'].detail}`);
    assert.ok(['ok', 'warn'].includes(by['grid.scripts'].status), `grid scripts: ${by['grid.scripts'].detail}`);
    assert.ok(['ok', 'warn'].includes(by['grid.vscode-sysroot'].status));
    // every failure is either a root cause or blocked by one
    for (const r of rep.reports) if (r.status === 'blocked') assert.ok(rep.rootCauses.some((c: any) => c.id === r.rootCause), `${r.id} blocked by ${r.rootCause}`);
  });
});
