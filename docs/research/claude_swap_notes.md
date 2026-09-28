# claude-swap and cswap-desktop: notes for Ashley

This is a read-only study, done 2026-09-28. Two repositories were read:

- **realiti4/claude-swap**, `main` at 9aa6d02 (2026-09-20, `pyproject` 0.27.0b1). The latest release and the PyPI version are v0.26.0 (2026-09-02). All 395 issues and PRs were read by title, and the relevant ones in full.
- **TheSkinnyRat/cswap-desktop**, `main` at f339628 (release v0.1.21, 2026-09-09).

Ashley paths refer to Ashley commit a2e1f69. Paths inside the two tools are relative to their repo roots. Claims marked *(measured by ...)* are the authors' own measurements and were not repeated here. Nothing in either tool was run.

## Applied in version 1 (2026-09-28, grid scripts version 3)

Five findings were defects in the version about to be tested, so they were fixed now rather than
planned. Each has a test, and the tests ran inside the lab container on a compute node (12 of 12
passed; the phone tests need a pseudo-terminal and skip on Windows).

| Finding | What changed | Test |
|---|---|---|
| A session moved to the student's API key loses its conversation (§5 Step 2) | Measured first on Claude Code 2.1.283: from a second config folder, `--resume` answers "No conversation found"; with the transcripts present it finds the session. Every account's `projects/` now links to one `~/.ashley/projects` (`ashleyd.js` `shareTranscripts`, `ashley` `share_transcripts`) | the fake Claude now keeps transcripts per config folder like the real one; the daemon test fails with the real message when the fix is removed |
| Two workers could host the phone on one login (§4 item 2) | An mkdir lease `~/.ashley/remote/host.lock`, beat every 5 s, abandoned after 60 s; `ashley phone on` turns phone access off on the other workers; status names the host | four lease tests: one host, hand-over, abandoned lease, sign-in |
| Only two of the auth variables were removed (§3 item 4) | Both launchers remove all six, including `ANTHROPIC_AUTH_TOKEN` and `ANTHROPIC_BASE_URL` | the fake Remote Control records its environment; all six are absent |
| A fresh phone login could show onboarding prompts (§3 item 7) | `pretrust()` seeds `hasCompletedOnboarding` and `theme` | checked in the first lease test |
| One person, one subscription was not enforced (§5 Step 3) | `ashley accounts add-token` refuses a second subscription token; copied logins are no longer used; `minted_at` is recorded; a kind change removes the other kind's files; the wizard pushes through the CLI so these rules apply | diagnostics node `grid.accounts` |

The container run also found a defect the study did not: a phone process that had been stopped
could still deliver output, and the handler read a cleared variable and threw. Inside the worker
that would have ended the daemon. Handlers now act only for the current process, and spawn and
pipe errors are logged instead of thrown.

## 1. What the two tools do

**claude-swap (`cswap`)** is a Python 3.12+ command-line tool with a text UI and a macOS menu bar. It keeps several Claude Code logins on one machine and moves one of them into the place Claude Code reads. On Linux, WSL and Windows that place is `<config>/.credentials.json`; on macOS it is the Keychain item `Claude Code-credentials`; in both cases it also swaps the `oauthAccount` block of `~/.claude.json`. Each login is backed up in a slot, under `${XDG_DATA_HOME:-~/.local/share}/claude-swap` on Linux and `~/.claude-swap-backup` elsewhere. The backups are base64 files at mode 0600; base64 is not encryption. What cswap does with the slots:
- It reads each slot's 5-hour, 7-day and per-model weekly usage from the undocumented `GET api.anthropic.com/api/oauth/usage`.
- It switches the default login in place. Claude Code notices the file's new mtime on its next request, so no restart is needed.
- It switches automatically at a threshold (`cswap auto`, default 90%).
- It runs one account per terminal with `cswap run N`, which points `CLAUDE_CONFIG_DIR` at a seeded per-account directory. This is the same isolation Ashley already uses.
- It cooperates with Claude Code's own mkdir-based credential locks. It refreshes only inactive slots, and guards each single-use refresh token with a lock plus a fingerprint check.
It has no server, no relay and no remote access. The maintainer describes it as doing `/logout` and `/login` by hand (#31).

**cswap-desktop ("Claude Swap")** is an Electron 44 / React 19 desktop app that sits on top of the installed `cswap` binary. It does not bundle Python or cswap, never writes credentials and never calls Anthropic. Every action is a subprocess call to `cswap ... --json`, run one at a time through a single queue, with secrets passed on stdin. On top of that it adds:
- an accounts table showing 5 h, 7 d and per-model usage as bars or rings, with reset countdowns;
- a weekly pace marker;
- a tray menu with one-click switching;
- a long-running `cswap auto --json` child process whose event stream drives desktop notifications;
- a page mapping folders to accounts;
- export and import dialogs that warn the files are plaintext;
- a plan badge, read from two non-secret fields of the live `.credentials.json`;
- a watcher on cswap's data folder, a log of every command it ran, and a fake `cswap` for tests.

It has no ownership model: any email, setup-token or API key can be added. It has nothing about Remote Control, phones or headless hosts. What Ashley can take from it is UI patterns, and the rule that one program is the only writer of the credential store.

## 2. Features worth adopting

"Laptop" means the VS Code extension (`extension/src`). "Grid" means `grid/ashleyd.js`, `grid/phone.js` and `grid/ashley`. Effort: S is under a day, M is one to three days, L is a week or more.

| Feature | What it gives students | How Ashley would do it | Effort | Risk |
|---|---|---|---|---|
| Usage and limit monitoring | "5 h window 62%, resets 3:10 pm; week 41%" for the account the worker uses, without waiting for a failure | **Grid.** Ashley already runs `claude -p ... --output-format stream-json --verbose` and copies every line to `outbox/<id>.events.jsonl`. The handler at `ashleyd.js:213-218` keeps only `type === 'result'`. Also keep the last `rate_limit_event` and write it to `~/.ashley/accounts/<n>/usage.json` (write `.part`, then rename). Parse both published shapes:<br>- `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization 0..1, resetsAt epoch s}` (claude-swap PR #322, seen on 2.1.257 and 2.1.260);<br>- the Agent SDK form `{status, resetsAt, utilization, rateLimitType, errorCode}` (Ashley `docs/RESEARCH.md`).<br>Parse stdout whatever the exit code, because a rejected run still emits the event. **Never** call `/api/oauth/usage` with a worker token (see §3). | S | Low. The event shape is undocumented and may change; unknown shapes fall back to today's text matching |
| Cooldown from the event instead of the error text | The exact reset time instead of a regex guess or the one-hour default | **Grid.** When the event says `status: "rejected"`, set `cooldown_until` from its `resetsAt` (`setCooldown`, `ashleyd.js:363`). Keep `parseResetTime` (`ashleyd.js:61`) as the fallback. If `errorCode` is `"credits_required"`, the included usage is gone and usage credits are off; tell the student that. | S | Low |
| Auto-switch before a limit (adapted) | A long task is not started into a window that will cut it off, and there is no surprise spending | **Grid.** Under one person, one account, the only possible switch is from the student's subscription to their own capped API key, so switching early spends money early. Use cswap's consume-first idea instead. Before `startRequest` (`ashleyd.js:157`): if the chosen account's last `five_hour` reading is at or above a threshold (default 95%) and its reset is still ahead, emit `EVENT {"type":"ashley","event":"limit_warning",...}`. Then apply the student's setting `ashley.nearLimit`: `run` (default), `hold` until the reset, or `overflow` to the API key. cswap's hysteresis and cooldown (`autoswitch.py`) are not needed with two credentials. | M | Medium: a wrong reading holds work back, so `hold` is opt-in |
| Pace on the weekly window | "At this rate the week runs out Thursday" | **Laptop.** Port the logic of `pace.py`: the expected share is the elapsed fraction of the 7-day cycle; say nothing for 24 h after a reset; show a warning only when usage is ahead by a margin. Needs `seven_day.resetsAt` from the event. | S | Low |
| Status display | One glance shows which credential the worker is on, how full the window is, when it resets, and whether the phone is up | **Laptop.** A status-bar item, plus the existing tree (`extension/src/vscode/tree.ts:104`). Data comes from the heartbeat (`writeState`, `ashleyd.js:398`), extended with each account's `usage`. Colours as in cswap-desktop (`src/renderer/src/lib/format.ts`): warning at 80%, danger at 100%. Show a countdown, and "reset passed" when the reading is stale. Mask emails by default (cswap-desktop `maskEmail`). | S | Low |
| Notifications | The student is told when the worker moves to the paid key, and when everything is exhausted and until when | **Laptop.** `vscode.window.showInformationMessage` when the heartbeat changes state. cswap-desktop does the same on its `switch` and `all-exhausted` events (`src/main/core.ts`, `onAutoEvent`). | S | Low |
| Taking dead credentials out of use | A revoked or expired token shows "Renew" instead of being retried, or cooled down for an hour | **Grid.** On a 401, or a 403 that names scope or revocation, write `state.json {quarantined:"auth"}` and skip the account until the wizard's Renew rewrites the token. cswap does this on `invalid_grant` (`autoswitch.py`). | S | Low |
| Token age | The student is asked to renew before the one-year setup-token lapses | **Grid and laptop.** `ashley accounts add-token` (`grid/ashley:380`) writes `minted_at`; warn from day 330. A setup-token has no `expiresAt`, so nothing else records its age. | S | Low |
| Per-folder mapping (adapted) | Opening a project folder sends its prompts to the right grid session and worker, with that project's model and spending rule | **Laptop.** Each student has one account, so map folder to `{session, worker, model, allowApiKey}` rather than folder to account. Store it in the workspace's `.vscode/settings.json` (`ashley.session`, ...) or in `~/.ashley/mappings.json`. Resolve the nearest mapped parent folder, as cswap's `mappings.py` does. Sessions already bind a working directory (`ashleyd.js:371`). | S | Low |
| Export and import, without secrets | Moving to a new laptop, or starting from a lab template, without clicking through the wizard again | **Laptop.** Export settings, worker defaults, folder mappings, thresholds and session names. **Do not** export tokens, keys or the Remote Control login; tokens are minted again with `claude setup-token`. cswap's export is plaintext credentials (`transfer.py`), and copies of one login cancel each other (#164). | M | Low if secrets are left out; high otherwise |
| Machine-readable status with exit codes | Scripts, Nextflow steps and the MCP tools can ask "can I run now?" | **Grid.** `ashley limits --json [--once]`. Exit 0 = can run now, 1 = error, 2 = near the threshold, 3 = blocked until the reset. This follows cswap's `auto --once` convention of 0/1/2/3. | S | Low |
| Plan label | "Max 5x" shown beside the usage, which explains the numbers | **Grid, shown on the laptop.** Read only `claudeAiOauth.subscriptionType` and `rateLimitTier` from the Remote Control login's `~/.ashley/remote/config/.credentials.json`, as cswap-desktop's `src/main/plan.ts` does. Worker setup-tokens have no such file. | S | Low |
| Command log | Failures can be diagnosed: what Ashley ran on the grid, how long it took, the exit code | **Laptop.** Keep the recent `ashley` calls with arguments, exit code and duration; never record stdin (cswap-desktop `src/main/cswap/driver.ts`, `record`). Fits `diagnosticsUi.ts`. | S | Low |
| Test seams | Rotation and limits can be tested without hitting a real limit | Extend `extension/test-fixtures/fake-claude.js` in two ways. It should emit `rate_limit_event` in both shapes, including `rejected` with a non-zero exit. It should also fail `--resume` when the transcript is not under its `CLAUDE_CONFIG_DIR` (see §5 Step 2). The pattern to follow is cswap-desktop's `test/fake-cswap/fake-cswap.mjs`. | S | None |

Not adopted, and why:

| Feature | Reason |
|---|---|
| Rotating among several subscription accounts (`cswap auto`, `switch --strategy best`) | Pooling or stacking subscriptions breaks Ashley's one person, one account rule. `docs/RESEARCH.md` quotes the Consumer Terms and the Claude Code legal page against it. |
| Polling `/api/oauth/usage` | Undocumented, and it answers 403 for setup-tokens. It allows about 28-30 requests per rolling hour per identity *(measured by the cswap author, `poll_policy.py`)*. PR #322 reports that a handful of setup-token 403s trip a host-wide 429 for an hour. On a grid where many students share outbound addresses, that could blank other students' usage readings too. |
| Refreshing tokens from Ashley (`POST platform.claude.com/v1/oauth/token` with Claude Code's `client_id`) | Refresh tokens are single-use, so the process that owns them (Claude Code) must be the only refresher. It is also the handling of claude.ai credentials by a third party that the legal page forbids. |
| cswap-pin interception proxy (PR #210) | It installs its own certificate authority through `NODE_EXTRA_CA_CERTS` and swaps bearer tokens per path. It is unmerged, its licence was not checked, and Ashley has no need to separate Remote Control from inference. |
| Standalone PKCE login (PR #108) | Sign-in must go through Anthropic's own flow. `claude auth login`, which `phone.js` uses, is that flow. |
| Warm-on-reset pings (#315, #308) | Spends a request just to move a window boundary; the gain is small. |
| Bundling cswap | cswap-desktop's own README: "two cswap versions writing the same vault is how accounts go missing". |

## 3. Credential handling: lessons and pitfalls

1. **Refresh tokens are single-use, and two copies of one login cancel each other.** A copy can come from another machine, an export and import, or a session profile kept beside the default login. The copies diverge, and the first refresh revokes the other copy's access token at once. The symptom is `401 OAuth access token has been revoked` or `403 ... Please run /login` (claude-swap #164, #381, #96). cswap therefore:
   - refreshes only inactive slots;
   - takes a per-slot `.consume-<N>.lock` and saves the new token only if the old one's fingerprint is unchanged;
   - keeps a new token it could not save as `.unclaimed-<id>.enc` (`src/claude_swap/switcher.py`, `consume_backup_grant`).

   **For Ashley:** the `login` account kind is a copied `.credentials.json` (`ashleyd.js:8-10`, `docs/ARCHITECTURE.md` "Credentials"). It shares a refresh-token chain with the laptop it came from. Ashley's own probe saw a copy rejected after eight idle days, which is consistent with this mechanism but does not prove it. Retire the kind: refuse it in `ashley accounts` and drop it from `listAccounts` (`ashleyd.js:319`).

2. **Setup-tokens avoid this whole class of problem.** cswap stores a setup-token as `{"claudeAiOauth":{"accessToken":...,"scopes":["user:inference"]}}`, with no refresh token and no `expiresAt` (`switcher.py:106`, `SETUP_TOKEN_SCOPES`, commented "Matches Claude Code's CLAUDE_CODE_OAUTH_TOKEN path"). Issue #382's reading of the Claude Code bundle says Claude Code treats such a credential as inference-only, never refreshes it and never logs out. The costs:
   - it cannot read `/api/oauth/usage` or the profile endpoint (both answer 403);
   - it carries no email or organisation, so cswap labels it `setup-token-<N>@token.local`;
   - it cannot run Remote Control (Ashley's own finding, `grid/phone.js:5`).

3. **`/logout` can revoke.** Current Claude Code may revoke the refresh token of the account being left (claude-swap README and #189; cswap-desktop's add dialog says "Do not run /logout on the account you are leaving"). **For Ashley:** turning phone access off must only stop processes, as `phone.js` `stopAll` (line 163) does now. Never run `claude auth logout` in `~/.ashley/remote/config`. A future "Sign the phone out" action should be separate and should say that it revokes.

4. **Remove every auth variable before launching, not just two.** `cswap run` strips five variables before it starts Claude (`src/claude_swap/session.py`): `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` and `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR`. Ashley deletes only `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` (`ashleyd.js:197-198`, `phone.js:55-56`), after merging `process.env` with `~/.ashley/secrets.env` (`ashleyd.js:187`). An `ANTHROPIC_AUTH_TOKEN` or `ANTHROPIC_BASE_URL` in either source would silently override or redirect the credential Ashley chose. Also delete `ANTHROPIC_BASE_URL` for Remote Control: per #198 it disables `/v1/code/sessions`.

5. **One auth method per config directory.** cswap clears `primaryApiKey` when it activates OAuth, and clears the OAuth credential when it activates an API key (`credentials.py`). Ashley's `add-token` and `add-key` each remove the other kind's file (`grid/ashley:380-381`). But a stale `.credentials.json`, or a `primaryApiKey` inside an account's `.claude.json`, would survive. Remove both when an account changes kind.

6. **Keychain versus file:**
   - **Linux, WSL, Windows and the grid:** a plain `<config>/.credentials.json`, protected only by file permissions.
   - **macOS:** the Keychain item `Claude Code-credentials`, with the suffix `-<sha256(NFC(CLAUDE_CONFIG_DIR))[:8]>` for each config directory. cswap reads it with `security`; the Keychain caches it for about 30 s, and cswap falls back to a file when the Keychain is locked, as it is under SSH (`credentials.py`; open ACL bugs #279 and #373).
   - **Windows Credential Manager** was abandoned because `CredWrite` fails above 2,500 bytes (#45).
   - **Base64 is not encryption.** cswap's `.enc` backups are base64 at mode 0600, and the comment in cswap-desktop's `plan.ts` calling them "encrypted" is wrong.

   **For Ashley:** laptop secrets stay in VS Code SecretStorage. On the grid, `~/.ashley` and `accounts/` are `chmod 700` (`grid/ashley:108`). Also confirm with `getfacl` that no default ACL on the home directory or on CephFS lets the group read them.

7. **Seed a new config directory completely.** A fresh `CLAUDE_CONFIG_DIR` needs a `.claude.json` with `hasCompletedOnboarding: true` **and** a `theme`, or onboarding appears (`session.py`). `claude -p` does not care. The Remote Control pseudo-terminal does, and `phone.js` currently answers y/n prompts by pattern matching (`phone.js:140-143`). Seed both keys in `pretrust()` (`phone.js:82`).

8. **Locks on a shared filesystem.** Claude Code's own credential locks are directories created with mkdir (the npm `proper-lockfile` protocol, checked by the cswap author against the 2.1.218 bundle; `src/claude_swap/claude_locks.py`):
   - `<config>/.oauth_refresh.lock`, then `<config>.lock`, both treated as stale after 60 s;
   - `~/.claude.json.lock`, stale after 10 s.

   cswap's own locks use `fcntl.flock`. Across two nodes sharing an NFS home mounted `local_lock=all`, flock failed to exclude in 2,653 of 2,829 acquisitions, against 0 failures with mkdir (#372; the fix, PR #374, is unmerged). This was not measured on Panasas or CephFS. **For Ashley:** keep using rename (as the inbox claim does) or mkdir for anything new that must exclude across nodes, and never flock.

9. **One writer per file.** cswap-desktop refuses to bundle cswap, and queues every change, for this reason. In Ashley the CLI writes `token`, `apikey` and `disabled`, and the daemon writes `state.json`. Keep the new `usage.json` daemon-only.

10. **Secrets never on the command line.** Both tools pass tokens on stdin (`cswap add-token -`; cswap-desktop `addToken`). Ashley already does this (`curl -K -`, ssh stdin); keep it for every new command.

## 4. Remote Control and headless use

Neither tool has a relay or remote access. The useful material is contributor codeslake's measurements on Claude Code 2.1.220-2.1.234 (claude-swap #198 and PR #210), which were not repeated here:

- **Ownership.** A Remote Control session belongs to whoever owned the bearer token that created it. On reattach, Claude Code calls `POST /api/oauth/validate` and compares both `accountUuid` and `organizationUuid`; bridges store `bridgeOwnerAccountUuid` and `bridgeOwnerOrganizationUuid`. If the account in the config directory running a bridge changes, the bridge drops with "signed-in claude.ai account or organization changed on this machine — run /remote-control to reconnect".
- **No way to split it inside one process.** `CLAUDE_CODE_OAUTH_TOKEN` applies to both inference and Remote Control. An `x-organization-uuid` header is ignored. `CLAUDE_BRIDGE_OAUTH_TOKEN` exists in the binary but nothing reads it. `ANTHROPIC_BASE_URL` disables `/v1/code/sessions`. Only an interception proxy separates the two.
- **Session token lifetime.** The bridge mints a per-session worker token that refreshes about every 8 h.

What this means for Ashley's phone access:

1. **The current design is right.** Remote Control runs under its own `CLAUDE_CONFIG_DIR` (`~/.ashley/remote/config`, `phone.js:30`), which rotation never touches. A switch to the API key therefore cannot trip the ownership check and drop the phone.
2. **Only one worker should host it.** Found while reading, not run: every worker shares the one Remote Control login folder (all of `~/.ashley` is shared). But `phone.js` starts in any worker that has `<worker>/rc/enable`, and `ashley phone on --worker <w>` can be issued for several workers. Two workers on two nodes would then both run `claude remote-control`, or two `claude auth login`s, against one refresh-token chain, which is the situation in #164 and #381. Fix:
   - add an mkdir lease `~/.ashley/remote/host.lock/` holding `{worker, node, job, pid, beat}`, touched every 5 s and treated as stale after 60 s (Claude Code's own timings);
   - only the lease holder logs in or hosts;
   - the extension shows which worker holds the phone and offers to move it.
3. **Show when the phone sign-in lapses.** cswap reports `loginExpiresAt`, taken from `refreshTokenExpiresAt`. Read that one field (and the plan fields) from `~/.ashley/remote/config/.credentials.json` without touching the tokens. Show "phone sign-in good until 27 Oct", and ask for a new sign-in three days ahead, instead of finding out from "must be logged in" (`phone.js:153`). Check that 2.1.283 writes `refreshTokenExpiresAt` before relying on it.
4. **Seed onboarding and theme** in the Remote Control config (§3, item 7) to remove the pseudo-terminal prompts.
5. **The phone and the worker share one window.** Both draw on the same person's account, so the status display should say that phone use counts against the same 5 h and weekly windows. Remote Control produces no stream-json, so the phone's own use shows up only in the worker's next `rate_limit_event`.
6. **Headless habits worth copying:** secrets on stdin, `--json` on every status command, and `--once` exit codes for supervision from Slurm, cron or the MCP server.

Not known: whether Claude Code 2.1.283 can put an existing `-p` session (by id) under Remote Control without typing `/remote-control` interactively. If it can, a student could pick up a grid session on the phone. Transcripts live under each config directory's `projects/`, so the Remote Control config would need the transcript first. This is worth one test; nothing in either repo addresses it.

## 5. Plan: claude-swap integration in the next release

The scope, as students would read it: *Ashley keeps your one Claude account working across your laptop, the grid and your phone. It shows how much of your window is left and when it resets, and it moves to your own capped API key only if you allow it.* It does not add, rank or rotate other subscriptions. The next release is extension 2.0.0 and grid scripts `VERSION` 4 (version 3 carried the fixes listed under "Applied in version 1").

**Step 0: capture the event shape (S, before writing any code).** On the grid, run:

```
grep -h '"rate_limit_event"' ~/.ashley/workers/*/outbox/*.events.jsonl | tail -5
```

Every past run is already recorded, so the 2.1.283 shape may already be on disk. If there is no `rejected` event yet, keep the first one from a real limit and add it to the test fixtures.

**Step 1: grid, limits (S to M).**
- At `ashleyd.js:213`, keep the last `rate_limit_event`. When the run closes, write `accounts/<n>/usage.json`. On `rejected`, set the cooldown to its `resetsAt`.
- In `writeState` (`ashleyd.js:398`), add each account's `usage` and `quarantined` state to the heartbeat.
- Take accounts out of use on auth failures, and write `minted_at` in `add-token`.
- Add `ashley limits --json [--once]` with exit codes 0/1/2/3.
- Add the pre-flight `limit_warning` and the `ashley.nearLimit` setting (`run`, `hold` or `overflow`; default `run`).

**Step 2: grid, a bug found while reading (M).** When a request is re-queued to another account (`ashleyd.js:245-253`), an existing session resumes with `--resume <sid>` under the new account's `CLAUDE_CONFIG_DIR`. But its transcript is under the old account's `projects/<encoded cwd>/<sid>.jsonl` (`docs/ARCHITECTURE.md`, "Sessions"). claude-swap's `session.py:25-27` notes that `projects/` is what `--resume` reads and that it is separate for each config directory, which is why cswap has `--share-history`.

The expected result, not run, is "No conversation found" on the API key: the session is lost at the moment the student most needs it. The daemon test cannot catch this, because `fake-claude.js` ignores where transcripts are. Two possible fixes:
- make every account's `projects/` a symlink to one `~/.ashley/projects/`, migrating the existing folders once (all accounts belong to one person, so sharing history is within policy); or
- copy the one transcript into the new account's folder before resuming.

Add the fake-claude check first so the test fails, then fix.

**Step 3: grid, hygiene (S).**
- Remove the full list of auth variables (§3, item 4) in both `ashleyd.js` and `phone.js`.
- Retire the `login` account kind (§3, item 1).
- Remove a stale `.credentials.json` or `primaryApiKey` when an account changes kind (§3, item 5).
- Allow **at most one subscription-token account** in `ashley accounts add-token`: a second name is refused unless it replaces `default`. This is the enforceable form of one person, one account, because a setup-token cannot prove whose it is.

**Step 4: grid, phone (M).**
- The host lease (§4, item 2).
- The expiry and plan read (§4, item 3).
- The onboarding seed (§4, item 4).
- A test that turning the phone off never runs `logout`.

**Step 5: laptop (M).**
- A status-bar item and tree rows: usage, reset countdown, pace, the credential in use, and the phone's host worker and expiry.
- Notifications when the state changes.
- Folder mapping to `{session, worker, model, allowApiKey}`.
- Settings export and import without secrets.
- The command log in diagnostics.
- An MCP tool `ashley_limits`, so the laptop Claude can say "your window resets at 3:10 pm" before handing work to the grid.

**Step 6: laptop, working alongside cswap (optional, M, read-only).** This is for students who already use cswap for the Claude Code on their laptop.
- Find the binary the way cswap-desktop does (`src/main/cswap/resolve.ts`): the setting, then an environment variable, then `~/.local/bin` and the Python Scripts folders, then PATH, checking each candidate with `--version`.
- Call only `cswap status --json` and `cswap list --json`, with `NO_COLOR=1`, `PYTHONUTF8=1` and `CLAUDE_SWAP_NO_UPDATE_CHECK=1`. On Windows, kill a timed-out call with `taskkill /t /f` (`driver.ts`).
- Show the laptop login's usage beside the grid's.
- Warn when the identities disagree. Three should all name the same person: the laptop's active `oauthAccount.emailAddress`, the Remote Control login's (in `~/.ashley/remote/config/.claude.json`, which is not secret), and the wizard's AccessID@wayne.edu. If the cswap list shows more than one distinct email or organisation, say that Ashley uses only the one that matches the student.
- Ashley never calls `cswap switch`, `auto`, `add`, `add-token`, `export` or `import`, and never copies a cswap slot to the grid. The grid always gets a fresh `claude setup-token`.

**Step 7: docs.** Update `docs/LIMITS.md` (what the status bar means; the phone and the worker share one window), `docs/ARCHITECTURE.md` (`usage.json`, the lease, the shared `projects/`), the manual and the CHANGELOG.

An untested idea for checking that a setup-token belongs to the student: the weekly window resets at a fixed time for each account (`docs/RESEARCH.md`). So the worker's `seven_day.resetsAt` from `rate_limit_event` should equal the laptop login's own weekly reset, read from `/usage`, or from `cswap list --json` if cswap is installed. A match is evidence of one account; a mismatch is evidence of two. It would need testing on two known accounts before anything depends on it.

## 6. Licences

| | Licence | Holder |
|---|---|---|
| realiti4/claude-swap | MIT (`LICENSE`; `pyproject.toml` has `license = "MIT"`) | Onur Cetinkol, 2026 |
| TheSkinnyRat/cswap-desktop | MIT (`LICENSE`) | Purwa Sabrang Ramadhan, 2026 |
| codeslake/cswap-pin (optional companion, PR #210) | not checked | codeslake |
| Ashley | MIT (`LICENSE`, `extension/LICENSE`) | OpenSpineConsortium, 2026 |

MIT code can go into an MIT project.
- Writing our own version after reading their code needs no notice.
- Copying their code does need it. That would apply to, for example, `pace.py`, the backoff in `poll_policy.py`, or cswap-desktop's `killTree` or `resolve.ts`. The original copyright line and permission notice must stay with the copied part: add a `THIRD_PARTY_NOTICES.md` and a header comment in each copied file.

The MIT licence does not cover two things:
- **The name "Claude Swap".** It is cswap-desktop's product name, and "Claude" is Anthropic's trademark, so the Ashley feature should not be called that.
- **Anthropic's terms** for the undocumented endpoints and the OAuth client these tools call. Those terms bind Ashley whatever the code licence says.

## Not known

- The `rate_limit_event` shape on Claude Code 2.1.283 (Step 0 answers this).
- Whether 2.1.283's `.credentials.json` contains `refreshTokenExpiresAt`.
- Whether `--resume` fails under a different `CLAUDE_CONFIG_DIR`. This is expected from the architecture but was not run.
- Whether flock and mkdir behave on Panasas and CephFS the way #372 found on NFS.
- The Remote Control measurements in #198 were made by one contributor on 2.1.220-2.1.234 and were not repeated.
- Whether a person with a personal plan and a university seat counts as having one account under the lab's rule. This note assumes not.