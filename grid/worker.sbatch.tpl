#!/bin/bash
# Ashley (c) 2026 OpenSpineConsortium. Licensed software: use requires a license key. See LICENSE.txt.
# Ashley worker "@NAME@": a persistent Claude Code session for one student, in a Singularity
# container on a compute node. It watches ~/.ashley/workers/@NAME@/inbox and answers into
# outbox. Resumable: `ashley worker start --name @NAME@` again; queued requests survive.
# Written by `ashley worker start` from worker.sbatch.tpl; do not edit by hand.
#SBATCH --job-name=ashley_@NAME@
#SBATCH --partition=@PARTITION@
#SBATCH --qos=@QOS@
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=@CPUS@
#SBATCH --mem=@MEM@
#SBATCH --time=@TIME@
#SBATCH --output=log/slurm_%j.out
#SBATCH --open-mode=append
#SBATCH --signal=B:TERM@120
#SBATCH --dependency=singleton
@GRES@
@REQUEUE@
set -uo pipefail
ASHLEY_HOME="${ASHLEY_HOME:-$HOME/.ashley}"
W="${SLURM_SUBMIT_DIR:-$ASHLEY_HOME/workers/@NAME@}"
cd "$W" || exit 1
say() { echo "$(date -u +%FT%TZ) $*"; }
# shellcheck disable=SC1090
source "$ASHLEY_HOME/config.env" || { echo "REFUSING: no config.env"; exit 1; }
# a worker may run a container from the lab's shared library instead of the account's own
W_SANDBOX="@SANDBOX@"; W_CLAUDE="@CLAUDE_BIN@"; LIBRARY_ROOT="@LIBRARY@"
[ -n "$W_SANDBOX" ] && SANDBOX="$W_SANDBOX"
[ -n "$W_CLAUDE" ] && CLAUDE_BIN="$W_CLAUDE"
case "$SANDBOX" in "$LIBRARY_ROOT"/*) case " ${BINDS:-} " in *" -B $LIBRARY_ROOT "*|*" $LIBRARY_ROOT "*) ;; *) BINDS="${BINDS:-} -B $LIBRARY_ROOT";; esac;; esac
for v in RUNTIME SANDBOX CLAUDE_BIN ROOT; do [ -n "${!v:-}" ] || { echo "REFUSING: $v unset in config.env (bootstrap not finished?)"; exit 1; }; done
[ -x "$SANDBOX/usr/local/bin/node" ] || { echo "REFUSING: sandbox $SANDBOX incomplete"; exit 1; }
[ -x "$CLAUDE_BIN" ] || { echo "REFUSING: $CLAUDE_BIN missing"; exit 1; }
[ -x "$RUNTIME" ] || { echo "REFUSING: runtime $RUNTIME missing on $(hostname)"; exit 1; }
hostname -f > node.part && mv node.part node
echo "${SLURM_JOB_ID:-x}" > job.id
say "worker @NAME@ job ${SLURM_JOB_ID:-x} on $(hostname -f); cpus=${SLURM_CPUS_PER_TASK:-?} mem=@MEM@ time=@TIME@"
SCR=/dev/shm/${USER}_ashley_@NAME@_${SLURM_JOB_ID:-x}; mkdir -p "$SCR" || { echo "REFUSING: no /dev/shm scratch"; exit 1; }
trap 'rm -rf "$SCR"' EXIT
export TMPDIR="$SCR"
# Slurm from inside the container, so the worker's Claude can submit and watch jobs. Bound read-only:
# the host's Slurm client (/usr/bin under /opt/host/bin), its library, the munge library (into
# /usr/lib, a default search folder), the config, the munge socket, and a user list that names the
# slurm and munge users the config refers to (the container's own lacks them). The wrappers give a
# submitted job the host PATH and no container variables. Measured on asx1, 2026-09-28: squeue and
# sbatch work, and the job runs on the host. Skipped, and the worker tells Claude so, if a piece is absent.
SLURM_ARGS=(); SLURM_BIN=""
MUNGE_LIB=$(readlink -f /usr/lib64/libmunge.so.2 2>/dev/null || true)
if [ -x /usr/bin/sbatch ] && [ -d /usr/lib64/slurm ] && [ -d /etc/slurm ] && [ -d /var/run/munge ] && [ -n "$MUNGE_LIB" ]; then
  SB="$W/slurm"; mkdir -p "$SB/bin" "$SB/etc"
  { cat "$SANDBOX/etc/passwd"; getent passwd slurm munge "$USER"; } > "$SB/etc/passwd"
  { cat "$SANDBOX/etc/group"; getent group slurm munge "$(id -gn)"; } > "$SB/etc/group"
  for c in sbatch squeue scancel sacct sinfo scontrol; do
    cat > "$SB/bin/$c" <<EOW
#!/bin/sh
# host Slurm client, written by worker job ${SLURM_JOB_ID:-x}; a submitted job gets the host PATH, not the container's
for v in \$(env | sed -n 's/^\\(APPTAINER_[A-Za-z_]*\\|SINGULARITY_[A-Za-z_]*\\)=.*/\\1/p'); do unset "\$v"; done
# the runtime's own temporary and cache files: node-local (the worker's /dev/shm scratch), never a shared filesystem
export APPTAINER_TMPDIR="$SCR" SINGULARITY_TMPDIR="$SCR" APPTAINER_CACHEDIR="$SCR/cache" SINGULARITY_CACHEDIR="$SCR/cache"; mkdir -p "$SCR/cache"
PATH='$PATH' exec /opt/host/bin/$c "\$@"
EOW
    chmod 755 "$SB/bin/$c"
  done
  SLURM_ARGS=(-B /usr/bin:/opt/host/bin:ro -B /usr/lib64/slurm:/usr/lib64/slurm:ro -B "$MUNGE_LIB:/usr/lib/libmunge.so.2:ro" -B /etc/slurm:/etc/slurm:ro -B /var/run/munge:/var/run/munge -B "$SB/etc/passwd:/etc/passwd:ro" -B "$SB/etc/group:/etc/group:ro")
  SLURM_BIN="$SB/bin"
  say "Slurm available inside the container ($SB/bin)"
else
  say "Slurm NOT available inside the container: a piece is missing on $(hostname)"
fi
NV=""; [ "@GPUS@" != "0" ] && NV="--nv"
# shellcheck disable=SC2086,SC2206
BIND_ARR=($BINDS)
# ${ARR[@]+...}: bash 4.2 (CentOS 7) calls an empty array unbound under set -u
exec "$RUNTIME" exec $NV "${BIND_ARR[@]}" ${SLURM_ARGS[@]+"${SLURM_ARGS[@]}"} -B "$SCR:/tmp" "$SANDBOX" \
  env HOME="$HOME" ASHLEY_HOME="$ASHLEY_HOME" ASHLEY_ROOT="$ROOT" SLURM_JOB_ID="${SLURM_JOB_ID:-x}" TMPDIR=/tmp ASHLEY_SLURM_BIN="$SLURM_BIN" \
  node "$ASHLEY_HOME/bin/ashleyd.js" --worker-dir "$W" --claude "$CLAUDE_BIN" --concurrency @CONC@
