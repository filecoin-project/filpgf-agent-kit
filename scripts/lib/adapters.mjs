// Map the toolkit manifest to each output format.
// Keep each client's manifest and MCP configuration separate.
import fs from "node:fs";
import path from "node:path";

export const PORTABLE_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const PORTABLE_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

const json = (v) => JSON.stringify(v, null, 2) + "\n";
const metadata = (m) => {
  const out = { name: m.name, version: m.version, description: m.description };
  if (m.author) out.author = m.author;
  for (const k of ["homepage", "repository", "license"]) if (m[k]) out[k] = m[k];
  if (m.keywords?.length) out.keywords = m.keywords;
  return out;
};

// ---- MCP mappings -------------------------------------------------------

/** Agent Plugins 1.0.0 mcp.json: no env expansion in headers, so auth is client-managed. */
export function portableMcp(m) {
  const servers = {};
  for (const [name, s] of Object.entries(m.mcpServers ?? {})) servers[name] = { type: "streamable-http", url: s.url };
  return { $schema: PORTABLE_MCP_SCHEMA, mcpServers: servers };
}

/** Claude Code .mcp.json: `${VAR}` expansion is supported in headers. */
export function claudeMcp(m) {
  const servers = {};
  for (const [name, s] of Object.entries(m.mcpServers ?? {})) {
    const entry = { type: "http", url: s.url };
    const h = authHeaders(s.auth);
    if (h) entry.headers = h;
    servers[name] = entry;
  }
  return { mcpServers: servers };
}

/** Codex compatibility .mcp.json: env auth via bearer_token_env_var / env_http_headers (no `${VAR}`). */
export function codexMcp(m) {
  const servers = {};
  for (const [name, s] of Object.entries(m.mcpServers ?? {})) {
    const entry = { type: "http", url: s.url };
    if (s.auth?.scheme === "bearer") entry.bearer_token_env_var = s.auth.env;
    else if (s.auth?.scheme === "header") entry.env_http_headers = { [s.auth.header]: s.auth.env };
    if (s.allowedTools) entry.enabled_tools = [...s.allowedTools];
    servers[name] = entry;
  }
  return { mcpServers: servers };
}

/** Pi registerMcpServer configs; headers use `${VAR}`, which Pi expands. */
export function piServers(m) {
  return Object.entries(m.mcpServers ?? {}).map(([name, s]) => {
    const config = { url: s.url };
    if (s.description) config.description = s.description;
    const h = authHeaders(s.auth);
    if (h) config.headers = h;
    if (s.allowedTools) {
      // Configure Pi to hide every tool except the named ones, which stay reachable from codemode.
      // This filters by tool name only; it says nothing about what an allowed tool can do.
      config.exposure = "hidden";
      config.toolExposure = Object.fromEntries(s.allowedTools.map((t) => [t, "codemode"]));
    }
    return { name, requiresEnv: s.auth ? [s.auth.env] : [], config };
  });
}

function authHeaders(auth) {
  if (!auth) return null;
  if (auth.scheme === "bearer") return { Authorization: `Bearer \${${auth.env}}` };
  return { [auth.header]: `\${${auth.env}}` };
}

// ---- Plugin manifests ----------------------------------------------------

export function portablePlugin(m) {
  const out = { $schema: PORTABLE_PLUGIN_SCHEMA, ...metadata(m) };
  if (m.interface) out.extensions = { "com.openai": { interface: m.interface } };
  return out;
}

export function claudePlugin(m) {
  return metadata(m);
}

export function claudeMarketplace(m) {
  return {
    name: `${m.name}-marketplace`,
    description: `Marketplace for ${m.name}: ${m.description}`,
    owner: { name: m.author?.name ?? m.name },
    plugins: [{ name: m.name, source: `./plugins/${m.name}`, description: m.description, version: m.version }],
  };
}

export function codexPlugin(m) {
  const out = { ...metadata(m), skills: "./skills/" };
  if (Object.keys(m.mcpServers ?? {}).length) out.mcpServers = "./.mcp.json";
  if (m.interface) out.interface = m.interface;
  return out;
}

export function codexMarketplace(m) {
  return {
    name: `${m.name}-marketplace`,
    interface: { displayName: m.interface?.displayName ?? m.name },
    plugins: [
      {
        name: m.name,
        source: { source: "local", path: `./plugins/${m.name}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: m.interface?.category ?? "Productivity",
      },
    ],
  };
}

export function piPackageJson(m) {
  const ext = Object.keys(m.mcpServers ?? {}).length > 0;
  return {
    name: m.name,
    version: m.version,
    description: m.description,
    license: m.license,
    type: "module",
    keywords: ["pi-package", ...(m.keywords ?? [])],
    ...(m.repository ? { repository: m.repository } : {}),
    files: ["skills", ...(ext ? ["extensions"] : []), "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md"],
    pi: { skills: ["./skills"], ...(ext ? { extensions: ["./extensions"] } : {}) },
    peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
  };
}

export function piExtensionSource(template, m) {
  const marker = "/*SERVERS*/ []";
  if (!template.includes(marker)) throw new Error("Pi extension template is missing the /*SERVERS*/ marker");
  return template.replace(marker, JSON.stringify(piServers(m), null, 2));
}

// ---- Writers ---------------------------------------------------------------

export function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : json(content));
}

export function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: false, errorOnExist: true, force: false });
}
