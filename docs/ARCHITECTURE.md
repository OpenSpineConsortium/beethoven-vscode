# Beethoven for VS Code: architecture

Beethoven for VS Code (Ashley for VS Code until 3.0.0) is three small things that agree on one
file format.

| Piece | Runs on | Language | Job |
|---|---|---|---|
| VS Code extension (`extension/`) | the student's laptop, inside VS Code | TypeScript | wizard, secrets, Remote-SSH, the Beethoven view, "Ask", MCP registration |
| MCP server (`extension/dist/mcp-server.js`) | the laptop, spawned by Claude Code | TypeScript (bundled) | gives the local Claude the `beethoven_*` tools |
| Grid CLI + daemon (`grid/`) | the grid: `beethoven` on the login node, `beethovend.js` inside a container on a compute node | bash, Node | install, workers, the request queue, Claude Code itself |

Everything the laptop does on the grid is `ssh wsu-grid ~/.beethoven/bin/beethoven <verb>`. There is
no port, no tunnel and no server on the laptop; nothing on the login node beyond `sbatch`, `squeue`,
`cat`, `ls` and a half-second sleep loop.

## The names from before 4.0.0

The product was Ashley for VS Code until 3.0.0 and is Beethoven for VS Code from 4.0.0
(2026-09-30). The old names below still work, each because something built or written before the
rename still uses it; everything new uses the Beethoven name.

| Old name | What it is now | Why it stays |
|---|---|---|
| `~/.ashley` on the grid | a link to `~/.beethoven`; `beethoven install` moves the folder once, while no worker runs | Ashley for VS Code 3.0.0, grid scripts before 7 and the browser edition's framework before 7 name it |
| `bin/ashley`, `bin/ashleyd.js` | links to `beethoven` and `beethovend.js` | the same builds, and worker job files written before grid scripts 7, run them |
| `/rs/rs_grp_oschome/shared/ashley` | a link to `shared/beethoven`, the lab folder | grid scripts before 7 and Beethoven builds before 8.0.0 reach the lab's copies through it |
| `~/.ashley-local` on the laptop | still used while no `~/.beethoven-local` exists | the key and the accepted terms carry over, and both extensions see one key while both are installed |
| `ashley.*` settings | read while the `beethoven.*` one is unset; never declared | a value a student set keeps working; declaring them would collide with Ashley while it is installed |
| `ashley.*` command ids | hidden aliases while Ashley for VS Code is not installed | keybindings and notes that name them keep working; two extensions cannot hold one id |
| `ASHLEY_*` environment names (`ASHLEY_HOME`, `ASHLEY_GRID`, `ASHLEY_LICENSE_DIR`, `ASHLEY_VENDOR_DIR`, ...) | read after the `BEETHOVEN_*` name | older job files, forwarders and shells still set them |
| the `# >>> ashley` blocks in `~/.ssh/config` and `~/.bashrc` | recognised and replaced by the Beethoven block | an upgrade must not leave two blocks |
| `ASHLEY1.` keys and `ASHLEYREV1` lists | what the issuers still write (`KEY_PREFIX` in the access service, `--prefix` in the vendor tool); `BEETHOVEN1.` and `BEETHOVENREV1` verify as well | Ashley for VS Code 3.0.0, grid scripts before 7 and Beethoven builds before 8.0.0 accept only the old prefix |
| `ASHLEY-RELEASE1` | the signature domain of every `SHA256SUMS.sig` | a format tag: renaming it would fail `verify-release` on every earlier release |
| the Slurm job name `ashley_access` | a lab-access request (below) | an admin's tool older than grid scripts 7 looks for exactly it |
| the Worker `ashley-service` and the pages under `/ashley/` | kept beside `beethoven-access` and `/beethoven/` | installed 3.0.0 builds know only those addresses |
| `openspineconsortium.ashley` | the retired Marketplace item | a Marketplace id cannot be renamed (`docs/MARKETPLACE.md`) |

## Topology

```
laptop                           warrior (login node)                  compute node (Slurm job)
──────                           ────────────────────                  ────────────────────────
VS Code ─ Beethoven ext ──ssh──▶ ~/.beethoven/bin/beethoven ──files──▶ apptainer exec node22-bookworm
Claude Code ─ MCP ─┘             (bash: install, status,               └─ node beethovend.js
Remote-SSH ─────────ProxyJump─────────────────────────────────────────▶   └─ claude -p ... (2.1.283)
                                 sbatch / squeue                             watches  workers/<w>/inbox
                                                                             writes   workers/<w>/outbox
                                 shared home: ~/.beethoven/{accounts,sessions,workers}
                                 CephFS ROOT: containers/, npm/, workspaces/
```

The login node is a jump host. VS Code Remote-SSH connects to `voh3.nas.grid.wayne.edu`
(any node where the student holds a job) through `ProxyJump wsu-grid`; C&IT forbids the VS Code
server on `warrior` and kills it there. Compute nodes have internet, so Claude Code, `npm`,
Hugging Face and Zenodo all work from inside the job.

## The request queue

A request is a JSON file. Its life:

1. The laptop writes `~/.beethoven/workers/<w>/inbox/<id>.json` through `beethoven send` (stdin,
   `.part` then rename, so the daemon never reads a half-written file).
2. `beethovend.js` polls the inbox every second, claims the file by renaming it to
   `<id>.json.claimed` (an atomic operation on the shared filesystem; two daemons cannot both win).
3. It checks that Claude Code is signed in (below), resolves the session, and spawns
   `claude -p <prompt> --output-format stream-json --verbose --permission-mode <mode> --max-turns N [--resume <sid> | --session-id <uuid>]`
   in the session's working directory, with `CLAUDE_CONFIG_DIR=~/.beethoven/claude`.
4. Every stream-json line is appended to `outbox/<id>.events.jsonl` as it arrives. `beethoven wait
   --stream` tails that file to the laptop as `EVENT {…}` lines, so VS Code shows tool calls live.
5. On exit, the daemon writes `outbox/<id>.json` (`.part` then rename): status, result text,
   session id, account, turns, duration, node, job, and Claude Code's list-price estimate
   (`cost_usd`, never shown: on the subscription it is not a bill). `beethoven wait` prints it as
   `RESULT {…}`.

### How a prompt travels, and how fast

The laptop keeps **one ssh session** to the login node open, running `beethoven relay`. A prompt
is one line on that session's stdin; the relay writes the inbox file and answers `QUEUED`; the
daemon polls the inbox every 250 ms; results and events come back on the same session as
`RESULT`/`EVENT` lines. Measured on 2026-09-28 (Windows laptop, skew-corrected; `docs/research/`):

| Path | Median | Range |
|---|---|---|
| one ssh connection to the login node | 2.6 s | 2.4 to 2.7 s |
| prompt received by the worker, one ssh per prompt (the first design) | 2.0 s | 1.6 to 2.2 s |
| relay round trip | 20 ms | 18 to 23 ms |
| relay: queued on the grid, ack on the laptop | 37 ms | 35 to 43 ms |
| **prompt received by the worker via the relay** | **0.19 s** | 0.05 to 0.28 s |
| ssh straight to the compute node (for comparison) | about 25 s | the node's sshd delay |

![Latency of the prompt paths](figures/latency.png)

So the relay is roughly ten times faster to receipt and the remaining 0.1 to 0.3 s is the
daemon's poll interval. It is "UDP-like" in the sense that matters (no per-message handshake,
fire-and-forget `send` with an ack in 40 ms) while staying reliable: the file is the message,
and a dropped session loses nothing that was already queued. If the session drops, the next
call reconnects; every call also falls back to a fresh ssh. True UDP to the node is impossible
(the laptop cannot reach compute nodes) and unnecessary. Claude Code's own start-up (about 5 s
cold) now dominates the time to a first token; a warm `--input-format stream-json` process
per session is the next lever if that ever matters.

A queued request survives a daemon restart, a requeued job or a closed laptop: the daemon
moves any `.claimed` file back to the inbox when it starts. An interactive ssh to the login
node or the node (Remote-SSH, `Beethoven: Open a terminal on the grid login node`) remains
available; it is simply not the path prompts take.

Why not a socket or a TCP port: the laptop can only reach the login node; the daemon runs on
whichever node Slurm chose; the shared home is the one thing both see. Files are also what a
student can debug with `ls` and `cat`.

## Sessions

`~/.beethoven/sessions/<name>.json` maps a name the student chose ("thesis", "figure-2") to a
Claude Code session id, the working directory it is bound to and the account that owns it. The
first turn of a session passes `--session-id <uuid>` so the id is known even if the run dies;
later turns pass `--resume <uuid>`. Claude Code keeps the transcript under
`<CLAUDE_CONFIG_DIR>/projects/<encoded cwd>/<uuid>.jsonl`, which is why a session stays bound to
its directory.

`--resume` looks only in the running config folder's `projects/`. Measured on Claude Code 2.1.283:
from a second config folder the resume answers "No conversation found"; with the transcript present
it finds it. Up to grid scripts 7 a turn could move to the student's API key after a limit, so every
account's `projects/` became a link to one `~/.beethoven/projects`. The sign-in folder's link stays
(the daemon links it before each run; the diagnostics node `grid.accounts` finds and repairs an
unlinked one), so the sessions kept there still resume.

## Credentials

The rule, since version 2: **Beethoven never reads, stores, copies or relays a Claude credential.**
Anthropic's Claude Code terms permit an end user to sign in to the unmodified binary with their own
subscription, including where a platform hosts it, and forbid a third-party developer to collect,
store or intermediate Claude.ai credentials or tokens (`docs/research/reports/`, the compliance
report). Version 1 captured the output of `claude setup-token` and copied it to the grid; that was
on the wrong side of the line and is gone.

What happens instead:

- `~/.beethoven/claude` is a `CLAUDE_CONFIG_DIR` in the student's own grid account, mode 700. The
  student runs `beethoven claude login` once (the extension opens the terminal): inside their own
  Slurm allocation, in the lab container, the unmodified `claude auth login` prints its link, the
  student authorises in the browser and pastes the code, and Claude Code writes its own credential
  there. Beethoven writes nothing there but Claude Code's first-run settings.
- Every Claude Code process Beethoven starts on the grid (the worker's `claude -p`, Remote Control)
  gets `CLAUDE_CONFIG_DIR=~/.beethoven/claude` and an environment with every credential variable
  removed (`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL`, the file-descriptor variants and the Bedrock, Vertex and Foundry switches).
  Claude Code uses what it stored.
- The daemon asks `claude auth status` at start, every 30 minutes, when the credential file
  changes and before a request when its last answer is over a minute old, and puts the answer (signed in or not, the e-mail Claude Code reports) in its heartbeat.
  The laptop shows it; the diagnostics node `grid.claude-login` reads it; a prompt sent while not
  signed in is answered with the command that fixes it. Only a claude.ai sign-in billed by Anthropic
  itself counts, the laptop's rule: a sign-in through an API key, a token or a cloud provider is
  reported as not a Claude subscription, and the worker and phone access run nothing on it.
- One person, their own accounts (the next section), and no other credential: no API key and no
  usage credits, by anyone, ever (the maintainer, 2026-10-04). When the subscription window is spent the daemon
  answers `rate_limited` with the reset time in `retry_after`; nothing retries by itself, and the
  student sends the request again after the reset. The pay-per-use key overflow of 4.0.0 (grid
  scripts 7) is gone; a key it stored in `~/.beethoven/accounts/apikey/apikey` is never used or
  sent and never deleted by Beethoven. A worker still running the grid scripts 7 daemon reads that
  key on every request and honours only the `disabled` file beside it, so every grid command the
  laptop runs (`GRID_CLI_PICK` in `shell.ts`) puts that file there first, and `beethoven install`,
  `worker start`, the laptop's token push and `diag --repair` do as well (it deletes nothing). The
  first contact of a laptop updated to 5.0.0 therefore stops such a worker before the grid step
  replaces the scripts. A request already running on the key when the file appears finishes there. `grid.accounts` reports the key until the student runs `beethoven accounts remove --yes`
  in a terminal. Extra usage (usage credits) on the student's Claude account is a setting Beethoven
  cannot see or change; the texts tell the student to keep it off.
- On the laptop, the wizard checks `claude auth status` of the student's own Claude Code and
  requires a subscription sign-in (Pro or Max), because the lab works on subscriptions; it stores
  nothing.
- A copied `.credentials.json` is never used: a copy shares a refresh-token chain with the machine it
  came from, and the first refresh on either side revokes the other.

The sign-in lasts about a month (a user report; Anthropic's docs give a three-day warning before
expiry). The heartbeat notices when it ends; the extension asks for step 12 again.

## Several accounts of one person: `beethoven.account`

Decided by the maintainer on 2026-10-04 (the plan item *ACCOUNT_SWITCH_CLIENTS.md*, 2): a student
may hold several Claude accounts of their own, and the engine (`bee`, the `beethoven-agents`
repository, not installed with this edition) keeps the list of their sign-in directories. This
edition reads that list and lets the student pick one for the laptop. "One person, one Claude
account" became "one person, their own accounts": never pooled, never anyone else's.

- **The list is the engine's file, read only.** `~/.beethoven/engine/accounts.json` holds `version`
  and, per account, `label`, `path`, `enabled`, `order` and `hibernate_until`; nothing from inside a
  sign-in directory. Sign-in directories are `~/.beethoven/accounts/<label>/claude`; the account
  `main` is a link to the edition's own `~/.beethoven/claude`. Labels are lower-case letters, digits
  and hyphens (`ACCOUNT_LABEL` in `core/accounts.ts`). Beethoven never writes the file, never reads
  inside a sign-in directory (the one thing ever asked of one is `claude auth status`), and never
  copies, moves or links a credential between two directories: the switch is which directory the
  next Claude Code gets, nothing else. `usage/<label>.json` beside the list is not read by this
  edition.
- **What the terminals get.** With `beethoven.account` empty (the default) nothing changes: the
  terminals and the Claude Code extension use Claude Code's own sign-in, as in every build before.
  With a label that is listed and enabled, `hydrateEnvironment` (`vscode/store.ts`) puts
  `CLAUDE_CONFIG_DIR=<that account's path>` and `BEE_ACCOUNT=<label>` into the persistent
  `environmentVariableCollection`, so every integrated terminal gets them; the terminal the wizard
  opens for `claude auth login` gets them explicitly as well (the `env` of `WizardUI.runInteractive`),
  and so does *Investigate the failure with Claude* (`claude -p` on the laptop). These are the two
  variables `bee-use <label>` sets, so the edition and the command line share one list and one
  meaning. `Beethoven: Sign in to Claude on this laptop` keeps its flow and signs in under that
  directory, creating it empty and mode 0700 when it does not exist yet (Claude Code writes its own
  files there). A label that is not listed, is turned off, or is not a label at all sets nothing:
  the terminals keep the usual sign-in, the student is told once per label (a warning with the two
  fixes: pick a listed label, or `bee account add <label>` in a terminal), the Beethoven view's
  *Claude on this laptop* row says so, and the diagnostics nodes `account.list`, `account.choice`
  and `account.claude` say it every time. With a valid label the row and the wizard's step detail
  carry "as <label>" beside the signed-in account.
- **The grid is not changed.** A sign-in on the grid (`beethoven claude login` through the grid
  scripts) and the worker still use `~/.beethoven/claude` (grid scripts 8). Which of the student's
  accounts a grid job runs under, and the hand-over between them, is the engine's to choose
  (`beethoven-research`, `BUILD_PLAN.md` section 17), not this setting's.
- **Not yet measured:** whether the Claude Code extension for VS Code honours `CLAUDE_CONFIG_DIR`
  from the terminal environment (Cloak's known limitation, named in the plan item). The integrated
  terminals and the processes this edition starts get the variable; what the Claude Code extension's
  own panel does with it has not been checked on a real machine. The maintainer checks before 5.0.0
  ships (`docs/MARKETPLACE.md`, before the first publish).

## Secrets: where they are and where they are not

| Secret | Laptop | Grid | Never |
|---|---|---|---|
| GitHub, Hugging Face tokens | VS Code SecretStorage (OS keychain); injected into integrated terminals | `~/.beethoven/secrets.env` (mode 600), read by the daemon into the worker's environment | job logs, `sbatch --export`, command lines |
| Claude sign-in | Claude Code's own store (Beethoven never reads it) | `~/.beethoven/claude`, written by Claude Code itself (700) | Beethoven's files, logs and command lines (since version 2) |
| Anthropic API key | none asked for; a copy 4.0.0 stored is never used or sent, only its presence checked (Manage stored tokens and Reset delete it) | none written; `accounts/apikey/apikey` from 4.0.0 is never used, and marked `disabled` for workers of grid scripts 7 (`beethoven accounts remove --yes` deletes it) | laptop terminals and every Claude Code environment (`ANTHROPIC_API_KEY` is stripped: it would switch Claude Code to pay-per-use) |
| Grid password / OTP | nowhere | nowhere | typed once, in a terminal, to install the SSH key |

Files travel over ssh **stdin** (`cat > file` with `umask 077`), never as arguments.

## The container

`bootstrap.sbatch` (one job per user, 7 minutes measured) builds an unprivileged Apptainer
**sandbox directory** from `docker://node:22-bookworm` on the student's CephFS space and installs
`@anthropic-ai/claude-code@2.1.283` into a persistent npm prefix there. A sandbox rather than a
`.sif`: SIF-to-sandbox conversion at exec time is what failed on this grid before, and several
nodes lack `unsquashfs`. The host is CentOS 7 (glibc 2.17); Claude Code needs Node 22, which needs
a newer glibc, hence the container (glibc 2.36 inside). Runtime order tried:
`module load apptainer/1.2.2` (worked on `asx1`), the conda `singularity` 3.8.6, `module load
singularity/3.5.2`, `/usr/bin/apptainer`. `~/.local/bin/singularity` is skipped on purpose.

The worker job (`worker.sbatch.tpl`) execs the daemon inside the sandbox with `$HOME`, the
CephFS tree and a `/dev/shm` scratch bound to `/tmp` (`/tmp` on nodes is swept by a cleaner
while jobs run). `--signal=B:TERM@120` gives the daemon two minutes to finish a turn at the wall
limit; `--dependency=singleton` keeps one job per worker name; on the `requeue` QoS the job is
`--requeue --open-mode=append` because the daemon is re-entrant.

**Slurm inside the worker.** The container has no Slurm of its own, so until version 3 the
worker's Claude could not submit or even see jobs, although its instructions said it could (found
by the dependency study; confirmed on asx1: no grid command, `sbatch` or `squeue` on its PATH, and
`worker list` called running workers dead). The worker job now binds the host's Slurm client
in read-only: `/usr/bin` under `/opt/host/bin`, `/usr/lib64/slurm`, the munge library into `/usr/lib`
(a default search folder, so no `LD_LIBRARY_PATH` leaks into submitted jobs), `/etc/slurm`, the
munge socket, and a user list that adds the `slurm` and `munge` users that `slurm.conf` names
(without them: "Invalid user for SlurmUser slurm"). Small wrappers in `<worker>/slurm/bin` run the
host binaries with the host's PATH and without the container's variables, so a submitted job runs
on the host with the student's normal environment. The daemon asks Slurm for its own job at start
and puts the answer in its heartbeat; Claude is told either that Slurm works or that it does not,
and why. The diagnostics node `grid.slurm-in-worker` reads that answer.

`beethoven worker start` saves its settings in `<worker>/params`; `beethoven worker restart` stops
the job and starts it again from the current template with those settings, so an upgrade of the
template reaches running workers.

Grid etiquette, as C&IT stated it on 2026-09-28: nothing container-related runs on the login node,
and nothing of ours is left under its `/tmp` (a build there once left 7 GB of `rootfs-*`).
`bootstrap.sbatch` refuses to run outside a Slurm job and puts `APPTAINER_TMPDIR`,
`APPTAINER_CACHEDIR` and their `SINGULARITY_` twins on the compute node's local disk
(`$SLURM_TMPDIR` or `/tmp`), removed by a trap however the job ends; the worker template points the
runtime's temp and cache at its `/dev/shm` scratch; `cmd_diag_node` refuses off a job; the diagnostic
`grid.login-tmp` finds leftovers under the login node's `/tmp` and removes the recognisable ones on
repair. Temp that must be shared between nodes goes under `/wsu/tmp`.

## The shared container library

Containers are read-only at run time (every account's sessions, settings and caches live in its
own home), so one copy serves the whole lab. `/rs/rs_grp_oschome/shared/beethoven/` (group
`oschome`, mode 2775; `shared/ashley`, its name until 2026-09-30, is a link to it) holds
`library.json` and one sandbox per entry:

```json
{"version": 1, "default": "claude-node22",
 "containers": {"claude-node22": {"sandbox": ".../containers/claude-node22", "claude_bin": ".../npm-claude-node22/bin/claude",
   "runtime": "/wsu/el7/gnu7/apptainer/1.2.2/bin/apptainer", "image": "docker://node:22-bookworm",
   "claude_version": "2.1.283 (Claude Code)", "gpu": false, "built": "...", "built_by": "go2432", "purpose": "general ..."}}}
```

- `beethoven install` adopts the library's default when it is readable (`beethoven adopt <name>`
  writes `config.env` and `READY` in a second; nothing is built, nothing is stored in the student's
  space). `beethoven install --build-own` (admin only) builds a private copy for testing an image.
- `beethoven worker start --container <name>` runs any entry; the worker's job script carries the
  sandbox and binds the library root. A student can run a CPU worker on the general container and
  a GPU worker on a CUDA one at the same time.
- Leads publish entries with `beethoven library publish --name <name> --image docker://<image>
  [--gpu] [--purpose "..."]`: a job builds the sandbox, installs the pinned Claude Code, merges the
  entry into `library.json` and makes the tree group-readable. Entries are pinned by image and
  Claude Code version, so every student runs the same bits; an update is a new entry.
- **The lab's philosophy.** The admin curates one folder, `/rs/rs_grp_oschome/shared`: datasets,
  Claude containers, software. Students only ever **read** it; all their science runs in their own
  grid accounts (home, jobs, workers, their own tokens and subscription). Nothing under the lab
  volume is writable by students, not even a request drop-box.
- **Requests travel as held Slurm jobs.** *Join the lab* (the wizard's last step) submits one held,
  zero-work job named `ashley_access` (its name from before the rename, kept because an admin's tool
  older than grid scripts 7 looks for exactly it) whose comment carries the student's note. Slurm
  authenticates the submitter (`PrivateData=none` here, so the admin sees every user's jobs), so a
  request cannot be forged or squatted and uses no storage. The admin's ingest writes
  `status/<id>.json` (mode 600 plus an ACL for that student only) and gives the applicant a
  traverse-only ACL on the path to it. Decisions: approve, deny or remove with a message, reset (the
  student may ask again); each goes to `access/requests/decisions.log`. The student's own held job
  is cancelled once a decision exists.
- **Approval is a read-only ACL** (CephFS honours POSIX ACLs; the admin owns the volume): `--x` on
  the volume root, `r-x` plus a default ACL on `shared/`, and `r-X` recursively with default ACLs on
  everything under it except `access/`, walking physically (links are never followed out of the
  folder). No unix-group change, no ticket. `beethoven access admin resync` re-applies grants after
  data is copied in with `cp -a` or `mv`; publishing a container resyncs automatically.
- **Layout after `beethoven access init`:** volume root 2770 with a default ACL `o::---` (new entries
  start closed); `shared/` and its contents 2750 (the group reads, only the admin writes); `access/`
  and `access/status/` 2710; `access/requests/` 2700. Nothing is open to other grid users.
- **The request is refused until the environment works the way the lab works:** every earlier step
  done; the Claude Code and Remote-SSH extensions and the bridge present; and, checked on the grid
  by `beethoven access requirements`, a Claude subscription token the API accepts (`GET /v1/models`
  with the OAuth token must answer 200; 401 means invalid or revoked; `claude setup-token` only
  issues tokens to paid plans), and GitHub and Hugging Face tokens that verify. The shared container
  is what access gives, never a precondition; students are never offered a private build (`beethoven
  install --build-own` is for the admin only).
- **Token checks never put a token on a command line:** `curl -K -` reads the header from stdin, so
  nothing appears in the login node's process list (sampled during three runs: nothing).

Because every worker of an account shares `~/.beethoven`, a worker Claude can hand work to another
worker with `beethoven send --worker <name>` from its shell; the daemon tells each worker who it is,
which peers are alive and the exact command (`peerNote()` in `beethovend.js`). A lead worker on the
general container can therefore fan out to a GPU worker on a CUDA container and collect the result
with `beethoven result`.

## Wayne State sign-in and the pre-approved list

The wizard's first step signs the student in with the university's Microsoft account through VS
Code's built-in Microsoft sign-in (work or school accounts only; only the account's e-mail is used).
The AccessID is the part before `@wayne.edu`, and the student continues only if it is on the lab's
approved list. That list lives in the access service (`tools/intake/worker.js`, a Cloudflare
Worker): students ask for access on the website
(`https://openspineconsortium.com/beethoven/request.html`: AccessID, name, e-mail, what for; each
request is e-mailed to the maintainer with an Approve and a Deny link), the maintainer decides from
that e-mail or approves, denies, adds or removes people on
`https://openspineconsortium.com/beethoven/admin.html` (admin token plus Cloudflare Access), and the
extension fetches the current list from the service's `/allowlist`, in the same shape as the bundled
file. An approved person's trial button asks the service's `/trial` for a key, issued after the
service has asked Microsoft who they are; removing a person puts every key issued to them on the
signed revocation list the service serves at `/revoked`. The service's addresses are in
`https://openspineconsortium.com/beethoven/services.json`, which `tools/intake/deploy.sh` writes
into the site repository; the pages themselves are generated by the site repository's
`tools/build_site.py` (this edition's own pages, its agreements and privacy statement under
`/beethoven/vscode/`), not from this repository. The bundled list, `extension/media/allowlist.json`
(`python tools/allow.py add ab1234`, then rebuild), is the fallback when no service is configured
there or in `beethoven.allowlistUrl` (or the `ashley.*` value an earlier install set). This is a
gate for honest users; the enforceable boundary is still the grid (the student's own account and the
admin's approval). The lab assumes the student's Claude, GitHub and Hugging Face accounts were made
with AccessID@wayne.edu.

## Phone access

Claude Code's Remote Control lets the Claude app (or claude.ai/code) drive a session running
elsewhere, over outbound HTTPS only. On the grid the worker hosts it (`grid/phone.js`, inside the
worker job). It uses the same sign-in as the worker (`~/.beethoven/claude`): Remote Control needs a
full login, which is what `beethoven claude login` makes. Two things are the student's own acts, in
a terminal, because Anthropic's flow and its consent belong to the account holder: the sign-in, and
Claude Code's one-time question "Enable Remote Control?", which `beethoven claude remote-consent`
puts in front of them; their answer is recorded in a marker file and repeated to Claude Code if it
asks again. Until both exist, phone access waits and says which one is missing.

Only one worker hosts phone access. All workers share the one sign-in, and two hosts on it would
fight. The host holds a lease: a directory `~/.beethoven/remote/host.lock` made with `mkdir` (atomic
on the shared home, where `flock` is not reliable across nodes), with a beat every 5 s, treated as
abandoned after 60 s, the timings Claude Code uses for its own credential locks. `beethoven phone on
--worker B` turns phone access off on the other workers; B shows *elsewhere* for about a second and
then takes over. Turning phone access off only stops processes: `claude auth logout` would revoke
the login, so Beethoven never runs it. The handlers act only for the current session, so output from
a stopped process can neither change the status nor raise inside the daemon.

Students are told, in the terminal and in the manual, that while the phone is connected the session
transcript, tool activity included, is stored on Anthropic's servers; confidential data stays out of
phone sessions.

## Terms and the signing dialog

Before anything else runs, `vscode/termsPanel.ts` shows the Trial Edition agreement (`LICENSE.txt`)
and the privacy statement in a webview: the full text must be scrolled to its end (opening it in an
editor also counts), four un-prechecked statements (each names the button) must be ticked, a name
typed, and "Accept and Continue" chosen. The record (`core/terms.ts`: terms version, edition,
SHA-256 of both texts, each statement's wording and state, the typed name, the surface, the host and
product versions, the locale, the install id, the time) is written to `terms.json` in
`~/.beethoven-local` (`~/.ashley-local` on a computer that ran Ashley for VS Code) with the exact
texts beside it, so the person can store and print them (Michigan UETA, MCL 450.838(3)), and the CLI
(`beethoven-cli terms`) and the MCP server refuse to work without it.

The paid Full Edition has its own agreement (`LICENSE-FULL.txt`), shown by the same dialog when a key
whose edition is not `trial` is registered (`licenseGate.set` calls `requireFullTerms`; the CLI
refuses such a key until the record exists); its record is `terms-full.json`, and from that moment it
governs. A changed terms version asks again; dispute terms never take effect by posting. This is the
assent pattern the click-through cases enforce (Berman, Chabolla, In re StockX): conspicuous notice,
an affirmative act whose label names the agreement, and a record of what was shown.

## Licenses

Every copy of Beethoven for VS Code needs a license key for the person using it
(`docs/LICENSING.md`). Keys are offline, Ed25519-signed (`grid/license.js`, one implementation for
the extension, the CLI, the MCP server and the grid daemon), name an AccessID or e-mail, carry an
edition, dates and a grace period, and are checked against the Wayne State sign-in the extension
recorded. The extension refuses every command but the ones that get you a key; the daemon refuses
work; both compare the key against a signed revocation list bundled with the release and, where the
lab publishes one, fetched daily. A clock set back does not revive a key: the latest time seen is
kept. Trials are keys of edition `trial`, one per AccessID, issued by the lab's licence service
(`tools/intake/`) after it has asked Microsoft who the signed-in person is, or by the lead with the
issuing tool.

## Error reports

With the student's permission, given at first run and changeable at any time, the extension sends
the maintainer one report per distinct failure per day after a troubleshooter run that found a
failure or made a repair (`extension/src/core/diagReport.ts`, `diagShare.ts`). The report holds
versions, the checks' ids and verdicts, and the failing checks' messages with e-mails, AccessIDs,
paths, hostnames, addresses, job numbers and token-shaped strings replaced. VS Code's own telemetry
setting is honoured; with no report address configured nothing is sent; every report is kept on the
laptop for the student to read. On the maintainer's side the service files it as a GitHub issue and
the maintainer reads it. Nothing on the maintainer's side runs on an API key, and nothing runs Claude
Code unattended in GitHub Actions, because that would need a key or a token held as a secret; any
help from Claude Code is the maintainer's own interactive session on his own subscription. Nothing in
this path touches a student's Claude account.

## Diagnostics

Every assumption Beethoven makes, from the laptop's OpenSSH to the node's pseudo-terminal, is a node
in one dependency graph (`extension/src/vscode/diagNodes.ts`, grid side `beethoven diag`). The
troubleshooter checks the nodes in dependency order, names the lowest broken one as the cause of
everything above it, and runs a repair where one is safe. A feature is not integrated until its
nodes are in the graph, and a test fails when a feature's nodes go missing. The map, the rule, and
how to add a node: `docs/DIAGNOSTICS.md`.

## The laptop side

- **Wizard** (`core/wizard.ts`): ten steps in a strict order (Wayne State sign-in, GitHub, Hugging
  Face, Claude, grid account, SSH key, SSH config, login, grid install, join the lab), each with
  `check()` and `run()`; a single step never runs before every earlier one is done; over an abstract
  `WizardEnv` (settings, secrets, UI). The VS Code extension and the terminal CLI plug in their
  own UI. Rerunning does only what is missing.
- **SSH config** (`core/sshConfig.ts`): one managed block between markers, inserted first so it
  wins over any `Host *`. `MACs +hmac-sha1` because the grid's sshd offers nothing newer to
  Windows OpenSSH 9.5; `AddressFamily inet` because on Windows the IPv6 attempt to the login
  node times out first (13 s per connection measured, 2 s with IPv4 only);
  `IdentitiesOnly` so the agent's other keys are not tried; a wildcard
  `Host *.nas.grid.wayne.edu` with `ProxyJump` so no per-node edit is ever needed. On Windows the
  same block and key are mirrored into WSL.
- **Interactive steps** open a VS Code terminal whose *process* is `ssh` or `claude` (no shell,
  no quoting) and read its exit status.
- **Environment**: `environmentVariableCollection` (persistent) rather than editing
  `terminal.integrated.env` settings, so it can be cleared and does not leak into settings sync.
- **MCP**: `claude mcp add-json --scope user` with the server run by system `node` (>= 20) or by
  VS Code's own Electron with `ELECTRON_RUN_AS_NODE=1`, so students need not install Node.
  Fallback: `.mcp.json` in the workspace.

## Xcode and other editors

`core/` never imports `vscode`. `dist/beethoven-cli.js` runs the same wizard and the same grid calls
from a terminal; `cli/beethoven` is a ten-line ssh forwarder for machines without Node. The MCP
server is editor-agnostic: any client that speaks MCP over stdio (Claude Code in Xcode's
terminal, Claude Desktop, an Agent SDK script) can register it. A native Xcode extension is the
wrong layer: Xcode Source Editor Extensions cannot open terminals, store secrets or run
processes; the CLI plus MCP is the port.

## What is deliberately not here

- No Nextflow yet. The queue and the worker are the substrate a pipeline can call
  (`beethoven send` from a Nextflow process, `beethoven result` in the next); the recipe's Nextflow
  section stays the plan.
- No shared lab account, no cross-student pooling.
- No X11. Remote-SSH renders images; `srun --x11` remains available for the rare tool that needs
  a display.
