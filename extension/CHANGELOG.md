# Changelog

The format follows Keep a Changelog; versions follow Semantic Versioning.

## 5.0.0 (2026-10-04)

### Added
- The setting `beethoven.account`: which of your own Claude accounts Claude Code uses on this
  laptop, by its label in the account list the engine's `bee account add <label>` keeps on this
  computer (`~/.beethoven/engine/accounts.json`, or where the engine's `BEE_REGISTRY_DIR` or
  `BEETHOVEN_HOME` puts it; Beethoven reads it and never writes it). Empty, the default, means
  Claude Code's own sign-in, as before. With a label, every integrated terminal of a local VS Code
  window, the ones you open yourself included, gets that account's sign-in folder as
  `CLAUDE_CONFIG_DIR` and the label as `BEE_ACCOUNT` (only the label for an account listed at
  Claude Code's default place), the same as `bee-use <label>`, so Beethoven and the command line
  pick the same account (the maintainer, 2026-10-04: one person, their own accounts, never pooled,
  never anyone else's, never a sign-in copied or moved); **Beethoven: Sign in to Claude on this
  laptop**, Beethoven's checks of Claude Code, Investigate the failure with Claude and the bridge's
  registration (`claude mcp`, which Claude Code keeps per sign-in folder) use the same account. The
  terminals follow the account list as well as the setting: when the engine moves a folder or drops
  a label, the next terminal gets what the list now says, and what the Beethoven view and the
  troubleshooter report is what the terminals get. A remote window (Remote-SSH, WSL, a container)
  is left as it is, and the view says so. A label that is not in the list changes nothing: Beethoven
  says so once, the Beethoven view's *Claude on this laptop* row says so, the troubleshooter warns
  (the account list, the chosen account) without holding up any other check, and the setup carries
  on with Claude Code's usual sign-in. An account the engine took out of its rotation is still used,
  as `bee-use` does, and can be signed in again from VS Code. A list that `bee` itself refuses (a
  folder written with `~`, a row without its order, a label twice) is refused whole here too, and the
  troubleshooter says why; Beethoven: Reset forgets the setting with the other settings; error reports
  leave out your accounts' labels and folders. The grid is not changed by it: grid scripts
  9 still sign in at `~/.beethoven/claude`, and which of your accounts a grid job uses is the
  engine's decision. Not yet measured: whether the Claude Code extension for VS Code honours
  `CLAUDE_CONFIG_DIR` from the terminal environment; the maintainer checks this on a real machine
  before 5.0.0 ships.

### Removed
- The optional Anthropic API key and the pay-per-use overflow onto it. Beethoven uses no API key and
  asks for no paid usage: the grid worker runs only on your own Claude subscription, and when its
  window is spent it answers "rate limited" with the reset time, as it already did when no key was
  set; send the prompt again after that. The setup and Manage stored tokens no longer take a key,
  nothing copies one to the grid, the worker never reads one, and `beethoven accounts` keeps `list`
  and `remove --yes` (grid scripts version 8). A request that names another account than your
  sign-in is refused.
- Investigate the failure with Claude runs only when Claude Code on this laptop is signed in with
  your Claude subscription (not an API key, a key helper or a cloud provider), with the API key,
  token and provider variables removed from its environment.
- The dollar figure after each request (Ask the grid Claude, the terminal tool and the tool Claude
  Code calls). It was Claude Code's list-price estimate, and on your subscription it is not a bill.
- The packages of 2.0.0 to 4.0.0 in the repository: they ask for an API key. Do not install them,
  nor Ashley for VS Code 3.0.0 from the Marketplace.
- Every way Beethoven could delete what it did not make (grid scripts 9). `beethoven uninstall`
  removed all of `~/.beethoven`, where the Claude sign-in hpcworker's workers use, the engine's
  other sign-ins and account list and your session history live too, and `--purge-root` removed
  your work folder; `beethoven claude forget` deleted the sign-in. Now `beethoven uninstall --yes`,
  typed at a terminal, stops your workers and removes only Beethoven's scripts, settings, logs,
  worker folders, its block in `~/.bashrc` and the links it made, lists what it left, and refuses
  `--purge-root`; `beethoven claude forget` says that Beethoven never deletes or signs out a Claude
  sign-in and that you run `claude auth logout` yourself on a compute node. **Beethoven: Reset** no
  longer offers to remove the container and workspaces, and its grid choice runs the uninstall in
  a terminal you see (over the hidden connection it used, the grid always refused it, as a
  destructive command needs a person at a terminal). The troubleshooter's repair no longer deletes
  leftovers under the login node's `/tmp` or Claude tokens an earlier version stored under
  `~/.beethoven/accounts`, which may hold your other sign-ins now: it reports them. The worker no
  longer moves Claude Code's session history out of the sign-in folder into a shared one and links
  it back, the setup no longer deletes old token files there, and the sign-in relay deletes only
  the code file it was given inside `~/.beethoven/tmp`.

### Changed
- The grid worker and phone access run only on a Claude subscription sign-in, the same rule as on
  this laptop: when Claude Code on the grid is signed in some other way (an API key, a token or a
  cloud provider), they say so and run nothing on it until you sign in again with your subscription
  (the worker asks Claude Code again before a request when its last answer is over a minute old);
  the Beethoven view, the setup, the troubleshooter and `beethoven doctor` say so too (grid scripts
  version 8).
- A sign-in with an API key behind it is not a Claude subscription either (grid scripts 9). Claude
  Code reports `apiKeySource` beside a claude.ai sign-in when a key is in play (the Anthropic
  Console's own key, or one in the environment); the worker, phone access, `beethoven claude login`,
  `beethoven doctor`, the troubleshooter and this laptop's checks now treat it as hpcworker does
  (only `authMethod` `claude.ai`, the provider Anthropic's own, and no `apiKeySource`), say "signed
  in, but not with a Claude subscription", and run nothing on it. The key's value is never read.
  `beethoven claude login` checks the new sign-in before it says it is done. A worker started before
  grid scripts 9 does not look for a key: `beethoven doctor` and the troubleshooter say to restart
  it.
- The variables taken away before Claude Code starts are one list in all five places (this
  laptop's terminals, the worker, phone access, the grid sign-in and the sign-in relay), equal to
  hpcworker's: the switches to AWS, Google Cloud, Mantle and a gateway, and the OAuth refresh token
  and scopes, join them; GitHub and Hugging Face tokens pass as before. A test reads the five and
  fails when they differ.
- The lab's shared folder (grid scripts 9): `beethoven access init` and `beethoven library publish`
  keep other users' read and enter on `/rs/rs_grp_oschome/shared/beethoven` and below, where
  hpcworker's shared copy and the lab's image live too (the volume root's list of approved accounts
  is the gate, and closing the folder shut the browser and desktop editions' students out), and
  never lower an approved account's full entry on the volume root to enter-only. They still close
  every other folder in `shared/` and take away group and other write everywhere.
- New agreement texts (Trial and Full Edition version 7, privacy statement version 7): section 5(c)
  says Beethoven for VS Code asks for no API key and uses no paid usage, and asks you to keep extra
  usage (usage credits) off in your Claude account's settings, which Beethoven cannot see; the
  agreement no longer lists a key among what Beethoven stores, and says how to delete one an earlier
  version left. Sections 4(b) and 5(a) say that every Claude account you use is your own, that you
  may hold several and choose in the settings which one Claude Code signs in with in every
  integrated terminal of a local VS Code window on your laptop, and that Beethoven never pools
  accounts or moves a sign-in between them; the privacy statement lists the account list Beethoven
  reads. Section 5(a) and the privacy statement also say what Beethoven reads of Claude Code's
  report of the sign-in, that only your own Claude subscription with no API key behind it counts,
  that Beethoven never deletes a Claude sign-in or signs one out, and that removing it from the grid
  takes away only what it installed, never your sign-ins, accounts, history or work folder. The
  terms version is 7, so the signing dialog is shown once more.
- Update every computer you use Beethoven on to 5.0.0 before you run the grid step again, and do not
  run the grid step of Ashley for VS Code: the grid step of an earlier version puts its own grid
  scripts back.

### Kept, so nothing is lost
- A key that 4.0.0 stored is never used or sent, and Beethoven does not delete it (the Anthropic
  Console shows a key's value only once). The Beethoven view lists it as not used until you delete
  it with **Beethoven: Manage stored tokens** or **Beethoven: Reset**; the command-line edition's
  copy is in `~/.beethoven-local/secrets.json`, to delete by hand, and a copy Ashley for VS Code
  stored stays in Ashley's own storage. On the grid, every command this version sends puts an
  empty `disabled` file beside the key first, as do the install, every worker start and the
  troubleshooter's repair: it is the one switch a worker still running grid scripts 7 honours, so
  that worker cannot use the key for the rest of its job either. The troubleshooter reports the
  key, and `beethoven accounts remove --yes`, typed in a terminal on the grid, deletes it. Revoke
  the key itself in the Anthropic Console.
- `ANTHROPIC_API_KEY` and the other credential variables are still removed from every Claude Code
  environment the worker starts, and still never put into laptop terminals; the switches to
  Bedrock, Vertex and Foundry join them, and the sign-in on the grid (`beethoven claude login`)
  now has the whole list removed too.

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
