import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, validateSkillDir, listSkillDirs } from "../scripts/lib/skills.mjs";
import { loadManifest, validateManifest } from "../scripts/lib/manifest.mjs";
import { tmpdir } from "./helpers.mjs";

const repo = new URL("..", import.meta.url).pathname;

test("parses scalar and nested frontmatter", () => {
  const { data, body } = parseFrontmatter("---\nname: a-b\ndescription: \"Quoted: yes\"\nmetadata:\n  owner: x\ndisable-model-invocation: true\n---\nBody\n");
  assert.deepEqual(data, { name: "a-b", description: "Quoted: yes", metadata: { owner: "x" }, "disable-model-invocation": true });
  assert.equal(body, "Body\n");
  assert.throws(() => parseFrontmatter("# no frontmatter"), /missing YAML frontmatter/);
});

test("validates Agent Skills names, directory match and description", () => {
  const root = tmpdir();
  const mk = (dir, fm) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, "SKILL.md"), `---\n${fm}\n---\n`);
    return path.join(root, dir);
  };
  assert.equal(validateSkillDir(mk("ok-skill", "name: ok-skill\ndescription: Does a thing. Use when testing.")).name, "ok-skill");
  assert.throws(() => validateSkillDir(mk("Bad", "name: Bad\ndescription: x")), /invalid name/);
  assert.throws(() => validateSkillDir(mk("a--b", "name: a--b\ndescription: x")), /invalid name/);
  assert.throws(() => validateSkillDir(mk("dir-x", "name: other\ndescription: x")), /does not match directory/);
  assert.throws(() => validateSkillDir(mk("nodesc", "name: nodesc")), /description is required/);
  assert.throws(() => validateSkillDir(mk("long", `name: long\ndescription: ${"x".repeat(1025)}`)), /1024/);
});

test("all native skills are valid", () => {
  const dirs = listSkillDirs(path.join(repo, "skills"));
  assert.deepEqual(dirs.map((d) => path.basename(d)).sort(), ["filpgf-ecosystem", "filpgf-oso-metrics"]);
  for (const d of dirs) validateSkillDir(d);
});

test("toolkit.json is valid and routes every source to a maintainer", () => {
  const m = loadManifest(path.join(repo, "toolkit.json"));
  for (const s of m.sources) assert.ok(s.report && s.maintainer, s.id);
  assert.ok(m.llmsTxt.endsWith("/llms.txt"));
  assert.equal(m.mcpServers.oso.optIn, true, "authenticated, write-capable OSO stays opt-in");
});

test("manifest rejects literal headers, insecure URLs and bad auth", () => {
  const base = { name: "x-y", version: "0.1.0", description: "d" };
  const bad = (servers) => () => validateManifest({ ...base, mcpServers: servers });
  assert.throws(bad({ s: { url: "https://h/mcp", headers: { Authorization: "Bearer abc" } } }), /literal headers/);
  assert.throws(bad({ s: { url: "http://example.com/mcp" } }), /https/);
  assert.throws(bad({ s: { url: "https://user:pw@example.com/mcp" } }), /credentials/);
  assert.throws(bad({ s: { url: "https://h/mcp", auth: { scheme: "bearer", env: "lower" } } }), /environment variable/);
  assert.throws(bad({ s: { url: "https://h/mcp", auth: { scheme: "header", env: "K" } } }), /auth.header/);
  assert.throws(() => validateManifest({ ...base, name: "Bad--Name" }), /name/);
  assert.throws(bad({ s: { url: "https://h/mcp", allowedTools: [] } }), /allowedTools/);
  assert.throws(bad({ s: { url: "https://h/mcp", optIn: "yes" } }), /optIn/);
  validateManifest({ ...base, mcpServers: { s: { url: "http://127.0.0.1:3000/mcp" } } });
});
