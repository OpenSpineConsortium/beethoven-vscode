## What changed and why

<!-- one change per pull request; name the failure or need it answers -->

## Diagnostics (the pre-integration rule)

- [ ] every new tool, package, template or assumption has a node in `extension/src/vscode/diagNodes.ts` (or `grid/ashley` cmd_diag) with a check, a manual fix and a future risk
- [ ] its ids are in `REQUIRED_BY_FEATURE` (`extension/src/vscode-test/extension.test.ts`)
- [ ] `docs/DIAGNOSTICS.md` regenerated (`python tools/diag_doc.py`) if nodes changed

## Tests

- [ ] `npm run typecheck`
- [ ] unit tests (`node esbuild.mjs --tests && node --test "dist-test/unit/**/*.test.js"`)
- [ ] VS Code tests (`npx vscode-test --label unit`) when the extension changed
- [ ] container tests (`bash tools/grid_tests.sh`) when `grid/` changed
- [ ] anything new was checked against something outside the code (a measurement, a document, a live run); say what

## Not verified

<!-- say plainly what was not run or could not be checked -->

## Assistance

<!-- if an AI tool helped, keep the Assisted-by trailer on the commits and say here how much of the change it wrote; the human author owns the change -->
