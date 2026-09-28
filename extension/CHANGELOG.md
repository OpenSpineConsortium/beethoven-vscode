# Changelog

## 1.0.0 (2026-09-28)

First release.

- Setup wizard: AccessID, ed25519 key, `~/.ssh/config` block (login node as jump host,
  `*.nas.grid.wayne.edu` one hop away, `MACs +hmac-sha1` for the grid's sshd), key install
  with one password-and-code login, GitHub / Hugging Face / Claude tokens in SecretStorage,
  grid install as a Slurm job.
- Claude worker: persistent Claude Code in an Apptainer sandbox (`node:22-bookworm`) on a
  compute node; file-queue protocol; named resumable sessions; account rotation and cooldown
  on subscription limits; heartbeat; clean stop.
- Remote-SSH connection to the worker's node; Ask the grid Claude; Ashley view; MCP bridge
  for the Claude Code extension; terminal CLI for other editors.
