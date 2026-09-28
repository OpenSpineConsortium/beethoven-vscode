# Ashley

**A medical student's laptop, the Wayne State grid, and Claude Code, joined by one wizard.**

Ashley is a VS Code extension (with a terminal twin for other editors) that sets up a student
for computational research on the Wayne State HPC grid and keeps a Claude Code worker running
there, on the student's own Claude subscription, reachable from the Claude Code extension on the
laptop. It is the on-ramp to the lab's `Student_Projects` recipe: pre-registered questions,
results files, Slurm jobs, and papers built from results.

```
extension/   the VS Code extension (TypeScript): wizard, secrets, Remote-SSH, Ashley view, MCP bridge, CLI
grid/        what gets installed in ~/.ashley/bin on the grid: the ashley CLI (bash), the worker daemon (Node), job scripts
cli/         ten-line ssh forwarders for laptops without Node (macOS/Linux bash, Windows PowerShell)
docs/        manual (HTML + PDF), pitch, architecture, limits, install, research notes, figures
dist/        the built .vsix
```

## Quick start

1. Install `dist/ashley-wsu-1.0.0.vsix` in VS Code (Extensions view, `...`, *Install from VSIX*).
2. `Ashley: Set up my research environment (wizard)`.
3. `Ashley: Start a Claude worker on the grid`, then `Ashley: Ask the grid Claude`, or open the
   Claude Code panel and say "check the grid status".

Everything else: [docs/manual.html](docs/manual.html) (also `docs/manual.pdf`),
[docs/INSTALL.md](docs/INSTALL.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/LIMITS.md](docs/LIMITS.md), [docs/PITCH.md](docs/PITCH.md), [docs/RESEARCH.md](docs/RESEARCH.md).

## Status (2026-09-28)

Tested end to end on Windows 11 + WSL against the grid: key install, SSH config (login node as
jump host, `MACs +hmac-sha1`, `AddressFamily inet`), container build on a compute node
(Apptainer 1.2.2 module, `node:22-bookworm`, Claude Code 2.1.283), worker daemon heartbeat,
request round trip laptop -> login node -> worker -> laptop, MCP bridge called by the real Claude
Code, 22 unit tests including the daemon with a fake Claude, VS Code integration suite.

Not yet exercised with a live subscription token on the grid: that needs the student's one-time
`claude setup-token` approval in a browser (wizard step 7). A copied interactive login was
rejected after eight idle days, which is why the token flow is the supported one.

## Licence

MIT, like the lab's other student-facing repositories.
