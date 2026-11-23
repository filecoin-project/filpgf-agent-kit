import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { tagVersion, verifyTag, shouldPublish } from "../scripts/release.mjs";
import { tmpdir, git } from "./helpers.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const wf = fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8");
const job = (name) => {
  const start = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name} missing`);
  const next = wf.slice(start + 1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? wf.slice(start) : wf.slice(start, start + 1 + next);
};

test("tag must match toolkit.json and package.json", () => {
  const root = tmpdir();
  for (const f of ["toolkit.json", "package.json"]) fs.writeFileSync(path.join(root, f), JSON.stringify({ version: "1.2.3" }));
  assert.deepEqual(verifyTag("v1.2.3", root), []);
  assert.equal(verifyTag("v1.2.4", root).length, 2);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.2.2" }));
  assert.deepEqual(verifyTag("v1.2.3", root), ["package.json version 1.2.2 does not match tag v1.2.3"]);
  assert.throws(() => tagVersion("1.2.3"), /not v<semver>/);
});

test("stable only moves forward, and never to a prerelease", () => {
  const p = (tag, cur) => shouldPublish(tag, cur).publish;
  assert.equal(p("v0.1.1", ""), true);
  assert.equal(p("v0.1.2", "0.1.1"), true);
  assert.equal(p("v0.10.0", "0.9.0"), true, "numeric, not lexical");
  assert.equal(p("v0.1.1", "0.1.1"), false, "re-running a tag is a no-op");
  assert.equal(p("v0.1.0", "0.1.1"), false);
  assert.equal(p("v2.0.0-rc.1", ""), false);
  assert.throws(() => shouldPublish("v1.0.0", "garbage"), /unrecognised/);
});

test("release workflow runs on tags only, with least privilege per job", () => {
  assert.match(wf, /^on:\n  push:\n    tags: \["v\*"\]\n\npermissions: \{\}$/m);
  assert.doesNotMatch(wf, /branches:|workflow_dispatch|pull_request|schedule/);
  assert.match(job("build"), /permissions:\n      contents: read/);
  assert.match(job("build"), /persist-credentials: false/);
  assert.equal(wf.match(/contents: write/g).length, 2);
  for (const j of ["release", "stable"]) assert.doesNotMatch(job(j), /actions\/checkout|npm |node /, `${j} runs no repository code`);
});

test("release workflow gates on version, tests and validation before writing", () => {
  const b = job("build");
  let last = -1;
  for (const s of ["verify-tag", "merge-base --is-ancestor", "npm test", "imports:check", "npm run build", "npm run validate", "release.mjs decide", "sha256sum -c"]) {
    const i = b.indexOf(s);
    assert.ok(i > last, `${s} out of order or missing`);
    last = i;
  }
  assert.match(job("release"), /already exists/);
  assert.match(job("stable"), /needs: \[build, release\]/);
  assert.match(job("stable"), /if: needs\.build\.outputs\.publish == 'true'/);
  assert.doesNotMatch(job("stable"), /--force|\+refs|-f /);
});

/** Run the workflow's publish step against a local bare repository. */
function publish(remote, tree, env) {
  const script = wf.slice(wf.indexOf("# BEGIN publish-stable"), wf.indexOf("# END publish-stable")).replace(/^ {10}/gm, "");
  const gitEnv = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z" };
  return spawnSync("bash", ["-c", script], { env: { ...process.env, TOKEN: "", ...gitEnv, REMOTE_URL: remote, BRANCH: "stable", DEFAULT_BRANCH: "main", SOURCE_SHA: "b".repeat(40), TREE: tree, ...env }, encoding: "utf8" });
}

test("publish step fast-forwards stable and refuses stale bases or mismatched tags", () => {
  const remote = path.join(tmpdir("filpgf-remote-"), "origin.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const tarOf = (version) => {
    const dir = tmpdir();
    fs.mkdirSync(path.join(dir, "tree/.claude-plugin"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tree/package.json"), JSON.stringify({ version }));
    fs.writeFileSync(path.join(dir, "tree/.claude-plugin/marketplace.json"), "{}");
    execFileSync("tar", ["-C", path.join(dir, "tree"), "-cf", path.join(dir, "tree.tar"), "."]);
    return path.join(dir, "tree.tar");
  };
  const head = () => git(remote, "rev-parse", "refs/heads/stable");
  const t1 = tarOf("1.0.0");
  const r1 = publish(remote, t1, { TAG: "v1.0.0", BASE: "" });
  assert.equal(r1.status, 0, r1.stderr);
  const c1 = head();
  assert.match(git(remote, "ls-tree", "-r", "--name-only", "stable"), /^\.claude-plugin\/marketplace\.json$/m, "dotfiles are published");

  const t2 = tarOf("1.1.0");
  assert.notEqual(publish(remote, t2, { TAG: "v1.0.0", BASE: c1 }).status, 0, "tree/tag mismatch is refused");
  assert.equal(publish(remote, t2, { TAG: "v1.1.0", BASE: c1 }).status, 0);
  const c2 = head();
  assert.equal(git(remote, "rev-parse", "stable^"), c1, "new stable commit sits on the previous one");
  assert.notEqual(publish(remote, t1, { TAG: "v1.0.0", BASE: c1 }).status, 0, "a stale base cannot overwrite stable");
  assert.notEqual(publish(remote, t1, { TAG: "v1.0.0", BASE: "" }).status, 0);
  assert.equal(head(), c2);
  assert.notEqual(publish(remote, t2, { TAG: "v1.1.0", BASE: c2, BRANCH: "main" }).status, 0, "only the stable branch is ever written");
});

test("decide step reads the stable version and fails on an unreadable stable branch", () => {
  const b = job("build");
  const step = b.slice(b.indexOf("id: decide"), b.indexOf("- name:", b.indexOf("id: decide")));
  const script = step.slice(step.indexOf("run: |") + 7).replace(/^ {10}/gm, "").replaceAll("node scripts/", `node ${repoRoot}scripts/`);
  const repo = tmpdir("filpgf-decide-");
  git(repo, "init", "-q");
  const run = (tag) => {
    const out = path.join(repo, "out");
    fs.writeFileSync(out, "");
    const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], { cwd: repo, env: { ...process.env, TAG: tag, GITHUB_OUTPUT: out }, encoding: "utf8" });
    return { status: r.status, out: Object.fromEntries(fs.readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => l.split("="))) };
  };
  assert.deepEqual(run("v1.0.0"), { status: 0, out: { publish: "true", base: "", prerelease: "false" } });
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ version: "1.1.0" }));
  git(repo, "add", "package.json");
  git(repo, "commit", "-qm", "stable");
  const sha = git(repo, "rev-parse", "HEAD");
  git(repo, "update-ref", "refs/remotes/origin/stable", sha);
  assert.deepEqual(run("v1.0.5"), { status: 0, out: { publish: "false", base: sha, prerelease: "false" } });
  assert.deepEqual(run("v1.2.0"), { status: 0, out: { publish: "true", base: sha, prerelease: "false" } });
  git(repo, "rm", "-q", "package.json");
  git(repo, "commit", "-qm", "broken", "--allow-empty");
  git(repo, "update-ref", "refs/remotes/origin/stable", git(repo, "rev-parse", "HEAD"));
  assert.notEqual(run("v9.0.0").status, 0);
});
