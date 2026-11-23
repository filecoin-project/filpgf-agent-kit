import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { syncSkills, PLUGIN } from "../scripts/sync-skills.mjs";
import { computeHashes } from "../scripts/lib/imports.mjs";
import { fixtureRepo, tmpdir, MIT, skillMd } from "./helpers.mjs";

/** A project whose lock pins one fixture upstream skill. */
function project() {
  const root = tmpdir("filpgf-sync-");
  const cache = path.join(root, ".cache/imports");
  const up = fixtureRepo({ LICENSE: MIT, "skills/upstream-demo/SKILL.md": skillMd("upstream-demo", "license: MIT\n"), "skills/upstream-demo/references/x.md": "x\n" });
  const e = { skill: "upstream-demo", source: { type: "git", url: up.url, commit: up.commit }, path: "skills/upstream-demo", license: { spdx: "MIT", file: "LICENSE" }, transforms: [{ type: "rewrite-root-relative-links", file: "SKILL.md", origin: "https://data.example.org" }] };
  e.files = computeHashes(e, cache);
  fs.writeFileSync(path.join(root, "imports.lock.json"), JSON.stringify({ lockfileVersion: 1, imports: [e] }));
  fs.mkdirSync(path.join(root, PLUGIN, "skills"), { recursive: true });
  return { root, cache, skill: path.join(root, PLUGIN, "skills/upstream-demo") };
}

test("sync copies pinned upstream skills with license, provenance and notices", () => {
  const { root, cache, skill } = project();
  assert.ok(syncSkills({ root, cache, check: true }).length > 0, "a missing copy is drift");
  syncSkills({ root, cache });
  assert.deepEqual(fs.readdirSync(skill).sort(), ["LICENSE", "SKILL.md", "UPSTREAM.json", "references"]);
  assert.match(fs.readFileSync(path.join(skill, "SKILL.md"), "utf8"), /\(https:\/\/data\.example\.org\/datasets\.md\)/, "declared transform applied");
  assert.match(fs.readFileSync(path.join(root, PLUGIN, "THIRD_PARTY_NOTICES.md"), "utf8"), /## upstream-demo[\s\S]*License: MIT/);
  assert.deepEqual(syncSkills({ root, cache, check: true }), []);
});

test("--check reports hand edits and stray files in a copied skill, and sync repairs them", () => {
  const { root, cache, skill } = project();
  syncSkills({ root, cache });
  fs.appendFileSync(path.join(skill, "SKILL.md"), "\nlocal edit\n");
  fs.writeFileSync(path.join(skill, "extra.md"), "stray\n");
  assert.deepEqual(syncSkills({ root, cache, check: true }).sort(), ["skills/upstream-demo/SKILL.md", "skills/upstream-demo/extra.md"]);
  syncSkills({ root, cache });
  assert.deepEqual(syncSkills({ root, cache, check: true }), []);
  assert.ok(!fs.existsSync(path.join(skill, "extra.md")));
});
