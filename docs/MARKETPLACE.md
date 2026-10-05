# Publishing Beethoven for VS Code to the Visual Studio Marketplace

Written for the maintainer. The listing is **Free**; the Trial Edition works only for approved Wayne
State AccessIDs, and the README says so in its first paragraph (Microsoft's listing rules ask for
the account requirement and the data access to be disclosed up front; both are).

## The rename: a new item, and the old one retired

Up to 3.0.0 the extension was **Ashley for VS Code**, item `openspineconsortium.ashley`. A
Marketplace item's id is its publisher and name and cannot be changed, so 4.0.0 is a **new item**,
`openspineconsortium.beethoven` ("Beethoven for VS Code"; `extension/package.json` has name
`beethoven`, publisher unchanged). It is uploaded as a new extension, not as an update of the old
one (the web upload below, **+ New extension**).

What the new build does for people who had Ashley installed (all of it in the extension, nothing to
configure): it reads their `ashley.*` settings until the `beethoven.*` ones are set, keeps using their
`~/.ashley-local` folder (key, sign-in record, accepted terms), recognises the `~/.ssh/config` block
Ashley wrote, moves their grid folder `~/.ashley` to `~/.beethoven` on the first grid install and
leaves a link, runs the old command ids as hidden aliases while Ashley is absent, and offers once a
day to uninstall Ashley while both are installed. What it cannot do: read the GitHub and Hugging
Face tokens Ashley kept in VS Code's SecretStorage (VS Code keeps secrets per extension id), so
students enter those once more; the manual and the README say so.

Retiring `openspineconsortium.ashley`, in this order:

1. Publish Beethoven for VS Code 5.0.0 (below), never 4.0.0 or an earlier package: they ask for an
   API key, which Beethoven uses nowhere. Tell the students (the support page, the lab's channel):
   install Beethoven for VS Code, run its wizard once, let it uninstall Ashley.
2. Do not leave the Ashley listing up while the students move: the version it offers, Ashley for VS
   Code 3.0.0, asks for an API key and must not be installed, so unpublish it (step 3) as soon as
   5.0.0 is listed. Installed copies of 3.0.0 keep working meanwhile: they read
   `https://openspineconsortium.com/ashley/services.json` and the other `/ashley/` addresses, which
   the site keeps (copies or forwards; see the site's `tools/build_site.py`
   redirect table), and they accept only keys beginning `ASHLEY1.`, which is why every issuer still
   writes that prefix (`beethoven-license.mjs --prefix`, the access service's `KEY_PREFIX`: flip only
   after every installed build older than Beethoven 8.0.0 and Beethoven for VS Code 4.0.0 is retired).
3. On the publisher page, open the Ashley row's **…** menu and choose **Unpublish**: the item
   leaves search and the install button, installed copies keep working and simply get no update. If
   the page offers to mark the item deprecated with a replacement, name `openspineconsortium.beethoven`
   (VS Code then tells people who still have Ashley installed where it went); whether this publisher
   is offered that option was not checked.
4. Do not **Remove** the Ashley item: removal is permanent and frees nothing we need.

## Once: the publisher

1. Sign in at https://marketplace.visualstudio.com/manage with the Microsoft account that will own
   the listing (a personal account, not the university tenant, so the listing survives a change of
   affiliation).
2. The publisher with id `openspineconsortium` (the id in `extension/package.json`); display name
   "OpenSpineConsortium"; the website is the support site. Leave **Verified domain** empty for now:
   verification is optional, the field takes the bare domain (`openspineconsortium.com`, no path),
   and Microsoft only grants it once the publisher has had an extension listed for six months and the
   domain registration is six months old; it then needs a DNS TXT record and a five-business-day
   review (Publishing Extensions, "Verify a publisher"). Set a reminder for six months after the first
   publish.
3. Make a Personal Access Token at https://dev.azure.com (any organisation; User settings, Personal
   access tokens): organisation **All accessible organizations**, expiry up to a year, scope
   **Marketplace > Manage** only. Store it once in the vendor folder, mode 600, and never put it on a
   command line:

   ```bash
   umask 077; cat > ~/.beethoven-vendor/vsce.pat     # paste, Enter, Ctrl-D
   ```

   The vendor folder is `C:/Users/grego/.beethoven-vendor` (it was `.ashley-vendor`; the old path is
   a junction to the new one). Scripts read `BEETHOVEN_VENDOR_DIR`, then `ASHLEY_VENDOR_DIR`, then the
   new folder, then the old one.

## Publishing without a token: the web upload

Since 2026 a **new** Azure DevOps organization must be linked to an Azure subscription (a credit card
and identity check), so the Personal Access Token in step 3 is not available until an Azure
subscription exists. The Marketplace does not need it: on the publisher's management page
(https://marketplace.visualstudio.com/manage/publishers/openspineconsortium) choose **+ New
extension → Visual Studio Code**, drop `dist/release/5.0.0/beethoven-5.0.0.vsix` on the upload box
(never the withdrawn 4.0.0 or an earlier package: they ask for an API key; `dist/release/README.md`),
and wait for the validation (a few minutes; the page e-mails the result). From then on, updates go
through the **…** menu → **Update** on the **Beethoven for VS Code** row, with the next integer
version's VSIX. Never upload a Beethoven VSIX as an update of the Ashley row: its id
(`openspineconsortium.beethoven`) is not that item's, and the two items are meant to stay separate. Everything
below (the script, the token) is the automation for later, once an Azure subscription exists; the
uploaded file is the same checked, signed release either way.

## Every release

```bash
export PATH=/c/Users/grego/tools/node22:$PATH BEETHOVEN_VENDOR_DIR=/c/Users/grego/.beethoven-vendor
node tools/release.mjs                          # build, check, sign: dist/release/<version>/beethoven-<version>.vsix
wsl -e bash -lc 'cd /mnt/c/Users/grego/OneDrive/Desktop/ashley && DRY_RUN=1 bash tools/publish_marketplace.sh'
wsl -e bash -lc 'cd /mnt/c/Users/grego/OneDrive/Desktop/ashley && bash tools/publish_marketplace.sh'
```

(The repository folder is `Desktop/ashley` until the maintainer renames it `beethoven-vscode`; the
commands change with it.) The script verifies the signed checksums and re-runs the release check on
the exact file it uploads, verifies the token against the publisher, and passes the token through
the environment (`VSCE_PAT`). It publishes to the item `extension/package.json` names, so from 4.0.0
it can only reach `openspineconsortium.beethoven`. Versions are integers (4.0.0, 5.0.0): the
Marketplace refuses a re-upload of the same version, and a changed first-run agreement is always a
new integer.

## Before the first publish of the new item (state on 2026-09-30)

- `https://openspineconsortium.com/beethoven/services.json` must carry the VS Code edition's
  addresses (`license_service`, `allowlist`, `revocation`, `report`, `request_page`,
  `support_page`), or the new build falls back to the list shipped with it and keeps error reports on
  the laptop. The agreements, the privacy statement and the third-party notices must be on the
  pages the README links: `/beethoven/vscode/terms.html`, `terms-full.html`, `privacy.html`,
  `third-party.html`, and the shared `/beethoven/support.html` and `/beethoven/request.html`.
- The support page needs the notice address (section 19(a) of both agreements).
- `pricing` is Free; keep it Free until the Full Edition and the merchant of record exist, then
  change the README's first paragraph and the listing description in the same release.
- Marketplace review: the extension makes no network request until the terms are accepted; it
  loads no remote code; the only third-party endpoints are Microsoft (sign-in), GitHub, Hugging Face,
  the lab's access service and the support site. Keep that true; it is what keeps the listing.
- Not yet measured, to check on a real machine before 5.0.0 goes up: with `beethoven.account` set
  to a listed label, does the Claude Code extension's own panel, and not only the integrated
  terminals, run under that account's folder (`CLAUDE_CONFIG_DIR` from the terminal environment;
  Cloak's known limitation, `docs/ARCHITECTURE.md`, "Several accounts of one person")? If the
  extension ignores it, the setting's description and that section must say that only the terminals
  and the processes Beethoven starts follow the setting.

## After publishing

- Install from the Marketplace in the Windows Sandbox kit (`tools/sandbox/README.md`, `-Marketplace`)
  and walk the first run once; then once more on a laptop that already has Ashley 3.0.0 set up (do
  not install it anew: it asks for an API key), to see the settings, the key and the grid folder
  carry over and the uninstall offer appear.
- Watch the listing's Q&A (the `qna` link points at the support site) and the access requests.
- To pull a release: `vsce unpublish` removes the listing; a defective version is better replaced by
  publishing the next integer with the fix.
