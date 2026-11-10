#!/bin/sh
# Smoke-test built outputs with locally installed agent CLIs, fully isolated:
# empty environment (env -i), temporary HOME/config dirs, no credentials, no
# model calls. MCP header checks use a local fake server on 127.0.0.1 with a
# dummy token. Missing CLIs are skipped. Run `npm run build` first; the MCP
# checks use a separate build with the opt-in OSO server enabled.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DIST="$ROOT/dist"
NAME=$(node -p "require('$DIST/build-info.json').name")
SKILLS=$(node -p "require('$DIST/build-info.json').skills.all.join(' ')")
MDIST="$ROOT/.cache/smoke-dist"
node "$ROOT/scripts/build.mjs" --out .cache/smoke-dist --no-packages --enable-mcp oso >/dev/null
T=$(mktemp -d)
trap 'kill $SERVER $TOOLS_SERVER 2>/dev/null || true; rm -rf "$T"' EXIT
SERVER=
TOOLS_SERVER=
PORT=47613
TOOLS_PORT=47614
fail=0
ok() { echo "ok - $*"; }
bad() { echo "FAIL - $*"; fail=1; }
have() { command -v "$1" >/dev/null 2>&1; }
iso() { # iso <name> <cmd...>: run in an empty env with a private home
  h="$T/$1"; shift
  mkdir -p "$h/home" "$h/cfg" "$h/cwd" "$h/codex" "$h/claude" "$h/pi"
  (cd "$h/cwd" && env -i PATH="$PATH" HOME="$h/home" XDG_CONFIG_HOME="$h/cfg" XDG_CACHE_HOME="$h/cfg/cache" XDG_DATA_HOME="$h/cfg/data" \
    CLAUDE_CONFIG_DIR="$h/claude" CODEX_HOME="$h/codex" PI_CODING_AGENT_DIR="$h/pi" PI_OFFLINE=1 PI_SKIP_VERSION_CHECK=1 \
    SMOKE_TOKEN="${SMOKE_TOKEN:-}" "$@")
}
check_skills() { # check_skills <label> <file> <prefix>
  missing=
  for s in $SKILLS; do grep -q -- "$3$s" "$2" || missing="$missing $s"; done
  if [ -z "$missing" ]; then ok "$1: all skills visible"; else bad "$1: skills not visible:$missing"; fi
}
start_fake_mcp() {
  : > "$T/headers.log"
  node -e '
    const http = require("http"), fs = require("fs");
    http.createServer((q, r) => { fs.appendFileSync(process.argv[1], (q.headers.authorization || "<none>") + "\n"); r.writeHead(401); r.end(); })
      .listen(Number(process.argv[2]), "127.0.0.1");' "$T/headers.log" "$PORT" &
  SERVER=$!
  sleep 0.5
}
# A fake MCP server that completes the handshake and lists one allowlisted and
# two write-named tools. It never runs a tool.
start_fake_mcp_tools() {
  node -e '
    const tools = ["SqlQuery", "CreateDataset", "DeleteNotebook"].map((name) => ({ name, inputSchema: { type: "object" } }));
    require("http").createServer((q, r) => {
      if (q.method !== "POST") { r.writeHead(405); return r.end(); }
      let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
        const m = JSON.parse(b);
        if (m.id === undefined) { r.writeHead(202); return r.end(); }
        const result = m.method === "initialize" ? { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } } : m.method === "tools/list" ? { tools } : {};
        r.writeHead(200, { "content-type": "application/json" }); r.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
      });
    }).listen(Number(process.argv[1]), "127.0.0.1");' "$TOOLS_PORT" &
  TOOLS_SERVER=$!
  sleep 0.5
}
# Copy a plugin and point its MCP server at a fake server (default $PORT), using SMOKE_TOKEN.
local_copy() {
  cp -R "$1" "$2"
  for f in "$2/.mcp.json" "$2/extensions/filpgf-mcp.ts"; do
    if [ -f "$f" ]; then
      sed -i.bak -e "s#https://mcp.oso.xyz/mcp#http://127.0.0.1:${3:-$PORT}/mcp#" -e 's#OSO_TOKEN#SMOKE_TOKEN#g' "$f"
      rm -f "$f.bak"
    fi
  done
}

start_fake_mcp

if have claude; then
  iso claude claude plugin validate --strict "$DIST/claude/plugins/$NAME" >"$T/out" 2>&1 && ok "claude plugin validate" || { cat "$T/out"; bad "claude plugin validate"; }
  iso claude claude plugin validate --strict "$DIST/claude" >"$T/out" 2>&1 && ok "claude marketplace validate --strict" || { cat "$T/out"; bad "claude marketplace validate"; }
  ZIP=$(ls "$DIST"/packages/*-claude-plugin.zip)
  iso claude timeout 60 claude --plugin-dir "$ZIP" plugin list >"$T/out" 2>&1 || true
  grep -q "loaded" "$T/out" && ok "claude loads packaged plugin zip" || { cat "$T/out"; bad "claude zip load"; }
  local_copy "$MDIST/claude/plugins/$NAME" "$T/claude-plugin"
  : > "$T/headers.log"
  SMOKE_TOKEN=dummy-smoke-token iso claude timeout 60 claude --plugin-dir "$T/claude-plugin" mcp list >"$T/out" 2>&1 || true
  grep -q "plugin:$NAME:oso" "$T/out" && ok "claude loads plugin MCP server" || { cat "$T/out"; bad "claude plugin MCP server not listed"; }
  grep -q "Bearer dummy-smoke-token" "$T/headers.log" && ok "claude sends \${VAR}-expanded Authorization (fake local server, not real OSO)" || bad "claude did not send expanded bearer token"
else echo "skip - claude not installed"; fi

if have codex; then
  iso codex codex plugin marketplace add "$MDIST/codex" >"$T/out" 2>&1 && iso codex codex plugin add "$NAME@$NAME-marketplace" >>"$T/out" 2>&1 \
    && ok "codex marketplace add + plugin add (compatibility layout)" || { cat "$T/out"; bad "codex install"; }
  iso codex codex mcp get oso >"$T/out" 2>&1 || true
  grep -q "bearer_token_env_var: OSO_TOKEN" "$T/out" && ok "codex config shows bearer_token_env_var (config only, no request sent)" || { cat "$T/out"; bad "codex mcp get"; }
  grep -q "enabled_tools: .*SqlQuery" "$T/out" && ! grep -qi "enabled_tools: .*\(create\|delete\|update\)" "$T/out" && ok "codex config shows enabled_tools name allowlist without write-named tools (config only)" || bad "codex enabled_tools"
  iso codex timeout 120 codex debug prompt-input "smoke" >"$T/prompt" 2>&1 || true
  check_skills "codex prompt" "$T/prompt" "$NAME:"
  # Portable Agent Plugins output through a throwaway local marketplace.
  M="$T/portable-mkt"; mkdir -p "$M/.agents/plugins" "$M/plugins"
  cp -R "$DIST/agent-plugin/$NAME" "$M/plugins/$NAME"
  node -e 'const [m,n]=process.argv.slice(1);require("fs").writeFileSync(m,JSON.stringify({name:"portable-smoke",plugins:[{name:n,source:{source:"local",path:"./plugins/"+n},policy:{installation:"AVAILABLE",authentication:"ON_INSTALL"},category:"Productivity"}]}))' "$M/.agents/plugins/marketplace.json" "$NAME"
  iso codex-portable codex plugin marketplace add "$M" >"$T/out" 2>&1 && iso codex-portable codex plugin add "$NAME@portable-smoke" >>"$T/out" 2>&1 \
    && ok "codex installs portable Agent Plugins output" || { cat "$T/out"; bad "codex portable install"; }
  iso codex-portable timeout 120 codex debug prompt-input "smoke" >"$T/prompt" 2>&1 || true
  check_skills "codex portable prompt" "$T/prompt" "$NAME:"
else echo "skip - codex not installed"; fi

if have pi; then
  printf '%s\n' '{"type":"get_commands","id":"1"}' | iso pi timeout 60 pi --mode rpc --no-session -e "$DIST/pi/$NAME" >"$T/out" 2>&1 || true
  check_skills "pi rpc get_commands" "$T/out" "skill:"
  local_copy "$MDIST/pi/$NAME" "$T/pi-pkg"
  : > "$T/headers.log"
  (printf '%s\n' '{"type":"get_commands","id":"1"}'; sleep 4) | SMOKE_TOKEN=dummy-smoke-token iso pi timeout 30 pi --mode rpc --no-session -e "$T/pi-pkg" >/dev/null 2>&1 || true
  grep -q "Bearer dummy-smoke-token" "$T/headers.log" && ok "pi extension registers MCP server and sends expanded header (fake local server)" || bad "pi MCP registration"
  # Effective tool exposure after a real handshake with a fake server: a probe
  # extension command (run locally, no model call) records pi.getAllTools().
  start_fake_mcp_tools
  local_copy "$MDIST/pi/$NAME" "$T/pi-tools" "$TOOLS_PORT"
  cat > "$T/probe.ts" <<EOF
import fs from "node:fs";
export default function (pi: any) {
  pi.registerCommand("probe", { description: "smoke probe", handler: async () => {
    let t: any[] = [];
    for (let i = 0; i < 50 && t.length < 3; i++) { await new Promise((r) => setTimeout(r, 200)); t = pi.getAllTools().filter((x: any) => x.name.startsWith("mcp__oso__")); }
    fs.writeFileSync("$T/exposure.json", JSON.stringify(Object.fromEntries(t.map((x: any) => [x.name, x.exposure]))));
  }});
}
EOF
  (printf '%s\n' '{"type":"prompt","id":"1","message":"/probe"}'; sleep 12) | SMOKE_TOKEN=dummy-smoke-token iso pi timeout 30 pi --mode rpc --no-session -e "$T/pi-tools" -e "$T/probe.ts" >/dev/null 2>&1 || true
  node -e '
    const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const ok = e.mcp__oso__SqlQuery && e.mcp__oso__SqlQuery !== "hidden" && e.mcp__oso__CreateDataset === "hidden" && e.mcp__oso__DeleteNotebook === "hidden";
    console.log(JSON.stringify(e)); process.exit(ok ? 0 : 1);' "$T/exposure.json" >"$T/out" 2>&1 \
    && ok "pi hides tools outside the name allowlist at runtime (fake local server, not real OSO)" || { cat "$T/out"; bad "pi tool exposure"; }
else echo "skip - pi not installed"; fi

[ "$fail" = 0 ] && echo "smoke: all checks passed" || { echo "smoke: failures"; exit 1; }
