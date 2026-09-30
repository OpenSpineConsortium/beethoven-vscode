#!/bin/bash
# Runs the Linux-only tests (phone lease, pseudo-terminal sign-in, shared session history with real
# symlinks) inside the lab container on a compute node, in a running worker's allocation.
# From the laptop:  bash tools/grid_tests.sh            (builds, copies, runs, prints the summary)
# The ssh alias is BEETHOVEN_SSH_ALIAS, else ASHLEY_SSH_ALIAS (its name before 2026-09-30), else wsu-grid.
# On the grid the files go to ~/beethoven-test (it was ~/ashley-test; an old copy there can be deleted).
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
alias_=${BEETHOVEN_SSH_ALIAS:-${ASHLEY_SSH_ALIAS:-wsu-grid}}
( cd "$here/extension" && node esbuild.mjs --tests >/dev/null )
stage=$(mktemp -d)
mkdir -p "$stage/grid" "$stage/extension/test-fixtures" "$stage/extension/dist-test/unit/core"
for f in phone.js beethovend.js license.js; do tr -d '\r' < "$here/grid/$f" > "$stage/grid/$f"; done
mkdir -p "$stage/extension/test-fixtures/license"
cp "$here/extension/test-fixtures/license/test-signing-key.pem" "$stage/extension/test-fixtures/license/"
cp "$here/grid/license_keys.json" "$stage/grid/"
tr -d '\r' < "$here/extension/test-fixtures/fake-claude.js" > "$stage/extension/test-fixtures/fake-claude.js"
for f in phone daemon; do cp "$here/extension/dist-test/unit/core/$f.test.js" "$stage/extension/dist-test/unit/core/"; done
cat > "$stage/run.sh" <<'EOS'
#!/bin/bash
# inside the allocation: the container's node; the tests' temporary files in node-local memory.
# ~/.beethoven is the grid folder (~/.ashley before 2026-09-30, now a link to it on a moved account)
set -uo pipefail
home_=$HOME/.beethoven; [ -d "$home_" ] || home_=$HOME/.ashley
source "$home_/config.env"
scr=/dev/shm/${USER}_beethoven_tests_$$; mkdir -p "$scr"; trap 'rm -rf "$scr"' EXIT
# shellcheck disable=SC2086
"$RUNTIME" exec ${BINDS:-} -B "$scr:/tmp" "$SANDBOX" bash -c 'cd "$HOME/beethoven-test/extension" && command -v script >/dev/null && echo "script: $(script --version 2>&1 | head -1)"; node --version; node --test --test-timeout=120000 --test-concurrency=1 dist-test/unit/core/phone.test.js dist-test/unit/core/daemon.test.js'
EOS
tar -C "$stage" -cf - . | ssh -o BatchMode=yes "$alias_" 'rm -rf ~/beethoven-test && mkdir -p ~/beethoven-test && tar -C ~/beethoven-test -xf - && chmod +x ~/beethoven-test/run.sh'
rm -rf "$stage"
ssh -o BatchMode=yes "$alias_" 'd=~/.beethoven; [ -d "$d" ] || d=~/.ashley; jid=""; for w in "$d"/workers/*/; do j=$(cat "$w/job.id" 2>/dev/null); [ -n "$j" ] && [ "$(squeue -h -j "$j" -o %T 2>/dev/null)" = RUNNING ] && { jid=$j; break; }; done
  [ -n "$jid" ] || { echo "no running worker to test in"; exit 2; }
  echo "testing inside job $jid"; timeout 600 srun --jobid="$jid" --overlap -N1 -n1 --quiet ~/beethoven-test/run.sh'
