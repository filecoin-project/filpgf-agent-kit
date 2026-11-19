import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { build, parseArgs } from "../scripts/build.mjs";
import { assemble, check, shouldPublish, verifyTag, tagVersion } from "../scripts/stable-branch.mjs";
import { readZip, listFiles } from "../scripts/lib/zip.mjs";
import { tmpdir, git } from "./helpers.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

/** A project copy with the repository's skills and manifest, optionally at another version, and its router build. */
function routerProject(version) {
  const root = tmpdir("filpgf-stable-");
  fs.cpSync(path.join(repoRoot, "skills"), path.join(root, "skills"), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, "LICENSE"), path.join(root, "LICENSE"));
  const m = JSON.parse(read("toolkit.json"));
  if (version) m.version = version;
  fs.writeFileSync(path.join(root, "toolkit.json"), JSON.stringify(m));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: m.version }));
  build({ ...parseArgs(["--router-only"]), root });
  return { root, version: m.version, name: m.name };
}

test("stable tree is the router build verbatim plus generated marketplace indexes", () => {
  const { root, version, name } = routerProject();
  const tag = `v${version}`;
  const s = assemble({ root, tag, commit: "a".repeat(40), zip: "out/stable.zip" });
  const out = path.join(root, ".cache/stable");
  assert.deepEqual(check({ root, router: ".cache/dist-router", tag }), []);
  assert.deepEqual(s.skills, [name]);
  assert.deepEqual(listFiles(out), [
    ".agents/plugins/marketplace.json",
    ".claude-plugin/marketplace.json",
    "README.md",
    "STABLE.json",
    `plugins/${name}/LICENSE`,
    `plugins/${name}/plugin.json`,
    `plugins/${name}/skills/${name}/SKILL.md`,
    `plugins/${name}/skills/${name}/references/credentials.md`,
    `plugins/${name}/skills/${name}/references/sources.md`,
  ]);
  const claude = JSON.parse(fs.readFileSync(path.join(out, ".claude-plugin/marketplace.json"), "utf8"));
  const codex = JSON.parse(fs.readFileSync(path.join(out, ".agents/plugins/marketplace.json"), "utf8"));
  assert.equal(claude.name, `${name}-marketplace`);
  assert.equal(codex.name, `${name}-marketplace`);
  assert.deepEqual(claude.plugins.map((p) => [p.name, p.source, p.version]), [[name, `./plugins/${name}`, version]]);
  assert.deepEqual(codex.plugins.map((p) => [p.name, p.source]), [[name, { source: "local", path: `./plugins/${name}` }]]);
  // No host-specific plugin manifests or MCP config: one Agent Plugins package serves every client.
  assert.ok(!fs.existsSync(path.join(out, "plugins", name, ".claude-plugin")));
  assert.ok(!fs.existsSync(path.join(out, "plugins", name, ".codex-plugin")));
  const readme = fs.readFileSync(path.join(out, "README.md"), "utf8");
  assert.match(readme, /claude plugin marketplace add filecoin-project\/filpgf-agent-kit#stable/);
  assert.match(readme, /codex plugin marketplace add filecoin-project\/filpgf-agent-kit --ref stable/);
  // The release ZIP holds the exact tree, dotfiles included.
  assert.deepEqual([...readZip(path.join(root, "out/stable.zip")).keys()].sort(), listFiles(out).map((f) => `${name}-stable/${f}`).sort());
});

test("check rejects tampered, extra or mismatched stable content", () => {
  const { root, version, name } = routerProject();
  const tag = `v${version}`;
  const out = path.join(root, ".cache/stable");
  const cases = [
    [() => fs.appendFileSync(path.join(out, "plugins", name, "skills", name, "SKILL.md"), "\nhand edit\n"), /checksum mismatch|verbatim/],
    [() => fs.writeFileSync(path.join(out, "plugins", name, "run.sh"), "echo hi\n"), /unexpected file|file list/],
    [() => fs.writeFileSync(path.join(out, ".claude-plugin/marketplace.json"), "{}\n"), /not generated|checksum/],
    [() => fs.rmSync(path.join(out, ".agents"), { recursive: true }), /file list|not generated/],
  ];
  for (const [tamper, re] of cases) {
    assemble({ root, tag });
    tamper();
    const errors = check({ root, router: ".cache/dist-router", tag });
    assert.ok(errors.some((e) => re.test(e)), `expected ${re}, got ${errors}`);
  }
  assemble({ root, tag });
  assert.ok(check({ root, tag: "v9.9.9" }).some((e) => /expected v9\.9\.9/.test(e)));
  assert.throws(() => assemble({ root, tag: "v9.9.9" }), /does not match router version/);
  assert.throws(() => assemble({ root, router: ".cache/missing" }));
  assert.throws(() => assemble({ root, zip: ".cache/stable/x.zip" }), /outside/);
});

test("tag must match toolkit.json and package.json", () => {
  const { root, version } = routerProject("1.2.3");
  assert.equal(version, "1.2.3");
  assert.deepEqual(verifyTag("v1.2.3", root), []);
  assert.equal(verifyTag("v1.2.4", root).length, 2);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.2.2" }));
  assert.deepEqual(verifyTag("v1.2.3", root), ["package.json version 1.2.2 does not match tag v1.2.3"]);
  assert.throws(() => tagVersion("1.2.3"), /not v<semver>/);
  assert.throws(() => tagVersion("release-1"), /not v<semver>/);
});

test("stable only moves forward, and never to a prerelease", () => {
  const p = (tag, cur) => shouldPublish(tag, cur).publish;
  assert.equal(p("v0.1.1", ""), true);
  assert.equal(p("v0.1.1", undefined), true);
  assert.equal(p("v0.1.2", "0.1.1"), true);
  assert.equal(p("v0.2.0", "0.1.9"), true);
  assert.equal(p("v1.0.0", "0.10.0"), true);
  assert.equal(p("v0.10.0", "0.9.0"), true, "numeric, not lexical");
  assert.equal(p("v0.1.1", "0.1.1"), false, "re-running a tag is a no-op");
  assert.equal(p("v0.1.0", "0.1.1"), false);
  assert.equal(p("v0.9.0", "0.10.0"), false);
  assert.equal(p("v2.0.0-rc.1", "1.0.0"), false);
  assert.equal(p("v2.0.0-rc.1", ""), false);
  assert.throws(() => shouldPublish("v1.0.0", "garbage"), /unrecognised/);
});

// ---- Workflow -------------------------------------------------------------

const wf = read(".github/workflows/release.yml");
const job = (name) => {
  const start = wf.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name} missing`);
  const next = wf.slice(start + 1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? wf.slice(start) : wf.slice(start, start + 1 + next);
};

test("release workflow runs on tags only, with least privilege per job", () => {
  assert.match(wf, /^on:\n  push:\n    tags: \["v\*"\]\n\npermissions: \{\}$/m);
  assert.doesNotMatch(wf, /branches:|workflow_dispatch|pull_request|schedule/);
  assert.match(job("build"), /permissions:\n      contents: read/);
  assert.match(job("build"), /persist-credentials: false/);
  assert.equal(wf.match(/contents: write/g).length, 2);
  for (const j of ["release", "stable"]) {
    assert.match(job(j), /contents: write/);
    assert.doesNotMatch(job(j), /actions\/checkout|npm |node /, `${j} runs no repository code`);
  }
  for (const [, ref] of wf.matchAll(/uses: (?!\.\/)\S+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
});

test("release workflow gates on version, tests, validation and stable checks before writing", () => {
  const b = job("build");
  const order = ["verify-tag", "merge-base --is-ancestor", "npm test", "imports:check", "npm run validate", "build:router", "stable-branch.mjs check", "stable-branch.mjs decide", "sha256sum"];
  let last = -1;
  for (const s of order) {
    const i = b.indexOf(s);
    assert.ok(i > last, `${s} out of order or missing`);
    last = i;
  }
  assert.match(job("release"), /sha256sum -c SHA256SUMS/);
  assert.match(job("release"), /already exists/);
  assert.match(job("stable"), /needs: \[build, release\]/);
  assert.match(job("stable"), /if: needs\.build\.outputs\.publish == 'true'/);
  assert.match(job("stable"), /BRANCH: stable\n/);
  assert.doesNotMatch(job("stable"), /--force|\+refs|-f /);
});

/** Run the workflow's publish step against a local bare repository. */
function publish(remote, tree, env) {
  const script = wf.slice(wf.indexOf("# BEGIN publish-stable"), wf.indexOf("# END publish-stable")).replace(/^ {10}/gm, "");
  const gitEnv = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z" };
  return spawnSync("bash", ["-c", script], { env: { ...process.env, TOKEN: "", ...gitEnv, REMOTE_URL: remote, BRANCH: "stable", DEFAULT_BRANCH: "main", SOURCE_SHA: "b".repeat(40), TREE: tree, ...env }, encoding: "utf8" });
}

test("publish step fast-forwards stable and refuses stale or missing bases", () => {
  const remote = path.join(tmpdir("filpgf-remote-"), "origin.git");
  execFileSync("git", ["init", "-q", "--bare", remote]);
  const tarOf = (version) => {
    const { root } = routerProject(version);
    assemble({ root, tag: `v${version}` });
    const tar = path.join(root, "tree.tar");
    execFileSync("tar", ["-C", path.join(root, ".cache/stable"), "-cf", tar, "."]);
    return tar;
  };
  const head = () => git(remote, "rev-parse", "refs/heads/stable");
  const t1 = tarOf("1.0.0");
  const r1 = publish(remote, t1, { TAG: "v1.0.0", BASE: "" });
  assert.equal(r1.status, 0, r1.stderr);
  const c1 = head();
  assert.equal(JSON.parse(git(remote, "show", "stable:STABLE.json")).version, "1.0.0");
  assert.match(git(remote, "ls-tree", "-r", "--name-only", "stable"), /^\.agents\/plugins\/marketplace\.json$/m);

  const t2 = tarOf("1.1.0");
  assert.notEqual(publish(remote, t2, { TAG: "v1.0.0", BASE: c1 }).status, 0, "tree/tag mismatch is refused");
  const r2 = publish(remote, t2, { TAG: "v1.1.0", BASE: c1 });
  assert.equal(r2.status, 0, r2.stderr);
  const c2 = head();
  assert.equal(git(remote, "rev-parse", "stable^"), c1, "new stable commit sits on the previous one");

  // A run that inspected an older stable (or none) cannot overwrite a newer one.
  assert.notEqual(publish(remote, t1, { TAG: "v1.0.0", BASE: c1 }).status, 0);
  assert.notEqual(publish(remote, t1, { TAG: "v1.0.0", BASE: "" }).status, 0);
  assert.equal(head(), c2);
  // The step only ever targets the stable branch.
  assert.notEqual(publish(remote, t2, { TAG: "v1.1.0", BASE: c2, BRANCH: "main" }).status, 0);
  assert.throws(() => git(remote, "rev-parse", "--verify", "refs/heads/main"));
});

test("decide step reads the current stable version and fails on an unreadable stable branch", () => {
  const b = job("build");
  const step = b.slice(b.indexOf("id: decide"), b.indexOf("- name:", b.indexOf("id: decide")));
  assert.match(step, /shell: bash\n/);
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
  fs.writeFileSync(path.join(repo, "STABLE.json"), JSON.stringify({ version: "1.1.0" }));
  git(repo, "add", "STABLE.json");
  git(repo, "commit", "-qm", "stable");
  const sha = git(repo, "rev-parse", "HEAD");
  git(repo, "update-ref", "refs/remotes/origin/stable", sha);
  assert.deepEqual(run("v1.0.5"), { status: 0, out: { publish: "false", base: sha, prerelease: "false" } });
  assert.deepEqual(run("v1.2.0"), { status: 0, out: { publish: "true", base: sha, prerelease: "false" } });
  assert.deepEqual(run("v1.2.0-rc.1"), { status: 0, out: { publish: "false", base: sha, prerelease: "true" } });
  git(repo, "rm", "-q", "STABLE.json");
  git(repo, "commit", "-qm", "broken", "--allow-empty");
  git(repo, "update-ref", "refs/remotes/origin/stable", git(repo, "rev-parse", "HEAD"));
  assert.notEqual(run("v9.0.0").status, 0);
});
