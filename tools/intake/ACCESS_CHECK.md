# The access check: how Beethoven asks whether an account is approved

Beethoven, the browser extension, has no keys. (Beethoven is its name since 2026-09-29; it was built
as Ashley Bridge before, and its builds still send product `bridge`.) A person signs in to their own
Open OnDemand portal with their university account; the extension reads the account name the portal's
dashboard shows for that session and asks this service whether that account is approved. The answer
comes from the same approved list the admin page manages for Beethoven for VS Code (KV
`approved:<AccessID>`), so one approval serves both editions. Since 2026-09-30 (Beethoven 8.0.0) the
check also carries the installation's random identifier, and one approved account works on one
installation ([Installations](#installations)). This file is the contract as built in `worker.js`
(`accessCheck`, `installationRule`) and pinned by `worker.test.mjs`; both sides code to exactly this.

## Where the address comes from

| Build | File read (key `access_check`) | Address |
|---|---|---|
| Beethoven 7.0.0 on | `https://openspineconsortium.com/beethoven/services.json` | `https://beethoven-access.openspineconsortium.workers.dev/access_check` |
| Beethoven 4.0.0 to 6.0.0 (built as Ashley Bridge) | `https://openspineconsortium.com/ashley/services.json` | `https://ashley-service.openspineconsortium.workers.dev/access_check` |

The two hosts are one Worker deployed under two names: the same code, the same KV namespaces, the
same secrets (README.md, "Two names"), so they give the same answer to the same check. The new file
is in the site repository and names the new host for every route (`deploy.sh` writes its service
addresses); the old file is kept byte for byte for the builds that read it. The extension caches
`services.json` for a day. The site repository's copies are published when that repository is pushed.

## Request

```
POST <access_check>
Content-Type: text/plain;charset=UTF-8

{"v":1,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"8.0.0","install_id":"0123456789abcdef0123456789abcdef"}
```

`text/plain` keeps the request simple (no CORS preflight); an `application/json` body is read the
same way. The body is JSON, 8 KiB at most. `v` stays 1: `install_id` is an added field, and a Worker
from before it ignores fields it does not know, so an 8.0.0 build works against either.

| Field | Rule | If it fails |
|---|---|---|
| `v` | the number 1 | 400 |
| `access_id` | the account name the portal shows: letters, digits, `.` `_` `@` `-`, 64 at most, case and surrounding spaces ignored | 400 |
| `portal` | the portal's hostname (a `:port` is allowed, for a mock portal on localhost); not a URL | 400 |
| `product` | a short name: `bridge` is what every Beethoven build sends (its name when it was built as Ashley Bridge, kept on the wire so 4.0.0 on keep working); `beethoven` is taken as the same product; any other short name is accepted, recorded under its own name, and answered with `REQUEST_PAGE` | 400 |
| `version` | the extension's version, like `4.0.0` | 400 |
| `install_id` | Beethoven 8.0.0 on: the random identifier the extension makes when it is installed (`storage.local` `bridge.install_id`, 16 random bytes as 32 hexadecimal characters; not derived from the device; a reinstall makes a new one). Taken: 16 to 64 of `0-9 a-f -`, case ignored. Absent, `null` or `""` is a build before 8.0.0 | 400 when present and not of that shape |

## Answers

Every answer, the refusals included, carries `access-control-allow-origin: *`, `cache-control:
no-store` and `content-type: application/json`; none carries `access-control-allow-credentials`.

| Status | Body | When |
|---|---|---|
| 204 | none, with `access-control-allow-methods: POST, OPTIONS`, `access-control-allow-headers: content-type`, `access-control-max-age: 600` | `OPTIONS` (a preflight, should a browser send one) |
| 200 | `{"approved":true,"access_id":"st1234","checked":"<ISO time>","until":null}` | the account is on the approved list with the grant `extension` and the installation rule lets it through; `until` is the approval's end date when the record has one (none does today) |
| 200 | `{"approved":false,"access_id":"st1234","requestPage":"https://openspineconsortium.com/beethoven/request.html"}` | the account is not on the list (never approved, pending, denied or removed), is a lab member only (grants `["lab"]`), or the name is not one the list can hold. `requestPage` is `BEETHOVEN_REQUEST_PAGE` in `wrangler.toml` for product `bridge` or `beethoven`, and `REQUEST_PAGE` for any other; both are `https://openspineconsortium.com/beethoven/request.html` since 2026-09-30, the one request page of both editions (before, `REQUEST_PAGE` was `/ashley/request.html`, which now redirects there) |
| 200 | `{"approved":false,"access_id":"st1234","reason":"other_installation","requestPage":"..."}` | approved, but bound to another installation. What the extension says: "This account is already set up on another computer. Ask your lab lead to move it here." (no button) |
| 200 | `{"approved":false,"access_id":"st1234","reason":"other_account","requestPage":"..."}` | approved, but this installation is bound to another approved account (one installation serves one account) |
| 200 | `{"approved":false,"access_id":"st1234","reason":"update_required","requestPage":"..."}` | approved, but the check carries no `install_id` (a build before 8.0.0) and `REQUIRE_INSTALL_ID` is not `"0"`. What the extension says: "Install the current Beethoven from the lab's private listing." |
| 400 | `{"error":"..."}` | a malformed body (see the table above), or not JSON |
| 405 | `{"error":"POST the check here"}` | any method but POST and OPTIONS |
| 413 | `{"error":"too much text"}` | a body over 8 KiB |
| 429 | `{"error":"too many checks ... today; the last answer stands until tomorrow"}` | the day's cap: 120 checks per account, 2000 per connection (salted hash of the address) |
| 503 | `{"error":"the access service is not open yet"}` | the Worker has no `IP_SALT` secret (a deployment error) |

`reason` appears only on a refusal of an approved account, and before `requestPage`; a plain no has
none, so a build that does not know the field reads every refusal as a plain no. `requestPage` is on
every no, so older builds always have a page to open.

The extension opens `requestPage` with `?access_id=<account>` appended; `request.html` fills its
first field from that and sends nothing until the person presses the button.

## The decision

In order:

1. `approved:<access_id>` exists in KV ACCESS, its `until` (an ISO date), if any, has not passed, and
   its `grants` include `extension`. A record written before grants existed has no `grants` field and
   counts as `["extension","lab"]`; a lab member only (`["lab"]`) gets a plain no, and nothing is
   bound. That record is written by the admin routes (`add`, `approve`, `grant`, `seat-rule`) and the
   e-mail links, and deleted by `remove` and Withdraw approval; nothing on this route writes it.
2. A record with `any_installation: true` (set with `admin.mjs seat-rule <id> any`; the store
   reviewers' mock account `st1234`) is approved from any installation, with or without `install_id`,
   and binds none, **but only when `portal` is `localhost` or a name ending in `.localhost`** (a port
   is allowed): the reviewers' mock portal runs on their own machine. From any other portal (since
   2026-09-30 afternoon) the account is held to the installation rule like any other, so the exemption
   cannot be used to share `st1234` on a real portal.
3. Otherwise the installation rule decides ([Installations](#installations)).

The list itself is never returned on this route: one id in, yes or no out. (`GET /allowlist` still
returns the list to anyone, because Beethoven for VS Code reads it, as Ashley for VS Code 3.0.0 on the
Marketplace does; since 2026-09-30 it lists only the accounts with the grant `extension`, and `/trial`
issues keys only to them.)

Cloudflare KV is eventually consistent: an approval or a removal can take up to about a minute to
reach every edge, so a check right after a click on the admin page may still see the old answer.

## Installations

One approved account works on one installation of Beethoven, and one installation works for one
account. The installation is named by `install_id`, the random identifier the extension made when it
was installed; nothing about the computer goes into it, and a reinstall is a new installation.

| The check | The answer | What is written |
|---|---|---|
| no `install_id`, `REQUIRE_INSTALL_ID` not `"0"` | `reason: "update_required"` | nothing but `seen` |
| no `install_id`, `REQUIRE_INSTALL_ID` `"0"` | yes, from the approved list alone (builds before 8.0.0 keep working) | nothing but `seen` |
| the account has no seat, and the installation is not bound to another account | yes: the installation is bound | `seat:<access_id>` and `install:<install_id>` |
| the seat names this installation | yes | the seat's `last_seen`, `product`, `version` |
| the seat names another installation | `reason: "other_installation"`; the seat is unchanged | `conflict:<access_id>`; one e-mail to the maintainer per account a day (below) |
| the account has no seat, and this installation is bound to another account whose seat still names it | `reason: "other_account"` | `conflict:<access_id>` (kind `other_account`); no e-mail |

The e-mail about a second installation goes to `NOTIFY_TO`: "<name> (<AccessID>) asked from a second
installation; it was refused.", the installation in use and the refused one by fingerprint (the first
8 hexadecimal characters of a SHA-256 of the identifier), the refused one's version and portal, the
number of refusals, and two signed one-use links (14 days, one nonce between them, GET shows a page and
only its button acts): **Move the approval to the new installation** (the seat names the refused
installation from then on; the old one is refused at its next check) and **Withdraw approval** (the
same as `admin.mjs remove`). The Move link carries the refused installation's identifier inside its
signed token; the e-mail's text shows only fingerprints.

Since 2026-09-30 afternoon both links also carry `ref`, the version of the e-mail they came in, which
the conflict record keeps once that e-mail has gone. They act only while it is the one on record, so:

- a later e-mail about the same account (the next day's, after another refusal) replaces them: the
  older links answer "This e-mail was replaced ... see the newer e-mail" and change nothing;
- once the refusal is settled another way (moved, seat reset, approval removed) the conflict record is
  gone and both links answer that the refusal is no longer on record;
- a link without `ref` (an e-mail sent before the change) answers "This link is out of date".

**Move refuses while the refused installation is another account's seat.** One installation serves one
account, so when the installation a Move would bind is the seat of another approved account (its
`install:<install_id>` names that account and that account's seat still names it), the link opens a
plain page, "This installation is in use by another account", naming the other account and what to
do: withdraw that other approval first (Remove on the admin page, or `admin.mjs remove <other>`), or
reset its seat if it no longer uses that installation, then open the link again. Nothing is written
and the link is not spent, on the question page and on the button alike.

The maintainer's commands: `admin.mjs seat <id>` (the binding and the last refusal, by fingerprint),
`admin.mjs reset-seat <id>` (clears the binding: the next installation to check gets the account),
`admin.mjs seat-rule <id> any|one`, and `remove`, which deletes the seat with everything else,
including the account's access-check records.

What this does not do: the service answers yes or no to what the extension sends; it proves nothing
about the computer. A modified copy of the extension could skip the check or send another
installation's identifier copied out of its storage. The rule stops casual sharing (a copy handed to a
friend, one account on two computers, two accounts on one copy) and tells the maintainer when it
happens; it does not stop someone determined to get around it. Nor does the service know who sends
a check: the account name is whatever the check says, so anyone who knows an approved AccessID can
send checks in its name. Before the person's own first check, that can bind the account to a
stranger's identifier (the person is then refused until the maintainer moves the approval); after
it, it produces refusals and the e-mail about a second installation. A refusal is not proof of
sharing: ask the person before withdrawing. And while `REQUIRE_INSTALL_ID` is `"0"` (as deployed on
2026-09-30), none of this holds for a build before 8.0.0: it sends no identifier and is answered from
the approved list alone, on any number of computers.

Things that make a new installation, each refused until the maintainer moves the approval or resets the
seat: a reinstall, a second Chrome profile, Chrome Sync installing the extension on another computer, a
new computer. Two installations checking for the first time within the same minute can both be bound
(KV is eventually consistent; the one written last keeps the seat and the other is refused at its next
check).

## What the service records

| Key | Value | Kept |
|---|---|---|
| `seen:<product>:<access_id>` | `access_id`, `product`, `portal`, `version` (of the last check), `first_seen`, `last_seen`, `checks` (how many), `approved` (the last decision), `reason` (when the last check was refused for one), `ip_hash` (salted SHA-256 of the address, 32 hex characters, salt `IP_SALT`, the same for both Worker names, kept in the vendor folder's `ip_salt`; a new salt only when that file is replaced), `changed_at` (when the decision last changed) | until the account is removed (Remove, `admin.mjs remove`, or Withdraw approval deletes the records of every product for that account, since 2026-09-30 afternoon); a check after that starts a new record |
| `seat:<access_id>` | `install_id` (the bound installation's identifier), `first_seen`, `last_seen`, `product`, `version`; after a move also `moved_at` and `by` | until moved, reset or removed |
| `install:<install_id>` | `access_id`, `bound_at`: which account the installation is bound to | as long as that seat |
| `installed:<access_id>` | `at`, `product`, `version`: when the account's first installation bound it (the lifecycle's "installed"; a check never writes the approved record itself, so a check that raced a removal cannot bring the approval back) | until removed; a reset or a move keeps it |
| `conflict:<access_id>` | `kind` (`other_installation` or `other_account`), `count`, `first_at`, `last_at`, `other_install_short` (the fingerprint of the last refused installation), `ref` (the version of the last e-mail about it) | 12 months from the last refusal, or until moved, reset or removed |
| `conflict_notified:<access_id>` | when the last e-mail about a second installation went | 24 hours |
| `chk:<access_id>:<day>`, `chkip:<ip_hash>:<day>` | the day's counters | 2 days |

The network address itself is never stored, and an installation that was refused is kept only as its
fingerprint. A refused check (400, 413, 429, 503) writes no `seen` record; only the per-connection
counter is touched. The checks are listed, newest first, as `checks` in `GET /admin/list` and
`admin.mjs list`, and the seats and refusals as `seats` and `conflicts` there, with counts and dates
and no identifier or fingerprint; none of it is on a public route.

## What the extension does with the answer

Approved: works; the answer is cached for 24 hours and kept up to 7 days when the service cannot be
reached. Not approved: the strip's one button reads "Ask for access"; the answer is cached for 10
minutes. `other_installation`: the strip says "This account is already set up on another computer. Ask
your lab lead to move it here." with no button. `update_required`: "Install the current Beethoven from
the lab's private listing." Re-checked on a click of the icon once the last answer is a day old or was
no, and about once a day, and only after the agreement is accepted, the portal is connected and the
dashboard identity is known. Approval withdrawn (Remove on the admin page, `admin.mjs remove`, or
Withdraw approval in the e-mail) means the next check answers no and the extension stops starting
workers and says so. Because an approval is cached for a day, a withdrawal or a move reaches an
installation that was approved at its next check after that day, and up to 7 days later when it
cannot reach the service.

## The VS Code edition

`/trial`, `/allowlist`, `/revoked` and `/report` behave as before, with one change since 2026-09-30:
a lab member only (grants `["lab"]`) is not on `/allowlist` and gets no key from `/trial`. Every
record written before grants existed counts as both, so nobody approved before then is affected.
Ashley for VS Code 3.0.0 on the Marketplace and Beethoven for VS Code 4.0.0 keep their own key flow; the
keys are still signed `ASHLEY1.` (README.md, "The key prefixes"). The VS Code edition does not call
`/access_check`, so the installation rule does not apply to it.

## The admin routes: the admin page's contract

Written 2026-09-30 for the admin page (`tools/pages/beethoven/admin/body.html` in the site repository)
and `admin.mjs`. Nothing here is public: every route is behind the bearer token.

**Every call.** `https://beethoven-access.openspineconsortium.workers.dev/admin/<route>` (the page reads
the address from `license_service`'s origin in `/beethoven/services.json`; either Worker name answers the
same). Header `Authorization: Bearer <admin token>` (the vendor folder's `admin_token`). From a browser
the `Origin` must be `SITE_ORIGIN` (`https://openspineconsortium.com`); any other origin gets 403 with no
CORS header. `OPTIONS` answers 204 with `access-control-allow-origin: https://openspineconsortium.com`,
`access-control-allow-credentials: true`, `access-control-allow-methods: GET, POST, OPTIONS`,
`access-control-allow-headers: authorization, content-type`. `GET` for `list`; every other route is
`POST` with a JSON body (`content-type: application/json`, 8 KiB at most) naming `accessId` (two letters
and four digits). Errors are `{"error":"<plain sentence>"}` with 400 (a bad body), 401 (token missing or
wrong), 404 (no such route, or nobody by that AccessID where one is needed) or 409 (the state does not
allow it); the page shows the sentence as it is.

**`GET /admin/list`** answers 200:

```
{
  "now": "<ISO time of the answer>",
  "group": { "name": "Beethoven-users", "members_url": "https://groups.google.com/g/beethoven-users/members",
             "mode": "manual" | "workspace", "address": "beethoven-users@openspineconsortium.com" (workspace only) },
  "pending":  [ <request> ... ],     sorted by accessId
  "approved": [ <approval> ... ],    sorted by accessId
  "denied":   [ <denial> ... ],
  "revoked":  [ "L-..." ... ],
  "checks":   [ <seen record> ... ],  newest first (What the service records)
  "seats":    [ { accessId, first_seen, last_seen, product, version, moved_at? } ... ],
  "conflicts":[ { accessId, kind, count, first_at, last_at } ... ]
}
```

A **request** (`pending`):

| Field | Meaning |
|---|---|
| `accessId`, `name`, `email` | as the form sent them (`email` is always `<accessId>@wayne.edu`) |
| `google_account` | the Google account to invite (absent on a request from the older form) |
| `note` | what they will use Beethoven for (the form's "purpose") |
| `cv` | `{ "name", "kind": "pdf"\|"docx"\|"doc", "size" }` when a CV came with it; fetch it with `POST /admin/cv` |
| `mailbox` | `"waiting"` (the confirmation e-mail went; not confirmed yet), `"confirmed"`, or `"not_verified"` (MAIL_STUDENTS is `"0"`: nobody checked the mailbox) |
| `stage` | `"unconfirmed"` (mailbox `waiting`) or `"submitted"` (ready for a decision) |
| `requested_at` | the first time this AccessID asked; `submitted_at` the time this version of the request was sent |
| `confirmed_at` | when the student used the confirmation link (confirmed only) |
| `age_hours` | whole hours since `submitted_at` |
| `expires_at` | unconfirmed only: when KV drops the request and its CV (7 days after it was last sent); the student can send the form again |
| `confirm_mail` | `"failed"` when the confirmation e-mail could not be sent (the student was told; the request waits unconfirmed) |
| `asked_from`, `v`, `ref` | the product named on the form, the form version, the version stamp of the request (the e-mail links carry it) |

An **approval** (`approved`):

| Field | Meaning |
|---|---|
| `accessId`, `name`, `email`, `google_account`, `note` | carried from the request, or given with `add` |
| `grants` | `["extension","lab"]`, `["lab"]` or `["extension"]` |
| `stage` | `"lab"` (lab member only), `"approved"` (Beethoven, not invited yet), `"invited"`, `"installed"` (its first installation has checked in) |
| `approved_at` | the first approval; `decided_at` and `decision` (`"approve"` or `"lab"`) the latest decision |
| `submitted_at`, `confirmed_at`, `mailbox` | the lifecycle of the request it came from, when it came from one |
| `invited_at`, `invited_by` | when it was marked invited to Beethoven-users, and by what (`"e-mail link"`, `"admin"`, `"workspace"`) |
| `installed_at` | when the first installation bound the account (set once; a move or a reset keeps it) |
| `seat` | `{ "bound": true, "first_seen", "last_seen", "product", "version", "moved_at"? }` or `{ "bound": false }` |
| `conflicts` | the number of refusals on record (0 when none); `conflict_last_at` the last one |
| `any_installation` | `true` only for the store reviewers' mock account (it applies on a localhost portal only) |
| `lids` | the licence ids issued to them by `/trial` |

A **denial** (`denied`): `accessId`, `name`, `email`, `google_account`, `note`, `requested_at`,
`submitted_at`, `confirmed_at`, `mailbox`, `ref`, `denied_at`, `decided_at` (the same time), `decision: "deny"`,
`reason`, `by`.

**Writes** (each leaves an audit line; each answers 200 with the JSON shown):

| Route | Body | Answer | What it does |
|---|---|---|---|
| `approve` | `{ accessId, grants?, note? }` (`grants` absent = `["extension","lab"]`; `["lab"]` = Lab only) | `{ status: "approved", accessId, record, invite }`; 404 when there is no request | the Approve buttons. `invite` is `null` for Lab only; otherwise `{ group: "Beethoven-users", members_url, google_account (null when the older form gave none), invited: bool, mode: "manual"\|"workspace", address? (workspace), invited_at? (set when the service added them), error? (why the service could not add them) }`. When `invited` is false the page shows "Next: add <google_account> to the Google Group Beethoven-users", the address with a copy button, the members page and a Mark invited button |
| `deny` | `{ accessId, reason? }` | `{ status: "denied", accessId, lab_member? }`; 409 when approved for Beethoven | Deny |
| `invited` | `{ accessId }`, or `{ accessId, clear: true }` | `{ status: "invited", accessId, invited_at }` (`already: true` added when it was marked before; the date is not changed) or `{ status: "not-invited", accessId }`; 404 when not approved, 409 when lab only | Mark invited (stamps `invited_at`, `invited_by: "admin"`) |
| `reset-seat` | `{ accessId }` | `{ status: "reset", accessId, had_seat }` | Reset seat: the next installation to check gets the account |
| `remove` | `{ accessId }` | `{ status: "removed", accessId, revoked: [lids] }` | Remove: every record of the person (approved, pending, denied, seat, installed, conflict, CV, and `seen:<product>:<accessId>` for every product), keys revoked |
| `cv` | `{ accessId }` | the file itself: `content-type` application/pdf or a Word type, `content-disposition: attachment; filename="<accessId>-cv.<ext>"` (exposed to the page), 404 JSON when none | the CV link: fetch, make a blob URL, open or save it |
| `seat` | `{ accessId }` | `{ accessId, any_installation, seat: {install_short, ...} \| null, conflict: {...} \| null }` | the fingerprints, for the command line |
| `add`, `grant`, `seat-rule`, `revoke-lid`, `notify-test` | as before (README.md, "The approved list, day to day") | | |

The page never sees an installation identifier or a decision link: the lists carry dates, counts and
stages only, and the links in the e-mails stay in the e-mails.

## Proof, 2026-09-29 afternoon (before the public name changed)

This one predates Beethoven: a no then named Ashley's request page for product `bridge`. The proof
for the two names follows it.

Taken with curl from Windows against the deployed Worker, right after `deploy.sh` and
`admin.mjs add st1234 "Store reviewer (mock portal)" st1234@wayne.edu "store-reviewer mock username"`.
Cloudflare's own headers (`date`, `server`, `cf-ray`, `nel`, `report-to`, `alt-svc`) are left out.

```
$ curl -i -X OPTIONS -H 'Origin: chrome-extension://abcdefghijklmnopabcdefghijklmnop' .../access_check
HTTP/2 204
access-control-allow-origin: *
cache-control: no-store
access-control-allow-headers: content-type
access-control-allow-methods: POST, OPTIONS
access-control-max-age: 600

$ curl -i -X POST -H 'Content-Type: text/plain;charset=UTF-8' -H 'Origin: chrome-extension://...' \
    --data '{"v":1,"access_id":"zz9876","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"4.0.0"}' .../access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/ashley/request.html"}

$ curl -i -X POST -H 'Content-Type: text/plain;charset=UTF-8' -H 'Origin: chrome-extension://...' \
    --data '{"v":1,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"4.0.0"}' .../access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":true,"access_id":"st1234","checked":"2026-09-29T17:44:54.874Z","until":null}

$ curl -i -X POST -H 'Content-Type: text/plain;charset=UTF-8' -H 'Origin: chrome-extension://...' --data 'not json' .../access_check
HTTP/2 400
access-control-allow-origin: *
cache-control: no-store

{"error":"not JSON"}

$ curl -i -X POST ... --data '{"v":2,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"4.0.0"}' .../access_check
HTTP/2 400
access-control-allow-origin: *
cache-control: no-store

{"error":"v must be 1"}

$ curl -i .../access_check
HTTP/2 405
access-control-allow-origin: *
cache-control: no-store

{"error":"POST the check here"}

$ curl -i -X POST -H 'Content-Type: application/json' \
    --data '{"v":1,"access_id":"john.doe","portal":"localhost:8080","product":"bridge","version":"4.0.0"}' .../access_check
HTTP/2 200
access-control-allow-origin: *
cache-control: no-store

{"approved":false,"access_id":"john.doe","requestPage":"https://openspineconsortium.com/ashley/request.html"}
```

`admin.mjs list` afterwards showed `approved (2)`: go2432 and st1234 (note "store-reviewer mock
username", `lids: []`), and `checks (3)`: zz9876 not approved, st1234 approved, john.doe not approved,
each with `portal`, `version 4.0.0`, the times and a 32-character `ip_hash`; no address anywhere.
`GET /allowlist` still answers `{"about":"AccessIDs approved to use Ashley","accessIds":[...]}` with
`access-control-allow-origin: *` and `cache-control: max-age=60`, as Ashley in VS Code 3.0.0 expects.

## Proof, two names, 2026-09-29 evening

Both names deployed from WSL with `deploy.sh` (`WORKER_NAME=beethoven-access` for the second), then
taken with curl from Windows at about 20:08 Detroit time (00:08 UTC on 2026-09-30). The new name
answers on `https://beethoven-access.openspineconsortium.workers.dev`. Cloudflare's own headers
(`date`, `server`, `cf-ray`, `nel`, `report-to`, `alt-svc`, `content-length`, `vary`) are left out.
`EXT` is `chrome-extension://abcdefghijklmnopabcdefghijklmnop`.

The new host:

```
$ curl -i -X OPTIONS -H "Origin: $EXT" https://beethoven-access.openspineconsortium.workers.dev/access_check
HTTP/2 204
access-control-allow-origin: *
cache-control: no-store
access-control-allow-headers: content-type
access-control-allow-methods: POST, OPTIONS
access-control-max-age: 600

$ curl -i -X POST -H 'Content-Type: text/plain;charset=UTF-8' -H "Origin: $EXT" \
    --data '{"v":1,"access_id":"zz9876","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"7.0.0"}' \
    https://beethoven-access.openspineconsortium.workers.dev/access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/beethoven/request.html"}

$ curl -i -X POST ... --data '{"v":1,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"7.0.0"}' \
    https://beethoven-access.openspineconsortium.workers.dev/access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":true,"access_id":"st1234","checked":"2026-09-30T00:08:14.614Z","until":null}

$ curl -i -X POST ... --data '{"v":1,"access_id":"zz9876","portal":"ondemand.grid.wayne.edu","product":"ashley","version":"3.0.0"}' \
    https://beethoven-access.openspineconsortium.workers.dev/access_check
HTTP/2 200
content-type: application/json
access-control-allow-origin: *
cache-control: no-store

{"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/ashley/request.html"}

$ curl -i https://beethoven-access.openspineconsortium.workers.dev/health
HTTP/2 200
content-type: application/json
cache-control: no-store

{"ok":true}

$ curl -i -X OPTIONS -H 'Origin: https://openspineconsortium.com' -H 'Access-Control-Request-Method: POST' \
    https://beethoven-access.openspineconsortium.workers.dev/request
HTTP/2 204
access-control-allow-origin: https://openspineconsortium.com
access-control-allow-credentials: true
access-control-allow-headers: authorization, content-type
access-control-allow-methods: GET, POST, OPTIONS
access-control-max-age: 600

$ curl -s https://beethoven-access.openspineconsortium.workers.dev/revoked
ASHLEYREV1.eyJ2IjoxLCJra...    (305 characters; SHA-256 begins 1887a2e3e53a5768)
```

The old host, `https://ashley-service.openspineconsortium.workers.dev`, gave the same answers to the
same seven calls: the 204 preflight with the same four headers, the same `/request` preflight,
`{"ok":true}`, the same signed `/revoked` list (305 characters, the same SHA-256), and these bodies,
each with `content-type: application/json`, `access-control-allow-origin: *` and
`cache-control: no-store`:

```
product bridge, zz9876: {"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/beethoven/request.html"}
product bridge, st1234: {"approved":true,"access_id":"st1234","checked":"2026-09-30T00:08:32.738Z","until":null}
product ashley, zz9876: {"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/ashley/request.html"}
```

`GET /allowlist` hashed the same on both hosts, and
`GET /admin/list` with the one admin token answered on both with the same counts (approved 3, pending
0, denied 0, checks 6), so the two names share the KV namespaces and the admin secret. `wrangler secret
list` shows the same seven secret names on both: `ADMIN_TOKEN`, `DECIDE_KEY`, `IP_SALT`, `MAIL_FROM`,
`NOTIFY_TO`, `TRIAL_KEY_PKCS8_B64`, `TRIAL_KID`. At about 20:15, once `resend_api_key` in the vendor
folder held a Resend key, both names were deployed again and both list an eighth, `RESEND_API_KEY`;
`admin.mjs notify-test` through the new host printed `sent: the provider answered 200`.

Until the site repository publishes `https://openspineconsortium.com/beethoven/request.html`, that
address answers 404 (checked at the same time), so a no sends a person to a page that is not there
yet; `https://openspineconsortium.com/ashley/request.html` still works for the same approved list.

## Proof, the rename to Beethoven, 2026-09-30 early morning

Both names deployed again from WSL with `deploy.sh`, `beethoven-access` now the default and
`WORKER_NAME=ashley-service` the second, with the vendor folder at its new place
(`BEETHOVEN_VENDOR_DIR=/mnt/c/Users/grego/.beethoven-vendor`; `mail_from` rewritten to
`Beethoven access <onboarding@resend.dev>` first). Both found the three KV namespaces by the ids in
`wrangler.toml`, `deploy.sh` put the same eight secrets on both from the vendor folder, and it left the site's `beethoven/services.json`
unchanged, since it already named `beethoven-access` for all six routes. Then, read-only, from WSL
(`chrome-extension://...` as the Origin of the checks, product `bridge` and product `ashley`, version
3.0.0), the same answers from both hosts:

```
health:        {"ok":true}
allowlist:     {"about":"AccessIDs approved to use Beethoven","accessIds":[ ...
revoked:       ASHLEYREV1. ...
check bridge:  {"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/beethoven/request.html"}
check ashley:  {"approved":false,"access_id":"zz9876","requestPage":"https://openspineconsortium.com/beethoven/request.html"}
trial no auth: 401
decide bad:    <h1>This link is not valid</h1> href="https://openspineconsortium.com/beethoven/admin.html"
report bad:    {"error":"not a Beethoven report"}
```

`admin.mjs notify-test`, once through each name, printed `sent: the provider answered 200` both times
(subject `Beethoven access: test e-mail`, sender from `mail_from`). At the same time
`https://openspineconsortium.com/beethoven/admin.html` answered 404 (the site repository had not been
pushed with it yet) while `/ashley/admin.html` answered 200: until that push, the admin-page link in
the e-mails and on the `/decide` pages leads nowhere, and `/ashley/admin.html` is the admin page. The
Approve and Deny links themselves do not depend on it.

## Proof, one installation per account, 2026-09-30 morning

Both names deployed from WSL with `deploy.sh` (`SKIP_SITE=1` for the first; the second with
`WORKER_NAME=ashley-service`), `wrangler.toml` saying `REQUIRE_INSTALL_ID = "0"` and `MAIL_STUDENTS = "0"`.
Both found the three KV namespaces by their ids, got the same eight secrets, and answered `/health`
`{"ok":true}`. The checks were taken with Git Bash's curl on Windows at 14:04 to 14:05 UTC; `admin.mjs`
ran from WSL, because Windows node timed out connecting to Cloudflare (`UND_ERR_CONNECT_TIMEOUT`).
`zz0007` and `zz0008` are made-up AccessIDs, removed at the end. Every answer below also carried
`content-type: application/json`, `access-control-allow-origin: *` and `cache-control: no-store`.
`EXT` is `chrome-extension://abcdefghijklmnopabcdefghijklmnop`, `IA` is
`0123456789abcdef0123456789abcdef` and `IB` is `fedcba9876543210fedcba9876543210`.

```
$ node tools/intake/admin.mjs add zz0007 "Service proof (made-up account)" zz0007@wayne.edu "made up for the 2026-09-30 proof; removed after"
{"status":"approved","accessId":"zz0007","record":{..., "lids":[],"grants":["extension","lab"]}}

POST https://beethoven-access.openspineconsortium.workers.dev/access_check   (text/plain, Origin: EXT)
{"v":1,"access_id":"zz0007","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"8.0.0","install_id":"IA"}
HTTP/2 200  {"approved":true,"access_id":"zz0007","checked":"2026-09-30T14:04:59.211Z","until":null}      (binds)

the same again
HTTP/2 200  {"approved":true,"access_id":"zz0007","checked":"2026-09-30T14:05:02.159Z","until":null}      (repeats)

{"v":1,"access_id":"zz0007","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"8.0.0","install_id":"IB"}
HTTP/2 200  {"approved":false,"access_id":"zz0007","reason":"other_installation","requestPage":"https://openspineconsortium.com/beethoven/request.html"}

{"v":1,"access_id":"zz0007","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"7.0.0"}
HTTP/2 200  {"approved":true,"access_id":"zz0007","checked":"2026-09-30T14:05:07.108Z","until":null}      (REQUIRE_INSTALL_ID "0")

POST https://ashley-service.openspineconsortium.workers.dev/access_check, IA, then IB
HTTP/2 200  {"approved":true,"access_id":"zz0007","checked":"2026-09-30T14:05:09.073Z","until":null}
HTTP/2 200  {"approved":false,"access_id":"zz0007","reason":"other_installation","requestPage":"https://openspineconsortium.com/beethoven/request.html"}

{"v":1,"access_id":"zz0007","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"8.0.0","install_id":"not-hex"}
HTTP/2 400  {"error":"install_id is the random identifier Beethoven makes when it is installed (32 hexadecimal characters)"}

$ node tools/intake/admin.mjs seat zz0007
{"accessId":"zz0007","any_installation":false,
 "seat":{"install_short":"3eb1bd43","first_seen":"2026-09-30T14:04:59.211Z","last_seen":"2026-09-30T14:05:09.073Z","product":"bridge","version":"8.0.0"},
 "conflict":{"kind":"other_installation","count":2,"first_at":"2026-09-30T14:05:04.824Z","last_at":"2026-09-30T14:05:11.353Z","other_install_short":"4ba68aa8"}}

POST https://beethoven-access.openspineconsortium.workers.dev/request   (application/json, Origin: https://openspineconsortium.com)
{"v":2,"access_id":"zz0008","name":"Service proof (made-up account)","email":"zz0008@wayne.edu","google_account":"service.proof@example.com","purpose":"a made-up request to prove the service after the 2026-09-30 deploy; removed after","product":"bridge"}
HTTP/2 202  {"status":"pending","mailbox":"not_verified"}      (access-control-allow-origin: https://openspineconsortium.com)
```

The two installations answered the same on both hosts, so both names run the new code on the same
records. The refusals counted across both (`count` 2), and one e-mail went: KV afterwards held
`conflict_notified:zz0007` (14:05:05) and `notified:zz0008` (14:04:04), which the Worker writes only
after Resend accepted the message. What the e-mails looked like in the inbox was not seen from here.

A check without `install_id` answered **yes**, because `REQUIRE_INSTALL_ID` is `"0"`: every Beethoven
7.0.0 in use (and 4.0.0 to 6.0.0 through `ashley-service`) sends no identifier, and requiring one now
would refuse them all. `update_required` is therefore proved by the tests only
(`worker.test.mjs`, "without install_id an approved account is refused update_required, unless
REQUIRE_INSTALL_ID is \"0\""), not live. It goes live when `wrangler.toml` says `"1"` and both names are
deployed again, after Beethoven 8.0.0 is on the private listing.

**A slip in the first pass, and what it showed.** The first attempt ran `admin.mjs add zz0007` with
Windows node, which timed out, so `zz0007` was not approved when the next call sent it a v2 request
with a 5 MB PDF-shaped CV (6,990,766 bytes of JSON, meant to measure the decoding on an approved account
that stores nothing). It was stored as a pending request instead, `202 {"status":"pending","mailbox":"not_verified"}`
in 2.2 seconds with the upload, and e-mailed to the maintainer (`notified:zz0007`, 14:04:08). So the
deployed Worker read, checked and stored a 5 MB CV without hitting a CPU limit. The e-mails of this
proof (two requests, one second installation) carry live-looking links; all are inert now: the
accounts are gone, so each decision page answers "Nothing changed" and the CV link "No CV on record".

Clean-up, from WSL: `admin.mjs remove zz0007` and `remove zz0008` (both `{"status":"removed",...,"revoked":[]}`);
then `seat zz0007` answered `"seat":null,"conflict":null`, `cv zz0007` answered
`HTTP 404: {"error":"no CV on record for zz0007"}`, `wrangler kv key get seat:zz0007` answered 404, and
`admin.mjs list` counted pending 0, seats 0, conflicts 0, approved 3 (as before the proof).

Last, `admin.mjs seat-rule st1234 any` answered `{"status":"seat-rule","accessId":"st1234","any_installation":true}`:
the store reviewers' mock account works from every reviewer's own installation and binds none. Its record
has no `grants` field, so it counts as both.

## Proof, versions, the Move guard, the localhost exemption, removal and the invitation step, 2026-09-30 afternoon

Both names deployed from WSL with `deploy.sh` (`SKIP_SITE=1`), `wrangler.toml` saying
`REQUIRE_INSTALL_ID = "0"`, `MAIL_STUDENTS = "0"` and `GROUP_MODE = "manual"`. Each deploy reported
`cron schedule: 0 13 * * *`; `wrangler versions view` of beethoven-access's current version (made by
the secret updates after the deploy) lists `SERVICE_NAME ("beethoven-access")`, `REMINDER_FROM`,
`SERVICE_ORIGIN`, `GROUP_MODE ("manual")`, `MAIL_STUDENTS ("0")` and `REQUIRE_INSTALL_ID ("0")`. Both
were deployed once more at 16:05 UTC after two changes to the pages (the copy box's width at phone
size, a missing full stop), and answered `/health` `{"ok":true}` at 16:08.

The calls were made with Git Bash's curl on Windows, 15:52 to 16:08 UTC. The admin token was piped into
curl's header list from the vendor folder. The e-mails of this proof went to the maintainer's inbox,
which is not read from here, so the decision links were signed locally with the vendor folder's
`decide_key` (piped) for exactly the `ref` on record. They were read from `/admin/list` for a request,
and from KV (`wrangler kv key get`, from WSL) for a refusal. `zq0001` to `zq0006` are made-up
AccessIDs, all removed at the end. The installations are `IA`, `IB` and `IC` as in the morning's proof,
plus `11111111222222223333333344444444`.

**F1 b, the exemption on a localhost portal only.** `zq0003` added, then `seat-rule zq0003 any`:

```
portal localhost:8080, IA          -> {"approved":true,...}
portal localhost:8080, IB          -> {"approved":true,...}
portal reviewers.localhost, IC     -> {"approved":true,...}
admin seat zq0003                  -> "seat":null
portal ondemand.grid.wayne.edu, IA -> {"approved":true,...}
admin seat zq0003                  -> "any_installation":true, "seat":{"install_short":"3eb1bd43",...}
portal ondemand.grid.wayne.edu, IB -> {"approved":false,...,"reason":"other_installation",...}
portal localhost.example.com, IC   -> {"approved":false,...,"reason":"other_installation",...}
portal localhost:8080, IC          -> {"approved":true,...}
```

The first `admin seat` after `seat-rule` still showed `"any_installation":false`. That was KV's minute:
the checks already honoured the rule, and the next read showed `true`. At 16:08 the reviewers' own
account, `st1234`, from `localhost:8080`, answered `{"approved":true,...}`.

**F1 a, Move refused while the installation is another account's seat.** `zq0001` bound
`1111...4444` and `zq0002` bound `IC` (fingerprint `8b54c291`), both through the product `bridge`, and
`zq0002` also through `beethoven`. `zq0001` checking from `IC` was refused `other_installation`, and
KV then held `conflict:zq0001` with `"ref":"5wcz0kDsVezBaIPJ3oU83A"` and `conflict_notified:zq0001`
(15:53:48): the e-mail had gone. The Move link for `IC` with that ref:

```
GET  /decide           -> HTTP 409 "This installation is in use by another account"
                          "The installation 8b54c291, which Proof F1a (made-up) (zq0001) asked from, is the one zq0002 uses: ..."
                          "To go on, withdraw the approval of zq0002 first (Remove on the admin page, or
                           node tools/intake/admin.mjs remove zq0002); or, ... reset its seat ...
                           Then open this link again: it was not used up."  "Nothing was changed."
POST /decide confirm=1 -> the same page, HTTP 409; admin seat zq0001 unchanged (install_short bc941d2b)
admin remove zq0002    -> {"status":"removed","accessId":"zq0002","revoked":[]}
POST /decide confirm=1 -> (the same link) HTTP 200 "Moved."; seat zq0001: install_short 8b54c291,
                          moved_at, by "e-mail link"; conflict null
POST again             -> HTTP 410 "This link was already used"
```

**F1 c, links tied to their version.** A Move link with another ref answered HTTP 409 "This e-mail was
replaced"; a Withdraw link with no ref answered HTTP 410 "This link is out of date". For requests, a
v2 request for `zq0004` (Google account `proof.f1c@example.com`) was sent, `202
{"status":"pending","mailbox":"not_verified"}`, with ref `H6iAgP7KDPD-5AtRvWcj1g`. The same form again
kept that ref and `submitted_at`. The Approve link for that ref opened its question (HTTP 200). The form
was then sent with a changed purpose, and the new ref was `IUqds_R24PIogCgqmrh6IQ`. After that, the first
version's links answered:

```
Approve, opened and pressed -> HTTP 409 "This request was replaced" ("... see the newer e-mail ... Nothing was changed.")
CV, pressed                 -> HTTP 409 "This request was replaced" ("... Nothing was sent.")
Approve with no ref         -> HTTP 410 "This link is out of date"   (also at ashley-service, 16:08)
```

**F3, the Approve page.** The second version's Approve link, pressed: HTTP 200 "Approved.", "They are not told
automatically; let them know.", "Next: add proof.f1c@example.com to the Google Group
Beethoven-users.", the address in a read-only box with a Copy button, "Invite them on the group's
members page" (`https://groups.google.com/g/beethoven-users/members`), and a Done, invited button. Its
policy was `default-src 'none'; style-src 'unsafe-inline'; script-src
'sha256-INwhXZoqo4hQAUAlfL90O8Q8ccXrCOPJAg3xWtat2UE='; form-action 'self'; base-uri 'none';
frame-ancestors 'none'`. The page had one script, and its SHA-256 is that value. The Done, invited
token named `zq0004`, `invited`, and the approval's ref. Opened, it asked "Mark Proof F1c (made-up)
(zq0004) as invited to Beethoven-users?". Pressed, it said "Marked invited.". `admin invited zq0004`
then answered `"already":true`; `clear` answered `{"status":"not-invited",...}`; marking again stamped a
new date. `/admin/list` answered the keys `now, group, pending, approved, denied, revoked, checks,
seats, conflicts` and `group` `{"name":"Beethoven-users",...,"mode":"manual"}`. `zq0001` showed `stage
"installed"`, `installed_at` its first binding (15:53:45, kept through the move), and `seat.bound`
true. The page was rendered in Edge at 1440 and inside a 390 px and a 320 px frame. The text wraps, and
since the second deploy the box and its button share one line at both phone widths.

**Once, a second press got through.** Pressing that Done, invited button a second time, 4 seconds after
the first, answered "Marked invited." again instead of "This link was already used", and it stamped a
second date (15:56:36; `admin invited` then reported it). The same sequence repeated on fresh made-up
accounts was refused correctly: press, then press after 2 s, at 16:00; open, press, then press after 2 s,
at 16:03. The cause is not established. The likely one is KV's consistency: the used link is recorded
in KV, which can take up to a minute to reach another Cloudflare location. Consecutive requests from
this one computer do not always reach the same location: of twelve calls to `/health`, eleven were
answered at ATL and one at MEM. For Done, invited the effect was a second date. For two different
links of one request e-mail (Approve, then Deny) pressed within that minute, both could apply. Closing
this needs a strongly consistent store for spending a link (a Durable Object), which is not built.
README.md, "What a link scanner can and cannot do", says so.

**F1 d, removal clears the access-check records.** Before `remove zq0002`, KV held `seen:bridge:zq0002` and
`seen:beethoven:zq0002`. After removing `zq0001` to `zq0006`, a KV listing (`wrangler kv key list`, from
WSL) found no key under any of the made-up ids or installations: no `seen:`, `seat:`, `install:`,
`installed:`, `conflict:`, `approved:`, `pending:`, `denied:` or `cv:` key. What is left expires on its
own: the day's counters (`chk:`, `notify_versions:`), the 24-hour e-mail flags (`notified:zq0004`,
`conflict_notified:zq0001`, `conflict_notified:zq0003`), and the spent links (`decide:<nonce>`, 30
days). `admin.mjs list` afterwards: pending 0, and approved 3 (go2432, hy9698, st1234), as before the
proof.

**Not proved live, by the tests only:** the daily reminder (`worker.test.mjs`, "the daily reminder lists
approved accounts ..."), the student's e-mail at approval and every other part of `MAIL_STUDENTS` `"1"`
(it stays `"0"`), and the Workspace adapter (against a stub of Google; `GROUP_MODE` stays `"manual"`).
The first reminder runs at 13:00 UTC on 2026-10-01. It will list go2432 and hy9698 (approved for
Beethoven, not marked invited, no installation checked in; st1234 is left out) unless they are marked
invited first: `admin.mjs invited go2432`, or Mark invited on the admin page.

E-mails this proof sent to the maintainer: the refusals of `zq0003` and `zq0001`, and the two versions
of `zq0004`'s request. Only `zq0001`'s e-mail is confirmed from here, by its flag in KV. All their links
are now inert, because the accounts are gone.

## Integration pass, 2026-09-30 16:30 to 16:42 UTC: three edge cases from the review, fixed and redeployed

The review of the afternoon's work found three edge cases and left them unfixed, so that the deployed
code would stay the code under review. They were fixed in the integration pass, each with a test that
fails on the earlier `worker.js` and passes now, and both names were deployed again from WSL
(`deploy.sh`, then `WORKER_NAME=ashley-service deploy.sh`; versions `0c6468d1` at 16:36:53 and
`94cd3269` at 16:38:11; `MAIL_STUDENTS` `"0"`, `REQUIRE_INSTALL_ID` `"0"`, `GROUP_MODE` `"manual"`,
`REMINDER_FROM` `beethoven-access`, each name its own `SERVICE_NAME`, handlers fetch and scheduled).

1. **An old Done, invited link after remove and add.** The check compared refs only when both the link
   and the approval had one, and an approval made by `add` has none; so a Done, invited button from
   before a remove and add still stamped `invited_at`, and the reminder stopped listing someone who may
   never have been invited. Now the link's ref and the approval's must be equal, a missing one counting
   as empty: either way round it answers "This approval was replaced" and changes nothing. A link and an
   approval that both have no ref (the reminder's link for an approval made by `add`, as go2432 and
   hy9698 were) still work.
2. **A second confirmation link for one version.** The same form sent twice before confirming gives
   two confirmation e-mails for one version; using the second after the first confirmed it again and
   e-mailed the maintainer a second set of decision links. Now it answers "Already confirmed", writes
   nothing and sends nothing. Inactive live while `MAIL_STUDENTS` is `"0"`.
3. **The student's e-mail in workspace mode.** With `GROUP_MODE` `"workspace"` the service adds the
   account itself and Google sends no invitation, but the student's approval e-mail said to watch for
   the invitation, which "has the link". Now, when the service added them, it says they are in the
   group and that the lab lead sends the listing's link; the Approve page and the admin page's
   next-step box say to send it. When Google refuses, the manual step and the old text stay. Never
   called live.

Live, from WSL, `scratchpad/integ/live_check.mjs` (tokens read from the vendor folder, never printed):

```
GET  beethoven-access/health, ashley-service/health  -> 200 {"ok":true} each
POST beethoven-access/request v2 zq0301              -> 202 {"status":"pending","mailbox":"not_verified"}
POST ashley-service/request v2 zq0302                -> 202 {"status":"pending","mailbox":"not_verified"}
admin add zq0303                                     -> 200; the approval has no ref
POST /decide, invited, with a ref zq0303 lacks       -> 409 "This approval was replaced" at both names;
                                                        invited_at unset (the earlier code stamped it)
GET  /decide, invited, no ref                        -> 200, the question (opened, not pressed)
admin remove zq0301, zq0302, zq0303                  -> 200 each
/admin/list 65 s later, both names                   -> pending 0; approved go2432, hy9698, st1234;
                                                        no made-up id mentioned anywhere
```

The two requests e-mailed the maintainer (marked "Mailbox: not verified"); their links are inert, since
the requests are gone. `node --test` in `tools/intake`: 55 of 55; with `tools/license/vendor.test.mjs`,
57 of 57.
