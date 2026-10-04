# Troubleshooting

## The troubleshooter

Beethoven keeps an item in the status bar. It shows a tick when everything works, a warning when
something needs attention soon, and the name of the broken piece when something is broken. Click
it for four actions:

- **Troubleshoot and repair** walks every piece Beethoven depends on, in order: your laptop, VS Code,
  the network, your accounts, the grid, the container and the workers. When a piece is broken, the
  pieces that depend on it are marked *blocked* and name it as the cause, so you see one problem,
  not twenty. Where a repair is safe it runs the repair and checks again.
- **Show log** opens the full record: every check, its result, and every command Beethoven ran.
- **Investigate with Claude** hands the failing check, its log and the known fixes to Claude Code on
  your laptop, which searches the web and writes a short report. Nothing is changed.
- **Open last report** shows the last run again.

A quick check (no repairs) runs by itself 45 seconds after VS Code starts and then every hour, so
the status bar notices an expired token or a stopped worker before you do. **Beethoven: Check
everything (no repairs)** runs the full check by hand.

Beethoven repairs by itself: missing VS Code extensions, the SSH configuration, the scripts on the
grid, tokens missing from the grid (it copies them from your laptop), a moved VS Code library or
container runtime on the grid, a stopped worker, the Claude Code connection, and unshared session
history. It never repairs by itself anything that needs you: signing in, pressing Authorize,
typing your grid password, or approval from your lead.

## Symptoms

The steps are the ten in *Getting started*.

| Symptom | Cause | Fix |
|---|---|---|
| Step 1: "not on the lab's pre-approved list" | your lead has not added your AccessID yet | ask your lead; they approve you on the lab's page, then run the step again |
| Step 1: the Microsoft sign-in does not accept your account | you signed in with a personal Microsoft account | sign in with AccessID@wayne.edu |
| Step 2: GitHub sign-in does not open a browser | VS Code's GitHub sign-in is disabled or blocked | the panel shows a pasted-token field with the token page pre-filled |
| Steps 3 or 4: the panel does not notice the copied token | clipboard access blocked, or the copy did not happen | paste it into the field; the check is the same |
| A token shows *no longer accepted*, or its row in the Beethoven view says *expired* | it expired or was revoked | press **Renew** next to it, or click the row: one click in the browser, and the grid copy is updated too |
| `no matching MAC found. Their offer: hmac-sha1` | your SSH configuration lacks the Beethoven block | run step 7 again (it writes the block with `MACs +hmac-sha1`) |
| Every grid action takes 13 s | an IPv6 attempt on Windows | the block sets `AddressFamily inet`; run step 7 again if you edited the file |
| Step 8 rejects the password or code three times | wrong password or code, a grid account not yet created, or the Authenticator not set up | check that ondemand.grid.wayne.edu logs you in, then run the wizard again. If the panel cannot reach the grid at all, it falls back to a terminal for the same two prompts |
| `Permission denied (publickey...)` after step 8 | the key was not added to `authorized_keys` | run step 8 again; on the grid, `cat ~/.ssh/authorized_keys` should contain "beethoven" (a key made by Ashley says "ashley") |
| Step 10 (*Join the lab*) refuses | a step above is not finished, or a token does not verify | the panel lists what is missing; fix that step and run the wizard again |
| Beethoven view: *Waiting for lab access* | your request is pending | your lead approves it in Beethoven; nothing to do |
| Worker shows PENDING for a long time | the `requeue` pool is busy | start it with the `secp`/`secondary` settings (`beethoven.worker.partition`, `beethoven.worker.qos`) |
| A prompt returns *Claude is not signed in on the grid* | you have not done step 12, or the sign-in ended (about a month) | run **Beethoven: Sign in to Claude on the grid** |
| A prompt or phone access says Claude on the grid is *signed in, but not with a Claude subscription* | Claude Code on the grid is using a Console key, a key helper, a token or a cloud provider | run **Beethoven: Sign in to Claude on the grid** and sign in with your Claude Pro or Max account |
| Step 5 says *signed in through ..., not a Claude subscription* | Claude Code on your laptop is using a Console key, a key helper or a cloud provider | in Claude Code, sign out and sign in with your Claude Pro or Max account |
| Beethoven refuses every command and says *license needed* | no key, an ended trial, or a key for someone else | **Beethoven: License**: enter your key, or ask your lead. A trial ends by itself and cannot be repeated |
| Beethoven says the terms have not been accepted | the first-run dialog was closed with *Not now* | run any Beethoven command; the dialog returns |
| Phone access says *need_consent* | Claude Code's one-time Remote Control question has not been answered | **Beethoven: Phone access** opens the terminal; type y when asked |
| A prompt returns `rate_limited` with a time | your subscription window is used up | wait for the time shown; Beethoven never switches to another person's account |
| Phone access: *Claude did not accept that code* | only part of the code was copied | press Copy on the claude.ai page (the code is long) and send it again |
| Phone access: *hosted by worker ...* | phone access is on for another of your workers | run **Beethoven: Phone access** and pick this worker; it moves, and the other one turns off |
| Phone access worked yesterday, not today | the worker job ended, or the 30-day sign-in expired | start a worker; run **Beethoven: Phone access** again |
| Remote-SSH: *Connecting with SSH timed out* | the compute node's sshd needs about 25 s per session; the first connection also downloads the server | Beethoven sets `remote.SSH.connectTimeout` to 300 when it opens a node; if you connect by hand, set it in Settings and connect again |
| Remote-SSH: *You are connecting to an OS version that is unsupported by Visual Studio Code* | the grid is CentOS 7; VS Code shows this on every such connection even when the compatibility libraries make it work | dismiss it, or *Don't show again* |
| Remote-SSH: *glibc* or *exit code 207* | the C&IT compatibility variables are not in `~/.bashrc`, or a `return` line comes before them | **Troubleshoot and repair** rewrites the block; move it above any `[ -z "$PS1" ] && return` |
| VS Code connects to `warrior` instead of a node | no job was running | start a worker; Beethoven connects only to nodes where you hold a job |
| `home quota` above 90 % | your home is full | large files belong in your project space; ask your lead |
| The MCP tools do not appear in Claude Code | the bridge was not registered, or Claude Code was open before registration | **Troubleshoot and repair** registers it; start a new conversation. The tools are named `beethoven_*` (they were `ashley_*` before the rename) |
| Install on the grid: *a Claude worker ... is running on the grid* | your grid folder gets its new name (`~/.ashley` becomes `~/.beethoven`) once, while none of your workers runs | **Beethoven: Stop a Claude worker**, then run the step again; the worker's queued requests wait in its inbox |
| The grid scripts keep going back to an older version | Ashley for VS Code is still installed beside Beethoven, and each installs its own scripts | uninstall Ashley for VS Code, then run **Install on the grid** once more |
| After the upgrade, a token row says *missing* | VS Code keeps each extension's stored tokens apart, so the tokens Ashley stored are not visible to Beethoven | run the wizard's GitHub and Hugging Face steps once (or click the row) |
| Claude Code lists an MCP server `ashley` that fails to connect | Ashley for VS Code registered it and was uninstalled afterwards; the entry points at its removed folder | run **Beethoven: Connect the Claude Code extension to the grid** once (it removes the `ashley` entry when Ashley is not installed) |

## Logs

- Laptop: the status bar item's **Show log** (the same as *View, Output, Beethoven*): every check and
  every command with its exit code. Each troubleshooter run is also saved as a report.
- Grid: `~/.beethoven/workers/<name>/log/beethovend.log`, `~/.beethoven/workers/<name>/log/slurm_<job>.out`,
  every request's `outbox/<id>.events.jsonl`, and for phone access `rc/session.log` in the worker's
  folder.
- Remote-SSH: *View, Output, Remote - SSH*.

## Undo

Laptop: remove the block from `~/.ssh/config` (a `config.beethoven.bak` is kept), delete
`~/.ssh/id_ed25519_wsu*`, **Beethoven: Manage stored tokens** to delete tokens, uninstall the
extension. Grid: `~/.beethoven/bin/beethoven uninstall` stops your workers and removes
`~/.beethoven`, the `~/.ashley` link and the block in `~/.bashrc`.
**Beethoven: Reset** does this for you: you pick what to forget, and it asks once before doing it.
