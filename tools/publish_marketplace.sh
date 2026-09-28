#!/usr/bin/env bash
# Publish a built, checked release to the Visual Studio Marketplace under the openspineconsortium
# publisher. Run from WSL (Windows sockets flake): bash tools/publish_marketplace.sh [version]
#
# The Personal Access Token (Azure DevOps, organisation "All accessible organizations", scope
# Marketplace > Manage) lives in ~/.ashley-vendor/vsce.pat, mode 600, and reaches vsce through the
# environment (VSCE_PAT), never through argv or a log. Nothing here builds: build and check first with
# node tools/release.mjs, and publish the very file that was checked and signed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
VENDOR="${ASHLEY_VENDOR_DIR:-$HOME/.ashley-vendor}"
VERSION="${1:-$(node -p "require('$REPO/extension/package.json').version")}"
VSIX="$REPO/dist/release/$VERSION/ashley-$VERSION.vsix"
[ -s "$VSIX" ] || { echo "no release at $VSIX: run node tools/release.mjs first" >&2; exit 2; }
[ -s "$VENDOR/vsce.pat" ] || { echo "no token at $VENDOR/vsce.pat (Azure DevOps PAT, Marketplace > Manage)" >&2; exit 2; }
( cd "$REPO/dist/release/$VERSION" && node "$REPO/tools/license/ashley-license.mjs" verify-release . | tail -1 )
node "$REPO/tools/release_check.mjs" "$VSIX" | tail -1
export VSCE_PAT; VSCE_PAT="$(tr -d '\r\n' < "$VENDOR/vsce.pat")"
cd "$REPO/extension"
npx --no-install vsce verify-pat openspineconsortium
npx --no-install vsce publish --packagePath "$VSIX" --no-dependencies ${DRY_RUN:+--dry-run}
unset VSCE_PAT
echo "published ashley $VERSION: https://marketplace.visualstudio.com/items?itemName=openspineconsortium.ashley"
