#!/bin/bash
# Runs inside a worker's allocation (srun --overlap): what do Remote Control and a headless
# login look like in this container? Nothing is authorized: the login is stopped after 20 s.
set -uo pipefail
source ~/.ashley/config.env
T=$(mktemp -d /dev/shm/${USER}_rcprobe_XXXX); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/cfg" "$T/proj"
BIND=($BINDS)
run() { "$RUNTIME" exec "${BIND[@]}" -B "$T:$T" "$SANDBOX" env HOME="$HOME" CLAUDE_CONFIG_DIR="$T/cfg" DISABLE_AUTOUPDATER=1 "$@"; }
echo "== which script (pty helper) inside the container: $(run bash -c 'command -v script || echo none')"
echo "== claude remote-control --help"; run "$CLAUDE_BIN" remote-control --help 2>&1 | head -30
echo "== claude auth --help"; run "$CLAUDE_BIN" auth --help 2>&1 | head -20
echo "== claude auth status (fresh config dir)"; run "$CLAUDE_BIN" auth status 2>&1 | head -5
echo "== claude auth login in a pty, 20 s, no browser"
( cd "$T/proj" && run bash -c "BROWSER=/bin/false timeout 20 script -qfc '$CLAUDE_BIN auth login' $T/login.typescript < /dev/null" ) >/dev/null 2>&1
sed 's/\x1b\[[0-9;?]*[ -/]*[@-~]//g' "$T/login.typescript" | tr -d '\r' | grep -v '^\s*$' | head -40
echo "== claude remote-control in a pty, 15 s, not logged in"
( cd "$T/proj" && run bash -c "timeout 15 script -qfc '$CLAUDE_BIN remote-control' $T/rc.typescript < /dev/null" ) >/dev/null 2>&1
sed 's/\x1b\[[0-9;?]*[ -/]*[@-~]//g' "$T/rc.typescript" | tr -d '\r' | grep -v '^\s*$' | head -30
