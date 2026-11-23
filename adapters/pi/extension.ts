// Registers the plugin's MCP servers with Pi. Copied as-is to the stable
// branch by scripts/build.mjs; it reads the same .mcp.json as Claude Code and Codex.
//
// - No credentials: Pi runs the OAuth sign-in from /mcp the first time a server needs it.
// - `enabled_tools` becomes Pi's tool exposure: other tools of that server stay hidden.
// - A server with the same name in ~/.pi/agent/mcp.json or .pi/mcp.json takes precedence.
import fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Server = { url: string; enabled_tools?: string[] };

export default function (pi: ExtensionAPI) {
  const file = new URL("../plugins/filpgf-ecosystem/.mcp.json", import.meta.url);
  const { mcpServers } = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpServers: Record<string, Server> };
  for (const [name, s] of Object.entries(mcpServers)) {
    const config: Parameters<ExtensionAPI["registerMcpServer"]>[1] = { url: s.url };
    if (s.enabled_tools) Object.assign(config, { exposure: "hidden", toolExposure: Object.fromEntries(s.enabled_tools.map((t) => [t, "codemode"])) });
    try {
      pi.registerMcpServer(name, config);
    } catch {
      // Another extension owns this name or the config is invalid: skip it rather than fail loading.
    }
  }
}
