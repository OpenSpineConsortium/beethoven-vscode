# Contributing to Ashley

Ashley is licensed software with a private source repository. Contributions come from the
maintainer, from collaborators the maintainer has added, and from an automated pipeline that turns
students' error reports into reviewed pull requests. All three follow the same rules.

## The rules

1. **One change per pull request**, on a branch, into `main` through a pull request. `main` is
   protected: a review by a code owner, green CI, and no force-push. The maintainer's own changes go
   through the same door.
2. **The pre-integration rule.** No feature, package, template or assumption is integrated until it
   is a node in the diagnostics graph with a check, a manual fix and a future risk, and its ids are
   listed for its feature in the test `every feature keeps its diagnostic nodes`. `docs/DIAGNOSTICS.md`
   explains how to add a node.
3. **Tests run before review**: typecheck, unit tests, VS Code tests when the extension changed,
   container tests (`tools/grid_tests.sh`) when `grid/` changed. A pull request says what was not
   run.
4. **Check against something outside the code.** A number that is wrong but plausible is the
   recurring failure in this project's history. A fix is verified against a measurement, a document
   or a live run, and the pull request says which.
5. **Generalise and harden.** A fix addresses the class of failure, not the one machine; it degrades
   with a clear message rather than a stack trace; it never widens permissions, weakens a check or
   touches credentials to make a test pass.
6. **Nothing secret in the repository**: no tokens, keys (except the test-only signing key under
   `extension/test-fixtures/license/`), no student identifiers, no report contents. The release check
   and CI enforce part of this; people enforce the rest.
7. **Say what is not known.** A pull request that cannot verify something says so; a comment that
   guesses is worse than one that says "not measured".

## AI-assisted changes

Ashley's maintenance pipeline and its maintainer both use Claude Code. The posture is disclose and
own: an AI tool may draft a change, and the human who opens or approves the pull request is its
author and answers for it.

- Commits made with assistance carry the trailer `Assisted-by: Claude Code (<tool or action>)`. An
  AI agent never adds `Signed-off-by`.
- The pull request says how much of the change the tool wrote and what the human changed or checked.
- Automated pull requests are drafts on a `claude/` branch with the label `ai-generated`; the agent
  cannot approve or merge; the same person may not be both the one who dispatched the agent and the
  only reviewer (with a single maintainer, that means a green CI run and a waiting period of one day
  before merge, stated on the pull request).
- The agent never edits `grid/license_keys.json`, `extension/LICENSE.txt`, `extension/PRIVACY.md`,
  the workflows or the release tooling.

## Reporting a problem

Students report through Ashley (`Ashley: Error reports` shows what is sent) or to their lead.
Security problems: see `SECURITY.md`.

## Building and releasing

`docs/INSTALL.md` (developer section) and `tools/release.mjs`. Releases are signed with the
maintainer's licence signing key (`tools/license/ashley-license.mjs sign-release`), never in CI.
