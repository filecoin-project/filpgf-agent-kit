#!/bin/sh
# Smoke-test the plugin with the installed agent CLIs, using the exact public
# install commands from the README. A private HOME redirects
# github.com/<repo> to a local bare repository (git url.insteadOf), so nothing
# touches the real branch. Each CLI runs in an empty environment with
# temporary config dirs and no credentials. The script publishes this
# checkout, installs it, then publishes version+1 and upgrades. Missing CLIs are
# skipped. Claude Code's MCP health check contacts the real Artio and Karma
# endpoints, which must answer "needs authentication".
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO=filecoin-project/filpgf-agent-kit
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fail=0
ok() { echo "ok - $*"; }
bad() { echo "FAIL - $*"; fail=1; }
have() { command -v "$1" >/dev/null 2>&1; }

NAME=filpgf-ecosystem
V1=$(node -p "require('$ROOT/package.json').version")
V2=$(node -p "const [a,b,c]='$V1'.split('.').map(Number); [a,b,c+1].join('.')")
ID="$NAME@$NAME-marketplace"

# publish <version>: push a snapshot of this checkout at <version> to the local bare repo main branch.
publish() {
  w="$T/w-$1"; git init -q "$w"
  (cd "$w" && { git fetch -q "$T/origin.git" main 2>/dev/null && git reset -q --soft FETCH_HEAD || true; })
  (cd "$ROOT" && git ls-files -co --exclude-standard -z | xargs -0 tar -cf -) | tar -xf - -C "$w"
  node -e 'const fs=require("fs"),[f,v]=process.argv.slice(1);const j=JSON.parse(fs.readFileSync(f));j.version=v;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$w/package.json" "$1"
  node "$ROOT/scripts/check.mjs" --root "$w" --set-version >/dev/null
  (cd "$w" && git add -A && git -c user.name=smoke -c user.email=smoke@example.invalid commit -qm "v$1" && git push -q "$T/origin.git" HEAD:refs/heads/main)
}
iso() { # iso <name> <cmd...>: empty env, private HOME whose gitconfig redirects the GitHub repo
  h="$T/$1"; shift
  mkdir -p "$h/home" "$h/cfg" "$h/cwd" "$h/codex" "$h/claude" "$h/pi"
  printf '[url "file://%s/origin.git"]\n\tinsteadOf = https://github.com/%s.git\n\tinsteadOf = https://github.com/%s\n' "$T" "$REPO" "$REPO" > "$h/home/.gitconfig"
  (cd "$h/cwd" && env -i PATH="$PATH" HOME="$h/home" XDG_CONFIG_HOME="$h/cfg" XDG_CACHE_HOME="$h/cfg/cache" XDG_DATA_HOME="$h/cfg/data" \
    CLAUDE_CONFIG_DIR="$h/claude" CODEX_HOME="$h/codex" PI_CODING_AGENT_DIR="$h/pi" PI_SKIP_VERSION_CHECK=1 GIT_TERMINAL_PROMPT=0 "$@")
}
skills() { node -p "require('fs').readdirSync('$ROOT/plugins/$NAME/skills').join(' ')"; }
check_skills() { # check_skills <label> <file> <prefix>
  missing=
  for s in $(skills); do grep -q -- "$3$s" "$2" || missing="$missing $s"; done
  [ -z "$missing" ] && ok "$1: all skills visible" || bad "$1: skills not visible:$missing"
}
claude_version() { iso claude claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.id===process.argv[1]);console.log(p&&p.enabled?p.version:"")})' "$ID"; }
pi_commands() { printf '%s\n' '{"type":"get_commands","id":"1"}' | iso pi timeout 60 pi --mode rpc --no-session >"$T/out" 2>&1 || true; }

git init -q --bare -b main "$T/origin.git"
publish "$V1"
ok "v$V1 pushed to a local bare repo"

if have claude; then
  iso claude claude plugin validate "$ROOT" >"$T/out" 2>&1 && ok "claude plugin validate (marketplace)" || { cat "$T/out"; bad "claude validate"; }
  iso claude timeout 120 claude plugin marketplace add "$REPO" >"$T/out" 2>&1 \
    && iso claude timeout 60 claude plugin install "$ID" >>"$T/out" 2>&1 \
    && ok "claude: marketplace add $REPO + plugin install $ID" || { cat "$T/out"; bad "claude install"; }
  [ "$(claude_version)" = "$V1" ] && ok "claude: $ID $V1 enabled" || bad "claude: plugin not enabled at $V1"
  find "$T/claude/claude/plugins/cache" -name SKILL.md >"$T/out" 2>&1 || true
  check_skills "claude" "$T/out" "skills/"
  iso claude timeout 90 claude mcp list >"$T/out" 2>&1 || true
  grep -q "plugin:$NAME:artio.*Needs authentication" "$T/out" && grep -q "plugin:$NAME:karma.*Needs authentication" "$T/out" \
    && ok "claude: artio and karma listed, waiting for OAuth sign-in" || { cat "$T/out"; bad "claude MCP servers"; }
else echo "skip - claude not installed"; fi

if have codex; then
  iso codex timeout 120 codex plugin marketplace add "$REPO" >"$T/out" 2>&1 \
    && iso codex timeout 60 codex plugin add "$ID" >>"$T/out" 2>&1 \
    && ok "codex: marketplace add $REPO + plugin add $ID" || { cat "$T/out"; bad "codex install"; }
  iso codex timeout 120 codex debug prompt-input smoke >"$T/prompt" 2>&1 || true
  check_skills "codex" "$T/prompt" "$NAME:"
  iso codex codex mcp list >"$T/out" 2>&1 || true
  grep -q "^artio .*Not logged in" "$T/out" && grep -q "^karma .*Not logged in" "$T/out" \
    && ok "codex: artio and karma listed, waiting for OAuth login" || { cat "$T/out"; bad "codex MCP servers"; }
else echo "skip - codex not installed"; fi

if have pi; then
  iso pi timeout 120 pi install "git:github.com/$REPO" >"$T/out" 2>&1 && ok "pi: install git:github.com/$REPO" || { cat "$T/out"; bad "pi install"; }
  pi_commands
  check_skills "pi" "$T/out" "skill:"
  (printf '%s\n' '{"type":"prompt","id":"1","message":"/mcp"}'; sleep 8) | iso pi timeout 30 pi --mode rpc --no-session >"$T/out" 2>&1 || true
  grep -q "artio: needs sign-in" "$T/out" && grep -q "karma: needs sign-in" "$T/out" \
    && ok "pi: artio and karma registered, waiting for OAuth sign-in" || { cat "$T/out"; bad "pi MCP servers"; }
else echo "skip - pi not installed"; fi

publish "$V2"
ok "main advanced to v$V2"

if have claude; then
  iso claude timeout 120 claude plugin marketplace update "$NAME-marketplace" >"$T/out" 2>&1 \
    && iso claude timeout 60 claude plugin update "$ID" >>"$T/out" 2>&1 || true
  [ "$(claude_version)" = "$V2" ] && ok "claude: marketplace update + plugin update -> $V2" || { cat "$T/out"; bad "claude: not updated to $V2"; }
fi
if have codex; then
  iso codex timeout 120 codex plugin marketplace upgrade "$NAME-marketplace" >"$T/out" 2>&1 \
    && iso codex timeout 60 codex plugin add "$ID" >>"$T/out" 2>&1 || true
  [ -d "$T/codex/codex/plugins/cache/$NAME-marketplace/$NAME/$V2" ] && ok "codex: marketplace upgrade + plugin add -> $V2" || { cat "$T/out"; bad "codex: not updated to $V2"; }
fi
if have pi; then
  iso pi timeout 120 pi update --extensions >"$T/out" 2>&1 || true
  grep -rq "\"version\": \"$V2\"" "$T/pi/pi" --include=package.json 2>/dev/null && ok "pi: update -> $V2" || { cat "$T/out"; bad "pi: not updated to $V2"; }
fi

[ "$fail" = 0 ] && echo "smoke: all checks passed" || { echo "smoke: failures"; exit 1; }
