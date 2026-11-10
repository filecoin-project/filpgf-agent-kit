#!/usr/bin/env node
// Structural validation of build output without any agent CLI.
// Usage: node scripts/validate-dist.mjs [dist]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSkillDirs, validateSkillDir } from "./lib/skills.mjs";
import { sha256 } from "./lib/imports.mjs";
import { readZip, listFiles } from "./lib/zip.mjs";
import { PORTABLE_MCP_SCHEMA, PORTABLE_PLUGIN_SCHEMA } from "./lib/adapters.mjs";
import { isPluginName } from "./lib/manifest.mjs";

const PORTABLE_FIELDS = new Set(["$schema", "name", "version", "description", "author", "homepage", "repository", "license", "keywords", "extensions"]);
// Header values must reference environment variables, never carry literal credentials.
const ENV_HEADER_RE = /^(Bearer )?\$\{[A-Z_][A-Z0-9_]*\}$/;

export function validateDist(dist) {
  const errors = [];
  const err = (m) => errors.push(m);
  const readJson = (f) => {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      err(`${path.relative(dist, f)}: ${e.message}`);
      return null;
    }
  };
  const info = readJson(path.join(dist, "build-info.json"));
  if (!info) return errors;
  const name = info.name;

  const checkSkills = (root, expected) => {
    const found = [];
    for (const d of listSkillDirs(path.join(root, "skills"))) {
      try {
        found.push(validateSkillDir(d).name);
      } catch (e) {
        err(e.message);
      }
    }
    if (JSON.stringify(found.sort()) !== JSON.stringify([...expected].sort())) err(`${path.relative(dist, root)}: skills ${found} != ${expected}`);
    for (const s of info.skills.imported) {
      const up = path.join(root, "skills", s, "UPSTREAM.json");
      if (!fs.existsSync(up)) err(`${path.relative(dist, root)}: ${s} missing UPSTREAM.json`);
      else {
        const p = JSON.parse(fs.readFileSync(up, "utf8"));
        if (!/^[0-9a-f]{40}$/.test(p.commit)) err(`${s}: provenance commit is not a full SHA`);
        if (!fs.existsSync(path.join(root, "skills", s, p.licenseFile))) err(`${s}: license file missing`);
      }
    }
    for (const d of listSkillDirs(path.join(root, "skills"))) {
      for (const f of listFiles(d).filter((x) => x.endsWith(".md"))) {
        const text = fs.readFileSync(path.join(d, f), "utf8");
        for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
          if (/^([a-z]+:|#)/i.test(target)) continue;
          const resolved = path.resolve(path.dirname(path.join(d, f)), decodeURI(target.split("#")[0]));
          if (target.startsWith("/") || !resolved.startsWith(d + path.sep) || !fs.existsSync(resolved)) err(`${path.relative(dist, path.join(d, f))}: broken or escaping link ${target}`);
        }
      }
    }
    if (!fs.existsSync(path.join(root, "THIRD_PARTY_NOTICES.md"))) err(`${path.relative(dist, root)}: THIRD_PARTY_NOTICES.md missing`);
  };
  const checkHeaders = (where, servers) => {
    for (const [n, s] of Object.entries(servers ?? {})) {
      for (const [h, v] of Object.entries(s.headers ?? {})) if (!ENV_HEADER_RE.test(v)) err(`${where}: ${n} header ${h} is not an environment reference`);
      if (s.http_headers) err(`${where}: ${n} uses static http_headers`);
      if (s.env) err(`${where}: ${n} sets env values`);
    }
  };

  // Portable Agent Plugins 1.0.0
  const portable = path.join(dist, info.outputs["agent-plugin"]);
  const pj = readJson(path.join(portable, "plugin.json"));
  if (pj) {
    if (pj.$schema !== PORTABLE_PLUGIN_SCHEMA) err("plugin.json: wrong $schema");
    if (!isPluginName(pj.name)) err("plugin.json: invalid name");
    for (const k of Object.keys(pj)) if (!PORTABLE_FIELDS.has(k)) err(`plugin.json: field ${k} not allowed by Agent Plugins 1.0.0`);
    if (pj.author) for (const k of Object.keys(pj.author)) if (!["name", "email", "url"].includes(k)) err(`plugin.json: author.${k} not allowed`);
    for (const [ns, v] of Object.entries(pj.extensions ?? {})) if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(ns) || typeof v !== "object") err(`plugin.json: bad extension namespace ${ns}`);
  }
  if (fs.existsSync(path.join(portable, ".mcp.json"))) err("portable output must use mcp.json, not .mcp.json");
  if (fs.existsSync(path.join(portable, "mcp.json"))) {
    const mj = readJson(path.join(portable, "mcp.json"));
    if (mj) {
      if (mj.$schema !== PORTABLE_MCP_SCHEMA) err("mcp.json: wrong $schema");
      for (const k of Object.keys(mj)) if (!["$schema", "mcpServers"].includes(k)) err(`mcp.json: field ${k} not allowed`);
      for (const [n, s] of Object.entries(mj.mcpServers ?? {})) {
        if (!["stdio", "streamable-http", "sse"].includes(s.type)) err(`mcp.json: ${n} has invalid type ${s.type}`);
        if (s.type !== "stdio") {
          for (const k of Object.keys(s)) if (!["type", "url", "headers"].includes(k)) err(`mcp.json: ${n} field ${k} not allowed`);
          const u = URL.canParse(s.url) ? new URL(s.url) : {};
          if (u.protocol !== "https:" || u.username || u.hash) err(`mcp.json: ${n} url must be https without credentials or fragment`);
          if (Object.keys(s.headers ?? {}).length) err(`mcp.json: ${n} headers are not allowed in this toolkit (no portable secret mechanism)`);
        }
      }
    }
  }
  checkSkills(portable, info.skills.all);

  // Claude Code
  const claudeRoot = path.join(dist, info.outputs.claude);
  const cm = readJson(path.join(claudeRoot, ".claude-plugin", "marketplace.json"));
  for (const p of cm?.plugins ?? []) {
    const dir = path.join(claudeRoot, p.source);
    if (!dir.startsWith(claudeRoot + path.sep) || !fs.existsSync(path.join(dir, ".claude-plugin", "plugin.json"))) err(`claude marketplace: source ${p.source} invalid`);
    else {
      const cp = readJson(path.join(dir, ".claude-plugin", "plugin.json"));
      if (cp?.name !== p.name) err("claude: marketplace and plugin names disagree");
      checkSkills(dir, info.skills.all);
      if (fs.existsSync(path.join(dir, ".mcp.json"))) checkHeaders("claude .mcp.json", readJson(path.join(dir, ".mcp.json"))?.mcpServers);
    }
  }

  // Codex
  const codexRoot = path.join(dist, info.outputs.codex);
  const xm = readJson(path.join(codexRoot, ".agents", "plugins", "marketplace.json"));
  for (const p of xm?.plugins ?? []) {
    const dir = path.join(codexRoot, p.source?.path ?? "");
    if (p.source?.source !== "local" || !p.source.path?.startsWith("./") || !dir.startsWith(codexRoot + path.sep)) err(`codex marketplace: bad source for ${p.name}`);
    const xp = readJson(path.join(dir, ".codex-plugin", "plugin.json"));
    if (!xp) continue;
    if (xp.name !== p.name) err("codex: marketplace and plugin names disagree");
    if (xp.skills !== "./skills/") err("codex: skills path must be ./skills/");
    if (xp.mcpServers) {
      const mcp = readJson(path.join(dir, xp.mcpServers));
      checkHeaders("codex .mcp.json", mcp?.mcpServers);
      for (const [n, s] of Object.entries(mcp?.mcpServers ?? {})) if (s.headers) err(`codex .mcp.json: ${n} uses headers; Codex needs bearer_token_env_var or env_http_headers`);
    }
    checkSkills(dir, info.skills.all);
  }

  // Pi
  const pi = path.join(dist, info.outputs.pi);
  const pp = readJson(path.join(pi, "package.json"));
  if (pp) {
    if (!pp.keywords?.includes("pi-package")) err("pi package.json: missing pi-package keyword");
    for (const p of [...(pp.pi?.skills ?? []), ...(pp.pi?.extensions ?? [])]) if (!fs.existsSync(path.join(pi, p))) err(`pi package.json: ${p} missing`);
    if (pp.dependencies?.["@earendil-works/pi-coding-agent"]) err("pi package.json: host package must be a peer dependency");
  }
  checkSkills(pi, info.skills.all);

  // Packages and checksums
  const pkg = path.join(dist, "packages");
  if (fs.existsSync(pkg)) {
    const sums = fs.readFileSync(path.join(pkg, "SHA256SUMS"), "utf8").trim().split("\n");
    for (const line of sums) {
      const [h, f] = line.split(/\s+/);
      if (sha256(fs.readFileSync(path.join(pkg, f))) !== h) err(`SHA256SUMS mismatch for ${f}`);
    }
    const zip = path.join(pkg, `${name}-${info.version}-agent-plugin.zip`);
    if (fs.existsSync(zip)) {
      const entries = [...readZip(zip).keys()].sort();
      const expected = listFiles(portable).map((f) => `${name}/${f}`);
      if (JSON.stringify(entries) !== JSON.stringify(expected)) err("agent-plugin zip contents differ from directory");
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] ?? "dist");
  const errors = validateDist(dist);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    process.exit(1);
  }
  console.log(`dist valid: ${dist}`);
}
