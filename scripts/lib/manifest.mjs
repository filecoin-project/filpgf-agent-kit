// Toolkit manifest (toolkit.json) loading and validation.
import fs from "node:fs";

const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9]|-(?!-)|\.(?!\.))*[a-z0-9]$|^[a-z0-9]$/;
const SERVER_NAME_RE = /^[A-Za-z0-9_-]+$/;
const SERVER_FIELDS = new Set(["url", "description", "docs", "allowedTools"]);
export const ROUTES = ["public", "credential", "local"];

/** Plugin name: 1-64 of [a-z0-9.-], alphanumeric at both ends, no "--" or "..". */
export const isPluginName = (n) => typeof n === "string" && n.length <= 64 && PLUGIN_NAME_RE.test(n);

export function validateManifest(m) {
  const errors = [];
  if (!isPluginName(m.name)) errors.push("name must be a valid plugin name");
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+/.test(m.version)) errors.push("version must be semver");
  if (typeof m.description !== "string" || !m.description) errors.push("description is required");
  // MCP servers carry only a URL: every client signs in with OAuth, so the package never holds a credential.
  for (const [name, s] of Object.entries(m.mcpServers ?? {})) {
    if (!SERVER_NAME_RE.test(name)) errors.push(`mcpServers.${name}: invalid server name`);
    for (const k of Object.keys(s)) if (!SERVER_FIELDS.has(k)) errors.push(`mcpServers.${name}: field ${k} is not allowed (servers use client OAuth; no headers or credentials)`);
    const url = URL.canParse(s.url) ? new URL(s.url) : null;
    if (!url || url.protocol !== "https:" || url.username || url.password || url.hash) errors.push(`mcpServers.${name}: url must be https without credentials or a fragment`);
    if (s.allowedTools !== undefined && (!Array.isArray(s.allowedTools) || !s.allowedTools.length || s.allowedTools.some((t) => typeof t !== "string" || !/^[A-Za-z0-9_.-]+$/.test(t)))) errors.push(`mcpServers.${name}: allowedTools must be a non-empty list of exact tool names`);
  }
  const ids = new Set();
  for (const s of m.sources ?? []) {
    if (!s.id || ids.has(s.id)) errors.push(`sources: missing or duplicate id ${s.id}`);
    ids.add(s.id);
    for (const k of ["name", "covers", "access", "auth", "authority", "maintainer", "report"]) if (typeof s[k] !== "string" || !s[k]) errors.push(`sources.${s.id}: ${k} is required`);
    // Routes say how an agent reaches the source; credential and local routes are handoffs to the user.
    if (s.route !== undefined && !ROUTES.includes(s.route)) errors.push(`sources.${s.id}: route must be one of ${ROUTES.join(", ")}`);
    if (s.route && s.route !== "public" && (typeof s.handoff !== "string" || !s.handoff)) errors.push(`sources.${s.id}: handoff is required for route ${s.route}`);
    if (s.upstream !== undefined && !(URL.canParse(s.upstream) && new URL(s.upstream).protocol === "https:")) errors.push(`sources.${s.id}: upstream must be an https URL`);
  }
  if (errors.length) throw new Error(`toolkit manifest invalid:\n- ${errors.join("\n- ")}`);
  return m;
}

export function loadManifest(file) {
  return validateManifest(JSON.parse(fs.readFileSync(file, "utf8")));
}
