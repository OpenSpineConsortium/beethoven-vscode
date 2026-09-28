#!/bin/bash
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
NV=""; [ "@GPUS@" != "0" ] && NV="--nv"
# shellcheck disable=SC2086,SC2206
BIND_ARR=($BINDS)
exec "$RUNTIME" exec $NV "${BIND_ARR[@]}" -B "$SCR:/tmp" "$SANDBOX" \
  env HOME="$HOME" ASHLEY_HOME="$ASHLEY_HOME" ASHLEY_ROOT="$ROOT" SLURM_JOB_ID="${SLURM_JOB_ID:-x}" TMPDIR=/tmp \
  node "$ASHLEY_HOME/bin/ashleyd.js" --worker-dir "$W" --claude "$CLAUDE_BIN" --concurrency @CONC@
