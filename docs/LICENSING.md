# Licensing: how keys work, how to issue them, how to release

Written for the maintainer (the lab lead). Students see only `Ashley: License`, the first-run
terms, and the trial button.

## The key

A license key is one line, `ASHLEY1.<payload>.<signature>`: a JSON payload (version, key id,
license id, product, edition, who it is for, dates, grace days) signed with Ed25519. The public keys
a release trusts are in `grid/license_keys.json` and ship inside the extension and the grid scripts;
the private keys live only in the maintainer's vendor folder (`~/.ashley-vendor`, or
`ASHLEY_VENDOR_DIR`), never in the repository (`.gitignore` refuses `*.pem`). One implementation,
`grid/license.js`, verifies keys in the extension, the CLI, the MCP server and the grid daemon.

A key names a person by AccessID and e-mail (or, for a site license, an e-mail domain). The
extension records the Wayne State sign-in and accepts the key only when it names that person; the
grid daemon accepts it only for the unix account it runs under. A key has an end date and a grace
period (14 days by default; trials 3). After the grace period Ashley stops. A clock set back does not
revive a key: the latest time seen is remembered on the laptop and on the grid. Withdrawn keys go on
a signed revocation list, bundled with each release and, if `ashley.licenseRevocationUrl` is set,
fetched daily.

What a key cannot do: it is a check in code students can read (a VSIX is a zip of JavaScript), so it
keeps honest people honest and gives a clear end to trials; the compliance report explains why it
is not a legal lock (`docs/research/reports/`). The controls that hold are the agreement, the lab
folder's ACL, and the revocation list.

## Issuing

```
export ASHLEY_VENDOR_DIR=~/.ashley-vendor            # once per shell; the default is the same path
node tools/license/ashley-license.mjs init --kid k1        # once: makes the release signing key
node tools/license/ashley-license.mjs init --kid trial     # once: a separate key for trials (the service signs with it)
node tools/license/ashley-license.mjs issue --access-id ab1234 --name "A. Student" --email ab1234@wayne.edu --edition student --days 365
node tools/license/ashley-license.mjs issue --access-id ab1234 --edition trial --days 30 --grace 3
node tools/license/ashley-license.mjs list
node tools/license/ashley-license.mjs verify --file key.txt --access-id ab1234
node tools/license/ashley-license.mjs revoke --lid L-... --reason "shared"   # writes extension/media/revoked.txt: rebuild, or publish it (tools/intake/publish.sh)
```

`issue` prints the key and saves a copy under the vendor folder; the ledger (`ledger.jsonl`) records
every key with the name and e-mail given. Send the key to the student by any private channel; they
paste it into `Ashley: License` or the first wizard step. Editions are labels for you (`student`,
`lab`, `trial`, `site`); Ashley treats them the same except that trials say so.

Back the vendor folder up offline. A lost release key means no new keys for the builds that trust
it; a new key (`init --kid k2`) needs a new release before students can use keys signed with it.

## Trials without the lead (superseded by the access service)

`tools/intake/` is a small service (a Cloudflare Worker) that issues keys to approved people after
asking Microsoft who the signed-in student is, keeps the approved list, files error reports as
issues, and serves the revocation list. Its README has the deployment steps. Until it is deployed,
the trial button tells students to ask their lead, and `issue --edition trial` is the way.

## Access requests and the approved list

Who may use Ashley is a list of AccessIDs, and the service is where it lives once deployed:

- **Asking.** A student opens the request page on the website
  (`https://openspineconsortium.com/ashley/request.html`, `docs/site/request.html`) and gives
  their AccessID, name, `AccessID@wayne.edu` and what they will use Ashley for. The Worker checks the
  fields, stores the request as pending and opens an issue `Access request: <AccessID>` labelled
  `access-request` in the private repository. Sending the same request again tells the student where
  it stands: pending, approved, or not approved (never the reason).
- **Deciding.** The admin page (`docs/site/admin.html`) asks for the admin token once per browser
  tab (the value in `~/.ashley-vendor/admin_token`; put Cloudflare Access in front of `/admin/*` as
  well) and shows four tables: waiting, approved, not approved, withdrawn keys. Approve, Deny (with a
  reason kept for you), Add (someone who never asked), Remove, and Withdraw one key; every action
  confirms first, and every write leaves an audit line in the service's store.
- **The key.** The wizard's first step fetches the approved list (`/allowlist`, the same shape as
  `extension/media/allowlist.json`) and, for an approved person, the trial button asks `/trial` for a
  key: the Worker asks Microsoft who they are, requires the approved record, signs a key for
  `TRIAL_DAYS` days (365) with the trial key, and writes the key's id into that person's record. Three
  keys a day per person, so a reset laptop is not a support call.
- **Removal.** Remove deletes the record and puts every key issued to that person on the revocation
  list, which the Worker signs with the trial key (a key id every release trusts) and serves at
  `/revoked`; installations with `ashley.licenseRevocationUrl` fetch it daily. Keys you issued with
  the tool are withdrawn with `revoke` and carried to the service with `tools/intake/publish.sh`, so
  the published list is the union.
- **Without the service.** The list bundled in the VSIX (`extension/media/allowlist.json`,
  `python tools/allow.py add ab1234`, rebuild) is the fallback when `docs/site/services.json` has
  no service address and no `ashley.allowlistUrl` is set; keys then come from `issue`.

`docs/site/services.json` holds the service's addresses (`license_service`, `allowlist`,
`revocation`, `report`, plus the request and support pages); the README in `tools/intake/` says how
to fill it after `wrangler deploy`.

## Releasing

```
cd extension && npm ci && npm run typecheck && npm test        # unit and VS Code tests
bash ../tools/grid_tests.sh                                    # Linux-only tests in the lab container
node ../tools/release.mjs                                      # build, notices, package, checks, unpacked copy, signed checksums
ASHLEY_PACKAGED_EXT=../dist/unpacked/extension npx vscode-test --label package   # the packaged extension refuses the test key
```

`tools/release_check.mjs` refuses a build that ships source maps, fixtures, the test signing key, a
copyleft dependency, the wrong licence field, run-time code construction outside two known dependency
uses, or the old credential capture. Bundles are readable on purpose (the Marketplace has removed
minified extensions); source maps never ship.
`dist/release/<version>/` holds the `.vsix`, the changelog, the licence, the privacy statement, the
notices, `SHA256SUMS` and `SHA256SUMS.sig`; `ashley-license.mjs verify-release <dir>` checks them.
Only the `.vsix` is committed (`dist/`), so students can install from the repository.

## What is still to settle (from the compliance report)

The licensor named in `LICENSE.txt` should be confirmed by counsel (a legal person; an LLC was
recommended before charging); the university's technology office should be told about the software;
Anthropic should be asked in writing about the orchestration pattern (`docs/ANTHROPIC_REQUEST.md`).
Paid keys come after those answers; trials can run before them.

## Changing the terms

`extension/LICENSE.txt` and `extension/PRIVACY.md` are the texts; `TERMS_VERSION` in
`extension/src/core/terms.ts` is an integer that every substantive change bumps (no fractional
versions). A bump makes every installation show the signing dialog again before the next command,
and the old record stays on disk under `terms/<old version>/`. Keep every published version of both
texts (the repository history does; `docs/site/license.txt` shows the current one). A change to the
dispute section applies only to disputes that arise after the person accepts it; say so in the
changelog. The affirmation wording in `AFFIRMATIONS` is part of the record: change it only with the
texts, and never pre-tick a box. Arbitration is deliberately absent from version 3;
`docs/legal/ARBITRATION_OPTION.md` holds the clause and the threshold for adopting it.

Two agreements ship: `extension/LICENSE.txt` (Trial Edition, accepted at first use) and
`extension/LICENSE-FULL.txt` (Full Edition, accepted when a non-trial key is registered). They share
section numbers so the dialog's affirmations reference both correctly; change them together, bump
`TERMS_VERSION` once, and name the new version and date in `affirmationsFor()`. Before the first paid
key the Full Edition agreement's licensor becomes the LLC (a version bump; Trial Edition users are
not re-asked unless their text changed).

## Before a public listing or a paid key

At checkout (a merchant of record's page or your own): the legal name and street address of the
seller and the refund policy before payment (California B&P 17538); the sentence "you are buying a
license to use Ashley, not the software" beside the price (B&P 17500.6); a separate age statement
with date and typed name; the trial sentence (free, no card, ends by itself) beside the word Trial.

The support page must carry a real notice address (not a university or hospital one); the licensor
should be the entity counsel confirms (an LLC was recommended); the university's technology office
should have been told; Anthropic's written answer should be on file; the copyright registered; a
technology errors-and-omissions policy in place. `docs/research/reports/` has the two reports behind
this list.
