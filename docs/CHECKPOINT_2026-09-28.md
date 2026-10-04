# CHECKPOINT 2026-09-28 (updated 2026-09-30, pass 29: Beethoven 8.0.0 released, the request-to-installation flow, framework 9; pass 28: Beethoven for VS Code 4.0.0 built and signed, not yet on the Marketplace, where Ashley for VS Code 3.0.0 is still the published item) — Beethoven for VS Code (Ashley for VS Code until 3.0.0), the grid + Claude Code extension

## CURRENT STATE: read this first

**As of pass 30 (2026-10-04).** Beethoven for VS Code 5.0.0 (no API key and no paid usage, grid
scripts 8, terms version 6) was merged to `main` at 13:27 UTC (pull request #5) and is not yet built
or signed: there is no `dist/release/5.0.0/` until the maintainer runs `tools/release.mjs`. It
replaces 4.0.0. The packages of 2.0.0, 3.0.0 and 4.0.0 ask for an API key and were withdrawn from the
tree on 2026-10-04, their records kept (`dist/release/README.md`), so pass 28's step "the maintainer
uploads 4.0.0" no longer stands: the Marketplace upload is 5.0.0 (`docs/MARKETPLACE.md`). The
withdrawal and the rest of that day's sweep for API keys are not committed: the maintainer reviews
and commits. Later that day, on the branch `wip/account` for the maintainer's review: the setting
`beethoven.account` (one person, their own accounts; `docs/ARCHITECTURE.md`, "Several accounts of
one person"), with the agreements and the privacy statement at version 8 and `TERMS_VERSION` 8 (a
review of the first draft, version 7, which never shipped, found that the texts promised the
account only to the terminals Beethoven opens, while every integrated terminal of a local window
gets it); it ships in 5.0.0. The bundled manual (`extension/media/manual.html`, `docs/manual.html`)
was edited by hand for that section, since pandoc was not at hand: `docs/manual.pdf` and a pandoc
rebuild (`python -X utf8 docs/manual/build_manual.py`) wait on the maintainer. The diagnostics
graph (`docs/diagnostics_graph.json`, `docs/DIAGNOSTICS.md`) was regenerated without VS Code, from
`buildGraph()` bundled with an inert stand-in for the `vscode` module (the same method reproduces the
graph committed in 710d74e byte for byte); the VS Code integration suite (`npm run test:vscode`),
with its two new account tests, has not run on this change and waits on the maintainer too, and
its graph test rewrites both files. Whether the Claude
Code extension honours `CLAUDE_CONFIG_DIR` from the terminal environment is not yet measured and is
on the pre-publish list in `docs/MARKETPLACE.md`. The pass 29 and pass 28 paragraphs that follow are
kept as they were.

**As of pass 29 (2026-09-30, 16:55 UTC).** The newest entry is "What pass 29 changed" below: the
browser edition's 8.0.0 is released and the site's history purged (both pushed by the maintainer);
the access service's afternoon work is deployed on both Worker names and framework 9 is published to
the lab's shared copy, but none of that afternoon work is committed: the maintainer reviews and
commits the three trees. The pass 28 paragraph that follows is kept as it was.

**As of pass 28 (2026-09-30).** The extension is **Beethoven for VS Code 4.0.0**
(`openspineconsortium.beethoven`), built and signed in `dist/release/4.0.0/`; it is not on the
Marketplace yet, where Ashley for VS Code 3.0.0 (`openspineconsortium.ashley`) stays the published
item until the maintainer uploads 4.0.0 and retires the old item (`docs/MARKETPLACE.md`). Grid
scripts 7 are installed for go2432, whose `~/.ashley` is now a link to `~/.beethoven`. Nothing of this
pass is committed: the maintainer reviews and commits both repositories. The next paragraph is the
state pass 21 recorded, kept as it was; the pass 28 entry after it says what changed since.

Version 3.0.0 of the extension (`openspineconsortium.ashley`, installed in Greg's VS Code), grid
scripts version 4 deployed to go2432 (plus `login_relay.sh`, a maintainer tool); workers `default` (job 40487595) and `peer`
(40487596) on asx1, both reporting a valid license and "not signed in" for Claude (expected until
Greg signs in). Release in `dist/release/3.0.0/` (VSIX, changelog, both agreements, privacy, notices,
SHA256SUMS signed by k1). Committed and pushed as this checkpoint says below.

### What pass 29 changed (the browser edition's release, the request-to-installation flow, framework 9)

- **Pass 29 (2026-09-30, midday to 16:55 UTC): Beethoven 8.0.0 released; the site's history purged;
  mailbox confirmation, the invitation to the private listing and each account's stage tracked by the
  access service; the admin page; framework 9 with the grid's Slurm client inside the worker.** The
  user's words: "require mailbox authentication, and track it as part of the process to getting
  private group access, the group is named 'Beethoven-users', can you automate inviting to the group
  after they verify the mailbox, and I approve them through one click email link? ... Extensions should
  only install in one chrome exe, on one computer, for one person, one time." Students use claude.ai to
  reach the grid, issue jobs and get work done.
  (a) **Released and pushed by the maintainer before this pass's work** (checked read-only today with
  `git ls-remote`): Beethoven 8.0.0, the browser edition, `OpenSpineConsortium/beethoven` `main` at
  `c05f595` with tag `v8.0.0` (`release/8.0.0/beethoven-8.0.0-chrome.zip`, SHA-256
  `3b4a300be1fa593c37fcadcc8df0c78ee270d1ed432c9d4c3b182216deea356a`): Chrome only, for a private
  Chrome Web Store listing; no grid-side tool inside (the lab's shared copy is the only mode); the
  approval check carries a random installation identifier kept in `storage.local`, which Chrome Sync
  never copies, so a synced copy on another computer is a new installation and is refused; agreement
  v7, privacy statement v8. The access service v2, this repository's `cb6b143` on
  `OpenSpineConsortium/beethoven-vscode` `main` (seats by installation, the grants `extension` and
  `lab`, the request portal with the Google account, the purpose and an optional CV, mailbox proof
  behind `MAIL_STUDENTS`). The site at `3f805f4`, `master` on GitHub and live: no public downloads
  (`/beethoven/downloads/` answers 404).
  (b) **The site's history purge.** Every package ever published under `beethoven/downloads/` was taken
  out of every commit (`git filter-repo` from WSL) and `master` force-pushed. Old tip `648e151`, new tip
  `3f805f4`: both have the tree `05b2e738e6423e7b2769f299f7127f6885050fb2` and 206 commits, so the
  current site is byte for byte the same; two commits of the old history touched that folder, none of
  the new one does (checked today against the backup bundle
  `site-before-purge-20260930-111343.bundle`, 172 MB, in the session scratchpad; it still holds the
  packages).
  (c) **The access service, afternoon** (`tools/intake/`, uncommitted, deployed on both names). Every
  e-mail link (Approve for Beethoven, Lab membership only, Deny, the CV view, Move, Withdraw, Done,
  invited) carries the version (`ref`) of the request, refusal e-mail or approval it was sent for; an
  older link answers "replaced", "decided already" or "out of date" and changes nothing. A Move onto an
  installation that is another account's seat is refused with a page naming that account and saying to
  withdraw its approval (or reset its seat) first; the link is not used up. The reviewers' `st1234`
  exemption (`seat-rule any`) holds only on a portal named `localhost` or `*.localhost`. Remove and
  Withdraw also delete `seen:<product>:<id>` and `installed:<id>`. Mailbox confirmation: with
  `MAIL_STUDENTS` `"1"` the maintainer is e-mailed only after the student presses the Confirm link sent
  to `<AccessID>@wayne.edu`; an unconfirmed request and its CV lapse after 7 days (KV TTL) and the
  student can send the form again; a confirmation e-mail that cannot be sent is answered 502 and never
  reaches the maintainer. With `"0"`, deployed today, the maintainer's e-mail says "Mailbox: not
  verified" as before. The lifecycle is stamped on the records (`submitted_at`, `confirmed_at`,
  `decided_at` and `decision`, `invited_at` and `invited_by`, and `installed:<id>` when the first seat
  binds), `GET /admin/list` gives each row its stage, and `admin.mjs list` prints one line per account.
  The invitation to the Google Group `Beethoven-users`: a group owned by a personal Google account has
  no programming interface for its members, so the Approve page shows the Google account in a copy
  box, a link to `https://groups.google.com/g/beethoven-users/members` and a one-use **Done, invited**
  button; a daily e-mail (13:00 UTC, from `beethoven-access` only, one a day at most) lists approvals
  for Beethoven not invited after an hour, each with its own Done, invited link; with `MAIL_STUDENTS`
  `"1"` the student is told after approval to watch for the invitation and install from the private
  listing. `GROUP_MODE` `"workspace"` (a Directory API `members.insert` with a delegated service
  account, for when the lab has a Google Workspace) is off, stub-tested and never called live. The
  contract the admin page reads, and every live proof, are in `ACCESS_CHECK.md`; the rest in
  `tools/intake/README.md`.
  (d) **The admin page** (site repository, uncommitted): `/beethoven/admin.html` rewritten on that
  contract: pending requests as cards (name, AccessID, e-mail, Google account with Copy, purpose, the
  CV through `POST /admin/cv`, the mailbox state with its lapse date), with Approve for Beethoven, Lab
  membership only and Deny; the next-step box after Approve; the approved table with grants, stage,
  dates and the seat summary, and Mark invited, Reset seat and Remove. Only `/admin/` routes, the token
  in `sessionStorage` for the tab. Wired in Edge against the Worker's own code in a local harness; not
  run against the live Worker, which needs the admin token and would change real records.
  (e) **Framework 9** (the browser edition's cluster-side tool, uncommitted, published): with the profile
  flag `scheduler_in_worker: true` (the Wayne profile only; the default is false) the worker's
  container gets the host's Slurm client: the host's `/usr/bin` read-only at `/opt/host/bin`,
  `/usr/lib64/slurm`, the munge library and socket folder, `/etc/slurm`, and user lists with the
  `slurm` and `munge` users, plus five wrappers (`sbatch`, `squeue`, `sacct`, `scancel`, `sinfo`) first
  on the container's PATH; `scontrol` is left out (its host binary needs `libreadline.so.6`, which the
  image lacks). A missing piece starts the worker without the client and says which piece. The
  workspace guide (`CLAUDE.md`) says jobs can be submitted with `sbatch` and how to hand results back.
  An account's kept `profile.json` takes this one field from the shared copy's site profile when it
  lacks it (`FIELDS_FROM_SITE`, new). One check job, 40518457 on `asx1` (`secp/secondary`, under a
  minute, no worker): `squeue -u go2432`, `sinfo -s`, `sacct -j 40518457 -X`, `sbatch --test-only` and
  `scancel --version` worked inside the container; `scontrol` failed as above. Published with
  `tools/deploy_shared.sh`: `current -> v9` at 16:07:05Z; README-only updates at 16:07:29Z and 16:44:10Z.
  Two wrapper changes made after the check job (no `scontrol`, the host's `LD_LIBRARY_PATH`) have not
  run on the grid, and no worker's Claude Code has submitted a real job yet.
  (f) **Integration** (the last step of this pass). Three edge cases the service review found were fixed,
  each with a test that fails on the earlier code, and both names deployed again (versions `0c6468d1`
  and `94cd3269`, 16:36 and 16:38 UTC): an old Done, invited link after the approval was removed and
  made again now answers "replaced" instead of stamping `invited_at`; a second confirmation link for a
  version already confirmed answers "Already confirmed" instead of e-mailing the maintainer twice; with
  the workspace adapter, a student the service added is no longer told to wait for an invitation, and
  the Approve page and the admin page say to send the listing's address. The request form now shows the
  service's own reason when the three-confirmations-a-day limit refuses it, instead of "too many
  requests from this connection". `WAYNE_STATE_PILOT.md` lost an obsolete Firefox measurement row
  (8.0.0 is Chrome only), and the shared copy's `README.md` was brought in line with the local one.
  (g) **Decisions**, so they are not re-litigated: mailbox confirmation is required once
  `MAIL_STUDENTS` is `"1"`, with no fallback to an unverified request; the invitation stays a tracked
  manual step while the group belongs to a personal Google account, and the Workspace adapter waits
  behind its switch; one installation per person is enforced by the installation identifier alone, no
  fingerprinting; a link is spent in KV, so "works once" holds only after about a minute (once in the
  afternoon proof a second press 4 s later went through; a Durable Object would close it and is not
  built); the Slurm client in the worker is a per-site flag, off unless a profile sets it.
  (h) **Checked in this pass:** `node --test` in `tools/intake`: 55 of 55; with
  `tools/license/vendor.test.mjs`, 57 of 57. `HPCW_PYTHON=python bash framework/tests/run.sh` in the
  browser edition: ALL OK (160 cases, 10 skipped on Windows). `python -X utf8 tools/build_site.py` in
  the site: 0 problems (43 pages, stamp `?v=202609301649`; `--check-only` also 0). The admin page in
  Edge through the local harness: 25 of 25 wiring checks, and 8 of 8 in workspace mode; the empty page
  at 1440 and 390 with no sideways scroll; the request form refused at the fourth changed send with the
  service's reason, 6 of 6. Over ssh: `~/.hpcworker/bin/hpcworker version` answers `9 (shared copy at
  /rs/rs_grp_oschome/shared/beethoven/hpcworker/current)`, `current -> v9`, and every published code
  file matches the local tree. Live: `/health` answers `{"ok":true}` on both names; a v2 request for
  the made-up `zq0301` (at `beethoven-access`) and `zq0302` (at `ashley-service`) answered 202
  `{"status":"pending","mailbox":"not_verified"}`; a Done, invited link with a ref that `add`-made
  `zq0303` lacks answered 409 "This approval was replaced" at both names; all three removed, and a
  minute later the lists held pending 0 and approved go2432, hy9698, st1234. Both names run
  `MAIL_STUDENTS` `"0"`, `REQUIRE_INSTALL_ID` `"0"`, `GROUP_MODE` `"manual"`. No user-facing text
  outside `/ashley/` names Edge, Firefox or Safari or offers a download of the extension, and the
  banned word is in no changed file.
  (i) **Still open, for the maintainer:** review and commit the three trees (this repository:
  `tools/intake/` and this checkpoint; the browser edition: `docs/` and `framework/`; the site:
  `tools/pages/beethoven/admin/body.html`, `tools/templates/request-form.html`, `assets/css/site.css` and
  the regenerated pages), then push (`tools/push_org.sh` from WSL in each product repository; `git push`
  in the site, which publishes the new admin page and request form). Create the Google Group
  `Beethoven-users` if it is not there yet and confirm its address, upload 8.0.0 to the Chrome Web
  Store as a private listing with the group as its trusted testers, and put the listing's address in
  every invitation's message (the student's e-mail says the invitation has the link). Before 13:00 UTC
  on 2026-10-01, mark go2432 (and hy9698 once she is invited) as invited, or the first reminder lists
  them. After the Resend domain is verified: `MAIL_STUDENTS = "1"` and deploy both names. After everyone
  runs 8.0.0: `REQUIRE_INSTALL_ID = "1"` and deploy both names. Decide on a Durable Object for spending
  links, on `FIELDS_FROM_SITE` (it switches a field on for accounts installed before it, but a later
  "off" reaches only those), and on binding the host's readline for `scontrol`. Restart your own worker
  to reach v9, then ask its Claude Code for `squeue -u $USER` and a small `sbatch` job: that measures
  the two unrun wrapper changes. For framework 10: the `sbatch` wrapper passes `HPCW_NODE_TMP` and
  `HPCW_BINDS` on to submitted jobs (documented; `arm_chain` unsets both), a write failure in the bind
  step is reported with the wrong reason, and the guide's "with the person's usual environment" says
  more than the wrappers do; `docs/DIAGNOSTICS.md` has no node for `hpcw.slurm-in-worker`. Delete
  `/rs/rs_grp_oschome/go2432/tmp/hpcw9_check` when its output is no longer needed, and decide whether
  to keep the purge's backup bundle (it holds every package the purge removed).

### What version 4 changed (pass 28)

- **Pass 28 (2026-09-30): Ashley for VS Code becomes Beethoven for VS Code 4.0.0; the documents
  follow; two organisation repositories; the site generated by the site repository; framework 7;
  the key-prefix switch; access requests approved from an e-mail.** The user's words: "any other
  sources of 'Ashley' throughout the code base including the github repos, just find and replace
  everywhere with beethoven". (a) **Renamed** (the code in commit 0475b63, the documents in this
  pass): the product (Beethoven for VS Code; its sibling, the browser extension, has been Beethoven
  since 7.0.0), the Marketplace id `openspineconsortium.beethoven` (a new item), the commands,
  settings and view `beethoven.*`, the MCP server `beethoven` with tools `beethoven_*`, the terminal
  tool `beethoven-cli` and forwarders `cli/beethoven(.ps1)`, the grid command
  `~/.beethoven/bin/beethoven` and daemon `beethovend.js` (grid scripts 7), the laptop folder
  `~/.beethoven-local`, the vendor folder `C:/Users/grego/.beethoven-vendor`, the licence tool
  `tools/license/beethoven-license.mjs`, the agreements (Trial and Full Edition version 5) and the
  privacy statement (version 5; `TERMS_VERSION` 5), the service pages under
  `https://openspineconsortium.com/beethoven/` and this edition's own under `/beethoven/vscode/`. In
  this pass: `docs/ARCHITECTURE.md` (with a new section, "The names from before 4.0.0", the table of
  every kept name and why), `INSTALL.md` (rewritten for 4.0.0), `LIMITS.md`, `PITCH.md`,
  `LICENSING.md` (keys, prefixes, the e-mail approvals, the site generator), `MAC.md`,
  `ENGINEERING.md` (invariant 9: an old name stays readable until nothing installed needs it),
  `RESEARCH.md` (a note and the section title only: the findings keep the words the research used),
  `DEPENDENCY_MAP.md` (a header saying how to read the study's names, through
  `tools/depmap_doc.py`; the 370 entries keep the names of the day), `ANTHROPIC_REQUEST.md`,
  `legal/ARBITRATION_OPTION.md`, the root `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, the pull
  request template, the three manual figures (`topology.svg`, `lifecycle.svg`, `wizard.svg` through
  `tools/wizard_figure.py`; rendered and looked at: the grid command's label is set at 13 px to fit
  its box, and two labels that still described the version 1 token now name Claude Code's own
  sign-in), and the Windows Sandbox kit (`tools/sandbox/`: it picked the newest `dist/ashley-*.vsix`
  and installed `openspineconsortium.ashley`, so it would have tested 3.0.0; it now takes
  `beethoven-*.vsix` or `openspineconsortium.beethoven`, and writes `Beethoven-VirginWindows*.wsb`;
  the two old untracked `.wsb` files were removed). The passages about `docs/site/*.html` and
  `tools/site_build.py` (both retired in 0475b63) now point at the site repository's
  `tools/build_site.py`. (b) **Kept, and why** (all still read or still written, so nothing installed
  breaks): the prefixes `ASHLEY1.` and `ASHLEYREV1`, still what every issuer writes, because Ashley
  for VS Code 3.0.0, grid scripts before 7 and Beethoven builds up to 7.0.0 accept nothing else;
  `~/.ashley` and `/rs/rs_grp_oschome/shared/ashley`, links to `~/.beethoven` and `shared/beethoven`,
  because those builds and worker job files written before grid scripts 7 name them; the `ashley.*`
  settings (read while the new one is unset, never declared) and command ids (hidden aliases while
  Ashley for VS Code is not installed), because two extensions cannot declare one name; the
  `ASHLEY_*` environment names, read after the `BEETHOVEN_*` ones, because older job files and
  forwarders set them; `~/.ashley-local`, used where it exists, so the key and the accepted terms
  carry over; the Marketplace id `openspineconsortium.ashley`, retired rather than renamed, because a
  Marketplace id cannot be renamed; the Desktop folders `ashley` and `ashley-bridge`, until the
  maintainer renames them (to `beethoven-vscode` and `beethoven`); `ASHLEY-RELEASE1`, the release
  signature's domain tag, because renaming it would fail every earlier release's `verify-release`;
  the Slurm job name `ashley_access`, which an admin's tool older than grid scripts 7 looks for; the
  Worker name `ashley-service` and the files under `/ashley/`, which installed 3.0.0 builds fetch; the
  payload field `product: "ashley"`, which every verifier checks. (c) **Repositories:**
  `OpenSpineConsortium/beethoven-vscode` (this one) and `OpenSpineConsortium/beethoven` (the browser
  edition) are the only remotes (`tools/push_org.sh` in each, from WSL; `push_via_grid.sh` is
  retired); the personal copies `GregorySchwing/ashley` and `GregorySchwing/ashley-bridge` are being
  deleted by the maintainer. (d) **Website** (site commits 816e9c4 and be44925): every page of
  openspineconsortium.com is generated by the site repository's `tools/build_site.py` from one
  navigation definition; the home page is Beethoven; this edition's pages (landing, both agreements,
  the privacy statement, the third-party notices) are under `/beethoven/vscode/`, rendered from this
  repository's texts and checked word for word against them; the admin page is
  `/beethoven/admin.html`; every file under `/ashley/` is either a forward the generator writes or a
  kept file whose SHA-256 it pins (installed builds read `/ashley/services.json` and the old texts).
  Checked live on 2026-09-30: `/beethoven/services.json` carries all eight keys, `report` included;
  `/beethoven/admin.html` and `/beethoven/vscode/` answer 200. (e) **Framework 7** (the browser
  edition's cluster-side tool): the lab folder moved from `/rs/rs_grp_oschome/shared/ashley` to
  `/rs/rs_grp_oschome/shared/beethoven` with a relative link left behind, and the shared copy is
  `shared/beethoven/hpcworker/current -> v7` (the record is in that repository's
  `framework/README.md`). Read-only check this pass, as go2432: `shared/ashley -> beethoven`,
  `~/.ashley -> .beethoven` (both made at 02:29 grid time), `~/.beethoven/bin/VERSION` 7, the links `ashley`
  and `ashleyd.js` beside `beethoven` and `beethovend.js`, `current -> v7`. (f) **The key-prefix switch:** `KEY_PREFIX` in `tools/intake/wrangler.toml` (`ashley`
  today) chooses what the access service signs, `--prefix` does the same in the vendor tool;
  Beethoven for VS Code 4.0.0 and grid scripts 7 verify both prefixes, the browser edition's next
  build (8.0.0) verifies `BEETHOVENREV1` as well, and its redaction now labels `BEETHOVEN1.` and
  `BEETHOVENREV1.` tokens like the old ones. Flip it only after every build older than Beethoven for
  VS Code 4.0.0 and Beethoven 8.0.0 is retired. (g) **Approvals by e-mail** (commits e9d17fb and
  05efbf6): each access request is e-mailed to the maintainer through Resend (`NOTIFY_TO`
  go2432@wayne.edu, sender `Beethoven access <onboarding@resend.dev>` until the domain is verified)
  with a signed, one-use Approve and Deny link (HMAC with `DECIDE_KEY`, 14 days; opening a link only
  shows the question, the button decides); the same code runs under two Worker names,
  `beethoven-access` and `ashley-service`, with the same KV, the same eight secrets and the same
  `ip_salt`; `admin.mjs notify-test` answered `sent: the provider answered 200` through both
  (`tools/intake/README.md`, "Requests by e-mail"; `ACCESS_CHECK.md`). (h) **Checked in this pass:**
  `npm run typecheck` clean; `npm run test:unit` 64 tests, 57 pass, 7 skip on Windows (container
  only), 0 fail; `npm run test:vscode` 17 passing on the first run both times it was run (the known
  flake did not appear); `node --test tools/intake/worker.test.mjs tools/license/vendor.test.mjs` 27
  pass. Manual rebuilt (`docs/manual.html` 256 KB, `docs/manual.pdf` 909 KB, and the copy in
  `extension/media/manual.html`, byte-identical): its title is "Beethoven for VS Code", and each of the
  56 lines that still contain "ashley" is a migration note or a kept name. Release rebuilt and signed
  (`BEETHOVEN_VENDOR_DIR=/c/Users/grego/.beethoven-vendor node tools/release.mjs`): `release_check` 0
  problems, `beethoven-4.0.0.vsix`, 32 files, SHA-256
  `2df9952557df76a072727a4cee938bd320fbf52cda4ac35f74af12aa4ce3574b`, `SHA256SUMS` signed by `k1`,
  `verify-release` ok (6 files); the manual inside the VSIX is byte-identical to `docs/manual.html`.
  In the browser edition's repository: the redaction rule and its test (`npx vitest run`: 19 files,
  158 tests, all pass; `tsc --noEmit` clean; no package rebuilt, 7.0.0 stays frozen), the reference
  copy of `services.json` updated from the live file (it gained `report`), and its documents' present-
  tense mentions of the VS Code edition, the lab folder and the sign-in folder brought up to date.
  (i) **Still open, for the maintainer:** review and commit both repositories and push them
  (`tools/push_org.sh`); upload 4.0.0 as the new Marketplace item and retire the old one
  (`docs/MARKETPLACE.md`); rename the two Desktop folders; delete the personal GitHub copies. The
  "Open" and "How to continue" sections below were written for 3.0.0 and are kept as they were: read
  `ashley` there as `beethoven` (the old names still run, as links and aliases), and the items that
  name `docs/site/` are now the site repository's. How to continue now:

  ```
  export PATH=/c/Users/grego/tools/node22:$PATH             # Git Bash
  cd C:/Users/grego/OneDrive/Desktop/ashley/extension       # beethoven-vscode once renamed
  npm run typecheck && npm run test:unit && npm run test:vscode
  python -X utf8 ../docs/manual/build_manual.py             # after any change to the manual's sources
  BEETHOVEN_VENDOR_DIR=/c/Users/grego/.beethoven-vendor node ../tools/release.mjs
  wsl -e bash -lc 'bash /mnt/c/Users/grego/OneDrive/Desktop/ashley/tools/push_org.sh'
  ```

  Grid scripts: copy `grid/*` (CR stripped) to `~/.beethoven/bin/`, then
  `~/.beethoven/bin/beethoven install` and `beethoven worker restart --name <w>`.

### What version 3 changed (pass 18)

- **Pass 27 (2026-09-29 night): Ashley Bridge 5.0.0, the lab's shared copy of the tool; PATH block; repos and
  releases.** (a) OnDemand's terminal could not find `hpcworker` (the login shell `/wsu/bin/wsush` reads `.bashrc`;
  the install only printed a hint): framework 4 writes one managed PATH block into `~/.bashrc` on install
  (default location only; `--no-shell-path`), tested; Greg's account refreshed and a fresh login shell finds it.
  (b) Greg's design ("Claude Code is the gas, the Ashley code is the car"): **framework 5** adds a shared mode:
  the lab keeps one read-only copy at `/rs/rs_grp_oschome/shared/ashley/hpcworker/current` -> `v<N>/`
  (published with `tools/deploy_shared.sh`: LF/version checks, SHA-256 manifest, ACLs, atomic `current` flip,
  never deletes); `hpcworker install --shared DIR` writes only a launcher (`~/.hpcworker/bin/hpcworker`, tag on
  line 2), a marker (`~/.hpcworker/shared`), the profile and the PATH block; conversion moves an own copy to
  `~/.hpcworker/replaced/<time>/`, refuses while a worker or probe runs; `HPCW_CODE` pins a running chain to its
  `v<N>`; `version` says "5 (shared copy at DIR)". Live at Wayne State: v5 published, `current -> v5`, Greg's
  account converted (profile kept). The **extension 5.0.0** reads `shared_install` from the bundled site profile,
  runs `bash <shared>/bin/hpcworker install --shared <shared> --profile wayne` through the portal shell (no
  upload), treats marker+launcher as the lab's copy (never outdated), falls back to the per-user upload when the
  shared root is unusable (exit 3 / 126 / 127), Details shows "tool: shared copy, version 5 at ..."; e2e on the
  mock: shared mode to online with 17 OK, upload mode to the install result. Agreement **v5** (the Framework may
  be the lab's shared copy; section 17 says how each is updated; TERMS_VERSION 5), privacy statement **v6**;
  `.gitattributes` keeps LF (deploy_shared.sh and the tests refuse CR). 153 extension tests, 120 framework tests;
  AMO rebuild from the sources zip: 30/30 files identical. (c) **Repos**: the organisation's private copy
  https://github.com/OpenSpineConsortium/ashley-bridge (created by API with WSL's stored GitHub credential; the grid
  token has no org rights; `tools/push_org.sh`) mirrors GregorySchwing/ashley-bridge; releases v4.0.0 and v5.0.0
  on both with chrome/edge/firefox/safari/sources zips + SHA256SUMS (also `release/<version>/`); README has the
  developer build and release steps (`npm run zip:all`); `docs/store/TEST_BEFORE_UPLOAD.md` per browser. Edge takes
  the Chromium zip (edge.zip == chrome.zip); safari.zip is converter input only. (d) **Facts for Greg**: students
  must be in group `oschome` (members today: ab5188, go2432) before either mode works at Wayne State, and the image
  folder `containers/claude-node22` carries group `wsu`; `shared/ashley` is group-writable; an unpacked 4.0.0 on a
  converted account would upload its own copy over the launcher (use 5.0.0); the worker showed "stopped by request"
  at 20:21Z (not by the tooling; unexplained). Open: a browser run of 5.0.0 against the live portal (does the Files
  app read `current/VERSION` through the link?), a real job from the shared copy, Firefox e2e, the seen: records'
  TTL, `/allowlist` still public for Ashley VS Code 3.0.0, k1.pem unencrypted, Safari, store accounts.
- **Pass 26 (2026-09-29 evening): Ashley Bridge 4.0.0, no licence keys; the worker needs nothing on the laptop.**
  Greg's decision: "the user name to key complexity should be completely removed"; the portal sign-in identifies
  the person and the approved-AccessID list authorises. Built and proven: (a) **access service** `POST /access_check`
  (worker.js; text/plain or JSON body `{v,access_id,portal,product,version}`; CORS `*` + OPTIONS; records
  `seen:<product>:<account>` with a salted IP hash; 120 checks/account/day; the list itself never returned; Ashley
  VS Code 3.0.0 routes untouched; deployed; `services.json` gained `access_check`; `request.html` prefills
  `?access_id=`); (b) **extension 4.0.0** (`src/licensing/access.ts`: services.json cached 24 h, approval cached
  24 h with 7-day grace, a no kept 10 min, request only after the acceptance record; identity only from the
  dashboard, `document.cookie` nowhere, a hygiene test greps for both; Access card, "Ask for access" button; check 1
  "Access approved for <account> at <portal>"; the reviewer key, paste box, site keys, `identity.ts`, `license.ts`
  removed; 133 tests; both manifests: storage/alarms/scripting/activeTab(+sidePanel), optional `https://*/*`,
  Firefox `data_collection_permissions {required:["personallyIdentifyingInfo"]}`; AMO rebuild of the sources zip is
  SHA-256 identical); an agent's end-to-end against the mock portal and the REAL service: st1234 (approved) reached
  online with 17/17 checks, zz9999 (not approved) stopped at "Ask for access" with the request page prefilled and no
  job; e2e logs in `extension/store-assets/e2e/`; three defects fixed on the way (a missing dashboard name fell back
  to the home directory's owner as identity; a `<details>` render loop made ~10 portal requests/s; a 10 s fetch
  limit tripped on cold DNS, now 30 s). (c) **Texts**: LICENSE v4 (section 3 approval and withdrawal, section 10
  what Licensor receives), PRIVACY v5, TERMS_VERSION 4; store kit and landing page for 4.0.0; `docs/TESTERS.md`
  (no key; ask for access; after it connects nothing on the laptop is needed). (d) **Framework 3**: seven-day
  resume window (was 4 h), stable session name `<site>-<run>` (was `<site>-<job>`), `email_domain` dropped with a
  tolerant loader; installed on the grid (profile kept). (e) **Revocations**: L-kBUmEepmm5D8 (tester site key),
  L-Dw8z5-3R4RAK (store-reviewer key), L-GarA16i3MWkb (3-day mock key) revoked and published (`/revoked` lists 6);
  vendor tool lost the site edition and `--domain`; `grid/license.js` refuses domain keys (reaches installs with
  the next Ashley VSIX). (f) **Laptop-off property, observed**: `hpcworker worker start` over ssh with no browser
  started job 40504883 on mdt7, registered `wayne-40504883`, environment
  `https://claude.ai/code?environment=env_01CgWERV6rm8gb61NvaBcn9s`, successor 40504887 queued (afterany); earlier
  today the chain 40501099 -> 40501175 rolled over with `--continue` and kept its session name. Nothing on the
  laptop is part of the running worker; the portal is needed only to start, stop or restart the chain. Not yet
  observed: a reopen from claude.ai after the successor takes over (8 h wall time), and a Firefox end-to-end run.
  Live: pages (privacy v5, agreement v4, "After it connects"), `services.json` with `access_check`, the prefill.
  Tester package 4.0.0 on the Desktop (no key). Open: the walk-through recordings (optional); `/allowlist` still
  returns the whole approved list to anyone (Ashley VS Code 3.0.0 depends on it); `request.html` is Wayne-shaped;
  the `seen:` records have no TTL; k1.pem unencrypted; Safari deferred; a human run of 4.0.0 against
  ondemand.grid.wayne.edu before the first store submission.
- **Pass 25 (2026-09-29 afternoon): Ashley Bridge 3.0.0 store kit; pages and kill-list live.** A two-stream
  workflow (site pages + signed kill-list; store listing kit + screenshots), each stream reviewed, found three
  defects in what would have been published, all fixed the same afternoon: (1) the privacy and licence texts said
  no request reaches Licensor before acceptance while the kill-list alarm fetched one minute after install, so
  `refreshKillListNow` now refuses without an in-force terms record and the background fetches when the record
  is written (true by construction); (2) `LICENSE.txt` v2 still described an access-service activation ping,
  error reports and a Licensor-held acceptance record that Bridge never had, so **LICENSE.txt is version 3**,
  `TERMS_VERSION` 3, `PRIVACY.md` v4 (the other stream's rewrite), README/SECURITY/CLAUDE.md/ARCHITECTURE.md
  brought into line; (3) the screenshots showed the maintainer's scratchpad path (recapture in progress). Also:
  `normaliseOrigin` refuses claude.ai/claude.com/anthropic.com hostnames; the listing sentences "talks to one
  website", "never deletes anything", "payment is required" corrected everywhere; Limited Use sentence without
  the Google APIs clause; **extension 3.0.0** (2.0.0 went to testers with the v2 texts). 134 tests, both
  packaged manifests: storage/alarms/scripting/activeTab(+sidePanel), optional `https://*/*`, Firefox
  `data_collection_permissions {required:["none"]}`. Zips in `ashley-bridge/extension/.output/`
  (`ashley-bridge-3.0.0-{chrome,firefox,sources}.zip`).
  **Live:** `https://openspineconsortium.com/ashley/bridge/` (+ `privacy.html`, `terms.html`) and
  `https://openspineconsortium.com/ashley/bridge-killlist.json` (k1, nothing withdrawn, verified from the live
  download with `ashley-license.mjs verify-killlist`; GitHub Pages sends `access-control-allow-origin: *` on every
  response, 404s included). Signer: `tools/license/ashley-license.mjs sign-killlist` (this repo, 0b2f9be); pages
  regenerate with `ashley-bridge/tools/site_bridge_build.py`; `extension/test/killlist.live.test.ts` is a
  deliberate tripwire (change its two `toEqual([])` when something is withdrawn). Store kit:
  `ashley-bridge/docs/store/LISTING.md` (texts per store, permission justifications, privacy answers, reviewer
  notes with the mock-portal recipe and reviewer key **L-Dw8z5-3R4RAK** for username st1234, to 2027-03-28) and
  `SUBMISSION.md` (click-by-click: Chrome Web Store $5 + 2-Step Verification on the personal Google account,
  Edge Partner Center, Firefox AMO with the sources zip; Safari deferred: Mac + Apple Developer Program, no
  licence keys). Tester package 3.0.0 on the Desktop (`AshleyBridge-3.0.0-tester-package.zip`); the folder
  `Ashley Bridge for testers` also holds an extracted 2.0.0 copy that was not made by the tooling. Still open:
  a human end-to-end run of 3.0.0 against the live portal before the first submission; `k1.pem` in
  `~/.ashley-vendor` signs without a passphrase while SECURITY.md speaks of hardware-key custody; the options
  page's example "such as wayne.edu" and the bundled `profiles/wayne.json` against the university-agnostic
  wording; "Testers: ask Greg for the package" on the public landing page; the two walk-through recordings
  (optional in the reviewer reply); store accounts are Greg's to open.
- **Pass 24 (2026-09-29): tester key and Bridge 2.0.0.** Site (domain) key issued for testers:
  lid **L-kBUmEepmm5D8**, edition site, domain wayne.edu, valid to 2027-03-28, signed with k1, file
  `~/.ashley-vendor/licenses/wayne.edu-L-kBUmEepmm5D8.key`; **revoke it when the pilot ends**
  (`ashley-license.mjs revoke --lid L-kBUmEepmm5D8`, then publish the list). Bridge extension 2.0.0
  honours site keys (profile `email_domain`, else the portal hostname's domain; look-alikes refused;
  a typed name with an @ builds no e-mail). Tester package on the Desktop: `Ashley Bridge for
  testers/` (chrome + firefox zips, tester-key.txt, README). Gmail/Drive connectors are not enabled
  for Claude Code in this session, so upload and e-mail to the tester were left to Greg.
- **Pass 23 (2026-09-29 morning): Ashley Bridge v2 flow.** After Greg's live test of Bridge v1 against
  ondemand.grid.wayne.edu (checks passed except sign-in; three bugs: page script not injected until
  reload, cold-PUN "Server Error", a missing file's 200-HTML page read as a `.restricted` marker), the
  flow was rebuilt: icon click opens the side panel and connects the portal in one gesture; options page
  replaces the popup; one-button strip driven by a step machine (terms -> key -> install/upgrade ->
  probe -> sign-in -> statement -> start -> online -> Open in Claude, automatic where nothing needs the
  student); the Claude sign-in runs inside the panel (`hpcworker claude login --plain`: AUTH-URL opened
  in a tab, one paste box, code never logged); consent marker written on the statement so the worker
  answers Claude Code's question itself (no y, no Ctrl-C, no second command); 15-minute sitting;
  TERMS_VERSION 2 (LICENSE 2 / PRIVACY 3). Framework **2**: line contract, needs/hint, ten-minute probe,
  deterministic stop, version-aware install; deployed to go2432's `~/.hpcworker`. 115 extension tests,
  104 framework tests. Not yet: a human run of v2 against the live portal (Greg reloads the unpacked
  build from `ashley-bridge/extension/.output/chrome-mv3`). Greg re-signed in on the grid at 05:02 with
  his Google-linked Claude account (Max); Ashley's phone host is up again
  (env_01BSwGFbdvjXwTG56B86GYnm). The remaining manual act, by design: Anthropic's paste-code login.
- **Pass 22 (2026-09-29, night): Remote Control proven from a batch job; Ashley Bridge built; the
  22:34 deletion.** (a) Greg completed `ashley claude login` on the grid (Max plan) and answered
  Claude Code's Remote Control question; Ashley's phone host in worker job 40496445 (asx15) then
  registered from `sbatch` under a pseudo-terminal: `https://claude.ai/code?environment=env_01XzAN32jsbL8W1PAFSvitBt`.
  Claude Code records that answer itself (`remoteDialogSeen: true` in its `.claude.json`); grid
  scripts **v6** read it (marker file is the fallback) and `ashley claude login` asks the question in
  the same sitting (no separate `remote-consent`). (b) At **22:34 local** the whole `~/.ashley` folder
  on the grid was deleted while a Remote Control session spawned from the phone was open; the login,
  config, license copy and grid tokens went with it. Not `ashley uninstall` (the .bashrc block and the
  worker job survived), not the build agents (transcripts searched), not the new framework (no such
  code path); the session's own record was inside the deleted folder. Restored by hand (scripts,
  `config.env`, `license.key`, `READY`); **Greg must sign in again** (`ashley claude login`, one
  sitting) and re-run the wizard's Install step for the GitHub/HF tokens on the grid. Guard added:
  `ashley uninstall` and `claude forget` refuse under `CLAUDECODE`/`ASHLEY_REQUEST_ID`/`ASHLEY_WORKER`
  or without a terminal. (c) Deep research (six notes + report `docs/research/reports/Browser
  extension HPC Claude worker.md`) rejected the two prior PDFs' claude.ai-interception design
  (Consumer Terms) and specified: Remote Control as the surface; a portal-origin-only browser
  extension over Open OnDemand (Shell WebSocket bootstrap, Files JSON mailbox, Active Jobs); a
  six/eight-call scheduler adapter; no cookies/claude.ai permissions; signed kill-list. (d) Built as
  **Ashley Bridge** in `C:\Users\grego\OneDrive\Desktop\ashley-bridge` (private GitHub
  `GregorySchwing/ashley-bridge`): `framework/` (hpcworker CLI, Slurm live-tested on the grid with
  probe + worker jobs, PBS/LSF fixture-tested, always-on self-renewing chain, one-sitting login,
  destructive-command guard, 54+ tests), `extension/` (WXT, Chrome/Edge/Firefox builds, mock
  OnDemand portal, 72 tests, Open-in-Claude button, auto-start setting, Google Drive step),
  documents (README, ARCHITECTURE, DIAGNOSTICS, OPEN_QUESTIONS, STORE_LISTING, WAYNE_STATE_PILOT,
  agreements). Two build rounds with adversarial reviews; remaining minors listed in that repo's
  checkpoint section of README. Not yet: a human load-unpacked run in Edge against
  ondemand.grid.wayne.edu; kill-list document not published; Safari untested.
- **Marketplace (pass 21, 2026-09-28 evening).** Publisher `openspineconsortium` created under the
  personal Microsoft account gregoryamdg@gmail.com (verified-domain badge impossible before
  2026-12-21: the domain is 3 months old and the rule is 6 months for both the domain and the
  listing). A new Azure DevOps organization now requires an Azure subscription, so no PAT yet:
  `ashley-3.0.0.vsix` was uploaded through the web management page; **PUBLISHED**: validated and public at
  2026-09-28 20:24 UTC (https://marketplace.visualstudio.com/items?itemName=OpenSpineConsortium.ashley;
  `code --install-extension openspineconsortium.ashley`). Updates: the next integer version's VSIX
  through the management page (**...** -> Update) until an Azure DevOps PAT exists.
  Publisher logo: the folder `OpenSpineConsortium-logo` on the Desktop (VS Code blue tile, white
  Ashley mark; scratch source in the session scratchpad `logo/`).
- The grid worker that hosted the phone sign-in relay ended with its wall time; the Claude sign-in on
  the grid is still not done. Restart: `ashley worker start` then `login_relay.sh start`.
- **Access service DEPLOYED (pass 20, 2026-09-28 ~19:25 UTC).** Cloudflare account: go2432@wayne.edu
  (account id 66f368d9f6e408c98d7f0547bcd94303; wrangler OAuth login on this laptop and in WSL, config
  `~/.config/.wrangler/config/default.toml`). Worker `ashley-service` at
  `https://ashley-service.openspineconsortium.workers.dev` (subdomain `openspineconsortium`). KV:
  TRIALS 328006d0894d4b45be7fb5e7becaec62, REPORTS 1af1580f28a248e7b51b084df7d40955, ACCESS
  d0604151a4c3417a8c372becb4e6a984. Secrets set: TRIAL_KEY_PKCS8_B64, TRIAL_KID, ADMIN_TOKEN (copy in
  `~/.ashley-vendor/admin_token`), IP_SALT; GITHUB_TOKEN/GITHUB_REPO not set (requests are stored, no
  issue opened). `docs/site/services.json` filled; site pages pushed and served at **https://openspineconsortium.com/ashley/** (the github.io address 301-redirects to the custom domain over plain http, so every address in the extension, the Worker's SITE_ORIGIN and the docs now uses openspineconsortium.com).
  Tools: `tools/intake/deploy.sh` (idempotent; run from WSL with `~/node22/bin` on PATH: the Windows
  network path times out against Cloudflare's API), `register_subdomain.sh`, `admin.mjs`
  (list/add/approve/deny/remove). go2432 added as approved.
- **Grid etiquette (C&IT e-mail, 2026-09-28, pass 19).** A 6.9 GB Apptainer `rootfs-*` from a
  build run on warrior sat under `/tmp` there; removed (91 % -> 63 %). Now enforced: `bootstrap.sbatch`
  refuses outside a Slurm job and keeps temp and cache on the compute node's local disk with a trap;
  the worker template points the runtime's temp/cache at its `/dev/shm` scratch; `cmd_diag_node`
  refuses off a job; new diagnostic `grid.login-tmp` (finds and removes leftovers; feature rule
  `grid_etiquette`). Grid scripts **version 5**, deployed to go2432; the running worker (started under
  v4) keeps hosting the sign-in relay until its wall time ends. `CLAUDE.md` added to this repo;
  `docs/MAC.md` (continuing on a Mac; the Xcode route = CLI + MCP server, first verify Xcode 26.3's
  MCP registration); the dataset repo's CLAUDE.md carries the same grid rule. One VS Code suite run
  failed two gate tests by timeout while a push and a grid deploy ran in parallel; two later runs
  passed 14/14 and the cause was not established.
- **Two agreements, one dialog.** `LICENSE.txt` is the free **Trial Edition** agreement (terms
  version 4): approved Wayne State AccessIDs only, no payment, converts to nothing, withdrawable, may
  end with 30 days' notice. `LICENSE-FULL.txt` is the **Full Edition** agreement (fees, 14-day refund,
  outage extension); the same signing dialog shows it when a non-trial key is registered
  (`licenseGate.set` -> `requireFullTerms`; the CLI refuses a full key without `terms-full.json`).
  `core/terms.ts` is edition-aware (`affirmationsFor`, `readTermsRecord(edition)`); the Full Edition
  text names Gregory Schwing trading as OpenSpineConsortium until the LLC exists (then a version bump).
- **Access by approval.** Wizard order: Wayne State sign-in first, then *Access*: Ashley asks the
  lab's access service for a key in the person's name; not approved -> "Ask for access" opens the
  request page. Service addresses come from `services.json` on the support site
  (`ashley.servicesUrl`; settings win). Access service = `tools/intake/worker.js` (Cloudflare Worker,
  12 tests): KV `ACCESS`, `/allowlist`, `/request`, `/trial` (approval required, 365-day keys),
  `/admin/*` (bearer secret: list, approve, deny, add, remove -> revoke + re-sign the revocation list
  with the trial key), `/revoked`; `docs/site/request.html` (students), `docs/site/admin.html`
  (Greg, token in sessionStorage), `services.json`. Bundled `allowlist.json` (go2432 only) is the
  fallback while no service is configured.
- **Click-to-fix.** Tree rows for tokens (missing / expired: click to renew), Claude on this laptop,
  Claude on the grid, Wayne State sign-in; commands `ashley.renewToken`, `ashley.claudeLocalSignIn`,
  `ashley.wsuSignIn`; diagnostic nodes carry `fixCommand` and the troubleshooter shows the button.
- **Sandbox kit** `tools/sandbox/` (Windows Sandbox, nothing but VS Code; `make_wsb.py`,
  `bootstrap.ps1` with hash-checked installer, `enable_sandbox.ps1`, README). Not yet run: the
  feature is not enabled on this machine (needs admin + restart).
- **Marketplace:** `pricing: Free`, `docs/MARKETPLACE.md`, `tools/publish_marketplace.sh` (PAT via
  `VSCE_PAT` from `~/.ashley-vendor/vsce.pat`). Publisher `openspineconsortium` not created yet.
- **Grid sign-in from a phone:** `grid/login_relay.sh start|screen|send <file>|stop` runs
  `claude auth login` in tmux inside the worker allocation (socket under /dev/shm); a session was
  started on asx1 and is waiting for Greg's code.

### What version 2 changed (passes 13 to 17)

- **13: licensing.** Ed25519 keys (`grid/license.js`, one implementation for extension, CLI, MCP
  server, daemon); issuer `tools/license/ashley-license.mjs` (init, issue, list, revoke, verify,
  export-key, sign-release, verify-release); vendor folder `~/.ashley-vendor` (release key `k1`,
  trial key `trial`, ledger); Greg's license `L-02dodeGmoygG` (lab, to 2027-09-28) in
  `~/.ashley-local` and on the grid. Gate: `licenseGate.ts` (every command; identity = the Wayne
  State sign-in; status-bar item), daemon `checkLicense` (refuses work, heartbeat `license`),
  `ashley worker start` refuses without a key. Revocation list bundled (`extension/media/revoked.txt`)
  and fetched daily from `ashley.licenseRevocationUrl`. First-run terms dialog (`terms.ts`) with the
  opt-out error-report choice. Trial request through `ashley.licenseServiceUrl` (Worker).
- **14: the compliant credential path** (`docs/research/reports/Ashley terms of service
  constraints.md`, 5 researchers + verification). Anthropic's Claude Code terms forbid third-party
  tools from collecting or storing Claude credentials; v1 captured `setup-token`. Now: the student
  signs in to Claude Code on the laptop (checked with `claude auth status`, step 5) and once on the
  grid (`ashley claude login` = `claude auth login` inside their allocation in the container, step
  12); Claude Code stores its credential in `~/.ashley/claude`; the daemon points every process
  there, strips all six credential variables, reads only `claude auth status` (heartbeat
  `claude_login`, fs.watch on the credentials file), refuses prompts when not signed in. Phone
  access uses the same login; the student answers "Enable Remote Control?" in
  `ashley claude remote-consent` (marker file); no code relay; never logout. Legacy tokens deleted
  on upgrade (keychain, `accounts/*/token`, `grid.accounts` repair). Lab access no longer requires
  a grid Claude token; the laptop requires a subscription sign-in in Claude Code.
- **15: error reports and the maintenance pipeline.** `core/diagReport.ts` (scrubber, tests),
  `vscode/diagShare.ts` (send only if `ashley.diagnostics.share` on AND VS Code telemetry on AND an
  endpoint configured; one per signature per day; every report kept locally; `Ashley: Error
  reports`). Vendor side `tools/intake/` (Cloudflare Worker: /trial via Microsoft Graph identity,
  /report to GitHub issues, /revoked) and `.github/workflows/triage.yml` (claude-code-action on
  Greg's own API key, write-access trigger, draft PR on `claude/`, label `ai-generated`,
  `Assisted-by` trailer). Repo baseline: `ci.yml`, CODEOWNERS, PR template, dependabot,
  CONTRIBUTING, `docs/ENGINEERING.md`, SECURITY, PRIVACY.
- **16: release.** `esbuild --production` (readable, no maps, notice banner, test key excluded),
  `tools/third_party_notices.mjs` (13 packages, all permissive), `tools/release_check.mjs` (zip
  reader; refuses maps, fixtures, test key, copyleft, wrong licence field, run-time code
  construction outside two known dependency uses, any setup-token string), `tools/release.mjs`. Extension renamed (APPM 10.12). Docs: LICENSE.txt v2.0
  (21 sections per the report's clause spec), PRIVACY.md, LICENSING.md, ANTHROPIC_REQUEST.md,
  manual (34 pp, 12-step table, new wizard figure via `tools/wizard_figure.py`), ARCHITECTURE,
  DIAGNOSTICS (45 nodes), README, CHANGELOG.
- **17: terms version 3, the signing dialog, and the listing.** Second deep-research report
  `docs/research/reports/Ashley liability shield and Marketplace.md` (Checklist A: 32 clause and
  dialog items; Checklist B: 22 outside-the-software items). Implemented: `LICENSE.txt` v3, 23
  sections; disputes go to Michigan courts after a signed 60-day notice-and-cure (condition
  precedent), individual claims only (stand-alone severable class waiver), small claims where the
  student lives, a separately headed jury waiver (s. 20), one year for contract and warranty claims
  only, mutual reasonable fees, exclusive remedy, cap = greater of 12 months' fees or $100, 14-day
  refund on request, outage extension instead of refunds, E-SIGN consent (22(f)), state riders (NJ,
  CA 1670.8/CLRA/17500.6, TX, MA), age 18 with parent acceptance. **No arbitration** (the AAA cost
  floor exceeds the MCPA class ceiling at this scale; `docs/legal/ARBITRATION_OPTION.md` keeps the
  clause and the threshold; the opt-out command was removed). Dialog (`core/terms.ts`,
  `vscode/termsPanel.ts`): scroll-to-end or "Open in editor" counts as reading, "Save a copy", four
  un-prechecked boxes whose exact labels are recorded (agree-by-button, dispute terms, known risks,
  age and own accounts), typed name, error-report choice, button **"Accept and Continue"**; the
  record (`~/.ashley-local/terms.json` + the texts) is what the daemon, MCP server and CLI gate on;
  `laptop.terms` diagnostic node ahead of `laptop.license` (46 nodes). Listing readiness:
  `pricing: "Trial"`, homepage/bugs/qna on the consortium site, `telemetry.json`, untrusted-workspace
  description, README "What Ashley accesses and does", absolute links; production bundles readable
  (unminified) with no source maps, because the Marketplace's scanners have pulled minified
  extensions. Site pages (`docs/site/`, `tools/site_build.py`) copied to
  `openspineconsortium.github.io/ashley/` and staged there, not committed: the support page still
  carries the notice-address placeholder.

### Tests (all run today)

| Suite | Result |
|---|---|
| Laptop unit tests | 49 pass, 7 skip on Windows (container-only) |
| VS Code integration (`--label unit`) | 14 pass (terms both editions, gate, license, graph rule, commands); 47 nodes |
| Access service (`node --test tools/intake/worker.test.mjs`) | 12 pass |
| Packaged extension (`--label package`, unpacked release) | 4 pass (release-key check with a one-day trial key, revoked afterwards) |
| Live troubleshooter (`--label live`) | pass; license nodes green on laptop and both workers |
| Inside the lab container on asx1 (`tools/grid_tests.sh`) | 17 of 17 |
| Release check + signed checksums | pass; signature by k1 verified |

### Open

0. **Greg, in this order:** (a) send the grid sign-in code (open the link Claude printed, on the
   phone; Authorize; paste the code here); (b) enable Windows Sandbox once as admin
   (`tools\sandbox\enable_sandbox.ps1`), restart, `python tools/sandbox/make_wsb.py`, double-click
   the `.wsb`, read `sandbox-report.txt`; (c) Cloudflare: `wrangler login`, KV namespaces, secrets,
   `wrangler deploy` per `tools/intake/README.md`, then fill `docs/site/services.json`, add the
   notice address to `support.html`, publish the site (pages are staged in
   `openspineconsortium.github.io/ashley/`, not committed); (d) Marketplace publisher
   `openspineconsortium` + PAT, then `bash tools/publish_marketplace.sh` (`docs/MARKETPLACE.md`).

1. **Greg:** `Ashley: Sign in to Claude on the grid` (or `ssh -t wsu-grid ~/.ashley/bin/ashley claude
   login`), then `Ashley: Phone access` (asks him to answer Remote Control's consent in a terminal).
   Then a first prompt through a worker. The Wayne State sign-in in the university tenant.
2. **Deploy the intake Worker** (`tools/intake/README.md`) and set `ashley.licenseServiceUrl`,
   `ashley.diagnostics.endpoint`, `ashley.licenseRevocationUrl` defaults before the student release.
3. **Written answers before paid keys:** Anthropic (`docs/ANTHROPIC_REQUEST.md`), WSU OTC, counsel
   (licensor entity, Tenet clause). Commercial build/test off the Grid.
3a. **Before the first paid key or the public listing (Checklist B of the second report):** the
   notice address on `docs/site/support.html` (replace the placeholder, rebuild, publish the site:
   the pages are staged in `openspineconsortium.github.io/ashley/`); an LLC as licensor (then
   "Gregory Schwing, trading as OpenSpineConsortium" becomes the entity and `TERMS_VERSION` bumps);
   E&O/cyber insurance; copyright registration of the bundle; Michigan 6 % sales tax on prewritten
   software (or a merchant of record such as Paddle, which also gives the checkout disclosures);
   EAR self-classification (5D992 mass-market note / ECCN NLR) for the SSH and signature code;
   WSU conflict-of-interest disclosure; the workflows in branch `workflows-pending` need a GitHub
   token with the `workflow` scope; deploy the intake Worker; then `vsce publish` under the
   `openspineconsortium` publisher with the same first-run dialog (the Marketplace records no
   acceptance; the dialog is the assent).
4. GitHub plan: branch protection and CODEOWNERS enforcement on a private repo need Pro;
   `tools/repo_settings.sh` not written; apply by hand in Settings when the plan allows.
5. Status calls still open one ssh each (relay routing planned); the claude-swap next-release plan
   (usage meter) unchanged.

### How to continue

```powershell
$env:Path = "C:\Users\grego\tools\node22;" + $env:Path
cd C:\Users\grego\OneDrive\Desktop\ashley\extension
npm run typecheck; node esbuild.mjs --tests; node --test "dist-test/unit/**/*.test.js"
npx vscode-test --label unit; npx vscode-test --label live
$env:ASHLEY_PACKAGED_EXT="..\dist\unpacked\extension"; npx vscode-test --label package
bash ../tools/grid_tests.sh                       # Git Bash: 17 tests in the container
$env:ASHLEY_VENDOR_DIR="C:\Users\grego\.ashley-vendor"; node ../tools/release.mjs
node ../tools/license/ashley-license.mjs issue --access-id ab1234 --name "A. Student" --email ab1234@wayne.edu --edition student --days 365
```

Deploy grid scripts: copy `grid/*` (CR stripped) to `~/.ashley/bin/`, then `ashley worker restart --name <w>`.
Push: `bash tools/push_via_grid.sh`.

---

History follows (version 1: passes 1 to 12).

## Version 1 state (superseded by version 2 above)

Version 1.0.0 of the extension, grid scripts version 3, installed in Greg's VS Code
(`dist/ashley-wsu-1.0.0.vsix`, 27 files, 1.64 MB) and deployed to his grid account. Workers
`default` (job 40486902, 6 h) and `peer` (job 40486904, 2 h) run on asx1 from the version 3 template.

### Passes 8 to 12 (after the seventh pass below)

- **8 (committed a2e1f69):** access requests as held Slurm jobs; wizard v2 (Sign in with Wayne State
  first, accounts before the grid, strict order, Renew updates the grid); phone access.
- **9: troubleshooter.** `core/diagnostics.ts` engine, `vscode/diagNodes.ts` graph (42 nodes),
  `vscode/diagnosticsUi.ts` (status bar, panel, Show log, Investigate with Claude, hourly sweep),
  grid `ashley diag`/`diag-node`. The pre-integration rule is a test: `REQUIRED_BY_FEATURE` in
  `vscode-test/extension.test.ts`, which also exports `docs/diagnostics_graph.json`;
  `tools/diag_doc.py` writes the tables in `docs/DIAGNOSTICS.md`.
- **10: claude-swap study** (`docs/research/claude_swap_notes.md`). Five v1 defects fixed: shared
  session history across one person's accounts (measured on 2.1.283: `--resume` from another config
  folder says "No conversation found"); one phone host (mkdir lease); all six credential variables
  removed; phone onboarding seed; one subscription per person (`add-token` refuses a second).
  The container run of the new phone tests found a crash in the phone handlers: fixed.
  Next-release plan (usage meter from `rate_limit_event`, read-only cswap cooperation): section 5.
- **11: dependency study** (`docs/DEPENDENCY_MAP.md`, 370 entries). Confirmed and fixed: quoted `~`
  made a literal `~` folder (first install on a fresh account would fail; the empty folder in
  Greg's home was removed); `squeue -u '$USER'` returned nothing; workers had no Slurm or `ashley`
  inside the container (now bound in, self-tested, node `grid.slurm-in-worker`); MCP re-registration
  refused on upgrade (now remove then add); SSH block captured the student's global lines (now ends
  with `Match all`; Greg's block rewritten, login checked); library purpose cut at commas; token
  capture could truncate (chunking, hard wraps); ssh/scp resolved from PATH; untrusted workspaces.
- **12:** `ashley worker restart` re-renders the job from the current template (settings saved in
  `<worker>/params`); manual rebuilt (32 pages); changelog; fixtures out of the VSIX.

### Tests (all run today)

| Suite | Result |
|---|---|
| Laptop unit tests (`node --test` over `dist-test/unit`) | 31 pass, 5 skip on Windows (phone) |
| VS Code integration (`npx vscode-test --label unit`) | 7 pass |
| Live troubleshooter (`npx vscode-test --label live`) | pass; 5 root causes, all from the isolated test profile |
| Inside the lab container on asx1 (`bash tools/grid_tests.sh`) | 12 of 12 pass |

### Open

1. Greg only: the Claude *Authorize* click (then the grid token check and a real prompt through a
   worker), the Wayne State sign-in in the university tenant, a phone sign-in with a real code, a
   GitHub token, a second student account to confirm the ACLs from the student side, and a
   human run-through of the wizard.
2. Status calls open one ssh connection each; route them over the relay (study entry
   `network.ssh-connection-budget`).
3. Next release (extension 2.0.0, grid scripts 4): the plan in `docs/research/claude_swap_notes.md`
   section 5. Greg's laptop already has claude-swap 0.26.0 in `~/.local/bin`, useful for its step 6.
4. The Remote-SSH caveat in the history below (a second window timing out while an old server ran).

### How to continue

```powershell
$env:Path = "C:\Users\grego\tools\node22;" + $env:Path
cd C:\Users\grego\OneDrive\Desktop\ashley\extension
node esbuild.mjs --tests; node --test "dist-test/unit/**/*.test.js"    # 31 pass, 5 skip
npx vscode-test --label unit; npx vscode-test --label live           # 7 pass; live walks the grid
bash ../tools/grid_tests.sh                                           # from Git Bash: 12 tests in the container
python ../tools/diag_doc.py; python ../tools/depmap_doc.py           # regenerate the diagnostics docs
npm run package; code --install-extension ..\dist\ashley-wsu-1.0.0.vsix --force
ssh wsu-grid "~/.ashley/bin/ashley diag --json"                       # grid truth, node by node
```

Deploy grid scripts by hand: copy `grid/*` with CR stripped to `~/.ashley/bin/`, then
`ashley worker restart --name <w>` (it re-renders from the new template). Push: `bash tools/push_via_grid.sh`.


---

## Seventh pass (Greg, 00:00 to 00:15 local): access is last, one folder, no private builds

- **The shared container is what access gives, not a precondition.** `ashley access requirements`
  no longer requires a built container; it requires a Claude subscription token the API accepts
  (`GET /v1/models` with the OAuth token and `anthropic-beta: oauth-2025-04-20`: 200 valid, 401
  "OAuth access token is invalid"), GitHub and HF tokens that verify, and the bashrc block.
- **The request is wizard step 11 `labAccess`** (last). Its run refuses unless every earlier step
  checks done (API key excepted), the Claude Code and Remote-SSH extensions exist and the bridge is
  registered (registered on the spot if missing), and the grid requirements pass; then a note and
  one request. Its check: admin → done; granted → runs `ashley install` (adopts) → done; pending →
  done "waiting"; denied/removed → failed with the admin's message; none → todo.
  `Ashley: Lab access` for a student runs that step in the panel; for the admin it is the queue.
- **No private builds for students.** `ashley install` with the access system in place marks
  `AWAITING_ACCESS` and builds nothing; `worker start` adopts the lab container once readable and
  otherwise says "it comes with lab access". `--build-own` stays for the admin only; every
  student-facing text, picker and doc mention is gone. Tree: "Waiting for lab access".
- **One folder.** Approval = ACL on `shared/` (r-x + default) and recursively on everything under it
  except `access/`, so later folders are covered. Drop-box ingest accepts only regular, non-symlink,
  small files owned by the user they name; `status/` is 711. Token checks feed curl on stdin
  (sampled the login node's process list during three verify runs: no token visible).
- **The `oschome` unix group**: lives in the university directory (sss; not in /etc/group; no ipa or
  group tool on the grid; `rs_grp_owners` only lists folders), so "administrator of the group" means
  C&IT adds people on Greg's email. The admin page shows who is in the group and drafts that email
  (`mailto:hpc@wayne.edu`, the approved AccessIDs not yet in the group). The ACL gives access at once.
- `setup-token` capture: the panel runs it via shell integration and reads the token from the
  terminal output (untested with a real Authorize click).
- Review workflow `wf_6fed7237-7bf` (security, correctness, operations lenses + verifiers) was running
  at 04:20 UTC; its confirmed findings are to be fixed before the push.
- Commits `e348145`, `8a2b06f` (local; last push `3969234`).

The sixth pass follows.

---


## Sixth pass (Greg's message at 23:45 local)

1. **Campus Wi-Fi**: the Authenticator step now says OnDemand answers from the WSU Wi-Fi on campus or
   the VPN elsewhere; the reachability check is the same.
2. **`claude setup-token` explained and captured.** It is the Claude Code command that mints a
   one-year subscription token after the account holder presses Authorize on claude.ai; only Greg
   can press it. The panel now explains the three moves in plain words and, when the terminal has
   VS Code shell integration, runs the command through `TerminalShellIntegration.executeCommand()`
   and reads its output (`execution.read()`), so the printed `sk-ant-oat...` token is captured and
   stored without copying (`SetupPanel.runCapturing`, `WizardUI.runCapturing`, token pattern no
   longer anchored). Falls back to the clipboard path. Untested with a real approval (needs Greg).
3. **Shared-library access requests, managed on the grid, admin page in Ashley.** Findings: the
   CephFS volume root is owned by go2432 and honours POSIX ACLs (`setfacl` works); Panasas homes do
   not, and Greg's home is traversable only by group `advcomp` (8 members), so the request area lives
   on the volume. `ashley access init` (run 03:53 UTC) set: `/rs/rs_grp_oschome` 2771 (traverse only),
   `go2432/` 2750 (private), `shared/` 2771, `shared/ashley` 2770 (group + approved users),
   `shared/access/{inbox 1733, status 755, requests 700}`. Commands: `access whoami|status|request
   [--note]`, `access admin list|approve|grant|deny [--message]|remove [--message]|reset`. Approve =
   `setfacl -m u:ID:--x` on `shared/` + `setfacl -R -m u:ID:r-X` and default ACLs on `shared/ashley`;
   deny/remove/reset revoke. One request per student until reset. `ashley install` files the request
   itself when the library is not readable, then builds the student's own container so nothing waits.
   Tested as go2432: approve added `user:go2432:r-x` + default ACL, deny wrote the message, reset
   removed both. Extension: command `Ashley: Lab access to the shared library` (admin: queue with
   Approve / Deny / Deny with message / Remove / Reset / direct Grant; student: state or a one-time
   request with a note), an "Shared library access" node in the tree (admin sees the pending count).
   Not simulated: a real second user filing a request (needs another grid account).

The fifth pass follows.

---


## Fifth pass: 2FA setup inside the wizard (Greg's question at 23:40 local)

The QR code has to be scanned from OnDemand in a browser with the phone, so the wizard cannot do
it for the student, but it now owns the path. New step 2 `gridTwoFactor` ("Grid account and
Authenticator"): first question "already have both?"; otherwise a menu that opens the grid account
request page, tests whether OnDemand answers (it only does through the WSU VPN, so that is the VPN
check, `onDemandReachable()`), opens OnDemand for Interactive Apps > 2FA Setup, the C&IT guide with
screenshots, and the Authenticator app for iPhone or Android; "continue" records
`ashley.twoFactorDone`. The check passes automatically when the grid already accepts the key. Step 5
(login in the panel) proves the setup; three rejected logins reset `twoFactorDone` and point back to
step 2. `WizardUI.choose()` (N-button menu) added to the panel and the terminal UI. Docs, figure
(`wizard.svg`, ten steps), walkthrough and the STEPS test updated. Not testable end to end by me
(needs a fresh account and a phone); the menu/VPN logic is unit-free but the extension builds and the
suites pass.

The fourth pass follows.

---


## Fourth pass: the lab's shared container library (Greg's request at 23:00 local)

- `/rs/rs_grp_oschome/shared/ashley/` (group `oschome`, 2775) with `library.json`; first entry
  `claude-node22` published by job 40486583 (`bootstrap.sbatch` with `LIBRARY=1 ROOT_OVERRIDE=...
  LIB_NAME=... IMAGE=... GPU=...`; merges the entry with the container's python3, `chmod -R g+rX`).
- Grid CLI: `ashley library [--json]`, `ashley library publish --name N --image docker://... [--gpu]
  [--purpose ...]`, `ashley adopt [name]` (config.env + READY in a second), `ashley install` adopts the
  default when readable (`--build-own` to opt out), `ashley worker start --container <name>`
  (`worker.sbatch.tpl` carries `@SANDBOX@ @CLAUDE_BIN@ @LIBRARY@`, binds the library root),
  `status --json` reports `container`, `source`, `library`.
- Daemon: every run gets `--append-system-prompt` from `peerNote()`: who the worker is, which peers
  of the account are alive, and the exact `ashley send --worker <name>` / `ashley result` commands, so
  a lead worker can fan out to others (each its own job, possibly a different container).
- Extension: setting `ashley.container` (auto | own | <name>), a container picker in *Start a Claude
  worker*, `GridApi.library()`, the tree shows the shared container. Docs: ARCHITECTURE library
  section, INSTALL "for leads", getting started step 9, LIMITS.
- Access: `getent group oschome` = ab5188, go2432 only. Students must be added to `oschome` by the
  HPC admins (Greg requests with the AccessID); until then the wizard builds in their own space.
- Tested 03:22 UTC: `ashley adopt` -> "adopted shared container 'claude-node22' (2.1.283); nothing
  to build"; `default` (job 40486616) and `peer` (job 40486617) both RUNNING on asx1 with the shared
  container (`W_SANDBOX=.../shared/ashley/containers/claude-node22` in their job scripts), heartbeats
  alive, `claude_version 2.1.283`; a request written from inside default's allocation (`srun
  --jobid --overlap`) into peer's inbox was answered by peer 3.4 s later (srun start-up included; the
  answer is the expected "no enabled Claude account" until Greg's setup-token). Script:
  `docs/research/library_peer_test.sh`, log `docs/research/library_peer_test.log`.
- First publish attempt (job 40486583) failed at `npm install` with ENOENT on the shared path: the
  container bound only the user's own CephFS dir. Fixed (a shared ROOT is bound explicitly);
  job 40486610 published the entry. Greg's account now runs the shared container too (`source=shared`).
- Future entries Greg named: a CUDA/torch container for GPU workers; an R/Bioconductor one; the
  image must run Node 22 (Debian 12 / Ubuntu 22.04+). Worker-to-worker messaging with live Claude
  needs the setup-token first.

The third pass follows.

---


## Third pass: prompt latency and the relay (Greg's question at 22:40 local)

Measured (Windows laptop, grid clock skew corrected, `docs/research/latency_*.csv`, plot
`docs/figures/latency.png`, script `docs/research/plot_latency.py`):

| Path | Median | Range |
|---|---|---|
| `ssh wsu-grid true` (one connection) | 2.6 s | 2.4 to 2.7 s |
| prompt received by the worker, one ssh per prompt (the first design) | 2.0 s | 1.6 to 2.2 s |
| relay round trip (PING/PONG over the open session) | 20 ms | 18 to 23 ms |
| relay: QUEUED ack back on the laptop | 37 ms | 35 to 43 ms |
| **prompt received by the worker via the relay** | **193 ms** | 53 to 275 ms |
| ssh straight to the compute node through the jump host | 81 s (two samples: 62 s, 101 s; earlier 27 s and 38 s) | the node's sshd, not our config; never on the prompt path |

Decision: switched to the relay everywhere. Design: `ashley relay` (grid CLI, bash `read -t 0.25`
loop) speaks a line protocol (SEND/QUEUED, RESULT/PENDING, PING/PONG, pushed EVENT/RESULT lines);
`extension/src/core/relay.ts` (`GridRelay`) keeps one ssh session per process (extension, MCP
server, CLI), reconnects on drop; `GridApi.send/ask/result` use it when present and fall back to a
fresh ssh. The daemon polls every 250 ms (was 1 s). `ashley-cli latency N` reproduces the
measurement. Direct UDP to the node is impossible (laptop cannot reach compute nodes) and
unnecessary; the remaining time to first token is Claude Code's ~5 s start-up (next lever: a warm
`--input-format stream-json` process per session). Interactive ssh/Remote-SSH remain as before.

Worker now: job 40486562 on asx1 (secp/secondary, 6 h from 02:53 UTC), 250 ms poll.
GitHub: private repository https://github.com/GregorySchwing/ashley created and **pushed** (branch
`main`) with the `repo`-scoped token that lives in Greg's grid environment; the token never left the
grid: the laptop makes a `git bundle`, scp's it to `~/ashley.bundle`, the grid clones it into
`~/ashley-repo` and pushes with an in-memory credential helper (`username=x-access-token`,
`password=$GITHUB_TOKEN`; a bearer `http.extraheader` is refused by git-over-HTTPS). To push again:
repeat those three steps (see the command in the session log or write `tools/push_via_grid.sh`).
Move the repository to OpenSpineConsortium when Greg wants (his grid token is not an org member).

The second pass follows.

---


## Second pass (Greg's feedback after trying the wizard, 2026-09-27 22:06 local)

Feedback and what changed:

| Feedback | Change | Status |
|---|---|---|
| "mirrored into WSL": keep it native | WSL mirror removed entirely (setting, code, docs). Windows OpenSSH only | done, built |
| Token steps should sign in like Claude does, no copy-paste into the command bar | GitHub: `vscode.authentication.getSession('github', ...)` (browser sign-in, token arrives by itself). Hugging Face and Claude token: one copy; the panel watches the clipboard and offers "Use it". Anthropic API key: paste (optional). `claude setup-token` cannot be driven by pipes (prints nothing without a TTY, probed), so it still runs in a terminal; the token is caught from the clipboard | done, built; human run pending |
| "token could not be verified (network: fetch failed)" | a network failure now keeps the token and says it will be verified on the grid; only 401/403 rejects. `ashley verify-tokens` on the grid (curl whoami, names only) runs after the grid install and inside `ashley doctor`; verified HF ok, GitHub ok when present | done, tested on the grid |
| Password in a terminal | in-panel login with the pure-JS ssh2 client (password field, then code field); falls back to the terminal on non-auth failure. `ashley-cli ssh2-probe` proved ssh2 negotiates with warrior (hmac-sha1) using the key; the keyboard-interactive path itself needs Greg's password to test | built; human run pending |
| Terminal log, no animations, layout | new `SetupPanel` webview (`src/vscode/panel.ts`): nine steps with state, progress bar, spinner, inline prompts (text/password/buttons), clipboard detection, toasts, collapsed log, buttons to start a worker / open files / doctor. Used by setup, token replace, grid install | built; human run pending |
| Emulate a from-scratch install | `Ashley: Reset this laptop (emulate a fresh install)` (multi-select: tokens, key+block, settings, MCP registration, grid `~/.ashley` via new `ashley uninstall`, optionally the container with `--purge-root`) plus the `code --user-data-dir ... --extensions-dir ...` recipe in INSTALL.md and the manual | done |
| "unsupported OS" banner | VS Code's FAQ (Greg's PDF, `CTSpinoPelvic1K-1/Remote Development FAQ.pdf`) says the banner and a dialog appear on every such connection and offers no suppression; Ashley explains it once before the first connection; troubleshooting row added | done |
| WSU email for GitHub/HF accounts? | Not enforceable by the extension and it does not simplify token creation, but it helps the lab map people to org invitations; the wizard texts now recommend creating the accounts with the WSU email | done (text) |

Still to do after this pass: a human run of the new panel (Greg), the `claude setup-token` click, screenshots for the manual. The old checkpoint follows.

---


Read this first. It is written so a fresh Claude session, on any account, continues as if
nothing was interrupted. Everything below is on disk; nothing lives only in a conversation.

## The directive (Greg, 2026-09-27, verbatim gist)

"Implement this spec" (the Gemini PDF `CTSpinoPelvic1K-1/WayneStateVSCodeSetupExtension.pdf`,
24 pages: a VS Code extension that collects credentials, opens token pages, writes them to the
environment, sets up SSH through the login node to compute nodes, connects Remote-SSH, and
bridges the local Claude Code to a Claude Code running in a Singularity container on the grid),
plus: deep research on running Claude Code in Singularity on the grid and accepting prompts over
ssh; swapping between multiple Claude accounts when one hits its limit; several compute nodes
each with a persistent Claude session taking prompts from an orchestrator; keep it simple,
reliable, low latency. "Don't stop until you have a tested extension which every step works and
a manual (html and pdf) and anything else an extension should have including installation
instructions, and a descriptive, persuasive pitch to sell students ... render figures ... what
they can ask, what they can't ask ... the final deliverable should be an extension I can simply
import into vscode or xcode and it will just work ... also generate the documentation and the
source ... you can use my tokens and environment to see what works." Also: use the Remote
Explorer approach for viewing images; review `Student_Projects/` and `STARTHERE.pdf` and make
architectural decisions with that future (the lab recipe, board, Nextflow later) in mind. The
seven prompt files in `CTSpinoPelvic1K-1/openresearch/` give the bigger vision ("Ashley"
organizer, Nextflow, PRISMA lit review); `zeroethprompt.txt` says: step-wise, the wizard first.

Standing preferences: one banned word (see CLAUDE.md); integer version bumps only; captions ≤ 60
words; commit directly (no feature branches); network through WSL when Windows sockets flake;
never run work on the grid login node; scripts are files, never heredocs over ssh.

## Where everything is

| What | Where |
|---|---|
| Repository (git, branch `main`, 3 commits, local only, NOT pushed) | `C:\Users\grego\OneDrive\Desktop\ashley` |
| Built, installed extension | `ashley/dist/ashley-wsu-1.0.0.vsix` (748 KB); installed in VS Code as `openspineconsortium.ashley-wsu` |
| Extension source | `ashley/extension/src/` — `core/` (no vscode import: services, sshConfig, protocol, slurm, shell, wizard, gridApi), `vscode/` (ui, store, tree, mcpRegister), `mcp/server.ts`, `cli/main.ts` + `terminalUi.ts`, `extension.ts`, tests `core/*.test.ts`, `vscode-test/extension.test.ts` |
| Grid-side scripts (source) | `ashley/grid/`: `ashley` (bash CLI), `ashleyd.js` (daemon), `bootstrap.sbatch`, `worker.sbatch.tpl`, `bashrc.block`, `VERSION` — copied into `extension/dist/grid` at build, uploaded by the wizard |
| Docs written | `ashley/docs/ARCHITECTURE.md`, `INSTALL.md`, `LIMITS.md`, `PITCH.md`, this file; `extension/README.md`, `CHANGELOG.md`; walkthrough md in `extension/media/walkthrough/` |
| Deep research output | `ashley/docs/research/deep_research_2026-09-28.json` (clean) and `deep_research_raw_2026-09-28.txt` (workflow wrapper, 2 MB) |
| Node for building (nothing else on the Windows PATH) | `C:\Users\grego\tools\node22` (v22.23.3, portable); WSL also has `~/tools/node22` |
| Memory files | `~/.claude/projects/c--Users-grego-OneDrive-Desktop-CTSpinoPelvic1K-1/memory/ashley-extension-project.md`, `grid-apptainer-module-works.md`, `windows-ssh-to-grid.md` (indexed in MEMORY.md) |
| Local CLI settings used for testing | `C:\Users\grego\.ashley-local\settings.json` ({"accessId":"go2432"}), `secrets.json` (Hugging Face token only) |
| Windows SSH | `C:\Users\grego\.ssh\id_ed25519_wsu` (authorized on the grid), `C:\Users\grego\.ssh\config` has the Ashley block (aliases `wsu-grid` and `grid`, wildcard `*.nas.grid.wayne.edu` with ProxyJump); mirrored into WSL |
| VS Code user settings touched | `remote.SSH.remotePlatform["asx1.nas.grid.wayne.edu"]="linux"`, `remote.SSH.connectTimeout=60` |
| Claude Code MCP registration | user scope, server `ashley`: command `C:/Users/grego/AppData/Local/Programs/Microsoft VS Code/Code.exe` with `ELECTRON_RUN_AS_NODE=1`, args `C:/Users/grego/.vscode/extensions/openspineconsortium.ashley-wsu-1.0.0/dist/mcp-server.js`, env `ASHLEY_GRID=wsu-grid` — status "Connected" |

### On the grid (go2432@warrior.grid.wayne.edu)

| What | Where / value |
|---|---|
| Ashley home | `~/.ashley/` — `bin/` (scripts v1.0.0), `config.env` (ROOT, RUNTIME, SANDBOX, CLAUDE_BIN, BINDS, BOOTSTRAP_JOB=40486353 done), `READY` (json), `secrets.env` (600, HF_TOKEN only), `accounts/` (EMPTY — no Claude credential yet), `sessions/` (empty), `workers/default/`, `log/` |
| Large files | `/rs/rs_grp_oschome/go2432/ashley/` — `containers/node22-bookworm` (1.1 GB Apptainer sandbox), `npm/bin/claude` (Claude Code 2.1.283), `npm-cache/`, `cache/`, `tmp/`, `workspaces/` |
| Probe leftovers (deletable) | `/rs/rs_grp_oschome/go2432/ashley_probe2/` (first probe's sandbox+npm), `~/.ashley/probe1*.json`, `~/.ashley/bin/bootstrap_probe.sbatch`, `~/.ashley/log/ashley_probe1_*.out` |
| Worker | `default` = Slurm job **40486367** on `asx1` (secp/secondary, 4 CPU, 16G, 4 h from 00:33 UTC → ends ~04:33 UTC 2026-09-28), daemon idle, heartbeat OK, processed 1 (an auth-failure test) |
| `~/.bashrc` | carries the `# >>> ashley` block (VS Code glibc sysroot vars + PATH) |

## What is CONFIRMED working (evidence in this session)

1. **Build/test toolchain**: `npm run build` (esbuild bundles extension 65 KB, mcp-server 1.3 MB, cli 38 KB; copies grid/ with LF), `tsc --noEmit` clean, **22/22 unit tests** (`node --test "dist-test/unit/**/*.test.js"`: ssh config, protocol, slurm parsing, token patterns, and the daemon end-to-end with `test-fixtures/fake-claude.js` covering claim/events/result/session resume/rate-limit rotation/all-limited/crash/forced account/heartbeat), **5/5 VS Code integration tests** (`npx vscode-test`: activation, all 15 commands registered, settings defaults, wizard step order, refresh+openManual), `vsce package` → VSIX, `code --install-extension` OK.
2. **SSH from Windows**: needs `MACs +hmac-sha1` (else "no matching MAC found"); `AddressFamily inet` cuts 13.1 s → 2.0 s per connection (IPv6 timeout); the wizard's `sshConfig` step wrote the block and mirrored it into WSL; `installKey` check passes (`ssh wsu-grid hostname` → warrior, BatchMode).
3. **Grid bootstrap** (job 40486353, 7 min on asx1 via secp/secondary): `module load apptainer/1.2.2` builds an unprivileged sandbox from `docker://node:22-bookworm`; `npm install -g --prefix <CephFS>/npm @anthropic-ai/claude-code@2.1.283`; `claude --version` inside works; READY written; `ashley status --json`, `ashley doctor` work on the login node.
4. **Worker daemon**: job 40486367 runs `ashleyd.js` inside the sandbox on asx1; `state.json` heartbeat every 10 s; `ashley worker list/start/stop/log/node` work; a real request travelled laptop → `ashley ask` (stdin JSON) → inbox → daemon → `claude -p` → outbox → laptop in ~14 s total (5 s of it Claude; the rest was the 13 s ssh, now 2 s). With no account the daemon answers `error: no enabled Claude account...` at once.
5. **MCP bridge**: `claude mcp get ashley` = Connected; a real `claude -p` on the laptop called `ashley_status` through the bridge and reported the worker/node/status/version correctly (3 turns, $0.74 shown as cost).
6. **Grid install step from the laptop** (`ashley-cli setup --only gridInstall`): uploads scripts, writes `secrets.env` (600) via ssh stdin, runs `ashley install` (bashrc block, ROOT, bootstrap or "already ready"); the check now compares laptop tokens with grid `secrets`/`accounts` names and re-pushes what is missing.
7. **ProxyJump from Windows to a compute node**: `ssh asx1.nas.grid.wayne.edu hostname` works (1.5 s to authenticate; ~23 s more before the node runs the command, node-side).
8. **VS Code Remote-SSH to the node**: connected once end to end (server installed under the C&IT sysroot, extension host running on asx1); see open item 2 for the timing caveat.
9. **Manual**: `docs/manual.html` + `docs/manual.pdf` (21 pages, 4 SVG figures) built by `docs/manual/build_manual.py`; bundled into the VSIX (`Ashley: Open the manual`). Final VSIX sha256 `B755E72637AE27411F63FBD29F1ADAE1022FEFB8D7A9773AB6D636A3F060B32A` (770 KB, 27 files).

## What is NOT done / open (in priority order)

1. **Live Claude on the grid needs Greg's one click.** `claude setup-token` opens a browser; paste the printed `sk-ant-oat...` token into wizard step "Claude token" (or `Ashley: Store or replace my Claude token for the grid`, or on the grid `ashley accounts add-token default` reading the token on stdin). The copied WSL login failed: "Failed to authenticate: OAuth session expired and could not be refreshed" (8 idle days). Research confirms setup-token is the supported headless credential (one-year token, `CLAUDE_CODE_OAUTH_TOKEN`, not refreshed after 401 → regenerate). Then rerun `ashley ask` end to end and record the real cold/warm latencies in the docs.
2. **Remote-SSH to the compute node: CONFIRMED WORKING 01:15 UTC**, with one caveat. Evidence: `~/.vscode-server/` was installed on the grid and the server log (`~/.vscode-server/cli/servers/Stable-*/log.txt`) shows "Extension host agent started" and "New connection established" (ExtensionHost + Management) at 21:15:03 local on asx1, i.e. VS Code was fully connected to the node through the jump host with the C&IT glibc sysroot from `.bashrc`; the client disconnected gracefully at 21:22 when the next window was launched. Timing: the jump authenticates in 1.5 s but the node's sshd takes ~23 s before running anything (also from warrior, also with `bash --norc`), and the first connection downloads the server on the node, so the first attempt with the 62 s default timed out; retries with the server present succeeded. `commandConnect` now sets `remote.SSH.connectTimeout` to 300 (Greg's user settings already have 300 and `remotePlatform[asx1...]=linux`). Caveat: a further window launched at 21:31 timed out twice at 302 s while the earlier server process (pid 25363) was still running on asx1; not diagnosed (possibly the still-running server/socket under `/rs/.../tmp`, possibly the `-D` port). If it recurs: on the node `pkill -u $USER -f vscode-server` and reconnect, or "Kill VS Code Server on Host" from the Remote-SSH command palette. Read the newest `%APPDATA%\Code\logs\*\window*\exthost\output_logging_*\1-Remote - SSH.log`.
3. **Manual: DONE 01:35 UTC.** `docs/manual/build_manual.py` assembles PITCH + Getting started + ARCHITECTURE (with the SVG figures `docs/figures/{topology,lifecycle,wizard,accounts}.svg`) + LIMITS + INSTALL + Troubleshooting → `docs/manual.html` (pandoc, resources embedded) → `docs/manual.pdf` (Edge headless, 21 pages, figures render as vectors; pages 1 and 7 inspected as PNG) and a copy at `extension/media/manual.html` for `Ashley: Open the manual`. Still missing: screenshots from a human run; a fifth figure for the can/can't matrix (the table stands in).
4. **docs/RESEARCH.md: DONE (generated).** 212 KB, per topic: summary, recommendation, open questions, a findings table with confidence / verdict / source. Generated by the script inline in this session from `docs/research/deep_research_2026-09-28.json` (8 topics, 277 findings; the VS Code topic has 0 verifications, the container topic 13 of 34; 37 verifiers and the critic died on the Claude usage limit). Key verified facts: `-p` exit codes and the JSON `is_error`/`subtype` arms; `--input-format stream-json` envelope; permission modes incl. `--permission-prompts none` (v2.1.259+); `--bare` must NOT be used (ignores the OAuth token); `setup-token` = 1-year token for Pro/Max/Team/Enterprise; sessions at `<CLAUDE_CONFIG_DIR>/projects/<cwd encoded>/<uuid>.jsonl`, `--resume` cross-project since v2.1.223, `cleanupPeriodDays` 30; Anthropic advises against sharing `~/.claude` over network filesystems (our account dirs ARE on the shared home: one worker per account, caveat stated); `claude -p` draws from the subscription (support article 2026-06-16); since v2.1.113 the npm package installs the native Bun binary (Node unused at runtime), Linux floor Ubuntu 20.04/Debian 10, hence the container; VS Code server skips its glibc check when `VSCODE_SERVER_CUSTOM_GLIBC_LINKER` is set and Red Hat bash sources `~/.bashrc` for non-interactive ssh (SSH_SOURCE_BASHRC), so the bashrc block placement is right as long as no `return` guard precedes it.
5. **Extension UX untested by a human**: the wizard's interactive terminal step (`shellPath: ssh` with password + Authenticator code), the "Ask" output channel streaming, the tree view. All code paths are unit/integration tested; the visual run-through is for Greg.
6. **GitHub token**: none on this machine (`gh auth token` empty in WSL), so `secrets.env` has only `HF_TOKEN`. The wizard step works (validated pattern + api.github.com check) but was not exercised with a real token.
7. **Small follow-ups**: `README.md` says the manual/PDF exist (write them or fix the text); delete probe leftovers on the grid; `extension/package.json` `repository.url` points to a not-yet-created GitHub repo; add screenshots to the manual once a human runs it; write a `docs/DEMO.md` (pelvic width demo on 10 records via the worker) once a token exists; consider `secp/secondary` as the worker default if `reqp/requeue` keeps sitting PENDING (Priority) — today reqp pended 30+ min, secp started at once.
8. **Not started (later versions, by design)**: Nextflow integration (the queue is the substrate: `ashley send` from a process, `ashley result` in the next), PRISMA literature pipeline, multi-worker orchestration by a lead Claude (mechanics exist: each worker has its own inbox; a worker Claude can write into another's inbox), the Xcode "port" (= CLI + MCP; research says Xcode 26 agent integration cannot host a wizard).

## Design decisions (so they are not re-litigated)

- File queue on the shared home, not sockets/ports: laptop only ever reaches the login node; daemon runs wherever Slurm put it; survives restarts; debuggable with ls/cat. Latency = ssh (2 s) + poll (1 s) + Claude start (~5 s).
- One worker Slurm job = daemon + the node VS Code connects to. Default 4 CPU/16 G/24 h, reqp/requeue with `--requeue --open-mode=append` (daemon is re-entrant), `--dependency=singleton`, `--signal=B:TERM@120`.
- Accounts = directories = `CLAUDE_CONFIG_DIR`; rotation only among ONE student's own credentials (subscription token first, own API key as overflow); pooling across students is refused on Consumer-Terms grounds and documented as such.
- `ANTHROPIC_API_KEY` is never injected into laptop terminals (it would silently switch the local Claude Code to pay-per-use).
- Sandbox directory, not SIF (SIF→sandbox conversion and missing `unsquashfs` are the known failures on this grid); runtime order apptainer module → conda singularity → module singularity/3.5.2 → /usr/bin.
- Remote-SSH renders images; no X11 by default.
- Xcode: `core/` has no vscode import; `dist/ashley-cli.js` + MCP server are the port.

## How to continue (exact commands)

```powershell
# laptop, PowerShell
$env:Path = "C:\Users\grego\tools\node22;" + $env:Path
cd C:\Users\grego\OneDrive\Desktop\ashley\extension
node esbuild.mjs --tests; node --test "dist-test/unit/**/*.test.js"      # 22 pass
npx vscode-test                                                         # 5 pass
npx vsce package --no-dependencies -o ..\dist\; code --install-extension ..\dist\ashley-wsu-1.0.0.vsix --force
node dist/ashley-cli.js doctor                                          # laptop + grid checks
ssh wsu-grid "~/.ashley/bin/ashley status --json"                       # grid truth
```

Grid worker (if job 40486367 has ended): `ssh wsu-grid "~/.ashley/bin/ashley worker start --name default --partition secp --qos secondary --hours 24"`.

Deep research resume (only if more verification is wanted; 37 verifiers died on the Fable limit):
`Workflow({scriptPath: 'C:\Users\grego\.claude\projects\C--Users-grego-OneDrive-Desktop-CTSpinoPelvic1K-1-openresearch\0599380b-0d32-4e19-b5be-65bdd1017566\workflows\scripts\ashley-deep-research-wf_ea775af4-4e7.js', resumeFromRunId: 'wf_ea775af4-4e7'})` — completed agents replay from cache; transcript dir `...\0599380b-0d32-4e19-b5be-65bdd1017566\subagents\workflows\wf_ea775af4-4e7\journal.jsonl`.

## Key insights from this session (the things that cost time)

1. Windows OpenSSH → grid: `MACs +hmac-sha1` is mandatory; `AddressFamily inet` removes an 11 s IPv6 timeout on every connection.
2. `module load apptainer/1.2.2` on compute nodes builds unprivileged sandboxes from Docker Hub in ~6 min; `~/.local/bin/singularity` stays broken; `/usr/bin/apptainer` also exists on asx1.
3. A copied Claude Code login dies with its refresh token; `claude setup-token` is the only unattended credential. Never pass `--bare`.
4. `claude -p` cold start inside the container ≈ 5–7 s; the JSON result arrives even on auth failure (`is_error: true`, `terminal_reason: api_error`).
5. Node ≥ 22 is required by `@vscode/vsce` 4, `@vscode/test-electron` 3 and Claude Code itself; VS Code's own `Code.exe` with `ELECTRON_RUN_AS_NODE=1` is a Node 24 runtime students already have, and Claude Code accepts it as an MCP server command.
6. The Bash tool eats backslashes in inline JSON/paths (a registration was saved as `C:UsersgregoAppData...`); use forward slashes or spawn with argv arrays (the extension does).
7. Windows `spawn` refuses `.cmd` wrappers without a shell; the daemon accepts a `.js` "claude" for tests.
8. `vscode-test`: activation must never await a dialog; `activate()` must return exports for tests.
9. On this grid, `reqp/requeue` can sit PENDING (Priority) for a long time while `secp/secondary` starts instantly; `sacctmgr` shows QoS max walls primary 30 d, secondary 90 d.
10. PowerShell mangles JSON arguments to native exes; test registration from Git Bash or via Node.

## Research workflow summary (for RESEARCH.md)

Topics: headless-cli (verified), limits-tos (verified), singularity-hpc (verification incomplete), account-swap (verified), orchestration (partly verified), vscode-ext (verification incomplete), xcode (verified), literature-apis (verified). The critic/gap phase did not run (limit). Per-topic `summary`, `findings[]` (claim, detail, source_url, confidence, critical, verdict{refuted, corrected_claim, evidence}) and `recommendation` are in the JSON.
