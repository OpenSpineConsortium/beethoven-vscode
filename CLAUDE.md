# Ashley — working context

A licensed VS Code extension (plus CLI and MCP server) that sets up a medical student's laptop for
the Wayne State HPC grid and runs a Claude Code worker there. Vendor: Gregory Schwing, trading as
OpenSpineConsortium (an LLC is planned). Private repository; the code is proprietary.

## Read first

- `docs/CHECKPOINT_2026-09-28.md`, top section "CURRENT STATE": what works, what is open, the exact
  commands, and the list of things only the maintainer can do.
- `docs/ARCHITECTURE.md`, then `docs/LICENSING.md`, `docs/ENGINEERING.md`, `docs/MARKETPLACE.md`,
  `docs/MAC.md` (continuing on a Mac; the Xcode route).
- `docs/DIAGNOSTICS.md` is generated (`tools/diag_doc.py` after the VS Code test suite exports the graph).

## Rules that are not negotiable

- **Ashley never reads, stores or relays a Claude credential.** The student signs in through Claude
  Code's own flow, on the laptop and once on the grid (`ashley claude login`); Claude Code keeps its
  credential in `~/.ashley/claude`; Ashley reads only `claude auth status`. One person, one Claude
  account; no pooling, no rotation of subscriptions (Anthropic's Consumer Terms). Overflow is the
  student's own Console key only.
- **Tokens never appear on command lines, in argv, in logs, in job files or in `sbatch --export`.**
  Never echo one. `ANTHROPIC_API_KEY` is never injected into laptop terminals.
- **Every feature ships with diagnostic nodes** (`extension/src/vscode/diagNodes.ts`, the grid's
  `cmd_diag`) before it integrates; `REQUIRED_BY_FEATURE` in the VS Code test enforces it.
- **Students see one path and no internals.** Container builds, runtimes, QoS, the admin page, the
  vendor tooling stay admin-only. Student-facing text is plain.
- **Grid etiquette (C&IT):** no jobs and no container commands on the login node (warrior); nothing
  of ours under its `/tmp`; container temp and cache on the compute node's local disk with a cleanup
  trap; IPC under `/dev/shm`; every job has a wall time.
- **Terms:** the first-run agreement is `extension/LICENSE.txt` (Trial Edition); `LICENSE-FULL.txt`
  is shown only when a non-trial key is registered. Change the texts and `TERMS_VERSION` together
  (integer). Never pre-tick a box; the button label is part of the record.
- Never use the word "provenance". Versions are integers (3.0.0, 4.0.0), never fractional.
- Commit directly to `main`; push with `bash tools/push_via_grid.sh` (the GitHub token lives on the
  grid). Signing keys live in `~/.ashley-vendor` and never enter the repository.

## Building and testing

```
export PATH=/c/Users/grego/tools/node22:$PATH            # Windows; on a Mac: Homebrew node@22
cd extension && npm ci
npm run typecheck && npm run test:unit && npm run test:vscode   # test:vscode recompiles the test bundles
python ../tools/diag_doc.py                                      # after test:vscode
ASHLEY_VENDOR_DIR=~/.ashley-vendor node ../tools/release.mjs     # build, check, sign -> dist/release/<v>/
```

`npx vscode-test` alone does NOT recompile: run `node esbuild.mjs --tests` first or use the npm
scripts. Inline shell heredocs eat backslashes: write patch scripts to a file and run them by path.
Never `git worktree remove` a worktree holding junctions into this checkout (it deletes the targets).

## Grid

`go2432@grid.wayne.edu` (alias `wsu-grid`). Scripts in `~/.ashley/bin` (deploy: copy `grid/*` with CR
stripped, then `ashley worker restart`). Workers run in `secp/secondary` when `reqp` sits pending. The
Claude sign-in relay for a phone: `~/.ashley/bin/login_relay.sh start|screen|send <file>|stop`.
