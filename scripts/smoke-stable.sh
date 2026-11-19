#!/bin/sh
# Smoke-test the generated stable marketplace branch with the installed
# Claude Code and Codex CLIs, using the exact public install commands
# (owner/repo#stable, owner/repo --ref stable). Git's url.insteadOf in a
# private HOME redirects github.com/<repo> to a local bare repository, so
# nothing touches the network or the real GitHub branch. Each CLI runs in an
# empty environment with temporary config dirs. The check publishes the
# current version, installs it, then publishes version+1 (patch) and upgrades.
# Missing CLIs are skipped.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
REPO=${REPO:-filecoin-project/filpgf-agent-kit}
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
fail=0
ok() { echo "ok - $*"; }
bad() { echo "FAIL - $*"; fail=1; }
have() { command -v "$1" >/dev/null 2>&1; }

NAME=$(node -p "require('$ROOT/toolkit.json').name")
V1=$(node -p "require('$ROOT/toolkit.json').version")
V2=$(node -p "const [a,b,c]='$V1'.split('.').map(Number); [a,b,c+1].join('.')")
ID="$NAME@$NAME-marketplace"

# tree <version>: router build + stable tree for a copy of this project at <version>.
tree() {
  p="$T/proj-$1"; mkdir -p "$p"
  cp -R "$ROOT/skills" "$ROOT/LICENSE" "$p/"
  node -e 'const fs=require("fs"),[s,d,v]=process.argv.slice(1);const m=JSON.parse(fs.readFileSync(s));m.version=v;fs.writeFileSync(d+"/toolkit.json",JSON.stringify(m));fs.writeFileSync(d+"/package.json",JSON.stringify({version:v}))' "$ROOT/toolkit.json" "$p" "$1"
  node "$ROOT/scripts/build.mjs" --root "$p" --router-only --out r >/dev/null
  node "$ROOT/scripts/validate-dist.mjs" "$p/r" >/dev/null
  node "$ROOT/scripts/stable-branch.mjs" assemble --root "$p" --router r --out stable --tag "v$1" --repo "$REPO" >/dev/null
  node "$ROOT/scripts/stable-branch.mjs" check --root "$p" --router r --out stable --tag "v$1" >/dev/null
  echo "$p/stable"
}
# publish <version>: commit that tree onto the local stable branch.
publish() {
  w="$T/w-$1"; git init -q "$w"
  (cd "$w" && git fetch -q "$T/origin.git" stable 2>/dev/null && git reset -q --soft FETCH_HEAD || true)
  cp -R "$(tree "$1")/." "$w/"
  (cd "$w" && git add -A && git -c user.name=smoke -c user.email=smoke@example.invalid commit -qm "stable: v$1" && git push -q "$T/origin.git" HEAD:refs/heads/stable)
}
iso() { # iso <name> <cmd...>: empty env, private HOME whose gitconfig redirects the GitHub repo to the local bare repo
  h="$T/$1"; shift
  mkdir -p "$h/home" "$h/cfg" "$h/cwd" "$h/codex" "$h/claude"
  printf '[url "file://%s/origin.git"]\n\tinsteadOf = https://github.com/%s.git\n\tinsteadOf = https://github.com/%s\n\tinsteadOf = git@github.com:%s.git\n' "$T" "$REPO" "$REPO" "$REPO" > "$h/home/.gitconfig"
  (cd "$h/cwd" && env -i PATH="$PATH" HOME="$h/home" XDG_CONFIG_HOME="$h/cfg" XDG_CACHE_HOME="$h/cfg/cache" XDG_DATA_HOME="$h/cfg/data" \
    CLAUDE_CONFIG_DIR="$h/claude" CODEX_HOME="$h/codex" GIT_TERMINAL_PROMPT=0 "$@")
}
claude_version() { iso claude claude plugin list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s).find(x=>x.id===process.argv[1]);console.log(p&&p.enabled?p.version:"")})' "$ID"; }

git init -q --bare "$T/origin.git"
publish "$V1"
ok "stable tree v$V1 assembled, checked and published to a local bare repo"

if have claude; then
  iso claude claude plugin validate --strict "$(tree "$V1")" >"$T/out" 2>&1 && ok "claude plugin validate --strict (marketplace)" || { cat "$T/out"; bad "claude validate"; }
  iso claude timeout 120 claude plugin marketplace add "$REPO#stable" >"$T/out" 2>&1 \
    && iso claude timeout 60 claude plugin install "$ID" >>"$T/out" 2>&1 \
    && ok "claude: marketplace add $REPO#stable + plugin install $ID" || { cat "$T/out"; bad "claude install"; }
  [ "$(claude_version)" = "$V1" ] && ok "claude: $ID $V1 enabled" || bad "claude: plugin not enabled at $V1"
  find "$T/claude/claude/plugins/cache" -path "*/skills/$NAME/SKILL.md" | grep -q . && ok "claude: router skill installed" || bad "claude: skill missing"
else echo "skip - claude not installed"; fi

if have codex; then
  iso codex timeout 120 codex plugin marketplace add "$REPO" --ref stable >"$T/out" 2>&1 \
    && iso codex timeout 60 codex plugin add "$ID" >>"$T/out" 2>&1 \
    && ok "codex: marketplace add $REPO --ref stable + plugin add $ID" || { cat "$T/out"; bad "codex install"; }
  iso codex timeout 120 codex debug prompt-input smoke >"$T/prompt" 2>&1 || true
  grep -q "$NAME:$NAME" "$T/prompt" && ok "codex: $NAME:$NAME skill in prompt" || bad "codex: skill not in prompt"
  [ -d "$T/codex/codex/plugins/cache/$NAME-marketplace/$NAME/$V1" ] && ok "codex: $V1 cached" || bad "codex: $V1 not cached"
else echo "skip - codex not installed"; fi

publish "$V2"
ok "stable advanced to v$V2"

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

[ "$fail" = 0 ] && echo "smoke-stable: all checks passed" || { echo "smoke-stable: failures"; exit 1; }
