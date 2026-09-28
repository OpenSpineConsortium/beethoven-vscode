# The licence and report service

One Cloudflare Worker (`worker.js`) gives Ashley three things without a server to keep: free trials
issued in the student's own name, error reports filed as issues in the private repository, and the
published list of withdrawn keys. It runs on the maintainer's own accounts (Cloudflare, GitHub); no
student credential other than the Microsoft sign-in token for a trial ever reaches it, and that
token is used once, to ask Microsoft who the person is.

## Deploy (once, from the maintainer's machine)

```
npm i -g wrangler
cd tools/intake
wrangler login
wrangler kv namespace create TRIALS
wrangler kv namespace create REPORTS
# paste the two ids into wrangler.toml
node ../license/ashley-license.mjs init --kid trial            # a separate signing key for trials
node ../license/ashley-license.mjs export-key --kid trial | wrangler secret put TRIAL_KEY_PKCS8_B64
echo trial | wrangler secret put TRIAL_KID
# a fine-grained GitHub token: repository GregorySchwing/ashley only, permission Issues: read and write
wrangler secret put GITHUB_TOKEN
echo GregorySchwing/ashley | wrangler secret put GITHUB_REPO
wrangler deploy
```

Then in the extension's settings for the lab (or the defaults in `package.json` before a release):
`ashley.licenseServiceUrl` and `ashley.diagnostics.endpoint` both set to the Worker's URL, and
`ashley.licenseRevocationUrl` to `<url>/revoked`.

The trial signing key is a second key on purpose: a paid key and a trial key are told apart by who
signed them, and the trial key can be rotated without touching paid licenses. Both public keys live
in `grid/license_keys.json` (the `init` command adds them), so a rebuilt release trusts both.

## Publishing the revocation list

```
node ../license/ashley-license.mjs revoke --lid L-... --reason "key shared"
bash publish.sh                                                # puts extension/media/revoked.txt into KV
```

Every installation with `ashley.licenseRevocationUrl` set fetches it daily; each release also bundles
the list current at build time.

## What the service keeps

| Store | Key | Value | Retention |
|---|---|---|---|
| TRIALS | AccessID | issued time, license id, e-mail, end date | for the record (one trial per person) |
| REPORTS | `rate:<install id>:<day>` | count | 2 days |
| REPORTS | `sig:<signature>` | issue number, count | 365 days |
| REPORTS | `revoked` | the signed list | until replaced |

The reports themselves live in the GitHub issues, where the triage workflow reads them.

## Limits and checks

Reports are capped at 64 KB, ten per installation per day; every string is stripped of hidden
comments and zero-width characters and truncated. Trials require a Microsoft account in the allowed
domains (`ALLOWED_DOMAINS`, default `wayne.edu`) whose user name, or on-premises account name, is an
AccessID (two letters and four digits). Anything else is answered with a message that says to ask
the lead.
