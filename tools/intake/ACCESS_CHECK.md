# The access check: how Beethoven asks whether an account is approved

Beethoven, the browser extension, has no keys. (Beethoven is its public name since 2026-09-29; Ashley
Bridge stays its code name in the repositories and the code.) A person signs in to their own Open
OnDemand portal with their university account; the extension reads the account name the portal's
dashboard shows for that session and asks this service whether that account is approved. The answer
comes from the same approved list the admin page manages for Ashley in VS Code (KV
`approved:<AccessID>`), so one approval serves both products. This file is the contract as built in
`worker.js` (`accessCheck`) and pinned by `worker.test.mjs`; both sides code to exactly this.

## Where the address comes from

| Build | File read (key `access_check`) | Address |
|---|---|---|
| Beethoven 7.0.0 on | `https://openspineconsortium.com/beethoven/services.json` | `https://beethoven-access.openspineconsortium.workers.dev/access_check` |
| Beethoven 4.0.0 to 6.0.0 (built as Ashley Bridge) | `https://openspineconsortium.com/ashley/services.json` | `https://ashley-service.openspineconsortium.workers.dev/access_check` |

The two hosts are one Worker deployed under two names: the same code, the same KV namespaces, the
same secrets (README.md, "Two names"), so they give the same answer to the same check. Beethoven's
file is built in the ashley-bridge repository (`docs/site/beethoven/services.json`) and names the
new host for every route; `deploy.sh` writes the old file's five service addresses. The extension
caches `services.json` for a day. The site repository's copies are published when that repository is
pushed.

## Request

```
POST <access_check>
Content-Type: text/plain;charset=UTF-8

{"v":1,"access_id":"st1234","portal":"ondemand.grid.wayne.edu","product":"bridge","version":"7.0.0"}
```

`text/plain` keeps the request simple (no CORS preflight); an `application/json` body is read the
same way. The body is JSON, 8 KiB at most.

| Field | Rule | If it fails |
|---|---|---|
| `v` | the number 1 | 400 |
| `access_id` | the account name the portal shows: letters, digits, `.` `_` `@` `-`, 64 at most, case and surrounding spaces ignored | 400 |
| `portal` | the portal's hostname (a `:port` is allowed, for a mock portal on localhost); not a URL | 400 |
| `product` | a short name: `bridge` is what every Beethoven build sends (the code name, kept on the wire so 4.0.0 to 6.0.0 keep working); `beethoven` is taken as the same product; any other short name is accepted and answered with Ashley's request page | 400 |
| `version` | the extension's version, like `4.0.0` | 400 |

## Answers

Every answer, the refusals included, carries `access-control-allow-origin: *`, `cache-control:
no-store` and `content-type: application/json`; none carries `access-control-allow-credentials`.

| Status | Body | When |
|---|---|---|
| 204 | none, with `access-control-allow-methods: POST, OPTIONS`, `access-control-allow-headers: content-type`, `access-control-max-age: 600` | `OPTIONS` (a preflight, should a browser send one) |
| 200 | `{"approved":true,"access_id":"st1234","checked":"<ISO time>","until":null}` | the account is on the approved list; `until` is the approval's end date when the record has one (none does today) |
| 200 | `{"approved":false,"access_id":"st1234","requestPage":"https://openspineconsortium.com/beethoven/request.html"}` | the account is not on the list (never approved, pending, denied or removed), or the name is not one the list can hold. `requestPage` is Beethoven's page (`BEETHOVEN_REQUEST_PAGE` in `wrangler.toml`) for product `bridge` or `beethoven`, and Ashley's (`REQUEST_PAGE`, `https://openspineconsortium.com/ashley/request.html`) for any other |
| 400 | `{"error":"..."}` | a malformed body (see the table above), or not JSON |
| 405 | `{"error":"POST the check here"}` | any method but POST and OPTIONS |
| 413 | `{"error":"too much text"}` | a body over 8 KiB |
| 429 | `{"error":"too many checks ... today; the last answer stands until tomorrow"}` | the day's cap: 120 checks per account, 2000 per connection (salted hash of the address) |
| 503 | `{"error":"the access service is not open yet"}` | the Worker has no `IP_SALT` secret (a deployment error) |

The extension opens `requestPage` with `?access_id=<account>` appended; `request.html` fills its
first field from that and sends nothing until the person presses the button.

## The decision

`approved:<access_id>` exists in KV ACCESS. That record is written by the admin routes (`add`,
`approve`) and deleted by `remove`; nothing on this route writes it. A record may carry `until` (an
ISO date); after it the answer is no. The list itself is never returned on this route: one id in,
yes or no out. (`GET /allowlist` still returns the whole list to anyone, because Ashley in VS Code
3.0.0 on the Marketplace reads it; that route is unchanged.)

Cloudflare KV is eventually consistent: an approval or a removal can take up to about a minute to
reach every edge, so a check right after a click on the admin page may still see the old answer.

## What the service records

| Key | Value | Kept |
|---|---|---|
| `seen:<product>:<access_id>` | `access_id`, `product`, `portal`, `version` (of the last check), `first_seen`, `last_seen`, `checks` (how many), `approved` (the last decision), `ip_hash` (salted SHA-256 of the address, 32 hex characters, salt `IP_SALT`, the same for both Worker names, kept in the vendor folder's `ip_salt`; a new salt only when that file is replaced), `changed_at` (when the decision last changed) | until the maintainer deletes it |
| `chk:<access_id>:<day>`, `chkip:<ip_hash>:<day>` | the day's counters | 2 days |

The network address itself is never stored. A refused check (400, 413, 429, 503) writes no `seen`
record; only the per-connection counter is touched. The records are listed, newest first, as
`checks` in `GET /admin/list` and `admin.mjs list`; they are not on any public route.

## What the extension does with the answer

Approved: works; the answer is cached for 24 hours and kept up to 7 days when the service cannot be
reached. Not approved: the strip's one button reads "Ask for access"; the answer is cached for 10
minutes. Re-checked on a click of the icon once the last answer is a day old or was no, and about
once a day, and only after the agreement is accepted, the portal is connected and the dashboard
identity is known. Approval withdrawn (Remove on the admin page or `admin.mjs remove`) means the
next check answers no and the extension stops starting workers and says so.

## Ashley in VS Code 3.0.0 is untouched

`/trial`, `/request`, `/allowlist`, `/admin/*`, `/revoked` and `/report` behave exactly as before;
`access_check` is added beside them. The Marketplace build keeps its own key flow.

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
