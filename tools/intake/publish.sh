#!/bin/bash
# Publish the maintainer's revocation list to the service. Every licence id in extension/media/revoked.txt
# (written by beethoven-license.mjs revoke, signed with the release key) is sent to POST /admin/revoke-lid;
# the Worker re-signs the union of its own list and yours with the trial key, which every installation
# trusts. The service address is the first argument, else what service.mjs finds (BEETHOVEN_SERVICE_URL,
# the site's beethoven/services.json, the primary Worker); the admin token is read from admin_token in the
# vendor folder (BEETHOVEN_VENDOR_DIR, else ~/.beethoven-vendor; ../license/vendor.mjs reads the old
# ASHLEY_VENDOR_DIR and ~/.ashley-vendor too), never from an argument.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
exec node "$here/publish_revoked.mjs" "$@"
