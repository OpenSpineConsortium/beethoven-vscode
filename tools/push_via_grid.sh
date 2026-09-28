#!/usr/bin/env bash
# Push this repository to GitHub through the grid, where a repo-scoped GITHUB_TOKEN already lives in
# the login environment. The token never comes to the laptop and is never written to disk on the grid:
#   laptop: git bundle -> scp ~/ashley.bundle
#   grid:   clone the bundle into ~/ashley-repo, push with an in-memory credential helper
#   bash tools/push_via_grid.sh [remote-url]        (Git Bash on Windows, or any shell with ssh)
set -uo pipefail
REPO_URL=${1:-https://github.com/GregorySchwing/ashley.git}
G=${ASHLEY_GRID:-wsu-grid}
cd "$(dirname "$0")/.." || exit 1
B=$(mktemp -t ashley.XXXXXX.bundle 2>/dev/null || echo "/tmp/ashley.$$.bundle")
git bundle create "$B" --all || exit 1
scp -q -o BatchMode=yes "$B" "$G:~/ashley.bundle" || exit 1
rm -f "$B"
ssh -o BatchMode=yes "$G" 'bash -lc "set -u; [ -n \"\${GITHUB_TOKEN:-}\" ] || { echo \"no GITHUB_TOKEN in the grid login environment\"; exit 1; }; rm -rf ~/ashley-repo && git clone -q ~/ashley.bundle ~/ashley-repo && cd ~/ashley-repo && git checkout -q main && git remote set-url origin '"$REPO_URL"' && git -c credential.helper=\"!f() { echo username=x-access-token; echo password=\$GITHUB_TOKEN; }; f\" push -u origin main --tags 2>&1 | tail -3; rm -f ~/ashley.bundle"'
