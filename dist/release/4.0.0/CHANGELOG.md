# Changelog

The format follows Keep a Changelog; versions follow Semantic Versioning.

## 4.0.0 (2026-09-30)

### Changed
- The name: Ashley for VS Code is now **Beethoven for VS Code**, published under a new Marketplace
  id (`openspineconsortium.beethoven`; the old listing, `openspineconsortium.ashley`, is retired).
  Commands are `beethoven.*` (category "Beethoven"), settings `beethoven.*`, the activity-bar view
  "Beethoven", the MCP server `beethoven` with tools `beethoven_*`, the terminal tool
  `beethoven-cli`.
- New agreement texts (Trial and Full Edition version 5, privacy statement version 5): the product's
  name, and access keys beginning `ASHLEY1.` or `BEETHOVEN1.`. The terms version is 5, so the
  signing dialog is shown once more.
- The grid folder is `~/.beethoven` and the grid command `~/.beethoven/bin/beethoven` (grid scripts
  version 7). The first grid install moves `~/.ashley` there in one step, while no worker runs, and
  leaves `~/.ashley` as a link to it; the Claude sign-in on the grid moves with it.
- Pages and `services.json` are read from openspineconsortium.com/beethoven/.

### Kept, so nothing breaks
- A setting still set under its old name (`ashley.*`) is read while the new one is unset; every
  change is written under the new name.
- The old command ids (`ashley.*`) run as hidden aliases of the new ones while Ashley for VS Code
  itself is not installed (two extensions cannot hold one command id).
- A computer that ran Ashley keeps its `~/.ashley-local` folder (access key, sign-in record,
  accepted terms, the CLI's settings); new computers use `~/.beethoven-local`.
  `BEETHOVEN_LICENSE_DIR` is read before the older `ASHLEY_LICENSE_DIR`.
- The `~/.ssh/config` block written by Ashley is recognised and replaced, never doubled.
- A grid account the move has not reached answers through `~/.ashley/bin/ashley` until the next grid
  install; files the laptop writes there go to whichever folder the account has.
- Access keys and withdrawn-key lists with either prefix verify; the access service still issues
  the old prefix, which Ashley for VS Code 3.0.0 and grid scripts before 7 require.
- Terminals get `BEETHOVEN_GRID` and, for older copies of the terminal forwarder, `ASHLEY_GRID`.

### Added
- While Ashley for VS Code is still installed, a notice (at most daily) offers to uninstall it: the
  two would otherwise keep reinstalling their own grid scripts. The `ashley` registration with
  Claude Code, which points at the old extension, is removed whenever Beethoven registers its own
  while Ashley is not installed (the wizard, Troubleshoot and repair, Connect the Claude Code
  extension to the grid) and by Reset; if Ashley is uninstalled later, run Connect the Claude Code
  extension to the grid once.

### Not carried over
- GitHub and Hugging Face tokens kept in the keychain by Ashley: VS Code keeps secrets per extension
  id, so they are entered again once (the wizard's token steps).

## 3.0.0 (2026-09-28)

### Changed
- Two agreements, one signing dialog. The free Trial Edition (LICENSE.txt, version 4) is accepted
  before first use; the paid Full Edition agreement (LICENSE-FULL.txt) is shown, and must be
  accepted, when a Full Edition key is registered, and from then on governs. Each has its own
  acceptance record and kept texts. The Trial Edition takes no payment, converts to nothing, and
  can be withdrawn or ended with 30 days' notice.
- Access by approval. The Trial Edition is for Wayne State AccessIDs the lab has approved: the
  wizard signs in with Wayne State first and then obtains an access key from the lab's access
  service by itself; a person who is not approved is sent to the request page. The list is managed
  on the lab's admin page; removal revokes the key.
- Service addresses come from `services.json`, published with the support site, so the access
  service, the approved list, the revocation list and the error-report address can change without
  a release; a setting still wins where set.
- The Marketplace listing is Free. Version 3 because the first-run agreement changed.

### Added
- A status row that says a token or sign-in is missing or expired can be clicked: the same sign-in
  the wizard uses runs for that item alone. The diagnostics panel offers the same fix beside each
  failing cause.
- A virgin-Windows test kit (Windows Sandbox with nothing but VS Code) under `tools/sandbox/`.
- Grid etiquette (C&IT, 2026-09-28): container builds run only inside Slurm jobs with temp and
  cache on the compute node's local disk and a cleanup trap; nothing container-related on the login
  node; a diagnostic (`grid.login-tmp`) finds and removes leftovers under the login node's `/tmp`.
  Grid scripts version 5. `docs/MAC.md`: continuing on a Mac and the Xcode route.
- `grid/login_relay.sh` (maintainer tool): runs Claude Code's own grid sign-in in a tmux session
  inside the worker allocation so it can be completed from a phone.

## 2.0.0 (2026-09-28)

### Changed
- Ashley is licensed software. Every copy needs a license key for the person using it, checked
  against the Wayne State sign-in; free trials (one per AccessID) from the lab's licence service or
  the lead; the extension, CLI, MCP server and grid worker refuse to work without a valid key.
- The extension id is `openspineconsortium.ashley` and the name carries no university name.
- The wizard has twelve steps: license first, then accounts, the grid, the lab, and the Claude
  sign-in on the grid last.

### Security
- Ashley no longer captures, stores or copies a Claude credential. The student signs in to Claude
  Code on the laptop and once on the grid through Claude Code's own flow; Claude Code keeps its
  credential in `~/.ashley/claude`, which every Claude Code process Ashley starts uses. An earlier
  version's stored token is deleted from the keychain and from the grid on upgrade.
- Phone access uses that sign-in; the student answers Claude Code's one-time Remote Control
  question themselves. Ashley relays no code and never runs logout.
- Error reports to the maintainer, opt-out at first run and in Settings, scrubbed of identity
  (no AccessID, e-mail, path, hostname, prompt, file, token or environment value), honouring VS
  Code's telemetry setting, kept on the laptop for inspection; nothing sent without a configured
  address.
- Release builds are readable, ship no source maps, carry the licence notice, third-party notices,
  a privacy statement and a release check that refuses maps, fixtures, the test signing key and
  copyleft dependencies.

### Added
- A signing dialog for the license agreement (version 3) and privacy statement: full text, four
  statements to tick, a typed name, "Accept and Continue"; the acceptance record is kept on the
  laptop with the texts; `Ashley: Read the license terms`, `Ashley: Support page`; `ashley-cli terms`
  for the terminal. Disputes go to Michigan courts after notice and cure (no arbitration); a 14-day
  refund on request for paid keys.
- `Ashley: License`, `Ashley: Error reports`, `Ashley: Sign in to Claude on the grid`.
- Grid: `ashley claude login|status|remote-consent|forget`; the worker heartbeat reports the
  sign-in; diagnostics nodes for the license, the sign-in and error reports.
- Repository: CI, a triage workflow that turns reports into reviewed draft pull requests on the
  maintainer's own account, code owners, contribution and engineering standards, a security policy.

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
