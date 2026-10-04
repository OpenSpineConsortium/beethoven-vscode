# Diagnostics: the dependency graph and the pre-integration rule

Beethoven for VS Code depends on a long chain of things it does not control: the student's OpenSSH, VS Code and
its Remote-SSH extension, Claude Code, three token services, Wayne State's login node, Slurm, the
C&IT compatibility libraries for VS Code, the Apptainer module, the lab container, and Claude
Code's own behaviour on a compute node. Any of them can change under a working installation.
The troubleshooter turns that chain into a graph that can be checked, so a failure names the one
piece that broke, and a safe repair runs where one exists.

## The rule

**No feature is integrated until every tool, package, template and assumption it adds is a node
in the graph**, with a check, a manual fix, the future risk it guards against and, where safe, a
repair. The rule is enforced by the VS Code test *every feature keeps its diagnostic nodes*
(`extension/src/vscode-test/extension.test.ts`): each feature lists the node ids it relies on,
and the test fails when any of them is missing from `buildGraph()`. A new feature adds its nodes
and its line in that list in the same commit.

## How a run works

- **Order.** Nodes are checked in dependency order (`order()` in
  `extension/src/core/diagnostics.ts`). An unknown dependency or a cycle is an error at build
  time, and a unit test covers both.
- **Root cause.** A node whose dependency failed is *blocked* and names that dependency's root
  cause. The report lists only the failing nodes whose own dependencies passed, so one broken
  SSH key reads as one problem, not twenty.
- **Repair.** In *Troubleshoot and repair*, a failing node with a repair runs it (at most five
  minutes), then checks again. It is reported *repaired* only if the second check passes;
  otherwise the report says the repair ran and what still fails. Repairs never do what needs a
  person: sign-ins, Authorize clicks, the grid password, the lab lead's approval.
- **Statuses.** pass, warn (works, needs attention soon), fail, repaired, blocked, skipped (not
  applicable: an admin-only node for a student, no worker running).
- **Timeouts.** Each check has 90 s. A check that throws or times out is a failure with the error
  as its detail, never a crash of the run.
- **Background sweep.** 45 s after VS Code starts, then hourly: all nodes except those marked slow
  (the compute-node probe), no repairs, no panel. The status bar shows the result.
- **Reports.** Every run is saved as JSON under the extension's global storage (`diagnostics/`),
  and written to the log in text, root causes first.
- **Grid side.** `beethoven diag --json [--repair] [--node]` answers every grid node in one ssh call.
  `--node` also runs `beethoven diag-node` inside a running worker's allocation (`srun --overlap`) to
  check the compute node and the container.
- **Investigate with Claude.** Runs the laptop's Claude Code with web search and fetch only, a
  12-turn limit, the failing node, its detail and the log, and writes a report. It changes
  nothing.

## Adding a node

1. Laptop-side check: add a `DiagNode` in `extension/src/vscode/diagNodes.ts` with `id`,
   `title`, `layer`, `dependsOn`, one-sentence `assumption`, `check`, `manualFix`, `futureRisk`,
   `source`, and `repair` only when the repair is safe to run unattended. When the fix is something
   only the person can do but a command starts it (a sign-in, a token renewal, the license dialog),
   give the node a `fixCommand` (`command`, `title`, optional `arguments`): the troubleshooter shows
   it as a button beside the failing check, runs it, and checks again. It is the same command the
   row in the Beethoven view runs, so both paths open the wizard's own step for that item.
2. Grid-side check: add a `diag_emit ID OK WARN SKIP DETAIL [REPAIRED]` line to `cmd_diag` in
   `grid/beethoven`, and a `gridNode(...)` entry in `diagNodes.ts` with the same id. A grid repair
   goes under `[ $repair = 1 ]` and must be idempotent. A check that should trigger its repair
   must report *fail*, not *warn*: repairs run only for failures.
3. Add the ids to the feature's line in `REQUIRED_BY_FEATURE`.
4. Run the tests:

   ```
   cd extension
   node esbuild.mjs --tests && node --test dist-test/unit/core/*.test.js
   npx vscode-test --label unit        # also exports docs/diagnostics_graph.json
   npx vscode-test --label live        # the whole graph, read-only, against the real grid
   bash ../tools/grid_tests.sh         # Linux-only tests inside the lab container on a node
   python ../tools/diag_doc.py         # regenerates the tables below
   ```

## Tests that need Linux

The phone module drives Claude Code through util-linux `script` (a pseudo-terminal), and the
shared session history uses real symbolic links. Their tests skip on Windows and run with
`tools/grid_tests.sh`, which copies the built tests to the grid and runs them with the lab
container's Node inside a running worker's allocation. On 2026-09-28 all 12 passed there:
7 daemon tests and 5 phone tests (one host at a time, hand-over, an abandoned lease taken over,
a clean environment for Remote Control, and the sign-in answering a wrong code). That run found
a crash in the phone handlers that no Windows test could reach.

The fake Claude (`extension/test-fixtures/fake-claude.js`) copies the behaviours the graph
relies on, as measured on Claude Code 2.1.283: transcripts under `<config>/projects/<cwd with
non-alphanumerics as '->/<id>.jsonl`, created as soon as a run starts; `--resume` refused with
"No conversation found with session ID" when the transcript is elsewhere; `auth status`,
`auth login` answering a wrong code with "Invalid code", and `remote-control` refusing without a
sign-in. When Claude Code changes one of these, change the fake first and let the tests fail.

## What the dependency study found

On 2026-09-28 four independent readers mapped every assumption in the code, and a completeness
critic added what they missed: 370 entries after merging, in `docs/DEPENDENCY_MAP.md`, each with
its check, what a failure looks like, the repair and the future risk. Most entries are risks. Twelve
described defects or unverified facts found by reading. Each was checked against the grid or the
laptop before anything changed:

| Finding | Checked | Outcome |
|---|---|---|
| The grid install quoted `~/`, so `mkdir -p '~/.ashley/bin'` made a folder literally named `~` | a `~` folder with empty `.ashley` subfolders existed in the admin's grid home since 2026-09-27; on a fresh account the upload would fail | every `~/` argument now expands (`renderRemote`); the empty folder removed; unit test; live check makes real folders |
| `squeue -u '$USER'` reached Slurm literally | the job list came back empty | `$USER` goes through `bash -c`; the live check returns 70 rows with both workers |
| A worker could not use Slurm or the grid command inside its container, yet was told it could | confirmed inside the container on asx1 | the Slurm bridge (`docs/ARCHITECTURE.md`); node `grid.slurm-in-worker` |
| `claude mcp add-json` refuses an existing name, so every upgrade fell back to a project `.mcp.json` | exit 1, "already exists in user config" in a throwaway config | remove, then add |
| Global lines in the student's `~/.ssh/config` below the block became node-only | `ssh -G`: `ForwardAgent yes` lost for github.com | the block ends with `Match all`; unit test |
| The library purpose was cut at the first comma by `--export` | a test job printed the whole purpose once it travelled in the environment | fixed |
| The captured Claude token could be cut short (first 20 characters of a chunk, or a hard wrap) | unit tests on chunked and wrapped output | `extractWrappedToken`; a real Authorize click is still untested |
| The hidden terminal used the student's default shell, which may have no shell integration | by reading | the capture terminal is always PowerShell or bash |
| `spawn('ssh')` could find Git's ssh before Windows OpenSSH | by reading | `run()` resolves ssh, scp and ssh-keygen the way Remote-SSH does |
| An untrusted folder could disable the extension | by reading | the manifest declares untrusted workspaces supported (Beethoven reads no workspace files) |
| The CUDA publish example cannot pass the build check | by reading `bootstrap.sbatch` | the example now publishes a Node 22 image with `--gpu` |
| GPU partition `galhp` and QoS `gpu` unverified | `sinfo` and the QoS list in the grid diagnostics | both exist; no change |

Not yet done: status calls still open one ssh connection each (the study's
`network.ssh-connection-budget`); routing them over the relay is planned. The remaining entries in
the map are checks the troubleshooter could grow into; the ones worth running often are added as
nodes, each under the rule above.

## The graph

<!-- graph:begin -->
49 nodes, 29 with an automatic repair, 9 with a one-click fix (a button beside the failing check that starts the sign-in or renewal only the person can do). Generated by `tools/diag_doc.py`.

### Laptop

| Node | Depends on | Assumes | Repair | If it fails | Future risk |
|---|---|---|---|---|---|
| `laptop.os` Operating system | none | Windows 10/11, macOS or Linux on x64 or arm64 | by hand | Beethoven supports Windows, macOS and Linux laptops | a new OS release changing OpenSSH or the keychain |
| `laptop.openssh` OpenSSH client | `laptop.os` | ssh 7.3+ on PATH (ProxyJump); on Windows the built-in OpenSSH client | by hand | Windows: Settings > System > Optional features > OpenSSH Client; macOS/Linux: install openssh-client | an OpenSSH release dropping hmac-sha1, which the grid still needs |
| `laptop.ssh-keygen` ssh-keygen | `laptop.openssh` | ssh-keygen can make ed25519 keys | by hand | install the OpenSSH client (it includes ssh-keygen) |  |
| `laptop.ssh-key` SSH key for the grid | `laptop.ssh-keygen`, `account.wsu` | ~/.ssh/id_ed25519_wsu and .pub exist | by hand | run the wizard steps "SSH key" and "Log in to the grid once" |  |
| `laptop.ssh-config` SSH configuration block | `laptop.ssh-key` | the Beethoven block in ~/.ssh/config is current (jump host, MACs +hmac-sha1, AddressFamily inet, *.nas.grid.wayne.edu) | automatic | run the wizard step "SSH configuration" | the grid dropping hmac-sha1 or renaming nodes |

### VS Code

| Node | Depends on | Assumes | Repair | If it fails | Future risk |
|---|---|---|---|---|---|
| `vscode.version` VS Code version | `laptop.os` | VS Code 1.100 or newer | by hand | Help > Check for Updates | API removals in a future VS Code |
| `vscode.remote-ssh` Remote-SSH extension | `vscode.version` | ms-vscode-remote.remote-ssh installed (opening grid files and images) | automatic | install ms-vscode-remote.remote-ssh from the Extensions view | the extension renamed or its commands changed |
| `vscode.claude-code` Claude Code extension | `vscode.version` | anthropic.claude-code installed (the local Claude, its own sign-in, the bridge) | automatic | install anthropic.claude-code from the Extensions view | the extension renamed or its commands changed |
| `vscode.claude-binary` Claude Code program | `vscode.claude-code` | the claude executable bundled with the Claude Code extension runs | by hand | reinstall the Claude Code extension | the extension moving its bundled binary |
| `vscode.shell-integration` Terminal shell integration | `vscode.version` | terminal.integrated.shellIntegration.enabled is on (Beethoven reads the Claude token from the terminal) | automatic | Settings: Terminal > Integrated > Shell Integration: Enabled |  |
| `vscode.secret-storage` Keychain (VS Code secret storage) | `vscode.version` | tokens can be stored and read back from the OS keychain | by hand | Linux: install a keyring (gnome-keyring or kwallet); restart VS Code | a keychain backend change |
| `vscode.remote-ssh-settings` Remote-SSH settings for the grid | `vscode.remote-ssh` | remote.SSH.connectTimeout >= 300 (compute nodes take ~25 s per session; the first connection downloads the server) | automatic | Settings: remote.SSH.connectTimeout = 300 | Remote-SSH changing its timeout semantics |
| `vscode.mcp-bridge` Claude Code bridge to the grid (MCP) | `vscode.claude-binary`, `network.grid-login`, `account.choice` | the beethoven MCP server is registered with Claude Code, under the account the setting names when it names one (Claude Code keeps its servers per sign-in folder), and connects | automatic | Beethoven: Connect the Claude Code extension to the grid | claude mcp CLI changes; Electron-as-node removed from VS Code |

### Network

| Node | Depends on | Assumes | Repair | If it fails | Future risk |
|---|---|---|---|---|---|
| `network.internet` Internet from this laptop | `laptop.os` | HTTPS to github.com and huggingface.co | by hand | check the Wi-Fi; some campus networks block token checks (the grid checks them instead) |  |
| `network.grid-login` Login node without a prompt | `laptop.openssh`, `laptop.ssh-config` | ssh -o BatchMode=yes wsu-grid answers (key installed, no password or code) | by hand | Permission denied: run "Log in to the grid once" again; timed out: check the network (the grid accepts SSH from anywhere) | the login host renamed, 2FA enforced for keys |
| `laptop.relay` Prompt relay (open session) | `grid.relay` | one persistent ssh session carries prompts in tens of milliseconds | by hand | Beethoven falls back to one ssh per prompt; check the grid relay node |  |

### Accounts

| Node | Depends on | Assumes | Repair | If it fails | Future risk |
|---|---|---|---|---|---|
| `laptop.terms` License terms accepted | `vscode.version` | the current version of the agreement and privacy statement was accepted in the signing dialog, and the record with the texts is on this laptop | one click: Accept the terms (`beethoven.terms`) | run any Beethoven command: the signing dialog appears; Beethoven: Read the license terms shows the text | a new terms version (every installation is asked again); the record folder deleted by hand |
| `laptop.license` Beethoven license | `laptop.terms` | a license key signed by a key this release trusts, in date (or in its grace period), not withdrawn | one click: Enter the key (`beethoven.license`) | Beethoven: License, then paste the key your lead sent; a new key if it ended or was withdrawn | the signing key rotating (a new release trusts the new key); the revocation list address moving |
| `account.license-identity` License names the signed-in person | `laptop.license`, `account.wsu` | the AccessID (or e-mail) in the license matches the Wayne State sign-in Beethoven recorded | one click: Sign in with Wayne State (`beethoven.wsuSignIn`) | sign in with the account the license names (setup step "Sign in with Wayne State"), or ask your lead for a license in your name | Wayne State changing the sign-in e-mail format (AccessID@wayne.edu) |
| `account.wsu` Wayne State sign-in and the lab list | `vscode.version`, `laptop.license` | signed in with AccessID@wayne.edu; AccessID on the pre-approved list | one click: Sign in with Wayne State (`beethoven.wsuSignIn`) | run the wizard step "Sign in with Wayne State"; if not on the list, ask your lead | the WSU tenant blocking VS Code sign-in |
| `account.github` GitHub token | `account.wsu` | GitHub token stored in the keychain and accepted by the service | one click: Renew (`beethoven.renewToken`) | press Renew next to "GitHub personal access token" in the setup panel, or click its row in the Beethoven view | token formats or scopes changing |
| `account.huggingface` Hugging Face token | `account.wsu` | Hugging Face token stored in the keychain and accepted by the service | one click: Renew (`beethoven.renewToken`) | press Renew next to "Hugging Face access token" in the setup panel, or click its row in the Beethoven view | token formats or scopes changing |
| `account.list` Your Claude account list | `laptop.os` | the account list the engine's bee command keeps on this computer (~/.beethoven/engine/accounts.json, or under BEE_REGISTRY_DIR or BEETHOVEN_HOME as the engine reads it) is absent, or present and readable; Beethoven reads it and never writes it | by hand | add an account with "bee account add <label>" in a terminal; a list that does not read is the engine's to repair, never Beethoven's | the engine moving the list or changing its rows |
| `account.choice` Claude account for the terminals | `laptop.os`, `account.list` | the setting beethoven.account is empty (Claude Code's own sign-in, as before) or names a listed account, whose directory every integrated terminal of a local window gets as CLAUDE_CONFIG_DIR with the label as BEE_ACCOUNT (the label alone for an account at Claude Code's default place); a remote window's terminals get neither | one click: Open the setting (`workbench.action.openSettings`) | Settings > Beethoven > Account: pick a label from your account list, add the account with "bee account add <label>" in a terminal, or leave the setting empty | the Claude Code VS Code extension not reading CLAUDE_CONFIG_DIR from the terminal environment (not yet measured on a real machine) |
| `account.claude` Claude on this laptop | `account.wsu`, `vscode.claude-binary`, `account.choice` | Claude Code on this laptop, in the directory the account setting names, is signed in with the student's own Claude Pro or Max subscription (Beethoven reads status only) | one click: Sign in (`beethoven.claudeLocalSignIn`) | sign in to Claude Code on this laptop (setup step "Claude on this laptop"; it signs in under the chosen account) | claude auth status changing its output; plan names changing |

### Grid login node

| Node | Depends on | Assumes | Repair | If it fails | Future risk |
|---|---|---|---|---|---|
| `grid.scripts` Beethoven scripts on the grid | `network.grid-login` | the grid has this extension's scripts (same version, LF line endings) | automatic | run the wizard step "Install on the grid" | a home directory restore or clean-up removing ~/.beethoven |
| `grid.bashrc-block` Beethoven block in ~/.bashrc | `grid.scripts` | the block exporting the VS Code sysroot variables and PATH | automatic | ssh wsu-grid "~/.beethoven/bin/beethoven install" | a new default .bashrc from C&IT |
| `grid.vscode-sysroot` VS Code compatibility libraries (C&IT sysroot) | `grid.bashrc-block` | /wsu/apps/vscode sysroot and patchelf exist at the paths in the block | automatic | ask hpc@wayne.edu where the VS Code sysroot moved | Wayne State moving or upgrading the sysroot (repair rediscovers it) |
| `grid.login-tmp` Nothing of yours left under /tmp on the login node | `grid.scripts` | no container build leftovers (rootfs-*, build-temp-*, apptainer*) or files over 50 MB of yours under /tmp on the login node, which C&IT keeps free of user files; Beethoven builds containers only inside Slurm jobs with node-local temp and cache | automatic | ssh wsu-grid and remove your files under /tmp yourself (Beethoven reports them and deletes nothing there) | a container command run by hand on the login node; a build job killed before its cleanup trap |
| `grid.slurm` Slurm commands | `grid.scripts` | sbatch, squeue, sacct, scancel work on the login node | automatic | contact hpc@wayne.edu | a Slurm upgrade changing output formats |
| `grid.slurm-visibility` Access requests visible to the admin | `grid.slurm` | Slurm PrivateData=none (the admin sees the held access-request jobs) | automatic | the admin can grant directly without a request | C&IT enabling PrivateData=jobs |
| `grid.qos` Slurm partitions and QoS | `grid.slurm` | the account has the requeue or secondary QoS | automatic | ask your lead / hpc@wayne.edu for the QoS | QoS renamed by C&IT |
| `grid.internet` Internet from the grid | `grid.scripts` | HTTPS from the login node; curl reads secrets from stdin (-K -) | automatic | contact hpc@wayne.edu | a proxy introduced on the grid |
| `grid.acl-tools` ACL tools (setfacl/getfacl) | `grid.scripts` | POSIX ACL tools present (lab access) | automatic | contact hpc@wayne.edu | the lab volume moved to a filesystem without ACLs |
| `grid.home-quota` Home directory quota | `grid.scripts` | home below 98 % of its soft quota | automatic | delete or move large files; ask your lead for lab storage | quota policy changes |
| `grid.token-github` GitHub token on the grid | `grid.internet`, `account.github` | the grid copy of the GitHub token verifies | automatic | press Renew next to GitHub | GitHub token expiry policies |
| `grid.token-hf` Hugging Face token on the grid | `grid.internet`, `account.huggingface` | the grid copy of the Hugging Face token verifies | automatic | press Renew next to Hugging Face | Hugging Face token changes |
| `grid.claude-login` Claude signed in on the grid | `grid.scripts`, `account.claude` | Claude Code on the grid reports its own sign-in with a Claude subscription and no API key behind it (made by the student with beethoven claude login; Beethoven never touches the credential, never deletes it and never signs it out) | automatic; one click: Sign in on the grid (`beethoven.claudeSignIn`) | run Beethoven: Sign in to Claude on the grid (the sign-in lasts about a month) | Anthropic changing the login flow or its lifetime |
| `grid.license` Beethoven license on the grid | `grid.scripts`, `account.license-identity` | the grid has the same license key as this laptop, and every running worker accepts it for this grid account | automatic | Troubleshoot and repair copies it; a worker started before licensing needs a restart (Beethoven: Stop a worker, then Start) | a worker template older than the license check |
| `grid.accounts` Claude accounts on the grid | `grid.claude-login` | your own Claude sign-in only (Beethoven keeps no Claude token and uses no API key), no copied logins, and an API key an earlier version stored marked disabled; nothing in a sign-in folder is moved, linked or deleted | automatic | Troubleshoot and repair marks an API key an earlier version stored disabled (it deletes nothing); ssh -t wsu-grid "beethoven accounts remove --yes" deletes the key, and Claude tokens an earlier version stored are yours to delete by hand | Claude Code moving where --resume looks for transcripts |
| `grid.lab-access` Lab access | `account.claude`, `grid.token-github`, `grid.token-hf`, `grid.slurm` | the lab folder is readable (approved), or a request is pending | automatic | the last wizard step: Join the lab | the lab folder moving |
| `grid.runtime` Container runtime (Apptainer) | `grid.scripts` | the configured apptainer executable exists (repair switches to the current module) | automatic | ask your lead to republish the container | Wayne State upgrading or removing the apptainer module |
| `grid.container` Lab Claude container | `grid.lab-access`, `grid.runtime` | the lab container is adopted (repair runs beethoven adopt) | automatic | wait for lab access | a republished container at a new path |
| `grid.relay` Prompt relay on the login node | `grid.scripts` | beethoven relay answers PING | automatic | reinstall Beethoven on the grid | bash changes on the login node |
| `grid.lab-folder` Lab folder layout (admin) | `grid.acl-tools` | the volume root is closed to other users (its list of approved accounts is the gate), nothing in shared/ is writable by others, and requests go through Slurm; shared/beethoven stays readable below the gate for the browser and desktop editions | automatic | ssh wsu-grid "beethoven access init" | someone widening permissions by hand |
| `grid.slurm-in-worker` Slurm inside the workers | `grid.worker` | the worker's Claude can submit and watch Slurm jobs from inside its container (the host client, its library, munge and the config are bound in) | automatic | Troubleshoot and repair restarts a worker started before version 3; if it still fails, tell your lead (the detail names the missing piece) | Wayne State moving the Slurm client, its library, munge or slurm.conf; a Slurm upgrade that needs more host libraries |

### Grid jobs

| Node | Depends on | Assumes | Repair | If it fails | Future risk |
|---|---|---|---|---|---|
| `grid.worker` Claude workers | `grid.container`, `grid.qos` | every running worker job has a daemon that answers (heartbeat under 90 s) | automatic | Beethoven: Stop a worker, then Start a worker | node images changing under the container |

### Compute node and container

| Node | Depends on | Assumes | Repair | If it fails | Future risk |
|---|---|---|---|---|---|
| `node.probe` Compute node and container | `grid.worker` | inside a worker: the container runs node and Claude Code, has a pseudo-terminal and HTTPS | automatic | restart the worker; if it persists tell your lead | a node OS or kernel update breaking the container |
| `grid.phone` Phone access | `grid.worker` | when turned on, the worker's Remote Control session runs | by hand | Beethoven: Phone access (sign in again if asked) | Remote Control flags or login flow changing |

### Features and the nodes they must keep

| Feature | Nodes |
|---|---|
| wizard | `account.wsu`, `account.github`, `account.huggingface`, `account.claude`, `laptop.ssh-key`, `laptop.ssh-config`, `network.grid-login` |
| grid install | `grid.scripts`, `grid.bashrc-block`, `grid.vscode-sysroot`, `grid.token-github`, `grid.token-hf`, `grid.claude-login` |
| workers | `grid.slurm`, `grid.qos`, `grid.runtime`, `grid.container`, `grid.worker`, `grid.slurm-in-worker`, `node.probe` |
| relay | `grid.relay`, `laptop.relay` |
| lab access | `grid.lab-access`, `grid.lab-folder`, `grid.slurm-visibility`, `grid.acl-tools` |
| remote ssh | `vscode.remote-ssh`, `vscode.remote-ssh-settings` |
| claude bridge | `vscode.claude-code`, `vscode.claude-binary`, `vscode.mcp-bridge` |
| phone | `grid.phone` |
| accounts | `grid.accounts` |
| licensing | `laptop.terms`, `laptop.license`, `account.license-identity`, `grid.license` |
| claude signin | `account.claude`, `grid.claude-login` |
| claude account | `account.list`, `account.choice`, `account.claude` |
| token capture | `vscode.shell-integration`, `vscode.secret-storage` |
| grid etiquette | `grid.login-tmp`, `grid.home-quota` |
<!-- graph:end -->
