# Changelog

## 1.0.0 (2026-09-28)

First release, for testing with students. Grid scripts version 3.

- **Setup wizard, ten steps in a fixed order.** Sign in with Wayne State (Microsoft sign-in,
  checked against the lab's pre-approved AccessIDs); GitHub, Hugging Face and Claude tokens by
  browser click, kept in the OS keychain; the grid account and Authenticator; an ed25519 key and
  a managed `~/.ssh/config` block (login node as jump host, compute nodes one hop away,
  `MACs +hmac-sha1`, `AddressFamily inet`, ending in `Match all` so the student's own settings
  keep their scope); one password-and-code login; the grid install with every token in one pass;
  and *Join the lab*. Each token has **Renew**, which also updates the grid copy.
- **Lab access.** A request is a held Slurm job; the lab admin approves, denies with a message,
  removes or resets it. Approval is a read-only ACL on the lab folder and its shared containers.
- **Claude workers.** Persistent Claude Code in the lab's Apptainer container on a compute node;
  file-queue protocol with a persistent relay (about 0.2 s to the worker); named resumable
  sessions whose history survives a move to the student's own API key; worker-to-worker
  messages; Slurm usable from inside the worker; `restart` re-renders the job from the current
  template.
- **Phone access.** Claude Code Remote Control hosted by one worker at a time.
- **Troubleshooter.** A status-bar item over a 42-node dependency graph: root cause, safe
  repairs, log, reports, hourly background check, and *Investigate with Claude*. A test fails when
  a feature loses its nodes.
- **Remote-SSH** to the worker's node; *Ask the grid Claude*; the Ashley view; the MCP bridge for
  the Claude Code extension (replaced, not duplicated, on upgrade); a terminal CLI for other
  editors; a manual in HTML and PDF.
