# CHECKPOINT 2026-09-28 01:25 UTC (grid clock) — Ashley, the WSU grid + Claude Code extension

Read this first. It is written so a fresh Claude session, on any account, continues as if
nothing was interrupted. Everything below is on disk; nothing lives only in a conversation.

## The directive (Greg, 2026-09-27, verbatim gist)

"Implement this spec" (the Gemini PDF `CTSpinoPelvic1K-1/WayneStateVSCodeSetupExtension.pdf`,
24 pages: a VS Code extension that collects credentials, opens token pages, writes them to the
environment, sets up SSH through the login node to compute nodes, connects Remote-SSH, and
bridges the local Claude Code to a Claude Code running in a Singularity container on the grid),
plus: deep research on running Claude Code in Singularity on the grid and accepting prompts over
ssh; swapping between multiple Claude accounts when one hits its limit; several compute nodes
each with a persistent Claude session taking prompts from an orchestrator; keep it simple,
reliable, low latency. "Don't stop until you have a tested extension which every step works and
a manual (html and pdf) and anything else an extension should have including installation
instructions, and a descriptive, persuasive pitch to sell students ... render figures ... what
they can ask, what they can't ask ... the final deliverable should be an extension I can simply
import into vscode or xcode and it will just work ... also generate the documentation and the
source ... you can use my tokens and environment to see what works." Also: use the Remote
Explorer approach for viewing images; review `Student_Projects/` and `STARTHERE.pdf` and make
architectural decisions with that future (the lab recipe, board, Nextflow later) in mind. The
seven prompt files in `CTSpinoPelvic1K-1/openresearch/` give the bigger vision ("Ashley"
organizer, Nextflow, PRISMA lit review); `zeroethprompt.txt` says: step-wise, the wizard first.

Standing preferences: never the word "provenance"; integer version bumps only; captions ≤ 60
words; commit directly (no feature branches); network through WSL when Windows sockets flake;
never run work on the grid login node; scripts are files, never heredocs over ssh.

## Where everything is

| What | Where |
|---|---|
| Repository (git, branch `main`, 3 commits, local only, NOT pushed) | `C:\Users\grego\OneDrive\Desktop\ashley` |
| Built, installed extension | `ashley/dist/ashley-wsu-1.0.0.vsix` (748 KB); installed in VS Code as `openspineconsortium.ashley-wsu` |
| Extension source | `ashley/extension/src/` — `core/` (no vscode import: services, sshConfig, protocol, slurm, shell, wizard, gridApi), `vscode/` (ui, store, tree, mcpRegister), `mcp/server.ts`, `cli/main.ts` + `terminalUi.ts`, `extension.ts`, tests `core/*.test.ts`, `vscode-test/extension.test.ts` |
| Grid-side scripts (source) | `ashley/grid/`: `ashley` (bash CLI), `ashleyd.js` (daemon), `bootstrap.sbatch`, `worker.sbatch.tpl`, `bashrc.block`, `VERSION` — copied into `extension/dist/grid` at build, uploaded by the wizard |
| Docs written | `ashley/docs/ARCHITECTURE.md`, `INSTALL.md`, `LIMITS.md`, `PITCH.md`, this file; `extension/README.md`, `CHANGELOG.md`; walkthrough md in `extension/media/walkthrough/` |
| Deep research output | `ashley/docs/research/deep_research_2026-09-28.json` (clean) and `deep_research_raw_2026-09-28.txt` (workflow wrapper, 2 MB) |
| Node for building (nothing else on the Windows PATH) | `C:\Users\grego\tools\node22` (v22.23.3, portable); WSL also has `~/tools/node22` |
| Memory files | `~/.claude/projects/c--Users-grego-OneDrive-Desktop-CTSpinoPelvic1K-1/memory/ashley-extension-project.md`, `grid-apptainer-module-works.md`, `windows-ssh-to-grid.md` (indexed in MEMORY.md) |
| Local CLI settings used for testing | `C:\Users\grego\.ashley-local\settings.json` ({"accessId":"go2432"}), `secrets.json` (Hugging Face token only) |
| Windows SSH | `C:\Users\grego\.ssh\id_ed25519_wsu` (authorized on the grid), `C:\Users\grego\.ssh\config` has the Ashley block (aliases `wsu-grid` and `grid`, wildcard `*.nas.grid.wayne.edu` with ProxyJump); mirrored into WSL |
| VS Code user settings touched | `remote.SSH.remotePlatform["asx1.nas.grid.wayne.edu"]="linux"`, `remote.SSH.connectTimeout=60` |
| Claude Code MCP registration | user scope, server `ashley`: command `C:/Users/grego/AppData/Local/Programs/Microsoft VS Code/Code.exe` with `ELECTRON_RUN_AS_NODE=1`, args `C:/Users/grego/.vscode/extensions/openspineconsortium.ashley-wsu-1.0.0/dist/mcp-server.js`, env `ASHLEY_GRID=wsu-grid` — status "Connected" |

### On the grid (go2432@warrior.grid.wayne.edu)

| What | Where / value |
|---|---|
| Ashley home | `~/.ashley/` — `bin/` (scripts v1.0.0), `config.env` (ROOT, RUNTIME, SANDBOX, CLAUDE_BIN, BINDS, BOOTSTRAP_JOB=40486353 done), `READY` (json), `secrets.env` (600, HF_TOKEN only), `accounts/` (EMPTY — no Claude credential yet), `sessions/` (empty), `workers/default/`, `log/` |
| Large files | `/rs/rs_grp_oschome/go2432/ashley/` — `containers/node22-bookworm` (1.1 GB Apptainer sandbox), `npm/bin/claude` (Claude Code 2.1.283), `npm-cache/`, `cache/`, `tmp/`, `workspaces/` |
| Probe leftovers (deletable) | `/rs/rs_grp_oschome/go2432/ashley_probe2/` (first probe's sandbox+npm), `~/.ashley/probe1*.json`, `~/.ashley/bin/bootstrap_probe.sbatch`, `~/.ashley/log/ashley_probe1_*.out` |
| Worker | `default` = Slurm job **40486367** on `asx1` (secp/secondary, 4 CPU, 16G, 4 h from 00:33 UTC → ends ~04:33 UTC 2026-09-28), daemon idle, heartbeat OK, processed 1 (an auth-failure test) |
| `~/.bashrc` | carries the `# >>> ashley` block (VS Code glibc sysroot vars + PATH) |

## What is CONFIRMED working (evidence in this session)

1. **Build/test toolchain**: `npm run build` (esbuild bundles extension 65 KB, mcp-server 1.3 MB, cli 38 KB; copies grid/ with LF), `tsc --noEmit` clean, **22/22 unit tests** (`node --test "dist-test/unit/**/*.test.js"`: ssh config, protocol, slurm parsing, token patterns, and the daemon end-to-end with `test-fixtures/fake-claude.js` covering claim/events/result/session resume/rate-limit rotation/all-limited/crash/forced account/heartbeat), **5/5 VS Code integration tests** (`npx vscode-test`: activation, all 15 commands registered, settings defaults, wizard step order, refresh+openManual), `vsce package` → VSIX, `code --install-extension` OK.
2. **SSH from Windows**: needs `MACs +hmac-sha1` (else "no matching MAC found"); `AddressFamily inet` cuts 13.1 s → 2.0 s per connection (IPv6 timeout); the wizard's `sshConfig` step wrote the block and mirrored it into WSL; `installKey` check passes (`ssh wsu-grid hostname` → warrior, BatchMode).
3. **Grid bootstrap** (job 40486353, 7 min on asx1 via secp/secondary): `module load apptainer/1.2.2` builds an unprivileged sandbox from `docker://node:22-bookworm`; `npm install -g --prefix <CephFS>/npm @anthropic-ai/claude-code@2.1.283`; `claude --version` inside works; READY written; `ashley status --json`, `ashley doctor` work on the login node.
4. **Worker daemon**: job 40486367 runs `ashleyd.js` inside the sandbox on asx1; `state.json` heartbeat every 10 s; `ashley worker list/start/stop/log/node` work; a real request travelled laptop → `ashley ask` (stdin JSON) → inbox → daemon → `claude -p` → outbox → laptop in ~14 s total (5 s of it Claude; the rest was the 13 s ssh, now 2 s). With no account the daemon answers `error: no enabled Claude account...` at once.
5. **MCP bridge**: `claude mcp get ashley` = Connected; a real `claude -p` on the laptop called `ashley_status` through the bridge and reported the worker/node/status/version correctly (3 turns, $0.74 shown as cost).
6. **Grid install step from the laptop** (`ashley-cli setup --only gridInstall`): uploads scripts, writes `secrets.env` (600) via ssh stdin, runs `ashley install` (bashrc block, ROOT, bootstrap or "already ready"); the check now compares laptop tokens with grid `secrets`/`accounts` names and re-pushes what is missing.
7. **ProxyJump from Windows to a compute node**: `ssh asx1.nas.grid.wayne.edu hostname` works (38 s; see open items).

## What is NOT done / open (in priority order)

1. **Live Claude on the grid needs Greg's one click.** `claude setup-token` opens a browser; paste the printed `sk-ant-oat...` token into wizard step "Claude token" (or `Ashley: Store or replace my Claude token for the grid`, or on the grid `ashley accounts add-token default` reading the token on stdin). The copied WSL login failed: "Failed to authenticate: OAuth session expired and could not be refreshed" (8 idle days). Research confirms setup-token is the supported headless credential (one-year token, `CLAUDE_CODE_OAUTH_TOKEN`, not refreshed after 401 → regenerate). Then rerun `ashley ask` end to end and record the real cold/warm latencies in the docs.
2. **Remote-SSH to the node from VS Code timed out** ("Connecting with SSH timed out" after 62 s) while plain `ssh asx1.nas.grid.wayne.edu` takes 38 s. Diagnose the 38 s (`ssh -vvv`), likely the second hop; raise `remote.SSH.connectTimeout` (the extension sets 60; try 120) and/or fix the slow hop (`ProxyJump` uses `ssh -W`; maybe `ProxyCommand ssh -W %h:%p wsu-grid` or `-o AddressFamily=inet` on the jump). Then verify `~/.vscode-server` appears on the grid and the glibc sysroot env from `.bashrc` is honoured (if not, add `remote.SSH.serverEnv` or the WSU KB's `.bashrc` exact lines). This is required for "view images".
3. **Manual (HTML + PDF) with figures is not written.** Plan: `docs/manual.html` assembled from ARCHITECTURE/INSTALL/LIMITS/PITCH + a "Getting started" walkthrough + troubleshooting + "for leads", with 5 inline SVG figures (topology; wizard steps; request lifecycle; account rotation; can/can't matrix); PDF via Edge headless: `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --print-to-pdf=docs\manual.pdf docs\manual.html`; render pages to PNG with PyMuPDF and LOOK at them. Bundle a copy at `extension/media/manual.html` (the `Ashley: Open the manual` command reads it) and repackage.
4. **docs/RESEARCH.md** not written. Source: `docs/research/deep_research_2026-09-28.json` (8 topics, ~200 findings; verification ran for headless-cli, limits-tos, account-swap, literature-apis, xcode, and partly orchestration; 37 verifier agents for singularity-hpc and vscode-ext died on the Fable usage limit, so those topics' `critical` findings are UNVERIFIED — say so). Key verified facts to carry into the manual: `-p` exit codes and the JSON `is_error`/`subtype` arms; `--input-format stream-json` envelope; permission modes incl. `--permission-prompts none` (v2.1.259+); `--bare` must NOT be used (ignores OAuth token); `setup-token` = 1-year token for Pro/Max/Team/Enterprise; sessions at `<CLAUDE_CONFIG_DIR>/projects/<cwd encoded>/<uuid>.jsonl`, `--resume` cross-project since v2.1.223, `cleanupPeriodDays` 30; Anthropic does not recommend sharing `~/.claude` over network filesystems (our accounts dirs ARE on the shared home — note the caveat, keep one worker per account); `claude -p` usage draws from the subscription (support article 2026-06-16); native binary Linux floor Ubuntu 20.04/Debian 10 (so CentOS 7 host needs the container, as built).
5. **Extension UX untested by a human**: the wizard's interactive terminal step (`shellPath: ssh` with password + Authenticator code), the "Ask" output channel streaming, the tree view. All code paths are unit/integration tested; the visual run-through is for Greg.
6. **GitHub token**: none on this machine (`gh auth token` empty in WSL), so `secrets.env` has only `HF_TOKEN`. The wizard step works (validated pattern + api.github.com check) but was not exercised with a real token.
7. **Small follow-ups**: `README.md` says the manual/PDF exist (write them or fix the text); delete probe leftovers on the grid; `extension/package.json` `repository.url` points to a not-yet-created GitHub repo; add screenshots to the manual once a human runs it; write a `docs/DEMO.md` (pelvic width demo on 10 records via the worker) once a token exists; consider `secp/secondary` as the worker default if `reqp/requeue` keeps sitting PENDING (Priority) — today reqp pended 30+ min, secp started at once.
8. **Not started (later versions, by design)**: Nextflow integration (the queue is the substrate: `ashley send` from a process, `ashley result` in the next), PRISMA literature pipeline, multi-worker orchestration by a lead Claude (mechanics exist: each worker has its own inbox; a worker Claude can write into another's inbox), the Xcode "port" (= CLI + MCP; research says Xcode 26 agent integration cannot host a wizard).

## Design decisions (so they are not re-litigated)

- File queue on the shared home, not sockets/ports: laptop only ever reaches the login node; daemon runs wherever Slurm put it; survives restarts; debuggable with ls/cat. Latency = ssh (2 s) + poll (1 s) + Claude start (~5 s).
- One worker Slurm job = daemon + the node VS Code connects to. Default 4 CPU/16 G/24 h, reqp/requeue with `--requeue --open-mode=append` (daemon is re-entrant), `--dependency=singleton`, `--signal=B:TERM@120`.
- Accounts = directories = `CLAUDE_CONFIG_DIR`; rotation only among ONE student's own credentials (subscription token first, own API key as overflow); pooling across students is refused on Consumer-Terms grounds and documented as such.
- `ANTHROPIC_API_KEY` is never injected into laptop terminals (it would silently switch the local Claude Code to pay-per-use).
- Sandbox directory, not SIF (SIF→sandbox conversion and missing `unsquashfs` are the known failures on this grid); runtime order apptainer module → conda singularity → module singularity/3.5.2 → /usr/bin.
- Remote-SSH renders images; no X11 by default.
- Xcode: `core/` has no vscode import; `dist/ashley-cli.js` + MCP server are the port.

## How to continue (exact commands)

```powershell
# laptop, PowerShell
$env:Path = "C:\Users\grego\tools\node22;" + $env:Path
cd C:\Users\grego\OneDrive\Desktop\ashley\extension
node esbuild.mjs --tests; node --test "dist-test/unit/**/*.test.js"      # 22 pass
npx vscode-test                                                         # 5 pass
npx vsce package --no-dependencies -o ..\dist\; code --install-extension ..\dist\ashley-wsu-1.0.0.vsix --force
node dist/ashley-cli.js doctor                                          # laptop + grid checks
ssh wsu-grid "~/.ashley/bin/ashley status --json"                       # grid truth
```

Grid worker (if job 40486367 has ended): `ssh wsu-grid "~/.ashley/bin/ashley worker start --name default --partition secp --qos secondary --hours 24"`.

Deep research resume (only if more verification is wanted; 37 verifiers died on the Fable limit):
`Workflow({scriptPath: 'C:\Users\grego\.claude\projects\C--Users-grego-OneDrive-Desktop-CTSpinoPelvic1K-1-openresearch\0599380b-0d32-4e19-b5be-65bdd1017566\workflows\scripts\ashley-deep-research-wf_ea775af4-4e7.js', resumeFromRunId: 'wf_ea775af4-4e7'})` — completed agents replay from cache; transcript dir `...\0599380b-0d32-4e19-b5be-65bdd1017566\subagents\workflows\wf_ea775af4-4e7\journal.jsonl`.

## Key insights from this session (the things that cost time)

1. Windows OpenSSH → grid: `MACs +hmac-sha1` is mandatory; `AddressFamily inet` removes an 11 s IPv6 timeout on every connection.
2. `module load apptainer/1.2.2` on compute nodes builds unprivileged sandboxes from Docker Hub in ~6 min; `~/.local/bin/singularity` stays broken; `/usr/bin/apptainer` also exists on asx1.
3. A copied Claude Code login dies with its refresh token; `claude setup-token` is the only unattended credential. Never pass `--bare`.
4. `claude -p` cold start inside the container ≈ 5–7 s; the JSON result arrives even on auth failure (`is_error: true`, `terminal_reason: api_error`).
5. Node ≥ 22 is required by `@vscode/vsce` 4, `@vscode/test-electron` 3 and Claude Code itself; VS Code's own `Code.exe` with `ELECTRON_RUN_AS_NODE=1` is a Node 24 runtime students already have, and Claude Code accepts it as an MCP server command.
6. The Bash tool eats backslashes in inline JSON/paths (a registration was saved as `C:UsersgregoAppData...`); use forward slashes or spawn with argv arrays (the extension does).
7. Windows `spawn` refuses `.cmd` wrappers without a shell; the daemon accepts a `.js` "claude" for tests.
8. `vscode-test`: activation must never await a dialog; `activate()` must return exports for tests.
9. On this grid, `reqp/requeue` can sit PENDING (Priority) for a long time while `secp/secondary` starts instantly; `sacctmgr` shows QoS max walls primary 30 d, secondary 90 d.
10. PowerShell mangles JSON arguments to native exes; test registration from Git Bash or via Node.

## Research workflow summary (for RESEARCH.md)

Topics: headless-cli (verified), limits-tos (verified), singularity-hpc (verification incomplete), account-swap (verified), orchestration (partly verified), vscode-ext (verification incomplete), xcode (verified), literature-apis (verified). The critic/gap phase did not run (limit). Per-topic `summary`, `findings[]` (claim, detail, source_url, confidence, critical, verdict{refuted, corrected_claim, evidence}) and `recommendation` are in the JSON.
