#!/usr/bin/env bash
# Deploy the access service end to end, after `wrangler login` has been done once on this machine:
# KV namespaces (created if missing, ids written into wrangler.toml), the secrets (piped from files in the
# vendor folder, never on a command line), the Worker itself, then docs/site/services.json (the five service
# addresses, access_check among them) and the support-site copy.
# Files read from the vendor folder: admin_token, decide_key (both made here when absent), notify_to
# (default go2432@wayne.edu), mail_from (default "Ashley access <onboarding@resend.dev>"), and
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
W() { npx --yes wrangler@4 "$@"; }
strip() { tr -d '\r\n'; }
cd "$HERE"

echo "== account"
W whoami | grep -E "Account Name|You are logged in|Account ID" | head -3 || { echo "not logged in: run  npx wrangler@4 login  first"; exit 2; }

echo "== KV namespaces"
LIST=$(W kv namespace list 2>/dev/null || echo "[]")
for B in TRIALS REPORTS ACCESS; do
  # wrangler names the namespace after the binding ("TRIALS"); older versions prefixed the Worker name
  ID=$(printf '%s' "$LIST" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const m=a.find(x=>x.title===process.argv[1]||x.title===process.argv[2]);console.log(m?m.id:"")}catch{console.log("")}})' "$B" "ashley-service-$B")
  if [ -z "$ID" ]; then
    OUT=$(W kv namespace create "$B" 2>&1) || { echo "$OUT"; exit 3; }
    ID=$(printf '%s' "$OUT" | grep -oE 'id = "[0-9a-f]+"' | head -1 | grep -oE '[0-9a-f]{16,}')
  fi
  [ -n "$ID" ] || { echo "no id for $B"; exit 3; }
  # write the id under the right binding (the block order in wrangler.toml is TRIALS, REPORTS, ACCESS)
  node -e '
    const fs=require("fs");const [f,b,id]=process.argv.slice(1);let t=fs.readFileSync(f,"utf8");
    const re=new RegExp("(binding = \""+b+"\"\\r?\\n)id = \"[^\"]*\"");
    if(!re.test(t)){console.error("binding "+b+" not found in wrangler.toml");process.exit(4)}
    fs.writeFileSync(f,t.replace(re,"$1id = \""+id+"\""));' wrangler.toml "$B" "$ID"
  echo "  $B = $ID"
done

echo "== secrets"
node "$REPO/tools/license/ashley-license.mjs" export-key --kid trial | strip | W secret put TRIAL_KEY_PKCS8_B64 >/dev/null
printf 'trial' | W secret put TRIAL_KID >/dev/null
[ -s "$VENDOR/admin_token" ] || { umask 077; openssl rand -base64 32 | strip > "$VENDOR/admin_token"; }
strip < "$VENDOR/admin_token" | W secret put ADMIN_TOKEN >/dev/null
openssl rand -base64 32 | strip | W secret put IP_SALT >/dev/null
echo "  TRIAL_KEY_PKCS8_B64, TRIAL_KID, ADMIN_TOKEN, IP_SALT set (GITHUB_TOKEN/GITHUB_REPO not set: requests are stored, no issue is opened)"
# requests by e-mail (README.md, "Requests by e-mail"): the key that signs the Approve and Deny links is made
# once and kept; the recipient and the sender have defaults; the Resend key is the maintainer's to add
[ -s "$VENDOR/decide_key" ] || { umask 077; openssl rand -base64 32 | strip > "$VENDOR/decide_key"; echo "  made $VENDOR/decide_key"; }
[ -s "$VENDOR/notify_to" ] || { printf 'go2432@wayne.edu' > "$VENDOR/notify_to"; echo "  made $VENDOR/notify_to (the default recipient)"; }
[ -s "$VENDOR/mail_from" ] || { printf 'Ashley access <onboarding@resend.dev>' > "$VENDOR/mail_from"; echo "  made $VENDOR/mail_from (the default sender)"; }
strip < "$VENDOR/decide_key" | W secret put DECIDE_KEY >/dev/null
strip < "$VENDOR/notify_to" | W secret put NOTIFY_TO >/dev/null
strip < "$VENDOR/mail_from" | W secret put MAIL_FROM >/dev/null
if [ -s "$VENDOR/resend_api_key" ]; then
  strip < "$VENDOR/resend_api_key" | W secret put RESEND_API_KEY >/dev/null
  echo "  DECIDE_KEY, NOTIFY_TO, MAIL_FROM, RESEND_API_KEY set: each request is e-mailed to the address in notify_to"
else
  echo "  DECIDE_KEY, NOTIFY_TO, MAIL_FROM set; no $VENDOR/resend_api_key, so no e-mail is sent (README.md, Requests by e-mail)"
fi

echo "== deploy"
OUT=$(W deploy 2>&1) || { echo "$OUT" | tail -20; exit 5; }
URL=$(printf '%s' "$OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || { echo "$OUT" | tail -20; echo "no workers.dev address in the deploy output"; exit 5; }
echo "  $URL"
sleep 3
curl -fsS "$URL/health" && echo

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
echo "done: $URL"
