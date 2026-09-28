#!/bin/bash
# Runs the Linux-only tests (phone lease, pseudo-terminal sign-in, shared session history with real
# symlinks) inside the lab container on a compute node, in a running worker's allocation.
# From the laptop:  bash tools/grid_tests.sh            (builds, copies, runs, prints the summary)
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
alias_=${ASHLEY_SSH_ALIAS:-wsu-grid}
( cd "$here/extension" && node esbuild.mjs --tests >/dev/null )
stage=$(mktemp -d)
mkdir -p "$stage/grid" "$stage/extension/test-fixtures" "$stage/extension/dist-test/unit/core"
for f in phone.js ashleyd.js; do tr -d '\r' < "$here/grid/$f" > "$stage/grid/$f"; done
tr -d '\r' < "$here/extension/test-fixtures/fake-claude.js" > "$stage/extension/test-fixtures/fake-claude.js"
for f in phone daemon; do cp "$here/extension/dist-test/unit/core/$f.test.js" "$stage/extension/dist-test/unit/core/"; done
cat > "$stage/run.sh" <<'EOS'
#!/bin/bash
# inside the allocation: the container's node; the tests' temporary files in node-local memory
set -uo pipefail
source "$HOME/.ashley/config.env"
scr=/dev/shm/${USER}_ashley_tests_$$; mkdir -p "$scr"; trap 'rm -rf "$scr"' EXIT
# shellcheck disable=SC2086
"$RUNTIME" exec ${BINDS:-} -B "$scr:/tmp" "$SANDBOX" bash -c 'cd "$HOME/ashley-test/extension" && command -v script >/dev/null && echo "script: $(script --version 2>&1 | head -1)"; node --version; node --test --test-timeout=120000 --test-concurrency=1 dist-test/unit/core/phone.test.js dist-test/unit/core/daemon.test.js'
EOS
tar -C "$stage" -cf - . | ssh -o BatchMode=yes "$alias_" 'rm -rf ~/ashley-test && mkdir -p ~/ashley-test && tar -C ~/ashley-test -xf - && chmod +x ~/ashley-test/run.sh'
rm -rf "$stage"
ssh -o BatchMode=yes "$alias_" 'jid=""; for w in ~/.ashley/workers/*/; do j=$(cat "$w/job.id" 2>/dev/null); [ -n "$j" ] && [ "$(squeue -h -j "$j" -o %T 2>/dev/null)" = RUNNING ] && { jid=$j; break; }; done
  [ -n "$jid" ] || { echo "no running worker to test in"; exit 2; }
  echo "testing inside job $jid"; timeout 600 srun --jobid="$jid" --overlap -N1 -n1 --quiet ~/ashley-test/run.sh'
