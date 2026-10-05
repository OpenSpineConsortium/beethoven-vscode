# hpcworker's hpcw_claude_signin, copied verbatim from framework/lib/adapters/common.sh at 503ea71, 2026-10-05.
# signin.test.ts runs it on every shape on every run, and checks it against hpcworker's own when HPCWORKER_DIR names a checkout.
hpcw_claude_signin() { # stdin: what `claude auth status` printed -> subscription | other | none
  # Beethoven runs only on a Claude subscription (greg, 2026-10-04: no API key anywhere): loggedIn true,
  # authMethod "claude.ai", apiProvider "firstParty" or absent, and no apiKeySource. "other" is signed in
  # some other way (the Anthropic Console, which bills by use; a token from the environment, "oauth_token";
  # a cloud provider) and every caller treats it as no sign-in. apiKeySource is there only when a key is
  # behind the sign-in, and 2.1.42 reports the Console's own key ("/login managed key") as authMethod
  # "claude.ai" beside it, so its presence alone decides; its value, a label, is not read. Four keys are
  # read and nothing else; lib/login_plain.sh and bin/hpcworker's terminal sitting apply the same rule
  # where this file is not at hand
  local t li am ap; t=$(tr -d '\n')
  li=$(printf '%s' "$t" | grep -o '"loggedIn": *\(true\|false\)' | head -1 | grep -o 'true\|false')
  [ "$li" = true ] || { echo none; return 0; }
  printf '%s' "$t" | grep -q '"apiKeySource":' && { echo other; return 0; }
  am=$(printf '%s' "$t" | grep -o '"authMethod": *"[^"]*"' | head -1 | cut -d'"' -f4)
  ap=$(printf '%s' "$t" | grep -o '"apiProvider": *"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ "$am" = claude.ai ] && { [ -z "$ap" ] || [ "$ap" = firstParty ]; }; then echo subscription; else echo other; fi
}
