# Licensing: how keys work, how to issue them, how to release

Written for the maintainer (the lab lead). Students see only `Beethoven: License`, the first-run
terms, and the access step of the wizard. (Beethoven for VS Code was Ashley for VS Code until 3.0.0;
the names this file keeps from then are marked where they appear.)

## The key

A license key is one line, `ASHLEY1.<payload>.<signature>`: a JSON payload (version, key id,
license id, product, edition, who it is for, dates, grace days) signed with Ed25519. `ASHLEY1.` is
the prefix every issuer still writes, because Ashley for VS Code 3.0.0 and the grid scripts before 7
accept nothing else; since 4.0.0 (grid scripts 7) keys beginning `BEETHOVEN1.` verify as well, and
revocation lists likewise under `ASHLEYREV1` and `BEETHOVENREV1`. The switch is `KEY_PREFIX` in the
access service's `wrangler.toml` and `--prefix beethoven` in the vendor tool; flip it only after every
build older than Beethoven for VS Code 4.0.0 and Beethoven 8.0.0 is retired. The payload's `product`
field stays `ashley` (every verifier checks it, none shows it).

The public keys a release trusts are in `grid/license_keys.json` and ship inside the extension and the
grid scripts; the private keys live only in the maintainer's vendor folder
(`C:/Users/grego/.beethoven-vendor`, or `BEETHOVEN_VENDOR_DIR`; the old folder `~/.ashley-vendor` is
a junction to it and `ASHLEY_VENDOR_DIR` is still read), never in the repository (`.gitignore`
refuses `*.pem`). One implementation, `grid/license.js`, verifies keys in the extension, the CLI,
the MCP server and the grid daemon.

A key names one person, by AccessID and e-mail; keys for a whole e-mail domain (the retired site
edition) are refused. The extension records the Wayne State sign-in and accepts the key only when it
names that person; the grid daemon accepts it only for the unix account it runs under. A key has an
end date and a grace period (14 days by default; trials 3). After the grace period Beethoven stops. A
clock set back does not revive a key: the latest time seen is remembered on the laptop and on the
grid. Withdrawn keys go on a signed revocation list, bundled with each release and fetched daily from
the access service (`revocation` in `services.json`, or `beethoven.licenseRevocationUrl` where set).

What a key cannot do: it is a check in code students can read (a VSIX is a zip of JavaScript), so it
keeps honest people honest and gives a clear end to trials; the compliance report explains why it
is not a legal lock (`docs/research/reports/`). The controls that hold are the agreement, the lab
folder's ACL, and the revocation list.

## Issuing

```
export BEETHOVEN_VENDOR_DIR=~/.beethoven-vendor              # once per shell; the default is the same path
node tools/license/beethoven-license.mjs init --kid k1        # once: makes the release signing key
node tools/license/beethoven-license.mjs init --kid trial     # once: a separate key for trials (the service signs with it)
node tools/license/beethoven-license.mjs issue --access-id ab1234 --name "A. Student" --email ab1234@wayne.edu --edition student --days 365
node tools/license/beethoven-license.mjs issue --access-id ab1234 --edition trial --days 30 --grace 3
node tools/license/beethoven-license.mjs list
node tools/license/beethoven-license.mjs verify --file key.txt --access-id ab1234
node tools/license/beethoven-license.mjs revoke --lid L-... --reason "shared"   # writes extension/media/revoked.txt: rebuild, or publish it (tools/intake/publish.sh)
```

`ashley-license.mjs`, the tool's name before the rename, still runs it. `issue` prints the key and
saves a copy under the vendor folder; the ledger (`ledger.jsonl`) records every key with the name and
e-mail given. Send the key to the student by any private channel; they paste it into
`Beethoven: License` or the wizard's access step. Editions are labels for you (`student`, `lab`,
`trial`); Beethoven treats them the same except that trials say so.

Back the vendor folder up offline. A lost release key means no new keys for the builds that trust
it; a new key (`init --kid k2`) needs a new release before students can use keys signed with it.

## Trials without the lead (superseded by the access service)

`tools/intake/` is a small service (a Cloudflare Worker) that issues keys to approved people after
asking Microsoft who the signed-in student is, keeps the approved list, files error reports as
issues, and serves the revocation list. Its README has the deployment steps. Until it is deployed,
the trial button tells students to ask their lead, and `issue --edition trial` is the way.

## Access requests and the approved list

Who may use Beethoven is a list of AccessIDs, kept by the service (one list for both editions, the
browser extension Beethoven and Beethoven for VS Code):

- **Asking.** A student opens the request page on the website
  (`https://openspineconsortium.com/beethoven/request.html`; the old address under `/ashley/`, which
  installed 3.0.0 builds open, forwards there) and gives their AccessID, name, `AccessID@wayne.edu`
  and what they will use Beethoven for. The Worker checks the fields, stores the request as pending
  and e-mails the maintainer (through Resend) with a signed, one-use Approve and Deny link; it would
  also open an issue labelled `beethoven-access-request` if `GITHUB_TOKEN` were set, which it is not.
  Sending the same request again tells the student where it stands: pending, approved, or not
  approved (never the reason).
- **Deciding.** Press Approve or Deny in that e-mail (each opens a page with one button; nothing is
  decided until it is pressed), or use the admin page
  (`https://openspineconsortium.com/beethoven/admin.html`), which asks for the admin token once per
  browser tab (the value in `admin_token` in the vendor folder; put Cloudflare Access in front of
  `/admin/*` as well) and shows four tables: waiting, approved, not approved, withdrawn keys.
  Approve, Deny (with a reason kept for you), Add (someone who never asked), Remove, and Withdraw one
  key; every action confirms first, and every write leaves an audit line in the service's store.
- **The key.** The wizard's first step fetches the approved list (`/allowlist`, the same shape as
  `extension/media/allowlist.json`) and, for an approved person, the access step asks `/trial` for a
  key: the Worker asks Microsoft who they are, requires the approved record, signs a key for
  `TRIAL_DAYS` days (365) with the trial key, and writes the key's id into that person's record. Three
  keys a day per person, so a reset laptop is not a support call.
- **Removal.** Remove deletes the record and puts every key issued to that person on the revocation
  list, which the Worker signs with the trial key (a key id every release trusts) and serves at
  `/revoked`; installations fetch it daily. Keys you issued with the tool are withdrawn with `revoke`
  and carried to the service with `tools/intake/publish.sh`, so the published list is the union.
- **Without the service.** The list bundled in the VSIX (`extension/media/allowlist.json`,
  `python tools/allow.py add ab1234`, rebuild) is the fallback when `services.json` names no service
  and no `beethoven.allowlistUrl` is set; keys then come from `issue`.

`https://openspineconsortium.com/beethoven/services.json` holds the service's addresses
(`access_check`, `request`, `revocation`, `allowlist`, `license_service`, `report`, plus the request
and support pages). `tools/intake/deploy.sh` writes the six service addresses into the site
repository (`openspineconsortium.github.io`) when one differs; the site's own generator,
`tools/build_site.py` in that repository, never writes it. The pages themselves (request, admin,
support, and this edition's own under `/beethoven/vscode/`: its landing page, both agreements, the
privacy statement and the third-party notices) are generated by `tools/build_site.py` from this
repository's texts and checked word for word against them; nothing in this repository builds them.
The address installed 3.0.0 builds read, `https://openspineconsortium.com/ashley/services.json`, is
kept byte for byte and names the old Worker name, `ashley-service`, which runs the same code with the
same records (`tools/intake/README.md`, "Two names").

## Releasing

```
cd extension && npm ci && npm run typecheck && npm test        # unit and VS Code tests
bash ../tools/grid_tests.sh                                    # Linux-only tests in the lab container
python -X utf8 ../docs/manual/build_manual.py                  # manual.html, manual.pdf, and the copy in extension/media
BEETHOVEN_VENDOR_DIR=/c/Users/grego/.beethoven-vendor node ../tools/release.mjs   # build, notices, package, checks, unpacked copy, signed checksums
BEETHOVEN_PACKAGED_EXT=../dist/unpacked/extension npx vscode-test --label package   # the packaged extension refuses the test key
```

`tools/release_check.mjs` refuses a build that ships source maps, fixtures, the test signing key, a
copyleft dependency, the wrong licence field, run-time code construction outside two known dependency
uses, or the old credential capture. Bundles are readable on purpose (the Marketplace has removed
minified extensions); source maps never ship.
`dist/release/<version>/` holds the `.vsix`, the changelog, both agreements, the privacy statement,
the notices, `SHA256SUMS` and `SHA256SUMS.sig`; `beethoven-license.mjs verify-release <dir>` checks
them (the signature's domain tag is still `ASHLEY-RELEASE1`, so every earlier release verifies too).
The `.vsix` in `dist/` and the release folders are committed, so students can install from the
repository; the Marketplace upload is `docs/MARKETPLACE.md`.

## What is still to settle (from the compliance report)

The licensor named in `LICENSE.txt` should be confirmed by counsel (a legal person; an LLC was
recommended before charging); the university's technology office should be told about the software;
Anthropic should be asked in writing about the orchestration pattern (`docs/ANTHROPIC_REQUEST.md`).
Paid keys come after those answers; trials can run before them.

## Changing the terms

`extension/LICENSE.txt` and `extension/PRIVACY.md` are the texts; `TERMS_VERSION` in
`extension/src/core/terms.ts` is an integer that every substantive change bumps (no fractional
versions; 6 since 5.0.0 removed the API key, 5 since the rename). A bump makes every installation show the signing dialog again before
the next command, and the old record stays on disk under `terms/<old version>/`. Keep every published
version of both texts (the repository history does; the site shows the current one at
`https://openspineconsortium.com/beethoven/vscode/terms.html`, rendered from this repository's text
by the site's `tools/build_site.py`). A change to the dispute section applies only to disputes that
arise after the person accepts it; say so in the changelog. The affirmation wording in `AFFIRMATIONS`
is part of the record: change it only with the texts, and never pre-tick a box. Arbitration is
deliberately absent (since version 3); `docs/legal/ARBITRATION_OPTION.md` holds the clause and the
threshold for adopting it.

Two agreements ship: `extension/LICENSE.txt` (Trial Edition, accepted at first use) and
`extension/LICENSE-FULL.txt` (Full Edition, accepted when a non-trial key is registered). They share
section numbers so the dialog's affirmations reference both correctly; change them together, bump
`TERMS_VERSION` once, and name the new version and date in `affirmationsFor()`. Before the first paid
key the Full Edition agreement's licensor becomes the LLC (a version bump; Trial Edition users are
not re-asked unless their text changed).

## Before a public listing or a paid key

At checkout (a merchant of record's page or your own): the legal name and street address of the
seller and the refund policy before payment (California B&P 17538); the sentence "you are buying a
license to use Beethoven for VS Code, not the software" beside the price (B&P 17500.6); a separate
age statement with date and typed name; the trial sentence (free, no card, ends by itself) beside the
word Trial.

The support page must carry a real notice address (not a university or hospital one); the licensor
should be the entity counsel confirms (an LLC was recommended); the university's technology office
should have been told; Anthropic's written answer should be on file; the copyright registered; a
technology errors-and-omissions policy in place. `docs/research/reports/` has the two reports behind
this list.
