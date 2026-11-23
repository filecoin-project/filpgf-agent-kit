// Map toolkit.json to the files each client reads. One plugin folder serves
// every client: Claude Code reads .claude-plugin/, Codex and ChatGPT read
// .codex-plugin/, both read the shared .mcp.json, and Pi reads the package.json
// at the marketplace root.
import fs from "node:fs";
import path from "node:path";

const json = (v) => JSON.stringify(v, null, 2) + "\n";
const metadata = (m) => {
  const out = { name: m.name, version: m.version, description: m.description };
  if (m.author) out.author = m.author;
  for (const k of ["homepage", "repository", "license"]) if (m[k]) out[k] = m[k];
  if (m.keywords?.length) out.keywords = m.keywords;
  return out;
};
export const marketplaceName = (m) => `${m.name}-marketplace`;
export const pluginPath = (m) => `./plugins/${m.name}`;

/**
 * Shared .mcp.json. Servers have no headers: each client runs the MCP OAuth
 * sign-in itself. `enabled_tools` is applied by Codex and ignored by Claude Code.
 */
export function mcpJson(m) {
  const servers = {};
  for (const [name, s] of Object.entries(m.mcpServers ?? {})) {
    servers[name] = { type: "http", url: s.url };
    if (s.allowedTools) servers[name].enabled_tools = [...s.allowedTools];
  }
  return { mcpServers: servers };
}

export function claudePlugin(m) {
  return metadata(m);
}

export function codexPlugin(m) {
  const out = { ...metadata(m), skills: "./skills/" };
  if (Object.keys(m.mcpServers ?? {}).length) out.mcpServers = "./.mcp.json";
  if (m.interface) out.interface = m.interface;
  return out;
}

export function claudeMarketplace(m) {
  return {
    name: marketplaceName(m),
    description: m.description,
    owner: { name: m.author?.name ?? m.name },
    plugins: [{ name: m.name, source: pluginPath(m), description: m.description, version: m.version, author: m.author }],
  };
}

export function codexMarketplace(m) {
  return {
    name: marketplaceName(m),
    interface: { displayName: m.interface?.displayName ?? m.name },
    plugins: [
      {
        name: m.name,
        source: { source: "local", path: pluginPath(m) },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: m.interface?.category ?? "Productivity",
      },
    ],
  };
}

/** Pi package manifest at the marketplace root, so `pi install git:<repo>@stable` works. */
export function piPackageJson(m) {
  return {
    name: m.name,
    version: m.version,
    description: m.description,
    license: m.license,
    type: "module",
    keywords: ["pi-package", ...(m.keywords ?? [])],
    ...(m.repository ? { repository: m.repository } : {}),
    pi: { skills: [`${pluginPath(m)}/skills`], extensions: ["./extensions"] },
    peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
  };
}

export function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" || Buffer.isBuffer(content) ? content : json(content));
}

export function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: false, errorOnExist: true, force: false });
}
