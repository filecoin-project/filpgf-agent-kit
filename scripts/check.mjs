#!/usr/bin/env node
// Check the plugin and the marketplaces that list it. The plugin's files are
// written by hand; this script makes sure every copy of the same fact agrees.
//
// Usage: node scripts/check.mjs [--root DIR]
//        node scripts/check.mjs --set-version   copy package.json's version into both plugin manifests
//                                               (run by `npm version` through the "version" script)
//
// - package.json (also the Pi package) holds the version. plugin.json (Agent
//   Plugins, read by Codex and VS Code) and .claude-plugin/plugin.json (Claude
//   Code) repeat it and the rest of the metadata.
// - mcp.json and the Claude manifest declare the same servers: https URLs only,
//   no headers or other credentials, because every client signs in with OAuth.
// - Both marketplaces list the plugin once; the Claude entry lists every skill
//   so `npx skills add` finds them.
// - Skills are valid, their relative links resolve, every skill and source the
//   router table names exists, and every skill appears in the router.
// - Copied upstream skills carry UPSTREAM.json at the commit imports.lock.json pins
//   (`npm run sync:check` compares their content with upstream).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { listFiles, listSkillDirs, validateSkillDir } from "./lib/skills.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN = "plugins/filpgf";
const ROUTER = "filpgf";
const SHARED = ["name", "version", "description", "author", "homepage", "repository", "license", "keywords"];
const PORTABLE_FIELDS = new Set(["$schema", ...SHARED, "extensions"]);
const MANIFESTS = ["plugin.json", ".claude-plugin/plugin.json"];

export function check(root = ROOT) {
  const problems = [];
  const err = (m) => problems.push(m);
  const read = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, f), "utf8"));
    } catch (e) {
      err(`${f}: ${e.message}`);
      return {};
    }
  };
  const pkg = read("package.json");
  const portable = read(`${PLUGIN}/plugin.json`);
  const claude = read(`${PLUGIN}/.claude-plugin/plugin.json`);
  const mcp = read(`${PLUGIN}/mcp.json`);
  const name = portable.name;

  // Manifests.
  if (portable.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json") err("plugin.json: $schema must be the Agent Plugins 1.0.0 schema");
  for (const k of Object.keys(portable)) if (!PORTABLE_FIELDS.has(k)) err(`plugin.json: field ${k} is not allowed; client fields belong under extensions`);
  if (`${PLUGIN.split("/")[0]}/${name}` !== PLUGIN) err(`plugin.json: name ${name} must match the folder ${PLUGIN}`);
  for (const k of SHARED) if (!isDeepStrictEqual(claude[k], portable[k])) err(`.claude-plugin/plugin.json: ${k} differs from plugin.json`);
  if (portable.version !== pkg.version) err(`plugin.json: version ${portable.version} differs from package.json ${pkg.version} (run npm version)`);
  if (claude.displayName !== portable.extensions?.["com.openai"]?.interface?.displayName) err(".claude-plugin/plugin.json: displayName differs from the com.openai listing");

  // MCP servers: the same set in both formats, URL only.
  const servers = mcp.mcpServers ?? {};
  for (const [n, s] of Object.entries(servers)) {
    if (!isDeepStrictEqual(Object.keys(s).sort(), ["type", "url"]) || s.type !== "streamable-http") err(`mcp.json: ${n} must have only type streamable-http and url (clients sign in with OAuth)`);
    const u = URL.canParse(s.url) ? new URL(s.url) : null;
    if (!u || u.protocol !== "https:" || u.username || u.password || u.search || u.hash) err(`mcp.json: ${n} url must be plain https`);
  }
  const claudeServers = Object.fromEntries(Object.entries(servers).map(([n, s]) => [n, { type: "http", url: s.url }]));
  if (!isDeepStrictEqual(claude.mcpServers, claudeServers)) err(".claude-plugin/plugin.json: mcpServers differs from mcp.json");

  // Marketplaces.
  const cm = read(".claude-plugin/marketplace.json");
  const xm = read(".agents/plugins/marketplace.json");
  const entry = cm.plugins?.find((p) => p.name === name);
  if (cm.plugins?.length !== 1 || entry?.source !== `./${PLUGIN}`) err(`.claude-plugin/marketplace.json: must list ${name} once, at ./${PLUGIN}`);
  if (xm.plugins?.length !== 1 || xm.plugins[0].name !== name || xm.plugins[0].source?.path !== `./${PLUGIN}`) err(`.agents/plugins/marketplace.json: must list ${name} once, at ./${PLUGIN}`);
  if (cm.name !== xm.name) err("marketplace names differ between Claude and Codex");
  for (const k of ["description", "keywords"]) if (entry && !isDeepStrictEqual(entry[k], portable[k])) err(`.claude-plugin/marketplace.json: ${k} differs from plugin.json`);

  // Pi package.
  if (!pkg.keywords?.includes("pi-package")) err("package.json: missing the pi-package keyword");
  for (const p of [...(pkg.pi?.skills ?? []), ...(pkg.pi?.extensions ?? [])]) if (!fs.existsSync(path.join(root, p))) err(`package.json: pi path ${p} is missing`);
  if (pkg.dependencies) err("package.json: the Pi package must not install dependencies");

  // Skills.
  const dir = path.join(root, PLUGIN, "skills");
  const skills = [];
  for (const d of listSkillDirs(dir)) {
    try {
      skills.push(validateSkillDir(d).name);
    } catch (e) {
      err(e.message);
    }
    checkLinks(root, d, err);
  }
  if (entry && !isDeepStrictEqual([...(entry.skills ?? [])].sort(), skills.map((s) => `./skills/${s}`).sort())) err(`.claude-plugin/marketplace.json: skills must list ${skills.map((s) => `./skills/${s}`).join(", ")}`);

  // Router: every skill is reachable, and every source it names is described in sources.md.
  const routerMd = read0(path.join(dir, ROUTER, "SKILL.md"));
  const sourcesMd = read0(path.join(dir, ROUTER, "references/sources.md"));
  for (const s of skills) if (s !== ROUTER && !routerMd.includes(`\`${s}\``)) err(`${ROUTER}/SKILL.md: skill ${s} is not in the router table`);
  const ids = new Set([...sourcesMd.matchAll(/^## .+ \(`([a-z0-9-]+)`\)$/gm)].map((x) => x[1]));
  for (const row of routerMd.split("\n").filter((l) => /^\| [A-Z]/.test(l) && !l.startsWith("| Question"))) {
    for (const [, id] of row.split("|")[2].matchAll(/`([^`]+)`/g)) if (!ids.has(id)) err(`${ROUTER}/SKILL.md: source ${id} has no section in references/sources.md`);
    for (const [, s] of (row.split("|")[3] ?? "").matchAll(/`([^`]+)`/g)) if (!skills.includes(s)) err(`${ROUTER}/SKILL.md: skill ${s} does not exist`);
  }

  // Upstream copies.
  const lock = read("imports.lock.json");
  for (const e of lock.imports ?? []) {
    const up = path.join(dir, e.skill, "UPSTREAM.json");
    if (!fs.existsSync(up)) err(`${e.skill}: UPSTREAM.json missing (run npm run sync)`);
    else if (JSON.parse(fs.readFileSync(up, "utf8")).commit !== e.source.commit) err(`${e.skill}: UPSTREAM.json is not at the pinned commit (run npm run sync)`);
  }
  return problems;
}

const read0 = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");

/** Relative Markdown links in a skill must resolve to files inside that skill. */
function checkLinks(root, d, err) {
  for (const f of listFiles(d).filter((x) => x.endsWith(".md"))) {
    for (const [, target] of fs.readFileSync(path.join(d, f), "utf8").matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^([a-z]+:|#)/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(path.join(d, f)), decodeURI(target.split("#")[0]));
      if (target.startsWith("/") || !resolved.startsWith(d + path.sep) || !fs.existsSync(resolved)) err(`${path.relative(root, path.join(d, f))}: broken or escaping link ${target}`);
    }
  }
}

/** Copy package.json's version into both plugin manifests. */
export function setVersion(root = ROOT) {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const f of MANIFESTS) {
    const file = path.join(root, PLUGIN, f);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    j.version = version;
    fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  }
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args.includes("--root") ? path.resolve(args[args.indexOf("--root") + 1]) : ROOT;
  if (args.includes("--set-version")) console.log(`plugin manifests set to ${setVersion(root)}`);
  const problems = check(root);
  if (problems.length) {
    console.error(problems.map((p) => `- ${p}`).join("\n"));
    process.exit(1);
  }
  console.log("plugin, manifests and marketplaces agree");
}
