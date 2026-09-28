# Troubleshooting

## The troubleshooter

Ashley keeps an item in the status bar. It shows a tick when everything works, a warning when
something needs attention soon, and the name of the broken piece when something is broken. Click
it for four actions:

- **Troubleshoot and repair** walks every piece Ashley depends on, in order: your laptop, VS Code,
  the network, your accounts, the grid, the container and the workers. When a piece is broken, the
  pieces that depend on it are marked *blocked* and name it as the cause, so you see one problem,
  not twenty. Where a repair is safe it runs the repair and checks again.
- **Show log** opens the full record: every check, its result, and every command Ashley ran.
- **Investigate with Claude** hands the failing check, its log and the known fixes to Claude Code on
  your laptop, which searches the web and writes a short report. Nothing is changed.
- **Open last report** shows the last run again.

A quick check (no repairs) runs by itself 45 seconds after VS Code starts and then every hour, so
the status bar notices an expired token or a stopped worker before you do. **Ashley: Check
everything (no repairs)** runs the full check by hand.

Ashley repairs by itself: missing VS Code extensions, the SSH configuration, the scripts on the
grid, tokens missing from the grid (it copies them from your laptop), a moved VS Code library or
container runtime on the grid, a stopped worker, the Claude Code connection, and unshared session
history. It never repairs by itself anything that needs you: signing in, pressing Authorize,
typing your grid password, or approval from your lead.

## Symptoms

The steps are the ten in *Getting started*.

| Symptom | Cause | Fix |
|---|---|---|
| Step 1: "not on the lab's pre-approved list" | your lead has not added your AccessID yet | ask your lead; they add it and send you a new Ashley |
| Step 1: the Microsoft sign-in does not accept your account | you signed in with a personal Microsoft account | sign in with AccessID@wayne.edu |
| Step 2: GitHub sign-in does not open a browser | VS Code's GitHub sign-in is disabled or blocked | the panel shows a pasted-token field with the token page pre-filled |
| Steps 3 or 4: the panel does not notice the copied token | clipboard access blocked, or the copy did not happen | paste it into the field; the check is the same |
| A token shows *no longer accepted* | it expired or was revoked | press **Renew** next to it: one click in the browser, and the grid copy is updated too |
| `no matching MAC found. Their offer: hmac-sha1` | your SSH configuration lacks the Ashley block | run step 7 again (it writes the block with `MACs +hmac-sha1`) |
| Every grid action takes 13 s | an IPv6 attempt on Windows | the block sets `AddressFamily inet`; run step 7 again if you edited the file |
| Step 8 rejects the password or code three times | wrong password or code, a grid account not yet created, or the Authenticator not set up | check that ondemand.grid.wayne.edu logs you in, then run the wizard again. If the panel cannot reach the grid at all, it falls back to a terminal for the same two prompts |
| `Permission denied (publickey...)` after step 8 | the key was not added to `authorized_keys` | run step 8 again; on the grid, `cat ~/.ssh/authorized_keys` should contain "ashley" |
| Step 10 (*Join the lab*) refuses | a step above is not finished, or a token does not verify | the panel lists what is missing; fix that step and run the wizard again |
| Ashley view: *Waiting for lab access* | your request is pending | your lead approves it in Ashley; nothing to do |
| Worker shows PENDING for a long time | the `requeue` pool is busy | start it with the `secp`/`secondary` settings (`ashley.worker.partition`, `ashley.worker.qos`) |
| A prompt returns `no enabled Claude account` | the Claude token is not on the grid | press **Renew** next to Claude (it updates the grid), or run **Troubleshoot and repair** |
| A prompt returns `Failed to authenticate` | the token expired or was revoked | press **Renew** next to Claude |
| A prompt returns `rate_limited` with a time | your subscription window is used up | wait for the time shown; Ashley never switches to another person's account |
| The grid says *already holds your Claude subscription token* | a second subscription token was offered under another name | Ashley uses one subscription per person; replace the existing one (**Renew** does this) |
| Phone access: *Claude did not accept that code* | only part of the code was copied | press Copy on the claude.ai page (the code is long) and send it again |
| Phone access: *hosted by worker ...* | phone access is on for another of your workers | run **Ashley: Phone access** and pick this worker; it moves, and the other one turns off |
| Phone access worked yesterday, not today | the worker job ended, or the 30-day sign-in expired | start a worker; run **Ashley: Phone access** again |
| Remote-SSH: *Connecting with SSH timed out* | the compute node's sshd needs about 25 s per session; the first connection also downloads the server | Ashley sets `remote.SSH.connectTimeout` to 300 when it opens a node; if you connect by hand, set it in Settings and connect again |
| Remote-SSH: *You are connecting to an OS version that is unsupported by Visual Studio Code* | the grid is CentOS 7; VS Code shows this on every such connection even when the compatibility libraries make it work | dismiss it, or *Don't show again* |
| Remote-SSH: *glibc* or *exit code 207* | the C&IT compatibility variables are not in `~/.bashrc`, or a `return` line comes before them | **Troubleshoot and repair** rewrites the block; move it above any `[ -z "$PS1" ] && return` |
| VS Code connects to `warrior` instead of a node | no job was running | start a worker; Ashley connects only to nodes where you hold a job |
| `home quota` above 90 % | your home is full | large files belong in your project space; ask your lead |
| The MCP tools do not appear in Claude Code | the bridge was not registered, or Claude Code was open before registration | **Troubleshoot and repair** registers it; start a new conversation |

## Logs

- Laptop: the status bar item's **Show log** (the same as *View, Output, Ashley*): every check and
  every command with its exit code. Each troubleshooter run is also saved as a report.
- Grid: `~/.ashley/workers/<name>/log/ashleyd.log`, `~/.ashley/workers/<name>/log/slurm_<job>.out`,
  every request's `outbox/<id>.events.jsonl`, and for phone access `rc/login.log` and
  `rc/session.log` in the worker's folder.
- Remote-SSH: *View, Output, Remote - SSH*.

## Undo

Laptop: remove the block from `~/.ssh/config` (a `config.ashley.bak` is kept), delete
`~/.ssh/id_ed25519_wsu*`, **Ashley: Manage stored tokens** to delete tokens, uninstall the
extension. Grid: `ashley worker stop`, `rm -rf ~/.ashley`, remove the block from `~/.bashrc`.
**Ashley: Reset** does this for you: you pick what to forget, and it asks once before doing it.
