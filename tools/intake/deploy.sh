#!/usr/bin/env bash
# Deploy the access service end to end, after `wrangler login` has been done once on this machine.
# One Worker, two names (README.md, "Two names"): ashley-service, the default and the name in wrangler.toml
# (Ashley in VS Code, and Beethoven 4.0.0 to 6.0.0), and beethoven-access (Beethoven 7.0.0 on). Both run
# the same code, bind the same three KV namespaces (the ids in wrangler.toml) and get the same secrets, so
# both answer from one approved list. Deploy both whenever worker.js changes:
#   bash tools/intake/deploy.sh                                   (ashley-service)
#   WORKER_NAME=beethoven-access bash tools/intake/deploy.sh      (the second name)
# Steps: the KV namespaces (the ids in wrangler.toml, checked against the account; created only on the very
# first deploy of the default name, never for another name), the Worker itself, the secrets (piped from
# files in the vendor folder, never on a command line), then, for the default name only,
# docs/site/services.json (the five service addresses, access_check among them) and the support-site copy
# (SKIP_SITE=1 leaves both alone). Beethoven's services.json, which names beethoven-access, is built in the
# ashley-bridge repository (docs/site/beethoven/services.json), not here.
# Files read from the vendor folder: admin_token, decide_key and ip_salt (each made here when absent),
# notify_to (default go2432@wayne.edu), mail_from (default "Ashley access <onboarding@resend.dev>"), and
# resend_api_key (optional: without it no e-mail is sent).
#   bash tools/intake/deploy.sh            (Git Bash on Windows or any shell; needs node 22 and the vendor folder)
#   From WSL on the maintainer's machine (the Windows network path times out against Cloudflare):
#   ASHLEY_VENDOR_DIR=/mnt/c/Users/<you>/.ashley-vendor PATH=$HOME/node22/bin:$PATH bash tools/intake/deploy.sh
# Re-running is safe: existing namespaces are reused, secrets are overwritten with the same values,
# the Worker is redeployed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$HERE/../.." && pwd)"
VENDOR="${ASHLEY_VENDOR_DIR:-$HOME/.ashley-vendor}"
SITE_REPO="${ASHLEY_SITE_REPO:-$REPO/../openspineconsortium.github.io}"
DEFAULT_NAME="ashley-service"
WORKER_NAME="${WORKER_NAME:-$DEFAULT_NAME}"
[[ "$WORKER_NAME" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || { echo "WORKER_NAME is lower-case letters, digits and dashes, like beethoven-access"; exit 2; }
W() { npx --yes wrangler@4 "$@"; }
strip() { tr -d '\r\n'; }
# one secret for this Worker name, its value on stdin (never an argument)
S() { W secret put "$1" --name "$WORKER_NAME" >/dev/null; }
cd "$HERE"

echo "== account"
W whoami | grep -E "Account Name|You are logged in|Account ID" | head -3 || { echo "not logged in: run  npx wrangler@4 login  first"; exit 2; }

echo "== KV namespaces (bound by $WORKER_NAME)"
# a failed listing stops here: it must never be read as "no namespaces yet" and lead to new, empty ones
LIST=$(W kv namespace list 2>/dev/null) || { echo "  the account's KV namespaces could not be listed; nothing was created"; exit 3; }
printf '%s' "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{if(!Array.isArray(JSON.parse(s)))throw 0}catch{console.error("  the KV namespace listing is not a JSON list; nothing was created");process.exit(3)}})'
for B in TRIALS REPORTS ACCESS; do
  # the id wrangler.toml holds for this binding (the block order is TRIALS, REPORTS, ACCESS)
  CUR=$(node -e '
    const fs=require("fs");const [f,b]=process.argv.slice(1);const t=fs.readFileSync(f,"utf8");
    const m=new RegExp("binding = \""+b+"\"\\r?\\nid = \"([0-9a-f]*)\"").exec(t);console.log(m?m[1]:"")' wrangler.toml "$B")
  if [ -n "$CUR" ] && printf '%s' "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.exit(JSON.parse(s).some(x=>x.id===process.argv[1])?0:1))' "$CUR"; then
    echo "  $B = $CUR"
    continue
  fi
  if [ "$WORKER_NAME" != "$DEFAULT_NAME" ]; then
    echo "  $B: the id in wrangler.toml (${CUR:-none}) is not a namespace of this account. $WORKER_NAME binds the"
    echo "  namespaces $DEFAULT_NAME binds and none is ever created for it: deploy $DEFAULT_NAME first."
    exit 3
  fi
  # the first deploy of the default name: find the namespace by its title, or create it. wrangler names the
  # namespace after the binding ("TRIALS"); older versions prefixed the Worker name
  ID=$(printf '%s' "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const m=a.find(x=>x.title===process.argv[1]||x.title===process.argv[2]);console.log(m?m.id:"")}catch{console.log("")}})' "$B" "$DEFAULT_NAME-$B")
  if [ -z "$ID" ]; then
    OUT=$(W kv namespace create "$B" 2>&1) || { echo "$OUT"; exit 3; }
    ID=$(printf '%s' "$OUT" | grep -oE 'id = "[0-9a-f]+"' | head -1 | grep -oE '[0-9a-f]{16,}')
  fi
  [ -n "$ID" ] || { echo "no id for $B"; exit 3; }
  node -e '
    const fs=require("fs");const [f,b,id]=process.argv.slice(1);let t=fs.readFileSync(f,"utf8");
    const re=new RegExp("(binding = \""+b+"\"\\r?\\n)id = \"[^\"]*\"");
    if(!re.test(t)){console.error("binding "+b+" not found in wrangler.toml");process.exit(4)}
    fs.writeFileSync(f,t.replace(re,"$1id = \""+id+"\""));' wrangler.toml "$B" "$ID"
  echo "  $B = $ID (written into wrangler.toml)"
done

# The code goes first, then the secrets: a Worker name that does not exist yet is created by the deploy
# (a secret cannot be set on a Worker that does not exist), and until its secrets arrive every route that
# needs one refuses (503 or 401), which is safe. Each secret put deploys a new version with that secret.
echo "== deploy ($WORKER_NAME)"
OUT=$(W deploy --name "$WORKER_NAME" 2>&1) || { echo "$OUT" | tail -20; exit 5; }
URL=$(printf '%s' "$OUT" | grep -oE "https://$WORKER_NAME\.[a-z0-9.-]+\.workers\.dev" | head -1)
[ -n "$URL" ] || { echo "$OUT" | tail -20; echo "no workers.dev address for $WORKER_NAME in the deploy output"; exit 5; }
echo "  $URL"

echo "== secrets ($WORKER_NAME)"
node "$REPO/tools/license/ashley-license.mjs" export-key --kid trial | strip | S TRIAL_KEY_PKCS8_B64
printf 'trial' | S TRIAL_KID
[ -s "$VENDOR/admin_token" ] || { umask 077; openssl rand -base64 32 | strip > "$VENDOR/admin_token"; }
strip < "$VENDOR/admin_token" | S ADMIN_TOKEN
# the salt that hashes a caller's address: kept in the vendor folder so both names hash an address the same
# way (the per-connection limits then count across both). Delete the file to start a new salt, then deploy
# both names; a new salt only restarts the day's per-connection counts.
[ -s "$VENDOR/ip_salt" ] || { umask 077; openssl rand -base64 32 | strip > "$VENDOR/ip_salt"; echo "  made $VENDOR/ip_salt"; }
strip < "$VENDOR/ip_salt" | S IP_SALT
echo "  TRIAL_KEY_PKCS8_B64, TRIAL_KID, ADMIN_TOKEN, IP_SALT set (GITHUB_TOKEN/GITHUB_REPO not set: requests are stored, no issue is opened)"
# requests by e-mail (README.md, "Requests by e-mail"): the key that signs the Approve and Deny links is made
# once and kept; the recipient and the sender have defaults; the Resend key is the maintainer's to add
[ -s "$VENDOR/decide_key" ] || { umask 077; openssl rand -base64 32 | strip > "$VENDOR/decide_key"; echo "  made $VENDOR/decide_key"; }
[ -s "$VENDOR/notify_to" ] || { printf 'go2432@wayne.edu' > "$VENDOR/notify_to"; echo "  made $VENDOR/notify_to (the default recipient)"; }
[ -s "$VENDOR/mail_from" ] || { printf 'Ashley access <onboarding@resend.dev>' > "$VENDOR/mail_from"; echo "  made $VENDOR/mail_from (the default sender)"; }
strip < "$VENDOR/decide_key" | S DECIDE_KEY
strip < "$VENDOR/notify_to" | S NOTIFY_TO
strip < "$VENDOR/mail_from" | S MAIL_FROM
# The Resend key is checked before it is sent anywhere: a Resend API key begins with re_, and a random
# secret made by openssl (base64, which has no underscore) never does. Whatever is in RESEND_API_KEY goes
# to api.resend.com in a header with every request e-mail, so a wrong file (another secret copied there by
# mistake) must stop here rather than travel to Resend. The check reads the file on stdin, never argv.
if [ -s "$VENDOR/resend_api_key" ] && ! strip < "$VENDOR/resend_api_key" | grep -qE '^re_[A-Za-z0-9_-]{8,200}$'; then
  echo "  DECIDE_KEY, NOTIFY_TO, MAIL_FROM set. $VENDOR/resend_api_key is NOT a Resend API key (one begins"
  echo "  with re_), so it was not sent: no e-mail is sent until that file holds the key from resend.com, API Keys"
  echo "  (README.md, Requests by e-mail). Any key the Worker already holds is left in place."
elif [ -s "$VENDOR/resend_api_key" ]; then
  strip < "$VENDOR/resend_api_key" | S RESEND_API_KEY
  echo "  DECIDE_KEY, NOTIFY_TO, MAIL_FROM, RESEND_API_KEY set: each request is e-mailed to the address in notify_to"
else
  echo "  DECIDE_KEY, NOTIFY_TO, MAIL_FROM set; no $VENDOR/resend_api_key, so no e-mail is sent (README.md, Requests by e-mail)"
fi

sleep 3
curl -fsS "$URL/health" && echo
echo "  access_check: $URL/access_check"

if [ "$WORKER_NAME" != "$DEFAULT_NAME" ]; then
  echo "== services.json: not written for $WORKER_NAME (Beethoven's is docs/site/beethoven/services.json in ashley-bridge)"
elif [ "${SKIP_SITE:-0}" = 1 ]; then
  echo "== services.json: left alone (SKIP_SITE=1)"
else
  echo "== services.json"
  node -e '
    const fs=require("fs");const [f,u]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(f,"utf8"));
    j.license_service=u+"/trial"; j.allowlist=u+"/allowlist"; j.revocation=u+"/revoked"; j.report=u+"/report"; j.access_check=u+"/access_check";
    fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");' "$REPO/docs/site/services.json" "$URL"
  cat "$REPO/docs/site/services.json"
  ( cd "$REPO" && { python -X utf8 tools/site_build.py >/dev/null 2>&1 || python3 tools/site_build.py >/dev/null; } )
  if [ -d "$SITE_REPO/.git" ]; then
    mkdir -p "$SITE_REPO/ashley"
    cp "$REPO"/docs/site/*.html "$REPO"/docs/site/*.txt "$REPO"/docs/site/services.json "$SITE_REPO/ashley/"
    echo "  copied to $SITE_REPO/ashley (commit and push that repository to publish)"
  fi
fi
echo "done: $WORKER_NAME at $URL"
