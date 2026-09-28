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

## Trials without the lead

`tools/intake/` is a small service (a Cloudflare Worker) that issues one trial per AccessID after
asking Microsoft who the signed-in student is, files error reports as issues, and serves the
revocation list. Its README has the deployment steps. Until it is deployed, the trial button tells
students to ask their lead, and `issue --edition trial` is the way.

## Releasing

```
cd extension && npm ci && npm run typecheck && npm test        # unit and VS Code tests
bash ../tools/grid_tests.sh                                    # Linux-only tests in the lab container
node ../tools/release.mjs                                      # build, notices, package, checks, unpacked copy, signed checksums
ASHLEY_PACKAGED_EXT=../dist/unpacked/extension npx vscode-test --label package   # the packaged extension refuses the test key
```

`tools/release_check.mjs` refuses a build that ships source maps, fixtures, the test signing key, a
copyleft dependency, the wrong licence field, an unminified bundle, or the old credential capture.
`dist/release/<version>/` holds the `.vsix`, the changelog, the licence, the privacy statement, the
notices, `SHA256SUMS` and `SHA256SUMS.sig`; `ashley-license.mjs verify-release <dir>` checks them.
Only the `.vsix` is committed (`dist/`), so students can install from the repository.

## What is still to settle (from the compliance report)

The licensor named in `LICENSE.txt` should be confirmed by counsel (a legal person; an LLC was
recommended before charging); the university's technology office should be told about the software;
Anthropic should be asked in writing about the orchestration pattern (`docs/ANTHROPIC_REQUEST.md`).
Paid keys come after those answers; trials can run before them.
