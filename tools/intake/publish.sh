#!/bin/bash
# Publish the current signed revocation list to the service (KV REPORTS, key "revoked").
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
f="$here/../../extension/media/revoked.txt"
[ -s "$f" ] || { echo "no revocation list at $f (nothing revoked yet)"; exit 0; }
cd "$here" && wrangler kv key put --binding REPORTS revoked --path "$f"
echo "published $(wc -c < "$f") bytes"
