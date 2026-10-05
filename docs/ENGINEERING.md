# Engineering standards for changes to Beethoven for VS Code

Written for anyone, human or automated, who changes this code. Short on purpose; every rule here
has cost time when it was broken.

## Shape of a change

- One failure class, one change, one pull request. If a report shows two problems, two pull
  requests.
- Prefer the smallest change that fixes the class: a wrong assumption becomes a checked assumption
  (a diagnostics node), not a special case for one machine.
- Every message a person will read says what is wrong, what to do, and where to look, in plain
  words. No stack traces to students; the log has those.
- Never widen a permission, weaken a check, store a credential or bypass a gate to make something
  work. A change that touches the license gate, the terms dialog, the credential rules or the
  diagnostics scrubber needs the maintainer's explicit review in the pull request text.

## Where things live

| Concern | Place |
|---|---|
| the wizard's steps and their checks | `extension/src/core/wizard.ts` (no VS Code import) |
| the dependency graph and repairs | `extension/src/vscode/diagNodes.ts`, `grid/beethoven` (`cmd_diag`) |
| the grid worker | `grid/beethovend.js`; phone access `grid/phone.js`; job template `grid/worker.sbatch.tpl` |
| licences | `grid/license.js` (one implementation), `extension/src/core/license.ts`, `extension/src/vscode/licenseGate.ts` |
| error reports | `extension/src/core/diagReport.ts` (scrubber), `extension/src/vscode/diagShare.ts` |
| tests | `extension/src/**/*.test.ts` (unit), `extension/src/vscode-test/` (VS Code), `tools/grid_tests.sh` (container) |

## Invariants that must hold after any change

1. Beethoven never reads, stores, copies or relays a Claude credential. It sets `CLAUDE_CONFIG_DIR`
   and asks `claude auth status`; nothing else.
2. One person, their own accounts, and no fallback: several sign-in directories of the student's
   own, chosen on the laptop by `beethoven.account` from the engine's list (read, never written),
   never pooled and never anyone else's; no API key, no usage credits; a spent window is answered
   `rate_limited` with `retry_after`, and the request is sent again after the reset.
3. Every Claude Code process Beethoven starts on the grid runs inside a Slurm allocation, never on the
   login node; every job has a wall time.
4. Tokens travel on stdin or in files with mode 600, never on a command line, in a job log or in
   `sbatch --export`.
5. The daemon and the extension refuse to work without a valid license for the signed-in person,
   and the refusal names the command that fixes it.
6. An error report contains nothing from `REPORT_FIELDS`' exclusions: no AccessID, e-mail, path,
   hostname, prompt, file content, token or environment value. The scrubber's tests are the proof.
7. Remote shell arguments are quoted once (`renderRemote`); a leading `~/` is the only unquoted
   thing; `$USER` and friends go through `bash -c`.
8. A feature's diagnostics nodes exist before the feature is merged (`REQUIRED_BY_FEATURE`).
9. A name from before the rename (Ashley for VS Code, up to 3.0.0) stays readable until every build
   that uses it is retired: `ashley.*` settings and command aliases, `~/.ashley` and
   `~/.ashley-local`, the `ASHLEY_*` variables, the `ASHLEY1.`/`ASHLEYREV1` prefixes the issuers
   still write (`docs/ARCHITECTURE.md`, "The names from before 4.0.0"). Removing one is a change
   of its own, made only when nothing installed can still depend on it.

## Tests

- Unit tests run on Windows and Linux; tests that need a pseudo-terminal or real symlinks skip on
  Windows and run in the lab container (`tools/grid_tests.sh`). A change to `grid/` runs them.
- A test that reproduces the reported failure comes first and fails; then the fix; then it passes.
  The fake Claude (`extension/test-fixtures/fake-claude.js`) copies the real binary's behaviour;
  when the real behaviour changes, the fake changes first.
- The VS Code suite exports the graph (`docs/diagnostics_graph.json`); `python tools/diag_doc.py`
  regenerates `docs/DIAGNOSTICS.md`.

## Testing on a virgin Windows

The tests above run on machines that have Node, Git and an ssh key; a student's new laptop has
none of them, and every "command not found" the wizard meets there is a message we have to have
written. `tools/sandbox/` starts a throwaway Windows (Windows Sandbox) with nothing installed,
puts VS Code and the packaged VSIX (or the Marketplace build) on it, writes a report of what the
clean machine had and what happened, and leaves you in VS Code to walk the first-run path by hand:
the signing dialog, the license, the sign-ins, the grid steps. `python tools/sandbox/make_wsb.py`,
then double-click the `.wsb`; `tools/sandbox/README.md` has the one-time setup and what to look
for. Do this before a release that changes the wizard, a first-run dialog or anything that looks
for a tool on the laptop.

## Pull request text

What changed and why; what was tested and how; what was checked against something outside the
code; what is not verified. For assisted changes, the `Assisted-by` trailer and a sentence on how
much the tool wrote.

## Versions and releases

Semantic versioning, integer major bumps only for behaviour a student would notice. `CHANGELOG.md`
in Keep a Changelog form; a change to what leaves the laptop, to the gate or to the agent goes under
Security. Releases: `node tools/release.mjs` (production build, notices, package, release checks,
unpacked copy for the package tests, signed checksums). The signing key never enters CI.
