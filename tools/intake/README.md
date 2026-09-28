# The access, licence and report service

One Cloudflare Worker (`worker.js`) gives Ashley four things without a server to keep: the list of
approved AccessIDs (asked for from the website, managed from an admin page), keys issued in the
student's own name to approved people, error reports filed as issues in the private repository, and
the published list of withdrawn keys. It runs on the maintainer's own accounts (Cloudflare, GitHub);
no student credential other than the Microsoft sign-in token for a key ever reaches it, and that
token is used once, to ask Microsoft who the person is. Nothing here logs a token, an e-mail or an
IP address.

## Routes

| Route | Who calls it | What it does |
|---|---|---|
| `GET /allowlist` | the extension (`ashley.allowlistUrl`) | the approved AccessIDs, in the shape of `extension/media/allowlist.json`; cached one minute |
| `POST /request` | `docs/site/request.html` | a student asks for access: stored as pending, filed as an issue labelled `access-request`; answers pending, approved or denied |
| `POST /trial` | the extension (`ashley.licenseServiceUrl`) | a key for a signed-in, approved person; three a day at most; the key's id is written to the approved record |
| `GET /revoked` | every installation, daily | the signed revocation list |
| `POST /report` | installations that allow error reports | an issue labelled `diagnostic-report`; repeats add a count |
| `/admin/*` | `docs/site/admin.html`, `publish.sh` | `list`, `approve`, `deny`, `add`, `remove`, `revoke-lid`, behind the bearer token `ADMIN_TOKEN` |
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
  "support_page": "https://openspineconsortium.com/ashley/support.html"
}
```

The extension reads this file to find the service, and `request.html` and `admin.html` read it too, so
the Worker's address lives in one place. While the four service values are empty the extension uses
the allowlist bundled in the VSIX and the trial button says to ask the lead. The settings
`ashley.licenseServiceUrl`, `ashley.allowlistUrl`, `ashley.licenseRevocationUrl` and
`ashley.diagnostics.endpoint` still override the file for one installation.

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
  for. The Worker checks the four fields, stores a pending record, and opens an issue titled
  `Access request: <AccessID>` labelled `access-request` so you see it in the repository.
- You open `admin.html` and click Approve (or Deny, with a reason the student does not see). Add puts
  someone on the list without a request. Every click confirms first.
- The student runs the wizard: the Wayne State sign-in step fetches `/allowlist`, finds them, and the
  trial button asks `/trial` for a key. The Worker asks Microsoft who they are, requires the approved
  record, and signs a key for `TRIAL_DAYS` days (365) with the trial key; a person can be issued three
  keys a day (a new laptop, a reset), and the id of each is written to their approved record.
- Remove deletes the record and puts every key issued to that person on the revocation list, which
  the Worker signs with the trial key and serves at `/revoked`; installations fetch it daily. Withdraw
  one key on its own with the form at the bottom of the admin page (`revoke-lid`).

## Publishing your own revocation list

Keys you issued with `ashley-license.mjs` are withdrawn with the tool; the service then needs to hear
about them:

```
node ../license/ashley-license.mjs revoke --lid L-... --reason "key shared"
bash publish.sh                    # sends every id in extension/media/revoked.txt to /admin/revoke-lid
```

`publish.sh` verifies the bundled list against `grid/license_keys.json`, reads the admin token from
`~/.ashley-vendor/admin_token`, posts each id, and checks that `/revoked` lists them all. From then on
the service's list is the union of yours and its own removals. Each release still bundles
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
| TRIALS | `<AccessID>` | the last key issued: time, key id, e-mail, end date | for the record |
| TRIALS | `issue:<AccessID>:<day>` | keys issued that day | 2 days |
| REPORTS | `rate:<install id>:<day>` | count | 2 days |
| REPORTS | `sig:<signature>` | issue number, count | 365 days |

The reports and the access requests themselves live in the GitHub issues, where the triage workflow
reads them.

## Limits and checks

Reports are capped at 64 KB, ten per installation per day; every string is stripped of hidden
comments and zero-width characters and truncated. Requests: the AccessID is two letters and four
digits, the e-mail must be `AccessID@wayne.edu`, the name 2 to 80 characters, the note 500 at most,
ten requests per connection per day; the issue body carries the AccessID, name and note, not the
e-mail. Keys require a Microsoft account in the allowed domains (`ALLOWED_DOMAINS`, default
`wayne.edu`) whose user name, or on-premises account name, is an AccessID, and an approved record
for it; anything else is answered with a message that says what to do. `/request` and `/admin/*`
answer browsers from `SITE_ORIGIN` only.

## Tests

```
node --test tools/intake/worker.test.mjs
```

An in-memory KV, stubbed Microsoft Graph and GitHub, and the test signing key as the trial key; what
the Worker signs is checked with `grid/license.js`, the verifier Ashley ships.
