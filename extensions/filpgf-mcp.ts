// Registers the plugin's MCP servers with Pi, from the same mcp.json that
// Codex and other Agent Plugins clients read.
//
// - No credentials: Pi runs the OAuth sign-in from /mcp the first time a server needs it.
// - A server with the same name in ~/.pi/agent/mcp.json or .pi/mcp.json takes precedence.
import fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const file = new URL("../plugins/filpgf-ecosystem/mcp.json", import.meta.url);
  const { mcpServers } = JSON.parse(fs.readFileSync(file, "utf8")) as { mcpServers: Record<string, { url: string }> };
  for (const [name, { url }] of Object.entries(mcpServers)) {
    try {
      pi.registerMcpServer(name, { url });
    } catch {
      // Another extension owns this name or the config is invalid: skip it rather than fail loading.
    }
  }
}
