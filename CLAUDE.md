# Beethoven for VS Code — working context

A licensed VS Code extension (plus CLI and MCP server) that sets up a medical student's laptop for
the Wayne State HPC grid and runs a Claude Code worker there. It was called **Ashley for VS Code**
until 3.0.0; from 4.0.0 it is **Beethoven for VS Code**, Marketplace item
`openspineconsortium.beethoven`. Its sibling, the Beethoven browser extension, is another repository
(Desktop/ashley-bridge, to be renamed beethoven). Vendor: Gregory Schwing, trading as
OpenSpineConsortium (an LLC is planned). Private repository `OpenSpineConsortium/beethoven-vscode`;
the Desktop folder is `ashley` until the maintainer renames it. The code is proprietary.

## Read first

- `docs/CHECKPOINT_2026-09-28.md`, top section "CURRENT STATE": what works, what is open, the exact
  commands, and the list of things only the maintainer can do.
- `docs/ARCHITECTURE.md`, then `docs/LICENSING.md`, `docs/ENGINEERING.md`, `docs/MARKETPLACE.md`
  (the new item and the retirement of the old one), `docs/MAC.md` (continuing on a Mac; the Xcode
  route).
- `docs/DIAGNOSTICS.md` is generated (`tools/diag_doc.py` after the VS Code test suite exports the graph).

## Rules that are not negotiable

- **Beethoven never reads, stores or relays a Claude credential.** The student signs in through
  Claude Code's own flow, on the laptop and once on the grid (`beethoven claude login`); Claude Code
  keeps its credential in `~/.beethoven/claude`; Beethoven reads only `claude auth status`. One
  person, one Claude account; no pooling, no rotation of subscriptions (Anthropic's Consumer Terms).
  Overflow is the student's own Console key only.
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
  (integer; 5 since the rename). Never pre-tick a box; the button label is part of the record.
- **The old names are aliases, never silent breaks.** Installed builds still use them: Ashley for VS
  Code 3.0.0 reads `https://openspineconsortium.com/ashley/services.json` and accepts only `ASHLEY1.`
  keys and `ASHLEYREV1` lists; grid scripts before 7 and the browser edition up to 7.0.0 name
  `~/.ashley`. So: `ashley.*` settings are read (never declared), `ashley.*` command ids are hidden
  aliases only while Ashley is not installed, `~/.ashley-local` stays in use where it exists,
  `~/.ashley` is a link to `~/.beethoven`, the old `~/.ssh/config` block is recognised, and the
  issuers keep writing the old key prefix until every build older than Beethoven for VS Code 4.0.0
  and Beethoven 8.0.0 is retired. `ASHLEY-RELEASE1` (the release signature domain) never changes.
- Never use the word that begins "prov" and ends "enance" (the maintainer's rule; not even in this
  file). Versions are integers (4.0.0, 5.0.0), never fractional.
- Commit directly to `main`; push with `wsl -e bash -lc 'bash /mnt/c/Users/grego/OneDrive/Desktop/ashley/tools/push_org.sh'`
  (the credential with organisation rights is in WSL). Signing keys live in the vendor folder
  `C:/Users/grego/.beethoven-vendor` (`.ashley-vendor` is a junction to it) and never enter the
  repository; scripts read `BEETHOVEN_VENDOR_DIR`, then `ASHLEY_VENDOR_DIR`.

## Building and testing

```
export PATH=/c/Users/grego/tools/node22:$PATH            # Windows; on a Mac: Homebrew node@22
cd extension && npm ci
npm run typecheck && npm run test:unit && npm run test:vscode   # test:vscode recompiles the test bundles
python ../tools/diag_doc.py                                      # after test:vscode
BEETHOVEN_VENDOR_DIR=/c/Users/grego/.beethoven-vendor node ../tools/release.mjs   # build, check, sign -> dist/release/<v>/
```

`npx vscode-test` alone does NOT recompile: run `node esbuild.mjs --tests` first or use the npm
scripts. Inline shell heredocs eat backslashes: write patch scripts to a file and run them by path;
Python on Windows writes CRLF in text mode, so write bytes (the repository is LF). Never
`git worktree remove` a worktree holding junctions into this checkout (it deletes the targets).

## Grid

`go2432@grid.wayne.edu` (alias `wsu-grid`). Scripts in `~/.beethoven/bin` (deploy: copy `grid/*` with
CR stripped, then `beethoven install`, which also moves an old `~/.ashley` and links the old names,
then `beethoven worker restart`). Workers run in `secp/secondary` when `reqp` sits pending. The Claude
sign-in relay for a phone: `~/.beethoven/bin/login_relay.sh start|screen|send <file>|stop`.
