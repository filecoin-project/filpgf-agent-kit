#!/usr/bin/env node
// Assemble, check and gate the generated `stable` marketplace branch.
//
// The stable branch carries one payload: the router-only build
// (`npm run build:router`) copied verbatim to plugins/<name>/, plus the two
// marketplace indexes that point at it. Both are generated from the router's
// own plugin.json, so there is exactly one skill tree and no hand-edited copy:
//
//   .claude-plugin/marketplace.json   Claude Code, VS Code (Claude-format marketplaces)
//   .agents/plugins/marketplace.json  Codex CLI, ChatGPT workspace GitHub import
//   plugins/<name>/                   Agent Plugins 1.0 package (plugin.json, skills/, LICENSE)
//   README.md, STABLE.json            generated notes and a per-file SHA-256 manifest
//
// The seven-skill builds stay release assets (dist/packages); they are not on
// the branch.
//
// Usage:
//   node scripts/stable-branch.mjs assemble [--router .cache/dist-router] [--out .cache/stable] [--tag vX.Y.Z] [--commit SHA] [--repo owner/repo] [--zip FILE]
//   node scripts/stable-branch.mjs check [--router .cache/dist-router] [--out .cache/stable] [--tag vX.Y.Z]
//   node scripts/stable-branch.mjs verify-tag vX.Y.Z           # toolkit.json and package.json must match the tag
//   node scripts/stable-branch.mjs decide vX.Y.Z [CURRENT]     # prints publish=true|false (CURRENT: version on stable, "" if none)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./lib/imports.mjs";
import { listFiles, zipDirectory } from "./lib/zip.mjs";
import { validateSkillDir, listSkillDirs } from "./lib/skills.mjs";
import * as A from "./lib/adapters.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STABLE_BRANCH = "stable";
const STABLE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const json = (v) => JSON.stringify(v, null, 2) + "\n";

/** Plugin metadata for the marketplace indexes, taken from the router build's portable plugin.json. */
function pluginMeta(pj) {
  const { $schema, extensions, ...meta } = pj;
  return { ...meta, interface: extensions?.["com.openai"]?.interface };
}

/** Every generated file of the stable tree except plugins/<name>/ (copied verbatim) and STABLE.json. */
export function renderIndexes(pj, { repo = "filecoin-project/filpgf-agent-kit" } = {}) {
  const m = pluginMeta(pj);
  const id = `${m.name}@${m.name}-marketplace`;
  const readme = [
    "# FilPGF Agent Kit marketplace",
    "",
    "The release workflow updates this branch. See `STABLE.json` for the source tag and commit. Send changes to the default branch.",
    "",
    `This branch holds the router plugin only (skill \`${m.name}\` and its source map; no MCP servers, imports or credentials). The full seven-skill packages are release assets.`,
    "",
    "## Install",
    "",
    "```sh",
    `claude plugin marketplace add ${repo}#${STABLE_BRANCH}`,
    `claude plugin install ${id}`,
    "",
    `codex plugin marketplace add ${repo} --ref ${STABLE_BRANCH}`,
    `codex plugin add ${id}`,
    "```",
    "",
    `ChatGPT workspace admins: Admin > Plugins > Add > Import marketplace, Source \`https://github.com/${repo}\`, Path empty, Branch \`${STABLE_BRANCH}\`.`,
    "",
    `VS Code: add \`"${repo}#${STABLE_BRANCH}"\` to \`chat.plugins.marketplaces\`.`,
    "",
    "Every file is listed with its SHA-256 in `STABLE.json`.",
    "",
  ].join("\n");
  return {
    ".claude-plugin/marketplace.json": json(A.claudeMarketplace(m)),
    ".agents/plugins/marketplace.json": json(A.codexMarketplace(m)),
    "README.md": readme,
  };
}

function readRouter(routerDist) {
  const info = JSON.parse(fs.readFileSync(path.join(routerDist, "build-info.json"), "utf8"));
  if (!info.router || !info.outputs?.router) throw new Error(`${routerDist} is not a --router-only build (run npm run build:router)`);
  const dir = path.join(routerDist, info.outputs.router);
  const pj = JSON.parse(fs.readFileSync(path.join(dir, "plugin.json"), "utf8"));
  if (pj.name !== info.name || pj.version !== info.version) throw new Error("router plugin.json disagrees with build-info.json");
  return { info, dir, pj };
}

export function tagVersion(tag) {
  const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag ?? "");
  if (!m) throw new Error(`tag ${tag} is not v<semver>`);
  return m[1];
}

export function assemble({ router = ".cache/dist-router", out = ".cache/stable", tag, commit, repo, zip, root = ROOT } = {}) {
  const outDir = path.resolve(root, out);
  if (!outDir.startsWith(path.resolve(root) + path.sep)) throw new Error("--out must be inside the repository");
  if (fs.existsSync(outDir) && fs.readdirSync(outDir).length && !fs.existsSync(path.join(outDir, "STABLE.json"))) throw new Error(`--out ${out} exists and is not a stable tree`);
  if (zip && path.resolve(root, zip).startsWith(outDir + path.sep)) throw new Error("--zip must be outside --out");
  const { dir, pj, info } = readRouter(path.resolve(root, router));
  if (tag && tagVersion(tag) !== pj.version) throw new Error(`tag ${tag} does not match router version ${pj.version}`);
  fs.rmSync(outDir, { recursive: true, force: true });
  A.copyDir(dir, path.join(outDir, "plugins", pj.name));
  for (const [f, c] of Object.entries(renderIndexes(pj, { repo }))) A.write(path.join(outDir, f), c);
  const files = Object.fromEntries(listFiles(outDir).map((f) => [f, sha256(fs.readFileSync(path.join(outDir, f)))]));
  const stable = { name: pj.name, version: pj.version, tag: tag ?? `v${pj.version}`, ...(commit ? { sourceCommit: commit } : {}), variant: "router", skills: info.skills.all, files };
  A.write(path.join(outDir, "STABLE.json"), stable);
  // Release asset with the exact branch content (dotfiles included) under a <name>-stable/ prefix.
  if (zip) zipDirectory(outDir, path.resolve(root, zip), `${pj.name}-stable`);
  return stable;
}

/** Validate a stable tree on its own; with `router`, also require it to be byte-identical to that router build. */
export function check({ out = ".cache/stable", router, tag, root = ROOT } = {}) {
  const dir = path.resolve(root, out);
  const errors = [];
  const err = (m) => errors.push(m);
  let stable;
  try {
    stable = JSON.parse(fs.readFileSync(path.join(dir, "STABLE.json"), "utf8"));
  } catch (e) {
    return [`STABLE.json: ${e.message}`];
  }
  let files;
  try {
    files = listFiles(dir); // throws on symlinks and other non-regular files
  } catch (e) {
    return [e.message];
  }
  const name = stable.name;
  const plugin = `plugins/${name}`;
  // Exact file set: STABLE.json, the generated indexes and the plugin tree. Nothing executable or host-specific.
  const listed = Object.keys(stable.files ?? {}).sort();
  if (JSON.stringify(listed) !== JSON.stringify(files.filter((f) => f !== "STABLE.json"))) err("STABLE.json file list differs from the tree");
  for (const [f, h] of Object.entries(stable.files ?? {})) if (fs.existsSync(path.join(dir, f)) && sha256(fs.readFileSync(path.join(dir, f))) !== h) err(`${f}: checksum mismatch`);
  const allowed = new RegExp(`^(STABLE\\.json|README\\.md|\\.claude-plugin/marketplace\\.json|\\.agents/plugins/marketplace\\.json|${plugin}/(plugin\\.json|LICENSE|skills/${name}/(SKILL\\.md|references/[a-z0-9-]+\\.md)))$`);
  for (const f of files) if (!allowed.test(f)) err(`unexpected file ${f}`);
  let pj;
  try {
    pj = JSON.parse(fs.readFileSync(path.join(dir, plugin, "plugin.json"), "utf8"));
  } catch (e) {
    return [...errors, `${plugin}/plugin.json: ${e.message}`];
  }
  if (pj.$schema !== A.PORTABLE_PLUGIN_SCHEMA) err("plugin.json: not an Agent Plugins 1.0.0 manifest");
  if (pj.name !== name || pj.version !== stable.version) err("plugin.json name/version disagree with STABLE.json");
  if (stable.tag !== `v${stable.version}`) err(`STABLE.json tag ${stable.tag} does not match version ${stable.version}`);
  if (tag && tag !== stable.tag) err(`stable tree is for ${stable.tag}, expected ${tag}`);
  if (stable.variant !== "router") err("stable branch carries the router variant only");
  // Indexes must be exactly what the generator writes for this plugin.json.
  const idx = renderIndexes(pj, { repo: stableRepoFromReadme(dir) });
  for (const [f, c] of Object.entries(idx)) if (!fs.existsSync(path.join(dir, f)) || fs.readFileSync(path.join(dir, f), "utf8") !== c) err(`${f}: not generated from ${plugin}/plugin.json`);
  const cm = JSON.parse(idx[".claude-plugin/marketplace.json"]);
  const xm = JSON.parse(idx[".agents/plugins/marketplace.json"]);
  if (cm.plugins.length !== 1 || cm.plugins[0].source !== `./${plugin}` || cm.plugins[0].version !== stable.version) err("claude marketplace must list exactly this plugin and version");
  if (xm.plugins.length !== 1 || xm.plugins[0].source.path !== `./${plugin}`) err("codex marketplace must list exactly this plugin");
  const skills = [];
  for (const d of listSkillDirs(path.join(dir, plugin, "skills"))) {
    try {
      const v = validateSkillDir(d);
      if (v.frontmatter.compatibility) err(`${v.name}: router skill must not declare runtime requirements`);
      skills.push(v.name);
    } catch (e) {
      err(e.message);
    }
  }
  if (JSON.stringify(skills) !== JSON.stringify([name]) || JSON.stringify(stable.skills) !== JSON.stringify([name])) err(`stable must carry only the router skill ${name}, found ${skills}`);
  if (router) {
    const r = readRouter(path.resolve(root, router));
    const a = listFiles(r.dir);
    const b = files.filter((f) => f.startsWith(plugin + "/")).map((f) => f.slice(plugin.length + 1));
    if (JSON.stringify(a) !== JSON.stringify(b) || a.some((f) => sha256(fs.readFileSync(path.join(r.dir, f))) !== sha256(fs.readFileSync(path.join(dir, plugin, f))))) err(`${plugin} is not a verbatim copy of the router build`);
  }
  return errors;
}

function stableRepoFromReadme(dir) {
  const m = /claude plugin marketplace add (\S+)#/.exec(fs.existsSync(path.join(dir, "README.md")) ? fs.readFileSync(path.join(dir, "README.md"), "utf8") : "");
  return m?.[1];
}

/** Source versions must equal the tag. */
export function verifyTag(tag, root = ROOT) {
  const v = tagVersion(tag);
  const errors = [];
  for (const f of ["toolkit.json", "package.json"]) {
    const got = JSON.parse(fs.readFileSync(path.join(root, f), "utf8")).version;
    if (got !== v) errors.push(`${f} version ${got} does not match tag ${tag}`);
  }
  return errors;
}

const parse = (v) => STABLE_VERSION_RE.exec(v)?.slice(1).map(Number);

/** Whether `tag` may replace the stable branch currently at version `current` ("" or undefined: no branch yet). Prereleases never do. */
export function shouldPublish(tag, current) {
  const next = parse(tagVersion(tag));
  if (!next) return { publish: false, reason: `${tag} is a prerelease; stable is not updated` };
  if (!current) return { publish: true, reason: "stable branch does not exist yet" };
  const cur = parse(current);
  if (!cur) throw new Error(`stable branch has unrecognised version ${current}`);
  for (let i = 0; i < 3; i++) {
    if (next[i] > cur[i]) return { publish: true, reason: `${tag} is newer than stable ${current}` };
    if (next[i] < cur[i]) break;
  }
  return { publish: false, reason: `${tag} is not newer than stable ${current}; stable is left unchanged` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (["--router", "--out", "--tag", "--commit", "--repo", "--zip", "--root"].includes(rest[i])) opts[rest[i].slice(2)] = rest[++i];
    else pos.push(rest[i]);
  }
  const fail = (errors) => {
    for (const e of errors) console.error(`error: ${e}`);
    process.exit(1);
  };
  try {
    if (cmd === "assemble") {
      const s = assemble(opts);
      console.log(`stable tree ${s.name} ${s.version} (${s.tag}): ${Object.keys(s.files).length + 1} files in ${opts.out ?? ".cache/stable"}`);
    } else if (cmd === "check") {
      const errors = check(opts);
      if (errors.length) fail(errors);
      console.log(`stable tree valid: ${opts.out ?? ".cache/stable"}`);
    } else if (cmd === "verify-tag") {
      const errors = verifyTag(pos[0], opts.root);
      if (errors.length) fail(errors);
      console.log(`versions match ${pos[0]}`);
    } else if (cmd === "decide") {
      const d = shouldPublish(pos[0], pos[1]);
      console.error(d.reason);
      console.log(`publish=${d.publish}`);
    } else throw new Error(`usage: stable-branch.mjs assemble|check|verify-tag|decide`);
  } catch (e) {
    fail([e.message]);
  }
}
