// Toolkit manifest (toolkit.json) loading and validation.
import fs from "node:fs";

const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)|\.(?!\.))*[a-z0-9]$|^[a-z0-9]$/;
const SERVER_NAME_RE = /^[A-Za-z0-9_-]+$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Agent Plugins 1.0.0 plugin name: 1-64 of [a-z0-9.-], alphanumeric at both ends, no "--" or "..". */
export const isPluginName = (n) => typeof n === "string" && n.length <= 64 && PLUGIN_NAME_RE.test(n);

export function validateManifest(m) {
  const errors = [];
  if (!isPluginName(m.name)) errors.push("name must be a valid Agent Plugins name");
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+/.test(m.version)) errors.push("version must be semver");
  if (typeof m.description !== "string" || !m.description) errors.push("description is required");
  for (const [name, s] of Object.entries(m.mcpServers ?? {})) {
    if (!SERVER_NAME_RE.test(name)) errors.push(`mcpServers.${name}: invalid server name`);
    let url;
    try {
      url = new URL(s.url);
    } catch {
      errors.push(`mcpServers.${name}: url is not a URL`);
      continue;
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) errors.push(`mcpServers.${name}: url must be https`);
    if (url.username || url.password || url.hash) errors.push(`mcpServers.${name}: url must not contain credentials or a fragment`);
    if (s.headers) errors.push(`mcpServers.${name}: literal headers are not allowed; use auth.env so no secret is stored in the package`);
    if (s.allowedTools !== undefined && (!Array.isArray(s.allowedTools) || !s.allowedTools.length || s.allowedTools.some((t) => typeof t !== "string" || !/^[A-Za-z0-9_.-]+$/.test(t)))) errors.push(`mcpServers.${name}: allowedTools must be a non-empty list of exact tool names`);
    if (s.optIn !== undefined && typeof s.optIn !== "boolean") errors.push(`mcpServers.${name}: optIn must be boolean`);
    const a = s.auth;
    if (a !== undefined) {
      if (!["bearer", "header"].includes(a.scheme)) errors.push(`mcpServers.${name}: auth.scheme must be bearer or header`);
      if (!ENV_RE.test(a.env ?? "")) errors.push(`mcpServers.${name}: auth.env must be an environment variable name`);
      if (a.scheme === "header" && !/^[A-Za-z0-9-]+$/.test(a.header ?? "")) errors.push(`mcpServers.${name}: auth.header is required for scheme header`);
    }
  }
  const ids = new Set();
  for (const s of m.sources ?? []) {
    if (!s.id || ids.has(s.id)) errors.push(`sources: missing or duplicate id ${s.id}`);
    ids.add(s.id);
    for (const k of ["name", "covers", "access", "auth", "authority", "maintainer", "report"]) if (typeof s[k] !== "string" || !s[k]) errors.push(`sources.${s.id}: ${k} is required`);
  }
  if (errors.length) throw new Error(`toolkit manifest invalid:\n- ${errors.join("\n- ")}`);
  return m;
}

export function loadManifest(file) {
  return validateManifest(JSON.parse(fs.readFileSync(file, "utf8")));
}
