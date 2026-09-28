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

Everything else: [docs/manual.html](docs/manual.html) (also `docs/manual.pdf`, 21 pages, built by `docs/manual/build_manual.py`),
[docs/INSTALL.md](docs/INSTALL.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/LIMITS.md](docs/LIMITS.md), [docs/PITCH.md](docs/PITCH.md), [docs/RESEARCH.md](docs/RESEARCH.md),
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md).

## Status (2026-09-28): version 1, ready for testing

Ten wizard steps in a fixed order: *Sign in with Wayne State* (a Microsoft sign-in, checked against
the lab's pre-approved AccessIDs), GitHub, Hugging Face and Claude by browser click, the grid
account and Authenticator, SSH key and configuration, one password-and-code login, the grid
install (scripts and every token in one pass), and *Join the lab*. Each token has **Renew**, which
also updates the grid copy.

- **Lab access.** A request is a held Slurm job, so Slurm vouches for who sent it; the lab admin
  approves, denies (with a message), removes or resets in *Ashley: Lab access*. Approval is a
  read-only ACL on the lab folder. Students never build containers.
- **Workers.** A persistent Claude Code worker per student in the lab's container on a compute
  node; prompts arrive over one persistent ssh session in about 0.2 s. Workers message each other.
- **Phone access.** Claude Code Remote Control hosted by the worker, so the Claude app drives a
  grid session with no workstation. One worker hosts it at a time.
- **Troubleshooter.** A status-bar item over a 42-node dependency graph; it names the root cause,
  repairs what is safe, keeps a log, and can ask Claude to research a failure. Every feature must
  add its nodes before it is integrated (`docs/DIAGNOSTICS.md`).
- **Grid scripts version 3.** Five fixes from a study of claude-swap and cswap-desktop
  (`docs/research/claude_swap_notes.md`): shared session history across one person's accounts, a
  single phone host, full removal of overriding credential variables, the phone's first-run seed,
  and one subscription per person. Workers can now use Slurm from inside their container, and
  `ashley worker restart` re-renders the job from the current template.
- **Dependency study.** 370 assumptions mapped (`docs/DEPENDENCY_MAP.md`); twelve defect claims were
  checked on the grid or laptop and fixed where real, among them a first-install failure on fresh
  grid accounts (a quoted `~`) and an MCP registration that broke on every upgrade
  (`docs/DIAGNOSTICS.md`).

Tests: 31 laptop unit tests (5 more skip on Windows), 7 VS Code integration tests, a live
troubleshooter run against the grid, and 12 tests inside the lab container on a compute node
(`tools/grid_tests.sh`).

Still needs a person: the Claude *Authorize* click and a real subscription token on the grid; the
Wayne State sign-in in the university tenant; a phone sign-in with a real code; a second student
account to confirm the lab-access ACLs from the student side.

Next release: usage and reset times from Claude Code's own rate-limit events, a status-bar usage
meter, and read-only cooperation with claude-swap on the laptop (plan in
`docs/research/claude_swap_notes.md`, section 5).

Repository: https://github.com/GregorySchwing/ashley (private).

## Licence

MIT, like the lab's other student-facing repositories.
