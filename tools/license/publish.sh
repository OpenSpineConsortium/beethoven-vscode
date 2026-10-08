#!/bin/bash
# Publish the maintainer's revocation list to the access service. Every licence id in
# extension/media/revoked.txt (written by beethoven-license.mjs revoke, signed with the release key) is sent
# to the service's POST /admin/revoke-lid; the service re-signs the union of its own list and yours with the
# trial key, which every installation trusts. The service is OpenSpineConsortium/beethoven-access, reached
# only over HTTP: its address is the first argument, else BEETHOVEN_SERVICE_URL, else the primary Worker
# (service.mjs). The admin token is read from admin_token in the vendor folder (BEETHOVEN_VENDOR_DIR, else
# ~/.beethoven-vendor; vendor.mjs reads the old ASHLEY_VENDOR_DIR and ~/.ashley-vendor too), never from an
# argument.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
exec node "$here/publish_revoked.mjs" "$@"
