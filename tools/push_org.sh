#!/usr/bin/env bash
# Push main to the organisation's private repository OpenSpineConsortium/beethoven-vscode (the only remote
# since 2026-09-30; the personal copy GregorySchwing/ashley is retired). Runs where a GitHub credential with
# organisation rights is stored: on the maintainer's machine that is WSL (git credential.helper=store).
#   wsl -e bash -lc 'bash /mnt/c/Users/grego/OneDrive/Desktop/ashley/tools/push_org.sh'
set -euo pipefail
cd "$(dirname "$0")/.."
git push https://github.com/OpenSpineConsortium/beethoven-vscode.git main:main --tags 2>&1 | tail -3
