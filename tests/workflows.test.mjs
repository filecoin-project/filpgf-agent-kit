import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir, git } from "./helpers.mjs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const update = read(".github/workflows/update-imports.yml");
const ci = read(".github/workflows/ci.yml");
const release = read(".github/workflows/release.yml");
const job = (wf, name) => {
  const start = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name} missing`);
  const next = wf.slice(start + 1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? wf.slice(start) : wf.slice(start, start + 1 + next);
};

test("daily update runs on a schedule and on demand, and the docs give the same time", () => {
  assert.match(update, /cron: "17 5 \* \* \*"/);
  assert.match(update, /^  workflow_dispatch:/m);
  assert.match(read("README.md"), /05:17 UTC/);
});

test("only the update commit job can write, and it runs no repository code", () => {
  assert.equal(update.match(/contents: write/g).length, 1);
  assert.match(update, /^permissions: \{\}$/m);
  const commit = job(update, "commit");
  assert.match(commit, /contents: write/);
  assert.doesNotMatch(commit, /npm |node scripts/);
});

/** Run the commit step's script in a fixture repository after staging `files`. */
function commitStep(files) {
  const step = job(update, "commit");
  const script = step.slice(step.indexOf("run: |") + 7, step.indexOf('echo "sha=')).replace(/^ {10}/gm, "").replace(/^git push.*$/m, "");
  const repo = tmpdir("filpgf-update-");
  git(repo, "init", "-q");
  fs.writeFileSync(path.join(repo, "imports.lock.json"), JSON.stringify({ lockfileVersion: 1, imports: [{ skill: "fdp" }] }));
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    fs.writeFileSync(path.join(repo, f), c);
  }
  const tmp = tmpdir();
  fs.mkdirSync(path.join(tmp, "update"));
  git(repo, "add", "-A");
  fs.writeFileSync(path.join(tmp, "update/update.patch"), git(repo, "diff", "--cached", "--binary") + "\n");
  fs.writeFileSync(path.join(tmp, "update/commit-message.txt"), "update\n");
  git(repo, "reset", "-q", "--hard");
  git(repo, "clean", "-qfd");
  const env = { ...process.env, RUNNER_TEMP: tmp, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
  return spawnSync("bash", ["-eo", "pipefail", "-c", script], { cwd: repo, env, encoding: "utf8" });
}

test("the update commit step accepts changes to imported skills and refuses anything else", () => {
  const ok = commitStep({ "plugins/filpgf/skills/fdp/SKILL.md": "new\n", "plugins/filpgf/THIRD_PARTY_NOTICES.md": "n\n" });
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  for (const f of ["plugins/filpgf/skills/filpgf/SKILL.md", "plugins/filpgf/mcp.json", ".github/workflows/ci.yml", "plugins/filpgf/skills/fdp-evil/SKILL.md"]) {
    const r = commitStep({ "plugins/filpgf/skills/fdp/SKILL.md": "new\n", [f]: "x\n" });
    assert.notEqual(r.status, 0, `${f} must be refused`);
    assert.match(r.stdout, /outside the imported skills/);
  }
});

test("the pushed commit is checked through the reusable CI workflow", () => {
  assert.match(update, /uses: \.\/\.github\/workflows\/ci\.yml\n\s+with:\n\s+ref: \$\{\{ needs\.commit\.outputs\.sha \}\}/);
  assert.match(ci, /workflow_call:/);
  for (const s of ["npm test", "npm run check", "npm run sync:check"]) assert.ok(ci.includes(s), s);
});

test("release runs on tags only, checks before writing, and its write job runs no repository code", () => {
  assert.match(release, /^on:\n  push:\n    tags: \["v\*"\]\n\npermissions: \{\}$/m);
  const build = job(release, "build");
  assert.match(build, /contents: read/);
  let last = -1;
  for (const s of ['test "v$(jq -r .version package.json)" = "$TAG"', "merge-base --is-ancestor", "npm test", "npm run check", "npm run sync:check", "git archive"]) {
    const i = build.indexOf(s);
    assert.ok(i > last, `${s} out of order or missing`);
    last = i;
  }
  const rel = job(release, "release");
  assert.match(rel, /contents: write/);
  assert.doesNotMatch(rel, /actions\/checkout|npm |node /);
});

test("third-party actions are pinned to full commit SHAs", () => {
  for (const text of [update, ci, release]) {
    for (const [, ref] of text.matchAll(/uses: (?!\.\/)\S+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
  }
});
