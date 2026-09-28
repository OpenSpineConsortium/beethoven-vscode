#!/usr/bin/env bash
# Register the account's workers.dev subdomain (needed once before the first deploy to workers.dev),
# using the OAuth token wrangler login stored; the token travels in a header file, never on argv.
#   bash tools/intake/register_subdomain.sh <account-id> <subdomain> [<fallback-subdomain> ...]
set -euo pipefail
ACCOUNT="${1:?account id}"; shift
CFG="${WRANGLER_CONFIG:-$HOME/.config/.wrangler/config/default.toml}"
[ -s "$CFG" ] || CFG="$APPDATA/xdg.config/.wrangler/config/default.toml"
TOK=$(grep -m1 '^oauth_token' "$CFG" | sed 's/^oauth_token *= *"\(.*\)"/\1/')
[ -n "$TOK" ] || { echo "no oauth_token in $CFG"; exit 2; }
H=$(mktemp); chmod 600 "$H"; printf 'Authorization: Bearer %s\n' "$TOK" > "$H"; trap 'rm -f "$H"' EXIT
CUR=$(curl -fsS -H @"$H" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/subdomain" 2>/dev/null || true)
if printf '%s' "$CUR" | tr -d ' \n' | grep -q '"subdomain":"[a-z0-9-]\+"'; then
  echo "already registered: $(printf '%s' "$CUR" | tr -d ' \n' | grep -o '"subdomain":"[a-z0-9-]*"' | head -1)"; exit 0
fi
for NAME in "$@"; do
  RES=$(curl -sS -X PUT -H @"$H" -H 'content-type: application/json' --data "{\"subdomain\":\"$NAME\"}" "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/subdomain")
  if printf '%s' "$RES" | grep -q '"success":true'; then echo "registered: $NAME.workers.dev"; exit 0; fi
  echo "  $NAME: $(printf '%s' "$RES" | grep -o '"message":"[^"]*"' | head -1)"
done
echo "no subdomain could be registered"; exit 3
