#!/usr/bin/env bash
# Latency of getting a prompt to the grid worker, measured from the laptop.
#   bash docs/research/latency_probe.sh [N]     (Git Bash on Windows; uses Windows OpenSSH)
# Prints one CSV line per sample: path,sample,ms
#   ssh_login      round trip of `ssh wsu-grid true`
#   ssh_node       round trip of `ssh <node> true` through the jump host
#   receipt_ssh    laptop send -> worker claim, one ssh per message (`ashley send`)
# The worker's claim time is result.started (grid clock); skew is measured first.
set -uo pipefail
N=${1:-5}
G=${ASHLEY_GRID:-wsu-grid}
W=${ASHLEY_WORKER:-default}
now() { date +%s%3N; }
# clock skew: remote_ms - local_mid_ms
skew() {
  local t0 t1 r; t0=$(now); r=$(ssh -o BatchMode=yes "$G" 'date +%s%3N'); t1=$(now)
  echo $(( r - (t0 + t1) / 2 ))
}
SKEW=$(skew); echo "# skew_ms=$SKEW (grid minus laptop)" >&2
NODE=$(ssh -o BatchMode=yes "$G" "cat ~/.ashley/workers/$W/node 2>/dev/null")
echo "# worker node: $NODE" >&2
echo "path,sample,ms"
for i in $(seq 1 "$N"); do t0=$(now); ssh -o BatchMode=yes "$G" true; echo "ssh_login,$i,$(( $(now) - t0 ))"; done
if [ -n "$NODE" ]; then
  for i in $(seq 1 2); do t0=$(now); ssh -o BatchMode=yes -o ConnectTimeout=60 "$NODE" true; echo "ssh_node,$i,$(( $(now) - t0 ))"; done
fi
iso2ms() { python -c "import sys,datetime; s=sys.argv[1].replace('Z','+00:00'); print(int(datetime.datetime.fromisoformat(s).timestamp()*1000))" "$1"; }
for i in $(seq 1 "$N"); do
  id="lat-$(date +%Y%m%dT%H%M%S)-$i-$RANDOM"
  req=$(printf '{"v":1,"id":"%s","prompt":"latency probe","session":"latency","mode":"plan","max_turns":1,"created":"%s","from":"probe","attempt":1,"exclude_accounts":[]}' "$id" "$(date -u +%FT%T.000Z)")
  t0=$(now)
  printf '%s' "$req" | ssh -o BatchMode=yes "$G" "~/.ashley/bin/ashley send --worker $W --json" >/dev/null
  t1=$(now)
  # wait for the worker to claim it (result.started is the claim time)
  started=""
  for _ in $(seq 1 40); do
    started=$(ssh -o BatchMode=yes "$G" "cat ~/.ashley/workers/$W/outbox/$id.json 2>/dev/null" | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('started',''))" 2>/dev/null) && [ -n "$started" ] && break
    sleep 1
  done
  if [ -n "$started" ]; then
    sms=$(iso2ms "$started"); echo "receipt_ssh,$i,$(( sms - SKEW - t0 ))"; echo "send_call_ssh,$i,$(( t1 - t0 ))"
  else echo "receipt_ssh,$i,NA"; fi
done
