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

1. Install `dist/ashley-2.0.0.vsix` in VS Code (Extensions view, `...`, *Install from VSIX*). Accept the terms; enter your license key or start a trial.
2. `Ashley: Set up my research environment (wizard)`.
3. `Ashley: Start a Claude worker on the grid`, then `Ashley: Ask the grid Claude`, or open the
   Claude Code panel and say "check the grid status".

Everything else: [docs/manual.html](docs/manual.html) (also `docs/manual.pdf`, 21 pages, built by `docs/manual/build_manual.py`),
[docs/INSTALL.md](docs/INSTALL.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/LIMITS.md](docs/LIMITS.md), [docs/PITCH.md](docs/PITCH.md), [docs/RESEARCH.md](docs/RESEARCH.md),
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md).

## Status (2026-09-28): version 2.0.0, licensed

Version 2 is the first licensed release. It changes three things students notice and one they do
not.

- **A license key per person**, checked against the Wayne State sign-in; free trials, one per
  AccessID, issued in the student's own name; the extension, its CLI, its MCP server and the grid
  worker all refuse to work without a valid key. Terms are accepted in a first-run dialog that also
  asks about error reports.
- **Claude sign-in through Claude Code's own flow only.** Ashley no longer captures, stores or
  copies a Claude token. The student signs in to Claude Code on the laptop and, once, in a terminal
  inside their own grid account; Claude Code keeps its own credential and Ashley only points at it.
  This follows the compliance research in `docs/research/reports/` (Anthropic's Claude Code terms
  forbid third-party tools from handling Claude credentials).
- **Error reports, opt-out at first run**, scrubbed of identity, feeding a maintenance pipeline that
  runs on the maintainer's own accounts and proposes reviewed pull requests.
- The extension id is now `openspineconsortium.ashley` (the university's name is not in a product
  name), and the source is proprietary: `LICENSE`, `extension/LICENSE.txt`, `extension/PRIVACY.md`,
  `extension/THIRD_PARTY_NOTICES.md`.

Version 1 (`ac64e4f`) was released under MIT and stays so; 2.0.0 is the first release under these
terms. The rest of version 1's status (workers, relay, lab access, phone access, troubleshooter,
dependency study) is in `docs/CHECKPOINT_2026-09-28.md`.

Still needs a person: the Claude sign-in on the grid and a first prompt through a worker; a phone
session with a real code; the Wayne State sign-in in the university tenant; a second student account;
the three written answers the compliance report asks for (Anthropic, the university's technology
office, counsel on the licensor entity). `docs/LICENSING.md` has the release and issuing steps.

## Licence

Proprietary: `LICENSE` and `extension/LICENSE.txt`. Use requires a license key. Bundled open-source packages keep their own licences (`extension/THIRD_PARTY_NOTICES.md`).
