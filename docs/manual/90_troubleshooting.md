# Troubleshooting

Run **Ashley: Check everything (doctor)** first. It prints one line per check on the laptop and,
when the connection works, the grid's own checks.

| Symptom | Cause | Fix |
|---|---|---|
| `no matching MAC found. Their offer: hmac-sha1` | your `ssh` config lacks the Ashley block | rerun the wizard (step 3 rewrites the block with `MACs +hmac-sha1`) |
| Every grid action takes 13 s | IPv6 attempt on Windows | the block sets `AddressFamily inet`; rerun the wizard if you edited the file |
| Step 4 rejects the password or code three times | wrong password/code, an account not yet created, or Authenticator not set up | check ondemand.grid.wayne.edu logs you in; then rerun the wizard. If the in-panel login cannot reach the grid at all, the wizard falls back to a terminal for the same two prompts |
| Step 5: GitHub sign-in does not open a browser | VS Code's GitHub sign-in is disabled or blocked | the panel shows a pasted-token field with the token page pre-filled |
| Step 6/7: the panel does not notice the copied token | clipboard access blocked, or the copy did not happen | paste it into the field; the check is the same |
| `Permission denied (publickey...)` after step 4 | the key was not appended to `authorized_keys` | rerun step 4; on the grid, `cat ~/.ssh/authorized_keys` should contain "ashley" |
| Ashley view: *Waiting for lab access* | your request (the last setup step) is pending | your lead approves it in Ashley; nothing to do. If you never filed it, run the wizard again |
| *Join the lab* refuses | a step above is not finished, or a token does not verify | the panel lists what is missing; fix that step and run the wizard again |
| Worker shows PENDING for long | the `requeue` QoS pool is busy | start it with the `secp`/`secondary` settings (`ashley.worker.partition`, `ashley.worker.qos`) |
| Ask returns `no enabled Claude account` | step 7 was skipped | **Ashley: Store or replace my Claude token for the grid** |
| Ask returns `Failed to authenticate` | the token expired or was revoked | run `claude setup-token` again and store the new token |
| Ask returns `rate_limited` with a time | your subscription window is exhausted | wait for the time shown, or add an API key (step 8) |
| Remote-SSH: *Connecting with SSH timed out* | the compute node's sshd needs about 25 s per session; the first connection also downloads the server | Ashley sets `remote.SSH.connectTimeout` to 300 when it opens a node; if you connect by hand, set it yourself in Settings and connect again |
| Remote-SSH window: *You are connecting to an OS version that is unsupported by Visual Studio Code* | the grid is CentOS 7; VS Code's FAQ says the banner and a dialog appear on every such connection even when the sysroot makes it work | dismiss it, or *Don't show again*; nothing else to do |
| Remote-SSH: *glibc* or *exit code 207* | the C&IT sysroot variables are not in `~/.bashrc`, or a `return` guard precedes them | `ssh wsu-grid "~/.ashley/bin/ashley install"` rewrites the block; move it above any `[ -z "$PS1" ] && return` |
| VS Code connects to `warrior` instead of a node | a job was not running | start a worker; Ashley connects only to nodes where you hold a job |
| `home quota` above 90 % | your home is full | large files belong on the lab volume; ask your lead for the path; `ashley.gridRoot` |
| The MCP tools do not appear in Claude Code | the bridge was not registered, or Claude Code was open before registration | **Ashley: Connect the Claude Code extension to the grid**, then start a new conversation |

## Logs

- Laptop: *View, Output, Ashley* (every command and its exit code).
- Grid: `~/.ashley/log/bootstrap_<job>.out`, `~/.ashley/workers/<name>/log/ashleyd.log`,
  `~/.ashley/workers/<name>/log/slurm_<job>.out`, and every request's
  `outbox/<id>.events.jsonl`.
- Remote-SSH: *View, Output, Remote - SSH*.

## Undo

Laptop: remove the block from `~/.ssh/config` (a `config.ashley.bak` is kept), delete
`~/.ssh/id_ed25519_wsu*`, **Ashley: Manage stored tokens** to delete tokens, uninstall the
extension. Grid: `ashley worker stop`, `rm -rf ~/.ashley`, remove the block from `~/.bashrc`,
delete the container folder under your storage root.
