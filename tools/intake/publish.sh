#!/bin/bash
# Publish the maintainer's revocation list to the service. Every licence id in extension/media/revoked.txt
# (written by ashley-license.mjs revoke, signed with the release key) is sent to POST /admin/revoke-lid; the
# Worker re-signs the union of its own list and yours with the trial key, which every installation trusts.
# The service address comes from docs/site/services.json (or the first argument); the admin token is read
# from $ASHLEY_VENDOR_DIR/admin_token (default ~/.ashley-vendor), never from an argument.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
exec node "$here/publish_revoked.mjs" "$@"
