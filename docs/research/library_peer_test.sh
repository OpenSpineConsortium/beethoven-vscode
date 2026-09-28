#!/usr/bin/env bash
# Runs ON THE GRID (ssh wsu-grid bash -s < this). Adopts the shared container, restarts the
# default worker on it, starts a second worker "peer" on it, and proves worker-to-worker
# messaging: a request is written from inside the default worker's allocation (srun --overlap,
# no ssh to the node) into peer's inbox, and peer answers.
set -uo pipefail
A=~/.ashley/bin/ashley
echo "== library"; $A library || exit 1
echo "== adopt"; $A adopt || exit 1
echo "== restart default on the shared container"
$A worker stop --name default >/dev/null 2>&1; sleep 2
$A worker start --name default --container claude-node22 --partition secp --qos secondary --hours 6 || exit 1
$A worker start --name peer --container claude-node22 --partition secp --qos secondary --hours 2 || exit 1
for i in $(seq 1 30); do
  st=$($A worker list --json | python3 -c 'import sys,json; ws=json.load(sys.stdin)["workers"]; print(" ".join("{}:{}:{}:{}".format(w["name"], w["job_state"], w["alive"], w["node"]) for w in ws))')
  echo "   $st"
  case "$st" in *"default:RUNNING:True"*"peer:RUNNING:True"*|*"peer:RUNNING:True"*"default:RUNNING:True"*) break;; esac
  sleep 10
done
JID=$(cat ~/.ashley/workers/default/job.id)
echo "== from inside default's allocation (job $JID), send to peer"
ID="peer-$(date +%s)"
REQ=$(printf '{"v":1,"id":"%s","prompt":"hello from the default worker","session":"peer-test","mode":"plan","max_turns":1,"created":"%s","from":"worker:default","attempt":1,"exclude_accounts":[]}' "$ID" "$(date -u +%FT%T.000Z)")
T0=$(date +%s%3N)
printf '%s' "$REQ" | srun --jobid="$JID" --overlap -N1 -n1 --quiet bash -c "hostname; ~/.ashley/bin/ashley send --worker peer --json"
for i in $(seq 1 40); do
  if [ -s ~/.ashley/workers/peer/outbox/$ID.json ]; then
    T1=$(date +%s%3N); echo "== peer answered in $((T1 - T0)) ms (send from default's node -> peer's daemon -> result):"
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print({k:d.get(k) for k in ("status","node","job","account","error","started","finished")})' ~/.ashley/workers/peer/outbox/$ID.json
    break
  fi
  sleep 0.5
done
echo "== worker containers"; for w in default peer; do echo "   $w: $(cat ~/.ashley/workers/$w/container 2>/dev/null) on $(cat ~/.ashley/workers/$w/node 2>/dev/null); sandbox in job: $(grep -m1 '^W_SANDBOX=' ~/.ashley/workers/$w/job.sbatch)"; done
echo "== status"; $A status --json | python3 -c 'import sys,json; d=json.load(sys.stdin); print({k:d[k] for k in ("ready","container","source","library","claude_version")})'
