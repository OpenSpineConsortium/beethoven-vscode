#!/usr/bin/env bash
# Runs Claude Code's own sign-in (claude auth login) inside the student's running worker allocation,
# in a tmux session on the compute node, so that a person who cannot see a terminal (phone, remote
# session) can still complete it: the link is read from the tmux screen, the one-time code the page
# shows is pasted back from a file. Exactly the same command as `beethoven claude login` runs;
# Beethoven still never reads, copies or stores the credential Claude Code writes to ~/.beethoven/claude.
#
#   login_relay.sh start            start the sign-in (prints the link once it appears)
#   login_relay.sh screen           show the current screen of the sign-in
#   login_relay.sh send <file>      paste the code in <file> into the sign-in; the file is deleted only when
#                                   it is in ~/.beethoven/tmp, this script's own folder
#   login_relay.sh stop             end the session
set -euo pipefail
BEETHOVEN="$(dirname "$0")/beethoven"; [ -r "$BEETHOVEN" ] || BEETHOVEN="$HOME/.beethoven/bin/beethoven"
eval "$(grep -m1 '^BEETHOVEN_HOME=' "$BEETHOVEN")"; eval "$(grep -m1 '^CFG=' "$BEETHOVEN")"; CLAUDE_HOME="$BEETHOVEN_HOME/claude"
# shellcheck disable=SC1090
source "$CFG"
SOCK="/dev/shm/beethoven-login-$(id -u).sock"
SESSION=login
KEEP="$BEETHOVEN_HOME/tmp"; mkdir -p "$KEEP"; chmod 700 "$KEEP"
# the default worker's job: beethoven_default, or ashley_default when it was started before grid scripts 7
jid() { squeue -u "$USER" -h -n beethoven_default,ashley_default -t R -o %i | head -1; }
in_alloc() { local j; j=$(jid); [ -n "$j" ] || { echo "no running worker (start one with: beethoven worker start)" >&2; exit 2; }; srun --jobid="$j" --overlap -N1 -n1 --quiet "$@"; }
tm() { in_alloc tmux -S "$SOCK" "$@"; }

case "${1:-}" in
  start)
    if tm has-session -t "$SESSION" 2>/dev/null; then echo "already running"; exec "$0" screen; fi
    mkdir -p "$ROOT/workspaces/phone" "$CLAUDE_HOME"; chmod 700 "$CLAUDE_HOME"
    # same first-run settings seed as `beethoven claude login` (settings, never credentials; a file that does
    # not parse is left as it is), kept in a file so that no quoting layer touches it
    cat > "$KEEP/seed.js" <<'JS'
const fs=require("fs"),p=process.env.CLAUDE_CONFIG_DIR+"/.claude.json",no=function(){console.error("Claude Code settings file "+p+" could not be read; Beethoven left it as it is");process.exit(0)};let j={};try{j=JSON.parse(fs.readFileSync(p,"utf8"))}catch(e){if(!e||e.code!=="ENOENT")no()}if(!j||typeof j!=="object"||Array.isArray(j))no();let ch=false;if(j.hasCompletedOnboarding!==true){j.hasCompletedOnboarding=true;ch=true}if(!j.theme){j.theme="dark";ch=true}j.projects=j.projects||{};const d=process.cwd(),pr=j.projects[d]||{};if(pr.hasTrustDialogAccepted!==true){j.projects[d]=Object.assign({},pr,{hasTrustDialogAccepted:true});ch=true}if(ch){fs.writeFileSync(p+".part",JSON.stringify(j,null,1),{mode:0o600});fs.renameSync(p+".part",p)};
JS
    chmod 600 "$KEEP/seed.js"
    inner="cd '$ROOT/workspaces/phone' && node '$KEEP/seed.js' && exec '$CLAUDE_BIN' auth login"
    # the key, token, gateway and cloud-provider variables are removed as in `beethoven claude login` (the
    # same list as there, beethovend.js and phone.js; a test compares them), and the two Remote Control switches
    auth_unset="-u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_OAUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR -u CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR -u CLAUDE_CODE_USE_BEDROCK -u CLAUDE_CODE_USE_VERTEX -u CLAUDE_CODE_USE_FOUNDRY -u CLAUDE_CODE_USE_ANTHROPIC_AWS -u CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD -u CLAUDE_CODE_USE_MANTLE -u CLAUDE_CODE_USE_GATEWAY -u CLAUDE_CODE_OAUTH_REFRESH_TOKEN -u CLAUDE_CODE_OAUTH_SCOPES"
    # shellcheck disable=SC2086
    cmd="$RUNTIME exec $BINDS '$SANDBOX' env $auth_unset -u CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC -u DISABLE_GROWTHBOOK HOME='$HOME' CLAUDE_CONFIG_DIR='$CLAUDE_HOME' TERM=xterm-256color BROWSER=/bin/false bash -c \"$inner\""
    printf '%s\n' "$cmd" > "$KEEP/login_cmd.sh"; chmod 600 "$KEEP/login_cmd.sh"
    j=$(jid); [ -n "$j" ] || { echo "no running worker" >&2; exit 2; }
    # the tmux server lives inside a step of the worker's allocation; the step stays up while the session exists
    nohup srun --jobid="$j" --overlap -N1 -n1 --quiet -J beethoven_login bash -c "tmux -S '$SOCK' new-session -d -s '$SESSION' -x 160 -y 45 \"bash '$KEEP/login_cmd.sh'; echo; echo '[sign-in process ended]'; sleep 600\"; while tmux -S '$SOCK' has-session -t '$SESSION' 2>/dev/null; do sleep 3; done" > "$KEEP/login_step.log" 2>&1 &
    disown
    for _ in $(seq 1 60); do sleep 2; tm has-session -t "$SESSION" 2>/dev/null && break; done
    for _ in $(seq 1 45); do
      sleep 2
      s=$(tm capture-pane -p -J -t "$SESSION" -S -200 2>/dev/null || true)
      if grep -q 'https://' <<<"$s"; then break; fi
    done
    exec "$0" screen;;
  screen)
    tm capture-pane -p -J -t "$SESSION" -S -200 | sed -e 's/[[:space:]]*$//' | awk 'NF{blank=0} !NF{blank++} blank<2';;
  send)
    f="${2:?file with the code}"; [ -s "$f" ] || { echo "no code in $f" >&2; exit 2; }
    tr -d '\r\n' < "$f" > "$KEEP/code.buf"; chmod 600 "$KEEP/code.buf"
    # the caller's file is removed only from this script's own folder: a path anywhere else (a workspace, a
    # sign-in folder) is never deleted from here
    case "$(readlink -f -- "$f")" in "$(readlink -f -- "$KEEP")"/*) rm -f -- "$f";; *) echo "(left $f where it is: delete it yourself once the sign-in is done)" >&2;; esac
    tm load-buffer -b code "$KEEP/code.buf"; rm -f "$KEEP/code.buf"
    tm paste-buffer -b code -d -t "$SESSION"; sleep 1; tm send-keys -t "$SESSION" Enter
    sleep 6; exec "$0" screen;;
  stop)
    tm kill-session -t "$SESSION" 2>/dev/null || true; rm -f "$KEEP/login_cmd.sh" "$KEEP/code.buf" "$KEEP/seed.js"; echo stopped;;
  *) echo "usage: login_relay.sh start|screen|send <file>|stop" >&2; exit 1;;
esac
