#!/bin/bash
# Ashley (c) 2026 OpenSpineConsortium. Licensed software: use requires a license key. See LICENSE.txt.
# Ashley bootstrap: build the Claude Code container for this user and record what works.
# Runs once per user (5-15 min), as a job, never on the login node. Idempotent: rerun to
# repair or, with UPDATE=1, to reinstall Claude Code at CLAUDE_CODE_VERSION.
#   run: sbatch --parsable -D ~/.ashley/log ~/.ashley/bin/bootstrap.sbatch
#   resume: same command; finished pieces are skipped.
#SBATCH --job-name=ashley_bootstrap
#SBATCH --partition=reqp
#SBATCH --qos=requeue
#SBATCH --no-requeue
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=02:00:00
#SBATCH --output=bootstrap_%j.out
set -uo pipefail
ASHLEY_HOME="${ASHLEY_HOME:-$HOME/.ashley}"
CFG="$ASHLEY_HOME/config.env"
# LIBRARY=1 publishes into the lab's shared library (ROOT_OVERRIDE, LIB_NAME, IMAGE, GPU) instead
# of the user's own root: nothing in the user's config.env or READY is touched.
LIBRARY="${LIBRARY:-0}"
if [ "$LIBRARY" = "1" ]; then
  ROOT="${ROOT_OVERRIDE:?LIBRARY=1 needs ROOT_OVERRIDE}"
  LIB_NAME="${LIB_NAME:?LIBRARY=1 needs LIB_NAME}"
else
  [ -s "$CFG" ] || { echo "REFUSING: $CFG missing; run 'ashley install' first"; exit 1; }
  # shellcheck disable=SC1090
  source "$CFG"
  : "${ROOT:?config.env must set ROOT}"
  LIB_NAME="node22-bookworm"
fi
IMAGE="${IMAGE:-docker://node:22-bookworm}"
CLAUDE_CODE_VERSION="${CLAUDE_CODE_VERSION:-2.1.283}"
GPU="${GPU:-0}"
SANDBOX="$ROOT/containers/$LIB_NAME"
NPM_PREFIX="$ROOT/npm"
[ "$LIBRARY" = "1" ] && NPM_PREFIX="$ROOT/npm-$LIB_NAME"
say() { echo "$(date -u +%FT%TZ) $*"; }
say "bootstrap job ${SLURM_JOB_ID:-local} on $(hostname); ROOT=$ROOT; LIBRARY=$LIBRARY; name=$LIB_NAME; image=$IMAGE"
mkdir -p "$ROOT"/{containers,cache,tmp,npm-cache,workspaces} "$NPM_PREFIX" || { echo "REFUSING: cannot write $ROOT"; exit 1; }
SCR=/dev/shm/${USER}_ashley_boot_${SLURM_JOB_ID:-x}; mkdir -p "$SCR"; trap 'rm -rf "$SCR"' EXIT
export TMPDIR="$ROOT/tmp" APPTAINER_CACHEDIR="$ROOT/cache" SINGULARITY_CACHEDIR="$ROOT/cache" APPTAINER_TMPDIR="$ROOT/tmp" SINGULARITY_TMPDIR="$ROOT/tmp"

# ---- 0. find a container runtime that can EXEC on a compute node ---------------------
# ~/.local/bin/singularity on this grid is a partial install ("starter not found"); skip it.
candidates=()
if [ -f /etc/profile.d/modules.sh ]; then source /etc/profile.d/modules.sh; fi
if command -v module >/dev/null 2>&1; then
  if module load apptainer/1.2.2 >/dev/null 2>&1 && command -v apptainer >/dev/null 2>&1; then candidates+=("$(command -v apptainer)"); fi
fi
for c in "$HOME"/mambaforge/envs/*/bin/singularity "$HOME"/miniforge3/envs/*/bin/singularity "$HOME"/mambaforge/bin/singularity "$HOME"/miniforge3/bin/singularity; do [ -x "$c" ] && candidates+=("$c"); done
if command -v module >/dev/null 2>&1; then
  if module load singularity/3.5.2 >/dev/null 2>&1 && command -v singularity >/dev/null 2>&1; then candidates+=("$(command -v singularity)"); fi
fi
for c in /usr/bin/apptainer /usr/bin/singularity; do [ -x "$c" ] && candidates+=("$c"); done
[ ${#candidates[@]} -gt 0 ] || { echo "STOP: no container runtime found on $(hostname)"; exit 2; }
say "runtime candidates: ${candidates[*]}"

BINDS=(-B "$HOME")
[ -d "/rs/rs_grp_oschome/$USER" ] && BINDS+=(-B "/rs/rs_grp_oschome/$USER")
case "$ROOT" in "/rs/rs_grp_oschome/$USER"/*|"$HOME"/*) ;; *) BINDS+=(-B "$ROOT");; esac   # a shared ROOT is not under the user dir: bind it

build_with() { # $1 runtime
  local rt="$1"
  if [ -x "$SANDBOX/usr/local/bin/node" ]; then say "sandbox exists: $SANDBOX"; return 0; fi
  rm -rf "$SANDBOX.part"
  say "building sandbox with $rt from $IMAGE"
  if "$rt" build --sandbox "$SANDBOX.part" "$IMAGE" > "$SCR/build.log" 2>&1 && [ -x "$SANDBOX.part/usr/local/bin/node" ]; then
    mv "$SANDBOX.part" "$SANDBOX"; say "built $(du -sh "$SANDBOX" | cut -f1)"; return 0
  fi
  say "build with $rt failed:"; tail -5 "$SCR/build.log"; rm -rf "$SANDBOX.part"; return 1
}
exec_ok() { # $1 runtime: can it run node inside the sandbox?
  "$1" exec "${BINDS[@]}" -B "$SCR:/tmp" "$SANDBOX" node -e 'console.log("node", process.version)' 2>&1
}
RUNTIME=""
for rt in "${candidates[@]}"; do
  if build_with "$rt" && out=$(exec_ok "$rt") && [[ "$out" == node* ]]; then RUNTIME="$rt"; say "runtime OK: $rt ($out)"; break; else say "runtime $rt cannot exec: $out"; fi
done
[ -n "$RUNTIME" ] || { echo "STOP: sandbox built but no runtime could exec it"; exit 3; }

# ---- 1. Claude Code inside the container, installed on the persistent prefix -------------
run_in() { "$RUNTIME" exec "${BINDS[@]}" -B "$SCR:/tmp" "$SANDBOX" "$@"; }
CLAUDE_BIN="$NPM_PREFIX/bin/claude"
have=""
[ -x "$CLAUDE_BIN" ] && have=$(run_in "$CLAUDE_BIN" --version 2>/dev/null | tail -1 | awk '{print $1}')
if [ -z "$have" ] || [ "${UPDATE:-0}" = "1" ] || { [ -n "$have" ] && [ "$have" != "$CLAUDE_CODE_VERSION" ] && [ "${PIN:-1}" = "1" ]; }; then
  say "installing @anthropic-ai/claude-code@$CLAUDE_CODE_VERSION into $NPM_PREFIX"
  run_in env npm_config_cache="$ROOT/npm-cache" npm install -g --prefix "$NPM_PREFIX" "@anthropic-ai/claude-code@$CLAUDE_CODE_VERSION" > "$SCR/npm.log" 2>&1 || { tail -20 "$SCR/npm.log"; echo "STOP: npm install failed"; exit 4; }
fi
CLAUDE_VERSION=$(run_in "$CLAUDE_BIN" --version 2>&1 | tail -1)
say "claude --version: $CLAUDE_VERSION"
[ -x "$CLAUDE_BIN" ] || { echo "STOP: $CLAUDE_BIN missing after install"; exit 4; }
smoke=$(run_in bash -c 'echo git=$(git --version | cut -d" " -f3) glibc=$(ldd --version | head -1 | awk "{print \$NF}") python3=$(command -v python3 || echo none) net=$(curl -s -m 8 -o /dev/null -w %{http_code} https://api.anthropic.com/)' 2>&1)
say "smoke: $smoke"

# ---- 2. record ------------------------------------------------------------------------
if [ "$LIBRARY" = "1" ]; then
  # merge the entry into library.json (the container's python3 does the JSON), then make the
  # whole tree group-readable so every lab member can run it without building their own
  run_in python3 - "$ROOT/library.json" "$LIB_NAME" "$SANDBOX" "$CLAUDE_BIN" "$RUNTIME" "$IMAGE" "$CLAUDE_VERSION" "$GPU" "$(date -u +%FT%TZ)" "$USER" "${SLURM_JOB_ID:-local}" "${PURPOSE:-general: Claude Code, Node 22, git, python3}" <<'PYEOF'
import json, sys, os
p, name, sandbox, claude, runtime, image, ver, gpu, built, by, job, purpose = sys.argv[1:13]
lib = {"version": 1, "default": name, "containers": {}}
if os.path.exists(p):
    try:
        lib = json.load(open(p))
    except Exception:
        pass
lib.setdefault("containers", {})[name] = {"sandbox": sandbox, "claude_bin": claude, "runtime": runtime, "image": image,
    "claude_version": ver, "gpu": gpu == "1", "built": built, "built_by": by, "job": job, "purpose": purpose}
lib.setdefault("default", name)
json.dump(lib, open(p + ".part", "w"), indent=1)
os.replace(p + ".part", p)
print("library entry written:", name)
PYEOF
  chmod -R g+rX,g-w,o-rwx "$ROOT" 2>/dev/null; find "$ROOT" -type d -exec chmod g+s {} + 2>/dev/null
  "$ASHLEY_HOME/bin/ashley" access admin resync 2>/dev/null   # approved students read the new entry too
  say "published $LIB_NAME to $ROOT (group read-only; approved students by ACL)"
  exit 0
fi
{
  grep -v -E '^(RUNTIME|SANDBOX|CLAUDE_BIN|BINDS|BOOTSTRAP_STATE)=' "$CFG"
  echo "RUNTIME=$RUNTIME"
  echo "SANDBOX=$SANDBOX"
  echo "CLAUDE_BIN=$CLAUDE_BIN"
  printf 'BINDS=%q\n' "${BINDS[*]}"
  echo "BOOTSTRAP_STATE=done"
} > "$CFG.part" && mv "$CFG.part" "$CFG"
printf '{"claude_version":"%s","runtime":"%s","sandbox":"%s","image":"%s","built":"%s","host":"%s","job":"%s","smoke":"%s"}\n' \
  "$CLAUDE_VERSION" "$RUNTIME" "$SANDBOX" "$IMAGE" "$(date -u +%FT%TZ)" "$(hostname)" "${SLURM_JOB_ID:-local}" "$smoke" > "$ASHLEY_HOME/READY.part" && mv "$ASHLEY_HOME/READY.part" "$ASHLEY_HOME/READY"
say "READY written: $(cat "$ASHLEY_HOME/READY")"
