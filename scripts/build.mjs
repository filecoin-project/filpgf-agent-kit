#!/usr/bin/env node
// Build portable and host-specific plugin outputs from toolkit.json, skills/
// and imports.lock.json.
//
// Usage: node scripts/build.mjs [--out dist] [--no-imports] [--no-packages] [--enable-mcp NAME]...
//                               [--manifest toolkit.json] [--lock imports.lock.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { loadManifest } from "./lib/manifest.mjs";
import { loadLock, materializeImport, sha256 } from "./lib/imports.mjs";
import { listSkillDirs, validateSkillDir } from "./lib/skills.mjs";
import { listFiles, zipDirectory } from "./lib/zip.mjs";
import * as A from "./lib/adapters.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv) {
  const opts = { root: ROOT, out: "dist", imports: true, packages: true, manifest: "toolkit.json", lock: "imports.lock.json", skills: "skills", cache: ".cache/imports", enableMcp: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-imports") opts.imports = false;
    else if (a === "--no-packages") opts.packages = false;
    else if (a === "--enable-mcp") opts.enableMcp.push(argv[++i]);
    else if (["--out", "--manifest", "--lock", "--skills", "--cache", "--root"].includes(a)) opts[a.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

export function build(opts) {
  const r = (p) => path.resolve(opts.root, p);
  const out = r(opts.out);
  if (out === path.resolve(opts.root) || !out.startsWith(path.resolve(opts.root) + path.sep)) throw new Error(`--out must be a subdirectory of ${opts.root}`);
  const fullManifest = loadManifest(r(opts.manifest));
  const warnings = [];
  // Opt-in MCP servers (credentials, write-capable tools) are left out unless enabled explicitly.
  const enable = opts.enableMcp ?? [];
  for (const n of enable) if (!fullManifest.mcpServers?.[n]) throw new Error(`--enable-mcp ${n}: no such server in the manifest`);
  const mcpServers = Object.fromEntries(Object.entries(fullManifest.mcpServers ?? {}).filter(([n, s]) => !s.optIn || enable.includes(n)));
  for (const n of Object.keys(fullManifest.mcpServers ?? {})) if (!mcpServers[n]) warnings.push(`opt-in MCP server ${n} not included (use --enable-mcp ${n})`);
  const manifest = { ...fullManifest, mcpServers };

  // Only ever delete an empty directory or a previous build output, so a typo such as `--out skills` cannot wipe sources.
  if (fs.existsSync(out) && fs.readdirSync(out).length && !fs.existsSync(path.join(out, "build-info.json")) && !fs.existsSync(path.join(out, ".stage"))) {
    throw new Error(`--out ${opts.out} exists and is not a previous build output; remove it yourself or choose another directory`);
  }
  fs.rmSync(out, { recursive: true, force: true });
  const stage = path.join(out, ".stage");
  const stageSkills = path.join(stage, "skills");
  fs.mkdirSync(stageSkills, { recursive: true });

  // 1. Native skills.
  const native = [];
  for (const dir of listSkillDirs(r(opts.skills))) {
    const { name } = validateSkillDir(dir);
    listFiles(dir); // throws on symlinks and other non-regular files
    A.copyDir(dir, path.join(stageSkills, name));
    native.push(name);
  }
  const sourcesRef = path.join(stageSkills, "filpgf-ecosystem", "references", "sources.md");
  if (fs.existsSync(path.dirname(path.dirname(sourcesRef)))) A.write(sourcesRef, renderSources(manifest));

  // 2. Pinned upstream imports.
  const provenance = [];
  if (opts.imports) {
    const lock = loadLock(r(opts.lock));
    for (const entry of lock.imports) {
      if (native.includes(entry.skill)) throw new Error(`import ${entry.skill} collides with a native skill`);
      provenance.push(materializeImport(entry, stageSkills, r(opts.cache)));
    }
  } else {
    warnings.push("upstream imports skipped (--no-imports)");
  }

  // 3. Validate the final skill set and cross references.
  const skills = listSkillDirs(stageSkills).map((d) => validateSkillDir(d).name);
  for (const s of manifest.sources ?? []) for (const k of s.skills ?? []) if (!skills.includes(k)) warnings.push(`source ${s.id} names skill ${k}, which is not in this build`);
  for (const [name, s] of Object.entries(manifest.mcpServers ?? {})) {
    if (s.auth) warnings.push(`portable mcp.json cannot carry credentials: server ${name} needs ${s.auth.env} or client-managed auth`);
    if (s.allowedTools) warnings.push(`tool-name allowlist for ${name} is configured only in the Codex (enabled_tools) and Pi (toolExposure) outputs; portable and Claude outputs expose every server tool. Allowlisted names are not proof of read-only access: use a least-privilege credential`);
  }

  const license = fs.existsSync(r("LICENSE")) ? fs.readFileSync(r("LICENSE")) : null;
  const notices = renderNotices(manifest, provenance);
  const common = (dir, host) => {
    A.copyDir(stageSkills, path.join(dir, "skills"));
    A.write(path.join(dir, "README.md"), renderReadme(manifest, host, skills));
    A.write(path.join(dir, "THIRD_PARTY_NOTICES.md"), notices);
    if (license) A.write(path.join(dir, "LICENSE"), license);
  };
  const hasMcp = Object.keys(manifest.mcpServers ?? {}).length > 0;

  // 4a. Portable Agent Plugins 1.0.0.
  const portable = path.join(out, "agent-plugin", manifest.name);
  common(portable, "portable");
  A.write(path.join(portable, "plugin.json"), A.portablePlugin(manifest));
  if (hasMcp) A.write(path.join(portable, "mcp.json"), A.portableMcp(manifest));

  // 4b. Claude Code plugin inside a local marketplace root.
  const claudeRoot = path.join(out, "claude");
  const claude = path.join(claudeRoot, "plugins", manifest.name);
  common(claude, "claude");
  A.write(path.join(claude, ".claude-plugin", "plugin.json"), A.claudePlugin(manifest));
  if (hasMcp) A.write(path.join(claude, ".mcp.json"), A.claudeMcp(manifest));
  A.write(path.join(claudeRoot, ".claude-plugin", "marketplace.json"), A.claudeMarketplace(manifest));

  // 4c. Codex compatibility plugin inside a local marketplace root.
  const codexRoot = path.join(out, "codex");
  const codex = path.join(codexRoot, "plugins", manifest.name);
  common(codex, "codex");
  A.write(path.join(codex, ".codex-plugin", "plugin.json"), A.codexPlugin(manifest));
  if (hasMcp) A.write(path.join(codex, ".mcp.json"), A.codexMcp(manifest));
  A.write(path.join(codexRoot, ".agents", "plugins", "marketplace.json"), A.codexMarketplace(manifest));

  // 4d. Pi package.
  const pi = path.join(out, "pi", manifest.name);
  common(pi, "pi");
  A.write(path.join(pi, "package.json"), A.piPackageJson(manifest));
  if (hasMcp) {
    const template = fs.readFileSync(path.join(ROOT, "adapters", "pi", "extension.ts"), "utf8");
    A.write(path.join(pi, "extensions", "filpgf-mcp.ts"), A.piExtensionSource(template, manifest));
  }

  fs.rmSync(stage, { recursive: true, force: true });

  // 5. Packaged artifacts and checksums.
  const artifacts = {};
  if (opts.packages) {
    const pkg = path.join(out, "packages");
    const v = manifest.version;
    const zips = {
      [`${manifest.name}-${v}-agent-plugin.zip`]: [portable, manifest.name],
      [`${manifest.name}-${v}-claude-plugin.zip`]: [claude, manifest.name],
      [`${manifest.name}-${v}-claude-marketplace.zip`]: [claudeRoot, `${manifest.name}-claude-marketplace`],
      [`${manifest.name}-${v}-codex-marketplace.zip`]: [codexRoot, `${manifest.name}-codex-marketplace`],
      [`${manifest.name}-${v}-pi-package.zip`]: [pi, manifest.name],
    };
    for (const [file, [dir, prefix]] of Object.entries(zips)) zipDirectory(dir, path.join(pkg, file), prefix);
    try {
      const res = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", pkg], {
        cwd: pi,
        env: { ...process.env, npm_config_cache: path.join(r(opts.cache), "..", "npm"), npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [{ filename }] = JSON.parse(res.toString());
      fs.renameSync(path.join(pkg, path.basename(filename)), path.join(pkg, `${manifest.name}-${v}-pi-package.tgz`));
    } catch (err) {
      warnings.push(`npm pack for the Pi package failed: ${err.message.split("\n")[0]}`);
    }
    for (const f of fs.readdirSync(pkg).sort()) artifacts[f] = sha256(fs.readFileSync(path.join(pkg, f)));
    A.write(path.join(pkg, "SHA256SUMS"), Object.entries(artifacts).map(([f, h]) => `${h}  ${f}`).join("\n") + "\n");
  }

  const info = {
    name: manifest.name,
    version: manifest.version,
    mcpServers: Object.keys(mcpServers),
    skills: { native, imported: provenance.map((p) => p.skill), all: skills },
    imports: provenance.map(({ files, ...rest }) => rest),
    outputs: {
      "agent-plugin": path.relative(out, portable),
      claude: path.relative(out, claudeRoot),
      codex: path.relative(out, codexRoot),
      pi: path.relative(out, pi),
    },
    artifacts,
    warnings,
  };
  A.write(path.join(out, "build-info.json"), info);
  return info;
}

// ---- Generated documents ---------------------------------------------------

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
    if (s.skills?.length) lines.push(`- Skills: ${s.skills.map((k) => `\`${k}\``).join(", ")}`);
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

function renderReadme(m, host, skills) {
  const servers = Object.entries(m.mcpServers ?? {});
  // Whether this host's output restricts tools by name (see scripts/lib/adapters.mjs).
  const filtersTools = host === "codex" || host === "pi";
  const serverLines = servers.map(([n, s]) => {
    let line = `- \`${n}\`: ${s.url}`;
    if (s.auth) line += host === "portable" ? ". Authenticate through the client's own MCP auth flow" : `. Set \`${s.auth.env}\` in the environment that starts the agent`;
    if (s.docs) line += ` (${s.docs})`;
    if (s.allowedTools) {
      line += filtersTools
        ? `. This output configures a tool-name allowlist (${s.allowedTools.length} tools); it is not proof of read-only access, so use a least-privilege credential.`
        : ". This output does not filter tools: every tool the server offers is reachable, so use a least-privilege credential.";
    }
    return line;
  });
  const install = {
    portable: [
      `Agent Plugins 1.0.0 layout: \`plugin.json\`, ${servers.length ? "`mcp.json`, " : ""}\`skills/\`.`,
      "Load it with a client that supports Agent Plugins 1.0.0." + (servers.length ? " `mcp.json` carries no credentials." : ""),
    ],
    claude: ["Try for one session: `claude --plugin-dir <path-to-this-directory>`.", "Install from the marketplace root one level up: `claude plugin marketplace add <marketplace-root>` then `claude plugin install " + m.name + "@" + m.name + "-marketplace`."],
    codex: ["From the marketplace root two levels up: `codex plugin marketplace add <marketplace-root>` then `codex plugin add " + m.name + "@" + m.name + "-marketplace`."],
    pi: [
      "Try for one session: `pi -e <path-to-this-directory>`.",
      "Install: `pi install <path-to-this-directory>` (add `-l` for project settings).",
      ...(servers.length ? ["The extension registers MCP servers only when their credential variable is set. Servers with the same name in your own `mcp.json` take precedence, including their exposure settings."] : []),
    ],
  }[host];
  return [
    `# ${m.name} ${m.version}`,
    "",
    m.description,
    "",
    "Generated build output. The editable source lives in the toolkit repository (`toolkit.json`, `skills/`, `imports.lock.json`).",
    "",
    "## Install",
    "",
    ...install.map((l) => `- ${l}`),
    "",
    "## Skills",
    "",
    ...skills.map((s) => `- \`${s}\``),
    "",
    "## MCP servers",
    "",
    ...(serverLines.length ? serverLines : ["None."]),
    "",
    "Third-party skills and their licenses are listed in `THIRD_PARTY_NOTICES.md`.",
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const info = build(parseArgs(process.argv.slice(2)));
    console.log(`built ${info.name} ${info.version}: ${info.skills.all.length} skills (${info.skills.imported.length} imported)`);
    for (const w of info.warnings) console.log(`warning: ${w}`);
  } catch (err) {
    console.error(`build failed: ${err.message}`);
    process.exit(1);
  }
}
