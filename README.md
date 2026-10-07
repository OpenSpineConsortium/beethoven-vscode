# Beethoven for VS Code

**A medical student's laptop, the Wayne State grid, and Claude Code, joined by one wizard.**

Beethoven for VS Code (called Ashley for VS Code until version 3.0.0) is a VS Code extension, with a
terminal twin for other editors, that sets up a student for computational research on the Wayne
State HPC grid and keeps a Claude Code worker running there, on the student's own Claude
subscription, reachable from the Claude Code extension on the laptop. It is the on-ramp to the lab's
`Student_Projects` recipe: pre-registered questions, results files, Slurm jobs, and papers built from
results. Its sibling, the Beethoven browser extension, does the same through the university's Open
OnDemand portal and lives in its own repository.

This repository is the VS Code edition's (GitHub: `OpenSpineConsortium/beethoven-vscode`; the
Desktop folder is still `ashley` until the maintainer renames it).

```
extension/   the VS Code extension (TypeScript): wizard, secrets, Remote-SSH, Beethoven view, MCP bridge, CLI
grid/        what gets installed in ~/.beethoven/bin on the grid: the beethoven CLI (bash), the worker daemon (Node), job scripts
cli/         ten-line ssh forwarders for laptops without Node (macOS/Linux bash, Windows PowerShell)
docs/        manual (HTML + PDF), pitch, architecture, limits, install, research notes, figures
tools/       release and license tooling, maintainer only (the access service is its own repository,
             OpenSpineConsortium/beethoven-access)
dist/        the release records, and the built .vsix of each release from 5.0.0
```

## Quick start

1. Install **Beethoven for VS Code** 5.0.0, from the Marketplace once it is published there, or
   `dist/release/5.0.0/beethoven-5.0.0.vsix` once the maintainer has built and signed it with
   `tools/release.mjs` (Extensions view, `...`, *Install from VSIX*). Do not install 4.0.0 or anything
   earlier, nor Ashley for VS Code 3.0.0 from the Marketplace: they ask for an API key. Accept the
   terms; sign in with Wayne State and your access key arrives by itself if the lab has approved you.
2. `Beethoven: Set up my research environment (wizard)`.
3. `Beethoven: Start a Claude worker on the grid`, then `Beethoven: Ask the grid Claude`, or open the
   Claude Code panel and say "check the grid status".

Everything else: [docs/manual.html](docs/manual.html) (also `docs/manual.pdf`, built by
`docs/manual/build_manual.py`), [docs/INSTALL.md](docs/INSTALL.md),
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/LIMITS.md](docs/LIMITS.md),
[docs/PITCH.md](docs/PITCH.md), [docs/RESEARCH.md](docs/RESEARCH.md),
[docs/DIAGNOSTICS.md](docs/DIAGNOSTICS.md), [docs/MARKETPLACE.md](docs/MARKETPLACE.md).

## Status (2026-10-04): version 5.0.0, no API key

Version 5 removes the optional Anthropic API key of 4.0.0 and the pay-per-use overflow onto it: the
grid worker runs only on the student's own Claude subscription and, when its window is spent, answers
with the time it resets. It is merged but not yet built, signed or released. The packages of 2.0.0 to
4.0.0 ask for an API key and were withdrawn from `dist/` on 2026-10-04 (`dist/release/README.md`);
`extension/CHANGELOG.md` has the full list.

Version 4 was Ashley for VS Code 3.0.0 under its new name, **Beethoven for VS Code**, and a new
Marketplace item, `openspineconsortium.beethoven` (the old item, `openspineconsortium.ashley`, is
retired as `docs/MARKETPLACE.md` describes). Commands, settings, the view, the MCP server and the grid
command are `beethoven`; the grid folder is `~/.beethoven`. Nothing a student set up is lost: the old
settings are read until new ones are set, the laptop's `~/.ashley-local` folder stays in use, the old
`~/.ssh/config` block is replaced rather than doubled, the grid folder moves once and leaves
`~/.ashley` as a link, the old command ids run as hidden aliases, and access keys with either prefix
(`ASHLEY1.`, which the issuers still write, or `BEETHOVEN1.`) verify. The GitHub and Hugging Face
tokens are entered once more (VS Code keeps secrets per extension). `extension/CHANGELOG.md` has the
full list.

What version 2 and 3 introduced still holds:

- **A license key per person**, checked against the Wayne State sign-in; access by the lab's
  approval, the key obtained by the extension itself from the lab's access service; the extension,
  its CLI, its MCP server and the grid worker all refuse to work without a valid key. Terms are
  accepted in a first-run dialog that also asks about error reports.
- **Claude sign-in through Claude Code's own flow only.** Beethoven never captures, stores or copies a
  Claude credential. The student signs in to Claude Code on the laptop and, once, in a terminal inside
  their own grid account; Claude Code keeps its own credential and Beethoven only points at it. This
  follows the compliance research in `docs/research/reports/` (Anthropic's Claude Code terms forbid
  third-party tools from handling Claude credentials).
- **Error reports, opt-out at first run**, scrubbed of identity, filed as GitHub issues on the
  maintainer's own accounts, where the maintainer reads them; nothing there runs on an API key.
- The source is proprietary: `LICENSE`, `extension/LICENSE.txt`, `extension/LICENSE-FULL.txt`,
  `extension/PRIVACY.md`, `extension/THIRD_PARTY_NOTICES.md`.

Version 1 (`ac64e4f`) was released under MIT and stays so; 2.0.0 was the first release under these
terms. The history of every pass is in `docs/CHECKPOINT_2026-09-28.md`.

Still needs a person: the Claude sign-in on the grid and a first prompt through a worker; a phone
session with a real code; the Wayne State sign-in in the university tenant; a second student account;
the three written answers the compliance report asks for (Anthropic, the university's technology
office, counsel on the licensor entity); building and signing 5.0.0; the Marketplace upload of the
new item and the retirement of the old one. `docs/LICENSING.md` has the release and issuing steps.

## Licence

Proprietary: `LICENSE` and `extension/LICENSE.txt`. Use requires a license key. Bundled open-source
packages keep their own licences (`extension/THIRD_PARTY_NOTICES.md`).
