#!/usr/bin/env node
// Structural validation of build output, without any agent CLI.
// Usage: node scripts/validate-dist.mjs [dist]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSkillDirs, validateSkillDir } from "./lib/skills.mjs";
import { sha256 } from "./lib/imports.mjs";
import { readZip, listFiles } from "./lib/zip.mjs";
import { isPluginName } from "./lib/manifest.mjs";
import { marketplaceName, pluginPath } from "./lib/adapters.mjs";

const ROOT_ENTRIES = [".agents", ".claude-plugin", "LICENSE", "README.md", "extensions", "package.json", "plugins"];

export function validateDist(dist) {
  const errors = [];
  const err = (m) => errors.push(m);
  const stable = path.join(dist, "stable");
  const readJson = (rel, base = stable) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(base, rel), "utf8"));
    } catch (e) {
      err(`${rel}: ${e.message}`);
      return {};
    }
  };

  // Marketplace root: only the files the build writes.
  const pkg = readJson("package.json");
  const { name, version } = pkg;
  if (!isPluginName(name)) return [...errors, "package.json: invalid name"];
  for (const f of fs.readdirSync(stable)) if (!ROOT_ENTRIES.includes(f)) err(`unexpected file at the marketplace root: ${f}`);
  const plugin = path.join(stable, pluginPath({ name }));

  // Pi package.
  if (!pkg.keywords?.includes("pi-package")) err("package.json: missing pi-package keyword");
  for (const p of [...(pkg.pi?.skills ?? []), ...(pkg.pi?.extensions ?? [])]) if (!fs.existsSync(path.join(stable, p))) err(`package.json: ${p} missing`);
  if (pkg.dependencies) err("package.json: the Pi package must not install dependencies");
  const ext = fs.existsSync(path.join(stable, "extensions/filpgf-mcp.ts")) ? fs.readFileSync(path.join(stable, "extensions/filpgf-mcp.ts"), "utf8") : "";
  if (!ext.includes(`../plugins/${name}/.mcp.json`)) err(`extensions/filpgf-mcp.ts must read plugins/${name}/.mcp.json`);

  // Marketplace indexes point at the plugin folder, at the same version.
  const cm = readJson(".claude-plugin/marketplace.json");
  const xm = readJson(".agents/plugins/marketplace.json");
  if (cm.name !== marketplaceName({ name }) || xm.name !== cm.name) err("marketplace names must be <name>-marketplace");
  if (cm.plugins?.length !== 1 || cm.plugins[0].name !== name || cm.plugins[0].source !== pluginPath({ name }) || cm.plugins[0].version !== version) err("claude marketplace must list exactly this plugin and version");
  if (xm.plugins?.length !== 1 || xm.plugins[0].name !== name || xm.plugins[0].source?.source !== "local" || xm.plugins[0].source?.path !== pluginPath({ name })) err("codex marketplace must list exactly this plugin");

  // Plugin manifests.
  const cp = readJson(".claude-plugin/plugin.json", plugin);
  const xp = readJson(".codex-plugin/plugin.json", plugin);
  for (const [label, p] of [["claude", cp], ["codex", xp]]) if (p.name !== name || p.version !== version) err(`${label} plugin.json: name/version disagree with package.json`);
  if (xp.skills !== "./skills/") err("codex plugin.json: skills path must be ./skills/");
  if (xp.mcpServers !== "./.mcp.json") err("codex plugin.json: mcpServers must be ./.mcp.json");

  // MCP servers: https URLs only, never headers, env values or other credentials.
  for (const [n, s] of Object.entries(readJson(".mcp.json", plugin).mcpServers ?? {})) {
    for (const k of Object.keys(s)) if (!["type", "url", "enabled_tools"].includes(k)) err(`.mcp.json: ${n} field ${k} not allowed (servers use client OAuth)`);
    const u = URL.canParse(s.url) ? new URL(s.url) : {};
    if (s.type !== "http" || u.protocol !== "https:" || u.username || u.password || u.hash) err(`.mcp.json: ${n} must be an https http server without credentials`);
  }

  // Skills, provenance and links.
  const found = [];
  for (const d of listSkillDirs(path.join(plugin, "skills"))) {
    try {
      found.push(validateSkillDir(d).name);
    } catch (e) {
      err(e.message);
      continue;
    }
    const up = path.join(d, "UPSTREAM.json");
    if (fs.existsSync(up)) {
      const p = JSON.parse(fs.readFileSync(up, "utf8"));
      if (!/^[0-9a-f]{40}$/.test(p.commit)) err(`${path.basename(d)}: provenance commit is not a full SHA`);
      if (!fs.existsSync(path.join(d, p.licenseFile ?? "LICENSE"))) err(`${path.basename(d)}: license file missing`);
    }
    checkLinks(dist, d, err);
  }
  if (!found.includes(name)) err(`skill ${name} missing`);
  if (!fs.existsSync(path.join(plugin, "THIRD_PARTY_NOTICES.md"))) err("THIRD_PARTY_NOTICES.md missing");

  // ZIP and checksums.
  const packages = path.join(dist, "packages");
  const sums = fs.existsSync(path.join(packages, "SHA256SUMS")) ? fs.readFileSync(path.join(packages, "SHA256SUMS"), "utf8").trim().split("\n") : [];
  if (!sums.length) err("packages/SHA256SUMS missing");
  for (const line of sums) {
    const [h, f] = line.split(/\s+/);
    if (!fs.existsSync(path.join(packages, f)) || sha256(fs.readFileSync(path.join(packages, f))) !== h) err(`SHA256SUMS mismatch for ${f}`);
  }
  const zip = path.join(packages, `${name}-${version}.zip`);
  if (!fs.existsSync(zip)) err(`packages/${name}-${version}.zip missing`);
  else if (JSON.stringify([...readZip(zip).keys()].sort()) !== JSON.stringify(listFiles(plugin).map((f) => `${name}/${f}`))) err("plugin ZIP contents differ from the plugin folder");
  return errors;
}

/** Relative Markdown links in a skill must resolve to files inside that skill. */
function checkLinks(dist, d, err) {
  for (const f of listFiles(d).filter((x) => x.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(d, f), "utf8");
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^([a-z]+:|#)/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(path.join(d, f)), decodeURI(target.split("#")[0]));
      if (target.startsWith("/") || !resolved.startsWith(d + path.sep) || !fs.existsSync(resolved)) err(`${path.relative(dist, path.join(d, f))}: broken or escaping link ${target}`);
    }
  }
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
