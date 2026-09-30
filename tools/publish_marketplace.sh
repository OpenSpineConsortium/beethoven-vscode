#!/usr/bin/env bash
# Publish a built, checked release of Beethoven for VS Code to the Visual Studio Marketplace under the
# openspineconsortium publisher. Run from WSL (Windows sockets flake): bash tools/publish_marketplace.sh [version]
#
# vsce publishes to the item that extension/package.json names (publisher.name): from 4.0.0 that is
# openspineconsortium.beethoven, a new item, because the item of 3.0.0 and before,
# openspineconsortium.ashley, cannot be renamed (docs/MARKETPLACE.md says how that listing is retired).
# The release file's name and the item's address are read from package.json for the same reason.
#
# The Personal Access Token (Azure DevOps, organisation "All accessible organizations", scope
# Marketplace > Manage) lives in vsce.pat in the vendor folder, mode 600, and reaches vsce through the
# environment (VSCE_PAT), never through argv or a log. The vendor folder is the first of
# BEETHOVEN_VENDOR_DIR, ASHLEY_VENDOR_DIR (the old variable, still read), ~/.beethoven-vendor,
# ~/.ashley-vendor (the old folder, still read). Nothing here builds: build and check first with
# node tools/release.mjs, and publish the very file that was checked and signed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/.." && pwd)"
if [ -n "${BEETHOVEN_VENDOR_DIR:-}" ]; then VENDOR="$BEETHOVEN_VENDOR_DIR"
elif [ -n "${ASHLEY_VENDOR_DIR:-}" ]; then VENDOR="$ASHLEY_VENDOR_DIR"
elif [ -d "$HOME/.beethoven-vendor" ] || [ ! -d "$HOME/.ashley-vendor" ]; then VENDOR="$HOME/.beethoven-vendor"
else VENDOR="$HOME/.ashley-vendor"; fi
PKG="$REPO/extension/package.json"
VERSION="${1:-$(node -p "require('$PKG').version")}"
NAME="$(node -p "require('$PKG').name")"
PUBLISHER="$(node -p "require('$PKG').publisher")"
VSIX="$REPO/dist/release/$VERSION/$NAME-$VERSION.vsix"
[ -s "$VSIX" ] || { echo "no release at $VSIX: run node tools/release.mjs first" >&2; exit 2; }
[ -s "$VENDOR/vsce.pat" ] || { echo "no token at $VENDOR/vsce.pat (Azure DevOps PAT, Marketplace > Manage)" >&2; exit 2; }
( cd "$REPO/dist/release/$VERSION" && BEETHOVEN_VENDOR_DIR="$VENDOR" node "$REPO/tools/license/beethoven-license.mjs" verify-release . | tail -1 )
node "$REPO/tools/release_check.mjs" "$VSIX" | tail -1
export VSCE_PAT; VSCE_PAT="$(tr -d '\r\n' < "$VENDOR/vsce.pat")"
cd "$REPO/extension"
npx --no-install vsce verify-pat "$PUBLISHER"
npx --no-install vsce publish --packagePath "$VSIX" --no-dependencies ${DRY_RUN:+--dry-run}
unset VSCE_PAT
echo "published $NAME $VERSION: https://marketplace.visualstudio.com/items?itemName=$PUBLISHER.$NAME"
