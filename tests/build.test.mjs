import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { build } from "../scripts/build.mjs";
import { validateDist } from "../scripts/validate-dist.mjs";
import { computeHashes } from "../scripts/lib/imports.mjs";
import { listFiles, readZip } from "../scripts/lib/zip.mjs";
import { fixtureRepo, tmpdir, MIT, skillMd } from "./helpers.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const NAME = "filpgf-ecosystem";

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

test("builds the stable marketplace tree and the plugin ZIP", () => {
  const root = fixtureProject();
  const info = build({ root });
  const dist = path.join(root, "dist");
  const stable = path.join(dist, "stable");
  const plugin = path.join(stable, "plugins", NAME);
  assert.deepEqual(info.skills.imported, ["upstream-demo"]);
  assert.deepEqual(validateDist(dist), []);

  assert.deepEqual(listFiles(stable).filter((f) => !f.startsWith("plugins/")), [
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
    "LICENSE",
    "README.md",
    "extensions/filpgf-mcp.ts",
    "package.json",
  ]);
  for (const f of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ".mcp.json", "README.md", "LICENSE", "THIRD_PARTY_NOTICES.md", "skills/filpgf-ecosystem/references/sources.md", "skills/upstream-demo/UPSTREAM.json"]) assert.ok(fs.existsSync(path.join(plugin, f)), f);

  // OSO and Karma ship as URLs only; clients run the OAuth sign-in.
  const mcp = JSON.parse(fs.readFileSync(path.join(plugin, ".mcp.json"), "utf8")).mcpServers;
  assert.deepEqual(Object.keys(mcp), ["oso", "karma"]);
  assert.deepEqual(mcp.karma, { type: "http", url: "https://api.karmahq.org/mcp" });
  assert.ok(mcp.oso.enabled_tools.includes("SqlQuery"));
  assert.ok(!mcp.oso.enabled_tools.some((t) => /^(create|update|delete|publish|dispatch)/i.test(t)), "allowlist has no write tools");
  const docs = listFiles(stable).filter((f) => /\.(md|json|ts)$/.test(f)).map((f) => fs.readFileSync(path.join(stable, f), "utf8")).join("\n");
  assert.doesNotMatch(docs, /OSO_TOKEN|KARMA_API_KEY|Authorization|x-api-key/);

  const readme = fs.readFileSync(path.join(stable, "README.md"), "utf8");
  assert.match(readme, /claude plugin marketplace add filecoin-project\/filpgf-agent-kit#stable\nclaude plugin install filpgf-ecosystem@filpgf-ecosystem-marketplace/);
  assert.match(readme, /codex plugin marketplace add filecoin-project\/filpgf-agent-kit --ref stable\ncodex plugin add filpgf-ecosystem@filpgf-ecosystem-marketplace/);
  assert.match(readme, /pi install git:github.com\/filecoin-project\/filpgf-agent-kit@stable/);

  const sources = fs.readFileSync(path.join(plugin, "skills/filpgf-ecosystem/references/sources.md"), "utf8");
  assert.match(sources, /## Open Source Observer[\s\S]*?- Route: needs the user's own sign-in/);
  assert.match(sources, /Report problems: https:\/\/github.com\/davidgasquez\/filecoin-data-portal\/issues\/new/);
  assert.match(fs.readFileSync(path.join(plugin, "THIRD_PARTY_NOTICES.md"), "utf8"), /upstream-demo[\s\S]*License: MIT/);

  const zip = readZip(path.join(dist, "packages", info.zip));
  assert.equal(info.zip, `${NAME}-${info.version}.zip`);
  assert.ok(zip.has(`${NAME}/.claude-plugin/plugin.json`) && zip.has(`${NAME}/.codex-plugin/plugin.json`) && zip.has(`${NAME}/skills/upstream-demo/SKILL.md`));
});

test("builds are byte-for-byte reproducible", () => {
  const root = fixtureProject();
  const sums = (out) => (build({ root, out }), fs.readFileSync(path.join(root, out, "packages/SHA256SUMS"), "utf8"));
  assert.equal(sums("dist-a"), sums("dist-b"));
});

test("offline build with no imports still produces valid output", () => {
  const root = fixtureProject({ withImport: false });
  const info = build({ root, imports: false });
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
  assert.throws(() => build({ root }), /integrity check failed/);

  const root2 = fixtureProject();
  fs.cpSync(path.join(root2, "skills/filpgf-ecosystem"), path.join(root2, "skills/upstream-demo"), { recursive: true });
  const f = path.join(root2, "skills/upstream-demo/SKILL.md");
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("name: filpgf-ecosystem", "name: upstream-demo"));
  assert.throws(() => build({ root: root2 }), /collides with a native skill/);
});

test("validator catches credentials, version drift, stray files and broken links", () => {
  const root = fixtureProject({ withImport: false });
  build({ root, imports: false });
  const dist = path.join(root, "dist");
  const plugin = path.join(dist, "stable/plugins", NAME);
  const edit = (f, fn) => fs.writeFileSync(f, JSON.stringify(fn(JSON.parse(fs.readFileSync(f, "utf8")))));
  edit(path.join(plugin, ".mcp.json"), (j) => ((j.mcpServers.oso.headers = { Authorization: "Bearer sk-literal" }), j));
  edit(path.join(plugin, ".codex-plugin/plugin.json"), (j) => ({ ...j, version: "9.9.9" }));
  fs.writeFileSync(path.join(dist, "stable/run.sh"), "echo hi\n");
  fs.appendFileSync(path.join(plugin, "skills/filpgf-ecosystem/SKILL.md"), "\n[gone](references/missing.md) [root](/datasets.md)\n");
  const errors = validateDist(dist).join("\n");
  for (const re of [/oso field headers not allowed/, /codex plugin.json: name\/version disagree/, /unexpected file at the marketplace root: run.sh/, /broken or escaping link references\/missing.md/, /broken or escaping link \/datasets.md/]) assert.match(errors, re);
});

test("refuses to write output outside the project or over sources", () => {
  const root = fixtureProject({ withImport: false });
  assert.throws(() => build({ root, out: ".." }), /subdirectory/);
  assert.throws(() => build({ root, out: "." }), /subdirectory/);
  assert.throws(() => build({ root, out: "skills", imports: false }), /not a previous build output/);
  assert.ok(fs.existsSync(path.join(root, "skills/filpgf-ecosystem/SKILL.md")));
  build({ root, imports: false });
  assert.doesNotThrow(() => build({ root, imports: false }), "a previous build output can be replaced");
});

test("refuses symlinks in native skills", () => {
  const root = fixtureProject({ withImport: false });
  fs.symlinkSync("/etc/hostname", path.join(root, "skills/filpgf-ecosystem/leak"));
  assert.throws(() => build({ root, imports: false }), /non-regular file/);
});
