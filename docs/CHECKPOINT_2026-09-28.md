# CHECKPOINT 2026-09-28 (updated 07:05 UTC, twelfth pass: version 1 ready for testing) — Ashley, the WSU grid + Claude Code extension

## CURRENT STATE: read this first

Version 1.0.0 of the extension, grid scripts version 3, installed in Greg's VS Code
(`dist/ashley-wsu-1.0.0.vsix`, 27 files, 1.64 MB) and deployed to his grid account. Workers
`default` (job 40486902, 6 h) and `peer` (job 40486904, 2 h) run on asx1 from the version 3 template.

### Passes 8 to 12 (after the seventh pass below)

- **8 (committed a2e1f69):** access requests as held Slurm jobs; wizard v2 (Sign in with Wayne State
  first, accounts before the grid, strict order, Renew updates the grid); phone access.
- **9: troubleshooter.** `core/diagnostics.ts` engine, `vscode/diagNodes.ts` graph (42 nodes),
  `vscode/diagnosticsUi.ts` (status bar, panel, Show log, Investigate with Claude, hourly sweep),
  grid `ashley diag`/`diag-node`. The pre-integration rule is a test: `REQUIRED_BY_FEATURE` in
  `vscode-test/extension.test.ts`, which also exports `docs/diagnostics_graph.json`;
  `tools/diag_doc.py` writes the tables in `docs/DIAGNOSTICS.md`.
- **10: claude-swap study** (`docs/research/claude_swap_notes.md`). Five v1 defects fixed: shared
  session history across one person's accounts (measured on 2.1.283: `--resume` from another config
  folder says "No conversation found"); one phone host (mkdir lease); all six credential variables
  removed; phone onboarding seed; one subscription per person (`add-token` refuses a second).
  The container run of the new phone tests found a crash in the phone handlers: fixed.
  Next-release plan (usage meter from `rate_limit_event`, read-only cswap cooperation): section 5.
- **11: dependency study** (`docs/DEPENDENCY_MAP.md`, 370 entries). Confirmed and fixed: quoted `~`
  made a literal `~` folder (first install on a fresh account would fail; the empty folder in
  Greg's home was removed); `squeue -u '$USER'` returned nothing; workers had no Slurm or `ashley`
  inside the container (now bound in, self-tested, node `grid.slurm-in-worker`); MCP re-registration
  refused on upgrade (now remove then add); SSH block captured the student's global lines (now ends
  with `Match all`; Greg's block rewritten, login checked); library purpose cut at commas; token
  capture could truncate (chunking, hard wraps); ssh/scp resolved from PATH; untrusted workspaces.
- **12:** `ashley worker restart` re-renders the job from the current template (settings saved in
  `<worker>/params`); manual rebuilt (32 pages); changelog; fixtures out of the VSIX.

### Tests (all run today)

| Suite | Result |
|---|---|
| Laptop unit tests (`node --test` over `dist-test/unit`) | 31 pass, 5 skip on Windows (phone) |
| VS Code integration (`npx vscode-test --label unit`) | 7 pass |
| Live troubleshooter (`npx vscode-test --label live`) | pass; 5 root causes, all from the isolated test profile |
| Inside the lab container on asx1 (`bash tools/grid_tests.sh`) | 12 of 12 pass |

### Open

1. Greg only: the Claude *Authorize* click (then the grid token check and a real prompt through a
   worker), the Wayne State sign-in in the university tenant, a phone sign-in with a real code, a
   GitHub token, a second student account to confirm the ACLs from the student side, and a
   human run-through of the wizard.
2. Status calls open one ssh connection each; route them over the relay (study entry
   `network.ssh-connection-budget`).
3. Next release (extension 2.0.0, grid scripts 4): the plan in `docs/research/claude_swap_notes.md`
   section 5. Greg's laptop already has claude-swap 0.26.0 in `~/.local/bin`, useful for its step 6.
4. The Remote-SSH caveat in the history below (a second window timing out while an old server ran).

### How to continue

```powershell
$env:Path = "C:\Users\grego\tools\node22;" + $env:Path
cd C:\Users\grego\OneDrive\Desktop\ashley\extension
node esbuild.mjs --tests; node --test "dist-test/unit/**/*.test.js"    # 31 pass, 5 skip
npx vscode-test --label unit; npx vscode-test --label live           # 7 pass; live walks the grid
bash ../tools/grid_tests.sh                                           # from Git Bash: 12 tests in the container
python ../tools/diag_doc.py; python ../tools/depmap_doc.py           # regenerate the diagnostics docs
npm run package; code --install-extension ..\dist\ashley-wsu-1.0.0.vsix --force
ssh wsu-grid "~/.ashley/bin/ashley diag --json"                       # grid truth, node by node
```

Deploy grid scripts by hand: copy `grid/*` with CR stripped to `~/.ashley/bin/`, then
`ashley worker restart --name <w>` (it re-renders from the new template). Push: `bash tools/push_via_grid.sh`.

---

History follows (passes 7 and earlier; counts and commands there are from that time).

## Seventh pass (Greg, 00:00 to 00:15 local): access is last, one folder, no private builds

- **The shared container is what access gives, not a precondition.** `ashley access requirements`
  no longer requires a built container; it requires a Claude subscription token the API accepts
  (`GET /v1/models` with the OAuth token and `anthropic-beta: oauth-2025-04-20`: 200 valid, 401
  "OAuth access token is invalid"), GitHub and HF tokens that verify, and the bashrc block.
- **The request is wizard step 11 `labAccess`** (last). Its run refuses unless every earlier step
  checks done (API key excepted), the Claude Code and Remote-SSH extensions exist and the bridge is
  registered (registered on the spot if missing), and the grid requirements pass; then a note and
  one request. Its check: admin → done; granted → runs `ashley install` (adopts) → done; pending →
  done "waiting"; denied/removed → failed with the admin's message; none → todo.
  `Ashley: Lab access` for a student runs that step in the panel; for the admin it is the queue.
- **No private builds for students.** `ashley install` with the access system in place marks
  `AWAITING_ACCESS` and builds nothing; `worker start` adopts the lab container once readable and
  otherwise says "it comes with lab access". `--build-own` stays for the admin only; every
  student-facing text, picker and doc mention is gone. Tree: "Waiting for lab access".
- **One folder.** Approval = ACL on `shared/` (r-x + default) and recursively on everything under it
  except `access/`, so later folders are covered. Drop-box ingest accepts only regular, non-symlink,
  small files owned by the user they name; `status/` is 711. Token checks feed curl on stdin
  (sampled the login node's process list during three verify runs: no token visible).
- **The `oschome` unix group**: lives in the university directory (sss; not in /etc/group; no ipa or
  group tool on the grid; `rs_grp_owners` only lists folders), so "administrator of the group" means
  C&IT adds people on Greg's email. The admin page shows who is in the group and drafts that email
  (`mailto:hpc@wayne.edu`, the approved AccessIDs not yet in the group). The ACL gives access at once.
- `setup-token` capture: the panel runs it via shell integration and reads the token from the
  terminal output (untested with a real Authorize click).
- Review workflow `wf_6fed7237-7bf` (security, correctness, operations lenses + verifiers) was running
  at 04:20 UTC; its confirmed findings are to be fixed before the push.
- Commits `e348145`, `8a2b06f` (local; last push `3969234`).

The sixth pass follows.

---


## Sixth pass (Greg's message at 23:45 local)

1. **Campus Wi-Fi**: the Authenticator step now says OnDemand answers from the WSU Wi-Fi on campus or
   the VPN elsewhere; the reachability check is the same.
2. **`claude setup-token` explained and captured.** It is the Claude Code command that mints a
   one-year subscription token after the account holder presses Authorize on claude.ai; only Greg
   can press it. The panel now explains the three moves in plain words and, when the terminal has
   VS Code shell integration, runs the command through `TerminalShellIntegration.executeCommand()`
   and reads its output (`execution.read()`), so the printed `sk-ant-oat...` token is captured and
   stored without copying (`SetupPanel.runCapturing`, `WizardUI.runCapturing`, token pattern no
   longer anchored). Falls back to the clipboard path. Untested with a real approval (needs Greg).
3. **Shared-library access requests, managed on the grid, admin page in Ashley.** Findings: the
   CephFS volume root is owned by go2432 and honours POSIX ACLs (`setfacl` works); Panasas homes do
   not, and Greg's home is traversable only by group `advcomp` (8 members), so the request area lives
   on the volume. `ashley access init` (run 03:53 UTC) set: `/rs/rs_grp_oschome` 2771 (traverse only),
   `go2432/` 2750 (private), `shared/` 2771, `shared/ashley` 2770 (group + approved users),
   `shared/access/{inbox 1733, status 755, requests 700}`. Commands: `access whoami|status|request
   [--note]`, `access admin list|approve|grant|deny [--message]|remove [--message]|reset`. Approve =
   `setfacl -m u:ID:--x` on `shared/` + `setfacl -R -m u:ID:r-X` and default ACLs on `shared/ashley`;
   deny/remove/reset revoke. One request per student until reset. `ashley install` files the request
   itself when the library is not readable, then builds the student's own container so nothing waits.
   Tested as go2432: approve added `user:go2432:r-x` + default ACL, deny wrote the message, reset
   removed both. Extension: command `Ashley: Lab access to the shared library` (admin: queue with
   Approve / Deny / Deny with message / Remove / Reset / direct Grant; student: state or a one-time
   request with a note), an "Shared library access" node in the tree (admin sees the pending count).
   Not simulated: a real second user filing a request (needs another grid account).

The fifth pass follows.

---


## Fifth pass: 2FA setup inside the wizard (Greg's question at 23:40 local)

The QR code has to be scanned from OnDemand in a browser with the phone, so the wizard cannot do
it for the student, but it now owns the path. New step 2 `gridTwoFactor` ("Grid account and
Authenticator"): first question "already have both?"; otherwise a menu that opens the grid account
request page, tests whether OnDemand answers (it only does through the WSU VPN, so that is the VPN
check, `onDemandReachable()`), opens OnDemand for Interactive Apps > 2FA Setup, the C&IT guide with
screenshots, and the Authenticator app for iPhone or Android; "continue" records
`ashley.twoFactorDone`. The check passes automatically when the grid already accepts the key. Step 5
(login in the panel) proves the setup; three rejected logins reset `twoFactorDone` and point back to
step 2. `WizardUI.choose()` (N-button menu) added to the panel and the terminal UI. Docs, figure
(`wizard.svg`, ten steps), walkthrough and the STEPS test updated. Not testable end to end by me
(needs a fresh account and a phone); the menu/VPN logic is unit-free but the extension builds and the
suites pass.

The fourth pass follows.

---


## Fourth pass: the lab's shared container library (Greg's request at 23:00 local)

- `/rs/rs_grp_oschome/shared/ashley/` (group `oschome`, 2775) with `library.json`; first entry
  `claude-node22` published by job 40486583 (`bootstrap.sbatch` with `LIBRARY=1 ROOT_OVERRIDE=...
  LIB_NAME=... IMAGE=... GPU=...`; merges the entry with the container's python3, `chmod -R g+rX`).
- Grid CLI: `ashley library [--json]`, `ashley library publish --name N --image docker://... [--gpu]
  [--purpose ...]`, `ashley adopt [name]` (config.env + READY in a second), `ashley install` adopts the
  default when readable (`--build-own` to opt out), `ashley worker start --container <name>`
  (`worker.sbatch.tpl` carries `@SANDBOX@ @CLAUDE_BIN@ @LIBRARY@`, binds the library root),
  `status --json` reports `container`, `source`, `library`.
- Daemon: every run gets `--append-system-prompt` from `peerNote()`: who the worker is, which peers
  of the account are alive, and the exact `ashley send --worker <name>` / `ashley result` commands, so
  a lead worker can fan out to others (each its own job, possibly a different container).
- Extension: setting `ashley.container` (auto | own | <name>), a container picker in *Start a Claude
  worker*, `GridApi.library()`, the tree shows the shared container. Docs: ARCHITECTURE library
  section, INSTALL "for leads", getting started step 9, LIMITS.
- Access: `getent group oschome` = ab5188, go2432 only. Students must be added to `oschome` by the
  HPC admins (Greg requests with the AccessID); until then the wizard builds in their own space.
- Tested 03:22 UTC: `ashley adopt` -> "adopted shared container 'claude-node22' (2.1.283); nothing
  to build"; `default` (job 40486616) and `peer` (job 40486617) both RUNNING on asx1 with the shared
  container (`W_SANDBOX=.../shared/ashley/containers/claude-node22` in their job scripts), heartbeats
  alive, `claude_version 2.1.283`; a request written from inside default's allocation (`srun
  --jobid --overlap`) into peer's inbox was answered by peer 3.4 s later (srun start-up included; the
  answer is the expected "no enabled Claude account" until Greg's setup-token). Script:
  `docs/research/library_peer_test.sh`, log `docs/research/library_peer_test.log`.
- First publish attempt (job 40486583) failed at `npm install` with ENOENT on the shared path: the
  container bound only the user's own CephFS dir. Fixed (a shared ROOT is bound explicitly);
  job 40486610 published the entry. Greg's account now runs the shared container too (`source=shared`).
- Future entries Greg named: a CUDA/torch container for GPU workers; an R/Bioconductor one; the
  image must run Node 22 (Debian 12 / Ubuntu 22.04+). Worker-to-worker messaging with live Claude
  needs the setup-token first.

The third pass follows.

---


## Third pass: prompt latency and the relay (Greg's question at 22:40 local)

Measured (Windows laptop, grid clock skew corrected, `docs/research/latency_*.csv`, plot
`docs/figures/latency.png`, script `docs/research/plot_latency.py`):

| Path | Median | Range |
|---|---|---|
| `ssh wsu-grid true` (one connection) | 2.6 s | 2.4 to 2.7 s |
| prompt received by the worker, one ssh per prompt (the first design) | 2.0 s | 1.6 to 2.2 s |
| relay round trip (PING/PONG over the open session) | 20 ms | 18 to 23 ms |
| relay: QUEUED ack back on the laptop | 37 ms | 35 to 43 ms |
| **prompt received by the worker via the relay** | **193 ms** | 53 to 275 ms |
| ssh straight to the compute node through the jump host | 81 s (two samples: 62 s, 101 s; earlier 27 s and 38 s) | the node's sshd, not our config; never on the prompt path |

Decision: switched to the relay everywhere. Design: `ashley relay` (grid CLI, bash `read -t 0.25`
loop) speaks a line protocol (SEND/QUEUED, RESULT/PENDING, PING/PONG, pushed EVENT/RESULT lines);
`extension/src/core/relay.ts` (`GridRelay`) keeps one ssh session per process (extension, MCP
server, CLI), reconnects on drop; `GridApi.send/ask/result` use it when present and fall back to a
fresh ssh. The daemon polls every 250 ms (was 1 s). `ashley-cli latency N` reproduces the
measurement. Direct UDP to the node is impossible (laptop cannot reach compute nodes) and
unnecessary; the remaining time to first token is Claude Code's ~5 s start-up (next lever: a warm
`--input-format stream-json` process per session). Interactive ssh/Remote-SSH remain as before.

Worker now: job 40486562 on asx1 (secp/secondary, 6 h from 02:53 UTC), 250 ms poll.
GitHub: private repository https://github.com/GregorySchwing/ashley created and **pushed** (branch
`main`) with the `repo`-scoped token that lives in Greg's grid environment; the token never left the
grid: the laptop makes a `git bundle`, scp's it to `~/ashley.bundle`, the grid clones it into
`~/ashley-repo` and pushes with an in-memory credential helper (`username=x-access-token`,
`password=$GITHUB_TOKEN`; a bearer `http.extraheader` is refused by git-over-HTTPS). To push again:
repeat those three steps (see the command in the session log or write `tools/push_via_grid.sh`).
Move the repository to OpenSpineConsortium when Greg wants (his grid token is not an org member).

The second pass follows.

---


## Second pass (Greg's feedback after trying the wizard, 2026-09-27 22:06 local)

Feedback and what changed:

| Feedback | Change | Status |
|---|---|---|
| "mirrored into WSL": keep it native | WSL mirror removed entirely (setting, code, docs). Windows OpenSSH only | done, built |
| Token steps should sign in like Claude does, no copy-paste into the command bar | GitHub: `vscode.authentication.getSession('github', ...)` (browser sign-in, token arrives by itself). Hugging Face and Claude token: one copy; the panel watches the clipboard and offers "Use it". Anthropic API key: paste (optional). `claude setup-token` cannot be driven by pipes (prints nothing without a TTY, probed), so it still runs in a terminal; the token is caught from the clipboard | done, built; human run pending |
| "token could not be verified (network: fetch failed)" | a network failure now keeps the token and says it will be verified on the grid; only 401/403 rejects. `ashley verify-tokens` on the grid (curl whoami, names only) runs after the grid install and inside `ashley doctor`; verified HF ok, GitHub ok when present | done, tested on the grid |
| Password in a terminal | in-panel login with the pure-JS ssh2 client (password field, then code field); falls back to the terminal on non-auth failure. `ashley-cli ssh2-probe` proved ssh2 negotiates with warrior (hmac-sha1) using the key; the keyboard-interactive path itself needs Greg's password to test | built; human run pending |
| Terminal log, no animations, layout | new `SetupPanel` webview (`src/vscode/panel.ts`): nine steps with state, progress bar, spinner, inline prompts (text/password/buttons), clipboard detection, toasts, collapsed log, buttons to start a worker / open files / doctor. Used by setup, token replace, grid install | built; human run pending |
| Emulate a from-scratch install | `Ashley: Reset this laptop (emulate a fresh install)` (multi-select: tokens, key+block, settings, MCP registration, grid `~/.ashley` via new `ashley uninstall`, optionally the container with `--purge-root`) plus the `code --user-data-dir ... --extensions-dir ...` recipe in INSTALL.md and the manual | done |
| "unsupported OS" banner | VS Code's FAQ (Greg's PDF, `CTSpinoPelvic1K-1/Remote Development FAQ.pdf`) says the banner and a dialog appear on every such connection and offers no suppression; Ashley explains it once before the first connection; troubleshooting row added | done |
| WSU email for GitHub/HF accounts? | Not enforceable by the extension and it does not simplify token creation, but it helps the lab map people to org invitations; the wizard texts now recommend creating the accounts with the WSU email | done (text) |

Still to do after this pass: a human run of the new panel (Greg), the `claude setup-token` click, screenshots for the manual. The old checkpoint follows.

---


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

Standing preferences: one banned word (see CLAUDE.md); integer version bumps only; captions ≤ 60
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
7. **ProxyJump from Windows to a compute node**: `ssh asx1.nas.grid.wayne.edu hostname` works (1.5 s to authenticate; ~23 s more before the node runs the command, node-side).
8. **VS Code Remote-SSH to the node**: connected once end to end (server installed under the C&IT sysroot, extension host running on asx1); see open item 2 for the timing caveat.
9. **Manual**: `docs/manual.html` + `docs/manual.pdf` (21 pages, 4 SVG figures) built by `docs/manual/build_manual.py`; bundled into the VSIX (`Ashley: Open the manual`). Final VSIX sha256 `B755E72637AE27411F63FBD29F1ADAE1022FEFB8D7A9773AB6D636A3F060B32A` (770 KB, 27 files).

## What is NOT done / open (in priority order)

1. **Live Claude on the grid needs Greg's one click.** `claude setup-token` opens a browser; paste the printed `sk-ant-oat...` token into wizard step "Claude token" (or `Ashley: Store or replace my Claude token for the grid`, or on the grid `ashley accounts add-token default` reading the token on stdin). The copied WSL login failed: "Failed to authenticate: OAuth session expired and could not be refreshed" (8 idle days). Research confirms setup-token is the supported headless credential (one-year token, `CLAUDE_CODE_OAUTH_TOKEN`, not refreshed after 401 → regenerate). Then rerun `ashley ask` end to end and record the real cold/warm latencies in the docs.
2. **Remote-SSH to the compute node: CONFIRMED WORKING 01:15 UTC**, with one caveat. Evidence: `~/.vscode-server/` was installed on the grid and the server log (`~/.vscode-server/cli/servers/Stable-*/log.txt`) shows "Extension host agent started" and "New connection established" (ExtensionHost + Management) at 21:15:03 local on asx1, i.e. VS Code was fully connected to the node through the jump host with the C&IT glibc sysroot from `.bashrc`; the client disconnected gracefully at 21:22 when the next window was launched. Timing: the jump authenticates in 1.5 s but the node's sshd takes ~23 s before running anything (also from warrior, also with `bash --norc`), and the first connection downloads the server on the node, so the first attempt with the 62 s default timed out; retries with the server present succeeded. `commandConnect` now sets `remote.SSH.connectTimeout` to 300 (Greg's user settings already have 300 and `remotePlatform[asx1...]=linux`). Caveat: a further window launched at 21:31 timed out twice at 302 s while the earlier server process (pid 25363) was still running on asx1; not diagnosed (possibly the still-running server/socket under `/rs/.../tmp`, possibly the `-D` port). If it recurs: on the node `pkill -u $USER -f vscode-server` and reconnect, or "Kill VS Code Server on Host" from the Remote-SSH command palette. Read the newest `%APPDATA%\Code\logs\*\window*\exthost\output_logging_*\1-Remote - SSH.log`.
3. **Manual: DONE 01:35 UTC.** `docs/manual/build_manual.py` assembles PITCH + Getting started + ARCHITECTURE (with the SVG figures `docs/figures/{topology,lifecycle,wizard,accounts}.svg`) + LIMITS + INSTALL + Troubleshooting → `docs/manual.html` (pandoc, resources embedded) → `docs/manual.pdf` (Edge headless, 21 pages, figures render as vectors; pages 1 and 7 inspected as PNG) and a copy at `extension/media/manual.html` for `Ashley: Open the manual`. Still missing: screenshots from a human run; a fifth figure for the can/can't matrix (the table stands in).
4. **docs/RESEARCH.md: DONE (generated).** 212 KB, per topic: summary, recommendation, open questions, a findings table with confidence / verdict / source. Generated by the script inline in this session from `docs/research/deep_research_2026-09-28.json` (8 topics, 277 findings; the VS Code topic has 0 verifications, the container topic 13 of 34; 37 verifiers and the critic died on the Claude usage limit). Key verified facts: `-p` exit codes and the JSON `is_error`/`subtype` arms; `--input-format stream-json` envelope; permission modes incl. `--permission-prompts none` (v2.1.259+); `--bare` must NOT be used (ignores the OAuth token); `setup-token` = 1-year token for Pro/Max/Team/Enterprise; sessions at `<CLAUDE_CONFIG_DIR>/projects/<cwd encoded>/<uuid>.jsonl`, `--resume` cross-project since v2.1.223, `cleanupPeriodDays` 30; Anthropic advises against sharing `~/.claude` over network filesystems (our account dirs ARE on the shared home: one worker per account, caveat stated); `claude -p` draws from the subscription (support article 2026-06-16); since v2.1.113 the npm package installs the native Bun binary (Node unused at runtime), Linux floor Ubuntu 20.04/Debian 10, hence the container; VS Code server skips its glibc check when `VSCODE_SERVER_CUSTOM_GLIBC_LINKER` is set and Red Hat bash sources `~/.bashrc` for non-interactive ssh (SSH_SOURCE_BASHRC), so the bashrc block placement is right as long as no `return` guard precedes it.
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
