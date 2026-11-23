#!/usr/bin/env node
// Build the stable marketplace tree and the plugin ZIP from toolkit.json,
// skills/ and imports.lock.json.
//
// Usage: node scripts/build.mjs [--out dist] [--no-imports] [--root DIR]
//
//   dist/stable/                       exact content of the `stable` branch
//     .claude-plugin/marketplace.json  Claude Code, VS Code
//     .agents/plugins/marketplace.json Codex, ChatGPT
//     package.json, extensions/        Pi (`pi install git:...@stable`)
//     plugins/<name>/                  the plugin every client installs
//   dist/packages/<name>-<version>.zip the plugin folder, for clients that upload a ZIP
//   dist/packages/SHA256SUMS
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadManifest } from "./lib/manifest.mjs";
import { loadLock, materializeImport, sha256 } from "./lib/imports.mjs";
import { listSkillDirs, validateSkillDir } from "./lib/skills.mjs";
import { listFiles, zipDirectory } from "./lib/zip.mjs";
import * as A from "./lib/adapters.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = "filecoin-project/filpgf-agent-kit";

export function parseArgs(argv) {
  const opts = { root: ROOT, out: "dist", imports: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-imports") opts.imports = false;
    else if (a === "--out" || a === "--root") opts[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

export function build({ root = ROOT, out: outArg = "dist", imports = true } = {}) {
  const r = (p) => path.resolve(root, p);
  const out = r(outArg);
  if (!out.startsWith(path.resolve(root) + path.sep)) throw new Error(`--out must be a subdirectory of ${root}`);
  // Only replace an empty directory or a previous build, so a typo such as `--out skills` cannot wipe sources.
  if (fs.existsSync(out) && fs.readdirSync(out).length && !fs.existsSync(path.join(out, "stable"))) throw new Error(`--out ${outArg} exists and is not a previous build output`);
  const m = loadManifest(r("toolkit.json"));
  const warnings = [];
  fs.rmSync(out, { recursive: true, force: true });

  const stable = path.join(out, "stable");
  const plugin = path.join(stable, "plugins", m.name);
  const skillsDir = path.join(plugin, "skills");
  fs.mkdirSync(skillsDir, { recursive: true });

  // 1. Native skills, with the source map generated from toolkit.json.
  const native = [];
  for (const dir of listSkillDirs(r("skills"))) {
    const { name } = validateSkillDir(dir);
    listFiles(dir); // throws on symlinks and other non-regular files
    A.copyDir(dir, path.join(skillsDir, name));
    native.push(name);
  }
  const sourcesRef = path.join(skillsDir, "filpgf-ecosystem", "references", "sources.md");
  if (fs.existsSync(sourcesRef)) A.write(sourcesRef, renderSources(m));

  // 2. Pinned upstream skills.
  const provenance = [];
  if (imports) {
    for (const entry of loadLock(r("imports.lock.json")).imports) {
      if (native.includes(entry.skill)) throw new Error(`import ${entry.skill} collides with a native skill`);
      provenance.push(materializeImport(entry, skillsDir, r(".cache/imports")));
    }
  } else warnings.push("upstream imports skipped (--no-imports)");
  const skills = listSkillDirs(skillsDir).map((d) => validateSkillDir(d).name);
  for (const s of m.sources ?? []) for (const k of s.skills ?? []) if (!skills.includes(k)) warnings.push(`source ${s.id} names skill ${k}, which is not in this build`);

  // 3. Plugin folder, shared by every client.
  const license = fs.existsSync(r("LICENSE")) ? fs.readFileSync(r("LICENSE")) : null;
  A.write(path.join(plugin, ".claude-plugin", "plugin.json"), A.claudePlugin(m));
  A.write(path.join(plugin, ".codex-plugin", "plugin.json"), A.codexPlugin(m));
  A.write(path.join(plugin, ".mcp.json"), A.mcpJson(m));
  A.write(path.join(plugin, "README.md"), renderPluginReadme(m, skills));
  A.write(path.join(plugin, "THIRD_PARTY_NOTICES.md"), renderNotices(m, provenance));
  if (license) A.write(path.join(plugin, "LICENSE"), license);

  // 4. Marketplace root: indexes for Claude Code and Codex, the Pi package, and a README.
  A.write(path.join(stable, ".claude-plugin", "marketplace.json"), A.claudeMarketplace(m));
  A.write(path.join(stable, ".agents", "plugins", "marketplace.json"), A.codexMarketplace(m));
  A.write(path.join(stable, "package.json"), A.piPackageJson(m));
  fs.mkdirSync(path.join(stable, "extensions"));
  fs.copyFileSync(path.join(ROOT, "adapters", "pi", "extension.ts"), path.join(stable, "extensions", "filpgf-mcp.ts"));
  A.write(path.join(stable, "README.md"), renderStableReadme(m));
  if (license) A.write(path.join(stable, "LICENSE"), license);

  // 5. ZIP of the plugin folder and checksums.
  const pkg = path.join(out, "packages");
  const zip = `${m.name}-${m.version}.zip`;
  zipDirectory(plugin, path.join(pkg, zip), m.name);
  A.write(path.join(pkg, "SHA256SUMS"), `${sha256(fs.readFileSync(path.join(pkg, zip)))}  ${zip}\n`);

  return { name: m.name, version: m.version, skills: { native, imported: provenance.map((p) => p.skill), all: skills }, zip, warnings };
}

// ---- Generated documents ---------------------------------------------------

const ROUTE_LABELS = {
  public: "public, no account needed",
  credential: "needs the user's own sign-in; hand off to the user",
  local: "needs a local shell or runtime; hand off when unavailable",
};

export function renderSources(m) {
  const lines = [
    "# FilPGF source directory",
    "",
    `Generated from \`toolkit.json\` (${m.name} ${m.version}). Edit that file, not this one.`,
    "",
    `Start from ${m.llmsTxt ?? "https://www.filpgf.io/llms.txt"} for the current list of program pages, app links and data.`,
    "",
  ];
  for (const s of m.sources ?? []) {
    lines.push(`## ${s.name} (\`${s.id}\`)`, "");
    lines.push(`- Covers: ${s.covers}`);
    if (s.url) lines.push(`- Where: ${s.url}`);
    if (s.docs) lines.push(`- Docs: ${s.docs}`);
    lines.push(`- Access: ${s.access}`);
    lines.push(`- Auth: ${s.auth}`);
    lines.push(`- Authority: ${s.authority}`);
    if (s.route) lines.push(`- Route: ${ROUTE_LABELS[s.route]}`);
    if (s.upstream) lines.push(`- Upstream guide: ${s.upstream}`);
    if (s.handoff) lines.push(`- Handoff: ${s.handoff}`);
    if (s.skills?.length) lines.push(`- Skills (when installed): ${s.skills.map((k) => `\`${k}\``).join(", ")}`);
    lines.push(`- Maintainer: ${s.maintainer}`);
    lines.push(`- Report problems: ${s.report}`, "");
  }
  return lines.join("\n");
}

function renderNotices(m, provenance) {
  const lines = ["# Third-party notices", "", `${m.name} includes the following upstream skills, imported at build time from pinned commits and verified against SHA-256 hashes in \`imports.lock.json\`.`, ""];
  if (!provenance.length) lines.push("This build contains no third-party skills.", "");
  for (const p of provenance) {
    lines.push(`## ${p.skill}`, "", `- Source: ${p.sourceUrl}`, `- Commit: \`${p.commit}\``, `- License: ${p.license} (full text in \`skills/${p.skill}/${p.licenseFile}\`)`);
    if (p.licenseEvidence) lines.push(`- License evidence: ${p.licenseEvidence}`);
    for (const t of p.transforms) lines.push(`- Modified at build time: ${t.type} in \`${t.file}\` (origin ${t.origin})`);
    lines.push("");
  }
  return lines.join("\n");
}

const signIn = (m) => [
  "The MCP servers carry no credentials. Sign in once with OAuth from your client:",
  "",
  `- Claude Code: run \`/mcp\`, select \`plugin:${m.name}:<server>\`, then **Authenticate**.`,
  "- Codex: `codex mcp login <server>`.",
  "- Pi: `/mcp login <server>`.",
];

function renderPluginReadme(m, skills) {
  return [
    `# ${m.interface?.displayName ?? m.name} ${m.version}`,
    "",
    m.description,
    "",
    `Generated from https://github.com/${REPO}. Edit \`toolkit.json\` and \`skills/\` there.`,
    "",
    "## Skills",
    "",
    ...skills.map((s) => `- \`${s}\``),
    "",
    "## MCP servers",
    "",
    ...Object.entries(m.mcpServers ?? {}).map(([n, s]) => `- \`${n}\`: ${s.url}${s.docs ? ` (${s.docs})` : ""}`),
    "",
    ...signIn(m),
    "",
    "Third-party skills and their licenses are listed in `THIRD_PARTY_NOTICES.md`.",
    "",
  ].join("\n");
}

function renderStableReadme(m) {
  const id = `${m.name}@${A.marketplaceName(m)}`;
  return [
    `# ${m.interface?.displayName ?? m.name} marketplace`,
    "",
    `Generated by the release workflow of https://github.com/${REPO} (${m.version}). Send changes to the default branch.`,
    "",
    "```sh",
    `claude plugin marketplace add ${REPO}#stable`,
    `claude plugin install ${id}`,
    "",
    `codex plugin marketplace add ${REPO} --ref stable`,
    `codex plugin add ${id}`,
    "",
    `pi install git:github.com/${REPO}@stable`,
    "```",
    "",
    ...signIn(m),
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const info = build(parseArgs(process.argv.slice(2)));
    console.log(`built ${info.name} ${info.version}: ${info.skills.all.length} skills (${info.skills.imported.length} imported), packages/${info.zip}`);
    for (const w of info.warnings) console.log(`warning: ${w}`);
  } catch (err) {
    console.error(`build failed: ${err.message}`);
    process.exit(1);
  }
}
