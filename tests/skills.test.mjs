import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseFrontmatter, validateSkillDir, listSkillDirs } from "../scripts/lib/skills.mjs";
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

test("every skill in the plugin is valid", () => {
  const dirs = listSkillDirs(path.join(repo, "plugins/filpgf-ecosystem/skills"));
  assert.deepEqual(dirs.map((d) => path.basename(d)), ["fdp", "filoscope", "filpgf-artio-metrics", "filpgf-ecosystem", "filpgf-plugin-feedback", "filpgf-read-karma", "filpgf-review-work"]);
  for (const d of dirs) validateSkillDir(d);
});

test("every source in the source map names its route, authority and maintainer, and a handoff unless it is public", () => {
  const md = fs.readFileSync(path.join(repo, "plugins/filpgf-ecosystem/skills/filpgf-ecosystem/references/sources.md"), "utf8");
  const sections = md.split(/^## /m).slice(1);
  assert.ok(sections.length >= 7);
  for (const sec of sections) {
    const id = /\(`([a-z0-9-]+)`\)/.exec(sec)?.[1];
    assert.ok(id, sec.split("\n")[0]);
    for (const field of ["Covers", "Access", "Auth", "Authority", "Route", "Maintainer", "Report problems"]) assert.match(sec, new RegExp(`^- ${field}: \\S`, "m"), `${id}: ${field}`);
    if (!/^- Route: public/m.test(sec)) assert.match(sec, /^- Handoff: \S/m, `${id}: handoff`);
  }
});
