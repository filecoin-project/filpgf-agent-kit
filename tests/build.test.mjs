import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build, parseArgs } from "../scripts/build.mjs";
import { validateDist } from "../scripts/validate-dist.mjs";
import { computeHashes } from "../scripts/lib/imports.mjs";
import { readZip } from "../scripts/lib/zip.mjs";
import { fixtureRepo, tmpdir, MIT, skillMd } from "./helpers.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;

/** A self-contained toolkit project: repository native skills + one fixture import. */
function fixtureProject({ withImport = true } = {}) {
  const root = tmpdir("filpgf-project-");
  fs.cpSync(path.join(repoRoot, "skills"), path.join(root, "skills"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "toolkit.json"), path.join(root, "toolkit.json"));
  fs.copyFileSync(path.join(repoRoot, "LICENSE"), path.join(root, "LICENSE"));
  const imports = [];
  if (withImport) {
    const up = fixtureRepo({ LICENSE: MIT, "skills/upstream-demo/SKILL.md": skillMd("upstream-demo", "license: MIT\n") });
    const e = { skill: "upstream-demo", source: { type: "git", url: up.url, commit: up.commit }, path: "skills/upstream-demo", license: { spdx: "MIT", file: "LICENSE" }, transforms: [{ type: "rewrite-root-relative-links", file: "SKILL.md", origin: "https://data.example.org" }] };
    e.files = computeHashes(e, path.join(root, ".cache/imports"));
    imports.push(e);
  }
  fs.writeFileSync(path.join(root, "imports.lock.json"), JSON.stringify({ lockfileVersion: 1, imports }));
  return root;
}

const opts = (root, extra = {}) => ({ ...parseArgs([]), root, ...extra });

test("builds all outputs from native skills and a pinned fixture import", () => {
  const root = fixtureProject();
  const info = build(opts(root));
  const dist = path.join(root, "dist");
  assert.deepEqual(info.skills.imported, ["upstream-demo"]);
  assert.ok(info.skills.native.includes("filpgf-ecosystem"));
  assert.deepEqual(validateDist(dist), []);

  const portable = path.join(dist, "agent-plugin", "filpgf-ecosystem");
  for (const f of ["plugin.json", "skills/filpgf-ecosystem/references/sources.md", "skills/filpgf-ecosystem/references/credentials.md", "skills/upstream-demo/UPSTREAM.json", "skills/upstream-demo/LICENSE", "THIRD_PARTY_NOTICES.md", "LICENSE"]) {
    assert.ok(fs.existsSync(path.join(portable, f)), f);
  }
  assert.ok(!fs.existsSync(path.join(portable, ".mcp.json")));
  assert.deepEqual(info.mcpServers, [], "opt-in MCP servers are excluded by default");
  for (const f of ["mcp.json", "../../claude/plugins/filpgf-ecosystem/.mcp.json", "../../codex/plugins/filpgf-ecosystem/.mcp.json", "../../pi/filpgf-ecosystem/extensions"]) assert.ok(!fs.existsSync(path.join(portable, f)), f);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dist, "pi/filpgf-ecosystem/package.json"), "utf8")).pi.extensions, undefined);
  assert.doesNotMatch(fs.readFileSync(path.join(portable, "README.md"), "utf8"), /mcp\.json/, "README does not mention files the build did not write");
  assert.doesNotMatch(fs.readFileSync(path.join(dist, "pi/filpgf-ecosystem/README.md"), "utf8"), /extension registers/);
  assert.match(fs.readFileSync(path.join(portable, "THIRD_PARTY_NOTICES.md"), "utf8"), /upstream-demo[\s\S]*License: MIT/);
  assert.match(fs.readFileSync(path.join(portable, "skills/filpgf-ecosystem/references/sources.md"), "utf8"), /Report problems: https:\/\/github.com\/davidgasquez\/filecoin-data-portal\/issues\/new/);

  assert.ok(fs.existsSync(path.join(dist, "claude/.claude-plugin/marketplace.json")));
  assert.ok(fs.existsSync(path.join(dist, "claude/plugins/filpgf-ecosystem/.claude-plugin/plugin.json")));
  assert.ok(fs.existsSync(path.join(dist, "codex/.agents/plugins/marketplace.json")));
  assert.ok(fs.existsSync(path.join(dist, "codex/plugins/filpgf-ecosystem/.codex-plugin/plugin.json")));

  const zip = readZip(path.join(dist, "packages", `filpgf-ecosystem-${info.version}-claude-plugin.zip`));
  assert.ok(zip.has("filpgf-ecosystem/.claude-plugin/plugin.json"));
  assert.ok(zip.has("filpgf-ecosystem/skills/upstream-demo/SKILL.md"));
});

test("--enable-mcp adds an opt-in server with host-specific auth and tool allowlists", () => {
  const root = fixtureProject({ withImport: false });
  const info = build(opts(root, { imports: false, packages: false, enableMcp: ["oso"] }));
  const dist = path.join(root, "dist");
  assert.deepEqual(info.mcpServers, ["oso"]);
  assert.deepEqual(validateDist(dist), []);
  const read = (p) => JSON.parse(fs.readFileSync(path.join(dist, p), "utf8"));
  assert.deepEqual(read("agent-plugin/filpgf-ecosystem/mcp.json").mcpServers.oso, { type: "streamable-http", url: "https://mcp.oso.xyz/mcp" });
  assert.equal(read("claude/plugins/filpgf-ecosystem/.mcp.json").mcpServers.oso.headers.Authorization, "Bearer ${OSO_TOKEN}");
  const codex = read("codex/plugins/filpgf-ecosystem/.mcp.json").mcpServers.oso;
  assert.equal(codex.bearer_token_env_var, "OSO_TOKEN");
  assert.ok(codex.enabled_tools.includes("SqlQuery"));
  assert.ok(!codex.enabled_tools.some((t) => /^(create|update|delete|publish|dispatch)/i.test(t)), "allowlist has no write tools");
  const ext = fs.readFileSync(path.join(dist, "pi/filpgf-ecosystem/extensions/filpgf-mcp.ts"), "utf8");
  assert.match(ext, /"exposure": "hidden"/);
  assert.match(ext, /"SqlQuery": "codemode"/);
  assert.ok(info.warnings.some((w) => /configured only in the Codex[\s\S]*not proof of read-only/.test(w)));
  const readme = (host) => fs.readFileSync(path.join(dist, host, "README.md"), "utf8");
  assert.match(readme("claude/plugins/filpgf-ecosystem"), /does not filter tools/);
  assert.match(readme("codex/plugins/filpgf-ecosystem"), /tool-name allowlist \(10 tools\); it is not proof of read-only access/);
  assert.doesNotMatch(readme("agent-plugin/filpgf-ecosystem"), /set `OSO_TOKEN`/, "portable output has no env-based auth");
  assert.throws(() => build(opts(root, { imports: false, packages: false, enableMcp: ["nope"] })), /no such server/);
});

test("builds are byte-for-byte reproducible", () => {
  const root = fixtureProject();
  const a = build(opts(root, { out: "dist-a" })).artifacts;
  const b = build(opts(root, { out: "dist-b" })).artifacts;
  const zips = (x) => Object.fromEntries(Object.entries(x).filter(([f]) => f.endsWith(".zip")).map(([f, h]) => [f, h]));
  assert.ok(Object.keys(zips(a)).length >= 5);
  assert.deepEqual(zips(a), zips(b));
});

test("offline build with no imports still produces valid outputs", () => {
  const root = fixtureProject({ withImport: false });
  const info = build(opts(root, { imports: false, packages: false }));
  assert.deepEqual(info.skills.imported, []);
  assert.ok(info.warnings.some((w) => w.includes("--no-imports")));
  assert.deepEqual(validateDist(path.join(root, "dist")), []);
});

test("build fails on tampered imports and name collisions", () => {
  const root = fixtureProject();
  const lockFile = path.join(root, "imports.lock.json");
  const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
  lock.imports[0].files["skills/upstream-demo/SKILL.md"] = "f".repeat(64);
  fs.writeFileSync(lockFile, JSON.stringify(lock));
  assert.throws(() => build(opts(root, { packages: false })), /integrity check failed/);

  const root2 = fixtureProject();
  fs.cpSync(path.join(root2, "skills/filpgf-ecosystem"), path.join(root2, "skills/upstream-demo"), { recursive: true });
  const f = path.join(root2, "skills/upstream-demo/SKILL.md");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("name: filpgf-ecosystem", "name: upstream-demo"));
  assert.throws(() => build(opts(root2, { packages: false })), /collides with a native skill/);
});

test("validator catches secrets and non-portable fields", () => {
  const root = fixtureProject({ withImport: false });
  build(opts(root, { imports: false, packages: false, enableMcp: ["oso"] }));
  const dist = path.join(root, "dist");
  const mcp = path.join(dist, "claude/plugins/filpgf-ecosystem/.mcp.json");
  const j = JSON.parse(fs.readFileSync(mcp, "utf8"));
  j.mcpServers.oso.headers.Authorization = "Bearer sk-literal-secret";
  fs.writeFileSync(mcp, JSON.stringify(j));
  const pj = path.join(dist, "agent-plugin/filpgf-ecosystem/plugin.json");
  fs.writeFileSync(pj, JSON.stringify({ ...JSON.parse(fs.readFileSync(pj, "utf8")), skills: "./skills" }));
  fs.appendFileSync(path.join(dist, "pi/filpgf-ecosystem/skills/filpgf-ecosystem/SKILL.md"), "\n[gone](references/missing.md) [root](/datasets.md)\n");
  const errors = validateDist(dist);
  assert.ok(errors.some((e) => /broken or escaping link references\/missing.md/.test(e)), errors.join("\n"));
  assert.ok(errors.some((e) => /broken or escaping link \/datasets.md/.test(e)), errors.join("\n"));
  assert.ok(errors.some((e) => /not an environment reference/.test(e)), errors.join("\n"));
  assert.ok(errors.some((e) => /field skills not allowed/.test(e)), errors.join("\n"));
});

test("refuses to write output outside the project", () => {
  const root = fixtureProject({ withImport: false });
  assert.throws(() => build(opts(root, { out: ".." })), /subdirectory/);
  assert.throws(() => build(opts(root, { out: "." })), /subdirectory/);
  // An existing directory that is not a previous build output is never deleted.
  assert.throws(() => build(opts(root, { out: "skills", imports: false, packages: false })), /not a previous build output/);
  assert.ok(fs.existsSync(path.join(root, "skills/filpgf-ecosystem/SKILL.md")));
  build(opts(root, { imports: false, packages: false }));
  assert.doesNotThrow(() => build(opts(root, { imports: false, packages: false })), "a previous build output can be replaced");
});

test("refuses symlinks in native skills", () => {
  const root = fixtureProject({ withImport: false });
  fs.symlinkSync("/etc/hostname", path.join(root, "skills/filpgf-ecosystem/leak"));
  assert.throws(() => build(opts(root, { imports: false, packages: false })), /non-regular file/);
});
