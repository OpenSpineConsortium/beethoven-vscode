# The access, licence and report service

One Cloudflare Worker (`worker.js`) gives Ashley five things without a server to keep: the list of
approved AccessIDs (asked for from the website, e-mailed to the maintainer with Approve and Deny links,
managed from an admin page), keys issued in the student's own name to approved people (Ashley in VS
Code), a yes-or-no approval check for one account (Ashley Bridge, which has no keys), error reports
filed as issues in the private repository, and the published list of withdrawn keys. It runs on the
maintainer's own accounts (Cloudflare, GitHub, Resend for the e-mail); no
student credential other than the Microsoft sign-in token for a key ever reaches it, and that token
is used once, to ask Microsoft who the person is. Nothing here logs a token, an e-mail or an IP
address.

## Routes

| Route | Who calls it | What it does |
|---|---|---|
| `GET /allowlist` | the extension (`ashley.allowlistUrl`) | the approved AccessIDs, in the shape of `extension/media/allowlist.json`; cached one minute |
| `POST /request` | `docs/site/request.html` | a student asks for access: stored as pending, e-mailed to the maintainer with Approve and Deny links (see [Requests by e-mail](#requests-by-e-mail)), filed as an issue labelled `access-request` when `GITHUB_TOKEN` is set; answers pending, approved or denied |
| `GET` and `POST /decide?t=<token>` | the links in that e-mail | GET shows one question and one button; the button POSTs the decision |
| `POST /trial` | the extension (`ashley.licenseServiceUrl`) | a key for a signed-in, approved person; three a day at most; the key's id is written to the approved record |
| `POST /access_check` | Ashley Bridge (`services.json` key `access_check`) | is this one account approved? Yes or no, from the same list; contract in [ACCESS_CHECK.md](ACCESS_CHECK.md) |
| `GET /revoked` | every installation, daily | the signed revocation list |
| `POST /report` | installations that allow error reports | an issue labelled `diagnostic-report`; repeats add a count |
| `/admin/*` | `docs/site/admin.html`, `publish.sh`, `admin.mjs` | `list`, `approve`, `deny`, `add`, `remove`, `revoke-lid`, `notify-test`, behind the bearer token `ADMIN_TOKEN` |
| `GET /health` | you | `{"ok":true}` |

## Deploy (once, from the maintainer's machine)

```
npm i -g wrangler
cd tools/intake
wrangler login
wrangler kv namespace create TRIALS
wrangler kv namespace create REPORTS
wrangler kv namespace create ACCESS
# paste the three ids into wrangler.toml

# the trial signing key: made once, piped straight into the secret store. export-key writes to stdout
# only, so the key is never on a command line or in the shell history.
node ../license/ashley-license.mjs init --kid trial
node ../license/ashley-license.mjs export-key --kid trial | wrangler secret put TRIAL_KEY_PKCS8_B64
echo trial | wrangler secret put TRIAL_KID

# the admin token: random, kept in the vendor folder for the admin page and for publish.sh
openssl rand -base64 32 > ~/.ashley-vendor/admin_token && chmod 600 ~/.ashley-vendor/admin_token
wrangler secret put ADMIN_TOKEN < ~/.ashley-vendor/admin_token

# the salt that hashes the address a request comes from (nothing reads it back; a new salt only resets the rate limit)
openssl rand -base64 32 | wrangler secret put IP_SALT

# a fine-grained GitHub token: repository GregorySchwing/ashley only, permission Issues: read and write
wrangler secret put GITHUB_TOKEN
echo GregorySchwing/ashley | wrangler secret put GITHUB_REPO

wrangler deploy
```

`wrangler secret put NAME` reads the value from stdin when something is piped in, and from a hidden
prompt otherwise; neither way puts the value in the command line or the history. `wrangler deploy`
prints the Worker's address (`https://ashley-service.<account>.workers.dev`, or a domain you route to it).

## After deploy: services.json

Fill `docs/site/services.json` with that address and republish the site (`python tools/site_build.py`,
then copy `docs/site/` into the site repository's `ashley/` folder):

```json
{
  "license_service": "https://<worker>/trial",
  "allowlist": "https://<worker>/allowlist",
  "revocation": "https://<worker>/revoked",
  "report": "https://<worker>/report",
  "request_page": "https://openspineconsortium.com/ashley/request.html",
  "support_page": "https://openspineconsortium.com/ashley/support.html",
  "access_check": "https://<worker>/access_check"
}
```

`deploy.sh` writes the five service addresses itself. The extension reads this file to find the
service, Ashley Bridge reads `access_check` from it (cached for a day), and `request.html` and
`admin.html` read it too, so the Worker's address lives in one place. While the four service values
are empty the extension uses the allowlist bundled in the VSIX and the trial button says to ask the
lead. The settings `ashley.licenseServiceUrl`, `ashley.allowlistUrl`, `ashley.licenseRevocationUrl`
and `ashley.diagnostics.endpoint` still override the file for one installation.

Check: `curl https://<worker>/health`, then open `admin.html`, paste the token from
`~/.ashley-vendor/admin_token`, and add yourself.

## A second wall in front of /admin/*

The bearer token is one check; put Cloudflare Access in front of the admin routes as another, so a
request reaches the Worker only from a browser that has signed in to your Cloudflare account's
identity provider. Zero Trust, Access, Applications, add a self-hosted application: domain the
Worker's host, path `admin/*`; a policy that allows only your own e-mail (one-time PIN is enough).
Because `admin.html` is served from the website and calls the Worker across origins, set the
application's CORS settings to allow the origin `https://openspineconsortium.com` with
credentials and the headers `Authorization` and `Content-Type`; the page already sends its calls
with credentials, so the Access session cookie rides along. `publish.sh` calls the same routes from a
terminal: create a service token for it in Access, or run it while the policy also allows the
machine's address. The free plan covers a lab.

## The approved list, day to day

- A student fills in `request.html`: AccessID, name, `AccessID@wayne.edu`, what they will use Ashley
  for. The Worker checks the four fields, stores a pending record and e-mails you about it (next
  section); with `GITHUB_TOKEN` set it also opens an issue titled `Access request: <AccessID>` labelled
  `access-request`.
- You press Approve or Deny in that e-mail, or open `admin.html` and click Approve (or Deny, with a
  reason the student does not see). Add puts someone on the list without a request. Every click
  confirms first.
- The student runs the wizard: the Wayne State sign-in step fetches `/allowlist`, finds them, and the
  trial button asks `/trial` for a key. The Worker asks Microsoft who they are, requires the approved
  record, and signs a key for `TRIAL_DAYS` days (365) with the trial key; a person can be issued three
  keys a day (a new laptop, a reset), and the id of each is written to their approved record.
- Remove deletes the record and puts every key issued to that person on the revocation list, which
  the Worker signs with the trial key and serves at `/revoked`; installations fetch it daily. Withdraw
  one key on its own with the form at the bottom of the admin page (`revoke-lid`).
- Ashley Bridge has no keys. The student signs in to their own Open OnDemand portal; the extension
  reads the account name the portal's dashboard shows and asks `POST /access_check` whether that
  account is on the approved list (when the portal is connected, on each click of its icon, and about
  once a day). Yes means it works; no means its one button reads "Ask for access" and opens
  `request.html?access_id=<account>`, which fills in the first field. Remove takes the approval away:
  the next check answers no and the extension stops starting workers. The checks on record (who, from
  which portal, which version, when, the decision) are the `checks` list in `admin.mjs list` and in
  `GET /admin/list`. [ACCESS_CHECK.md](ACCESS_CHECK.md) is the contract.
- The mock portal the store reviewers run signs in as `st1234`; that name is on the approved list
  (note "store-reviewer mock username") so the reviewers' copy is approved by the real service.

## Requests by e-mail

Every request the form stores is e-mailed to you, one e-mail per AccessID a day at most: pressing the
button again the same day adds nothing to your inbox, and a repeat after 24 hours sends one reminder.
The e-mail, subject `Ashley access request: <AccessID> (<name>)`, says who asked (name, AccessID,
e-mail, what for, when, and which product sent them when the form says so) and carries an Approve link,
a Deny link and the admin page's address. A link opens a page with one question and one button; nothing
is decided until the button is pressed. Approve writes the same approved record the admin page writes,
with `by: "e-mail link"` in place of `"admin"`; Deny writes the same denied record, with no reason. The
audit line says the same. The student is not e-mailed either way; tell them. Sending is best effort: if
the mail provider fails, the request is still stored and answered pending, the Worker logs the
provider's status (never the key or an address), and the admin page lists the request as before.

The mail goes through Resend's HTTP API (the domain's DNS is at Spaceship, not Cloudflare, so
Cloudflare's own mail sending is not available). Until the key exists, nothing is sent, the Worker logs
`mail: no provider configured` for each request, and everything else works as before. Setting it up,
once:

1. Sign up at https://resend.com with go2432@wayne.edu and confirm the address from Resend's e-mail.
2. In Resend, open API Keys, press Create API Key (Sending access is enough), and copy the key; it is shown once.
3. Save it as one line, nothing else, in `C:/Users/grego/.ashley-vendor/resend_api_key`.
4. From WSL: `cd /mnt/c/Users/grego/OneDrive/Desktop/ashley && ASHLEY_VENDOR_DIR=/mnt/c/Users/grego/.ashley-vendor PATH=$HOME/node22/bin:$PATH bash tools/intake/deploy.sh`
5. Then `ASHLEY_VENDOR_DIR=/mnt/c/Users/grego/.ashley-vendor PATH=$HOME/node22/bin:$PATH node tools/intake/admin.mjs notify-test`: it prints `sent: the provider answered 200` and the test arrives (the first one may land in junk).

Until the domain is verified at Resend, Resend sends only from `onboarding@resend.dev` and only to the
address that owns the Resend account, which is why that account is yours. Later, to send from the
domain or to e-mail students too: in Resend, Domains, add `openspineconsortium.com`; add the DNS
records Resend lists at Spaceship; once Resend says Verified, write a sender such as
`Ashley access <access@openspineconsortium.com>` into `mail_from` and run `deploy.sh` again.

| File in the vendor folder | Secret | When absent |
|---|---|---|
| `resend_api_key` | `RESEND_API_KEY` | nothing is sent; `deploy.sh` says so and leaves any key already in the Worker in place |
| `decide_key` | `DECIDE_KEY` | `deploy.sh` makes it: 32 random bytes, base64. A new key makes every link already sent answer "not valid" |
| `notify_to` | `NOTIFY_TO` | `deploy.sh` writes `go2432@wayne.edu`; several addresses may be given, separated by commas |
| `mail_from` | `MAIL_FROM` | `deploy.sh` writes `Ashley access <onboarding@resend.dev>` |

`deploy.sh` pipes each file into `wrangler secret put`; no value is on a command line or in its output.
`wrangler.toml` needs no binding for these.

**The link.** `https://<worker>/decide?t=<payload>.<signature>`, where `payload` is the base64url of
the JSON `{"v":1,"access_id":"ab1234","decision":"approve","nonce":"<22 characters>","exp":<seconds>}`
and `signature` is the base64url of HMAC-SHA256 over `payload` with `DECIDE_KEY`. `exp` is 14 days
after the e-mail was sent. The two links in one e-mail share the nonce, so once either is used, both
are spent. The link carries the AccessID and the decision only; the person's name is read from the
record when the page opens. The pages have no scripts, are not cached (`Cache-Control: no-store`), and
send no Referer, so following the admin-page link from them does not pass the token on.

**What a link scanner can and cannot do.** Mail programs and scanners (Microsoft's Safe Links at
Wayne State, for one) often open links before you do. Opening a link (GET) only shows the question: it
writes nothing, and the tests hold it to that. Only the button (a POST with `confirm=1`) decides. A
scanner that also pressed buttons on the pages it opened would decide; such scanners are rare, and the
record would say `by: "e-mail link"` with the time; if that ever happens, undo it on the admin page.
Nobody can change a link into another one: a different AccessID or decision breaks the signature and
the page says "not valid". A used link says "already used", a link older than 14 days says "expired",
and both point at the admin page. Anyone who has the e-mail can use its links, so the links are as
private as your inbox: do not forward the e-mail. KV takes up to a minute to reach every Cloudflare
location, so two presses from far-apart places within that minute could both get through; for the same
decision that changes nothing.

## Publishing your own revocation list

Keys you issued with `ashley-license.mjs` are withdrawn with the tool; the service then needs to hear
about them:

```
node ../license/ashley-license.mjs revoke --lid L-... --reason "key shared"
bash publish.sh                    # sends every id in extension/media/revoked.txt to /admin/revoke-lid
```

`publish.sh` verifies the bundled list against `grid/license_keys.json`, reads the admin token from
`~/.ashley-vendor/admin_token`, posts all the ids in one call (`revoke-lid` takes `{"lids": [...]}`
as well as one `lid`; one call per id would race its own earlier writes in KV and drop some), then
waits until `/revoked` lists them all (KV takes up to a minute to settle). From then on the service's
list is the union of yours and its own removals. Run it from WSL with `ASHLEY_VENDOR_DIR` pointing at
the vendor folder, as with `deploy.sh`. Each release still bundles
`extension/media/revoked.txt`, which holds only the keys withdrawn with the tool; keys the service
withdrew reach installations through `/revoked`.

## What the service keeps

| Store | Key | Value | Retention |
|---|---|---|---|
| ACCESS | `approved:<AccessID>` | name, e-mail, note, when and by whom, the ids of the keys issued | until removed |
| ACCESS | `pending:<AccessID>` | name, e-mail, note, when asked | until approved or denied |
| ACCESS | `denied:<AccessID>` | the same, plus when and why | until removed or approved |
| ACCESS | `revoked`, `revoked_signed` | the withdrawn key ids; the signed list | until replaced |
| ACCESS | `audit:<time>` | action, AccessID, by | for the record |
| ACCESS | `req:<hash>:<day>` | requests from one connection (a salted hash; the address itself is never stored) | 2 days |
| ACCESS | `notified:<AccessID>` | when the last e-mail about this person's request was sent | 24 hours |
| ACCESS | `decide:<nonce>` | a used e-mail link: AccessID, decision, when | 30 days (a link lives 14) |
| ACCESS | `seen:<product>:<AccessID>` | the last access check for that product and account: portal, version, time of the first and the last check, how many, the salted hash of the address, the decision, when the decision last changed | until the maintainer deletes it |
| ACCESS | `chk:<AccessID>:<day>`, `chkip:<hash>:<day>` | access checks that day per account (120 at most) and per connection (2000 at most) | 2 days |
| TRIALS | `<AccessID>` | the last key issued: time, key id, e-mail, end date | for the record |
| TRIALS | `issue:<AccessID>:<day>` | keys issued that day | 2 days |
| REPORTS | `rate:<install id>:<day>` | count | 2 days |
| REPORTS | `sig:<signature>` | issue number, count | 365 days |

The reports live in the GitHub issues, where the triage workflow reads them. The access requests live
in KV (above) and in the maintainer's e-mail; they are filed as issues too only when `GITHUB_TOKEN` is
set, which it is not today.

## Limits and checks

Reports are capped at 64 KB, ten per installation per day; every string is stripped of hidden
comments and zero-width characters and truncated. Requests: the AccessID is two letters and four
digits, the e-mail must be `AccessID@wayne.edu`, the name 2 to 80 characters, the note 500 at most,
ten requests per connection per day; the issue body carries the AccessID, name and note, not the
e-mail. Keys require a Microsoft account in the allowed domains (`ALLOWED_DOMAINS`, default
`wayne.edu`) whose user name, or on-premises account name, is an AccessID, and an approved record
for it; anything else is answered with a message that says what to do. `/request` and `/admin/*`
answer browsers from `SITE_ORIGIN` only. `/access_check` answers any origin (the caller is a browser
extension), looks up one account and never returns the list; it is capped at 120 checks per account
and 2000 per connection a day, and the extension itself asks only a few times a day.

## Tests

```
node --test tools/intake/worker.test.mjs
```

An in-memory KV, stubbed Microsoft Graph and GitHub, and the test signing key as the trial key; what
the Worker signs is checked with `grid/license.js`, the verifier Ashley ships.
