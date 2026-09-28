# Publishing Ashley to the Visual Studio Marketplace

Written for the maintainer. The listing is **Free**; the Trial Edition works only for approved Wayne
State AccessIDs, and the README says so in its first paragraph (Microsoft's listing rules ask for
the account requirement and the data access to be disclosed up front; both are).

## Once: the publisher

1. Sign in at https://marketplace.visualstudio.com/manage with the Microsoft account that will own
   the listing (a personal account, not the university tenant, so the listing survives a change of
   affiliation).
2. Create the publisher with id `openspineconsortium` (the id in `extension/package.json`); display
   name "OpenSpineConsortium"; add the support site as its website. Verified-domain status takes
   about six months and is optional.
3. Make a Personal Access Token at https://dev.azure.com (any organisation; User settings, Personal
   access tokens): organisation **All accessible organizations**, expiry up to a year, scope
   **Marketplace > Manage** only. Store it once, mode 600, and never put it on a command line:

   ```bash
   umask 077; cat > ~/.ashley-vendor/vsce.pat     # paste, Enter, Ctrl-D
   ```

## Every release

```bash
export PATH=/c/Users/grego/tools/node22:$PATH ASHLEY_VENDOR_DIR=/c/Users/grego/.ashley-vendor
node tools/release.mjs                          # build, check, sign: dist/release/<version>/
wsl -e bash -lc 'cd /mnt/c/Users/grego/OneDrive/Desktop/ashley && DRY_RUN=1 bash tools/publish_marketplace.sh'
wsl -e bash -lc 'cd /mnt/c/Users/grego/OneDrive/Desktop/ashley && bash tools/publish_marketplace.sh'
```

The script verifies the signed checksums and re-runs the release check on the exact file it
uploads, verifies the token against the publisher, and passes the token through the environment
(`VSCE_PAT`). Versions are integers (3.0.0, 4.0.0): the Marketplace refuses a re-upload of the same
version, and a changed first-run agreement is always a new integer.

## Before the first publish (state on 2026-09-28)

- The access service must be deployed and `services.json` published, or every Marketplace install
  will report "no access service is configured" after the Wayne State sign-in (the bundled list
  then applies, which holds one AccessID). See `tools/intake/README.md`.
- The support page needs the notice address (section 19(a) of both agreements).
- `pricing` is Free; keep it Free until the Full Edition and the merchant of record exist, then
  change the README's first paragraph and the listing description in the same release.
- Marketplace review: the extension makes no network request until the terms are accepted; it
  loads no remote code; the only third-party endpoints are Microsoft (sign-in), GitHub, Hugging Face,
  the lab's access service and the support site. Keep that true; it is what keeps the listing.

## After publishing

- Install from the Marketplace in the Windows Sandbox kit (`tools/sandbox/README.md`, `-Marketplace`)
  and walk the first run once.
- Watch the listing's Q&A (the `qna` link points at the support site) and the access requests.
- To pull a release: `vsce unpublish` removes the listing; a defective version is better replaced by
  publishing the next integer with the fix.
