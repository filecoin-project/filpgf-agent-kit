import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeHashes, resolveRef } from "../scripts/lib/imports.mjs";
import { updateImports, commitMessage } from "../scripts/update-imports.mjs";
import { fixtureRepo, tmpdir, MIT, skillMd, git } from "./helpers.mjs";

/** Two skills from one repository plus one from another, pinned at their first commits. */
function setup() {
  const a = fixtureRepo({ LICENSE: MIT, "skills/alpha/SKILL.md": skillMd("alpha"), "skills/beta/SKILL.md": skillMd("beta") });
  const b = fixtureRepo({ LICENSE: MIT, "SKILL.md": skillMd("gamma"), "README.md": "x\n" });
  const cache = tmpdir("filpgf-cache-");
  const entry = (skill, repo, extra) => ({ skill, source: { type: "git", url: repo.url, ref: "main", commit: repo.commit }, license: { spdx: "MIT", file: "LICENSE" }, ...extra });
  const imports = [entry("alpha", a, { path: "skills/alpha" }), entry("beta", a, { path: "skills/beta" }), entry("gamma", b, { path: "", include: ["SKILL.md"] })];
  for (const e of imports) e.files = computeHashes(e, cache);
  const lockFile = path.join(tmpdir("filpgf-lock-"), "imports.lock.json");
  fs.writeFileSync(lockFile, JSON.stringify({ lockfileVersion: 1, imports }, null, 2) + "\n");
  return { a, b, cache, lockFile, read: () => JSON.parse(fs.readFileSync(lockFile, "utf8")) };
}

test("resolveRef reads a branch or the default branch without fetching", () => {
  const repo = fixtureRepo({ LICENSE: MIT });
  git(repo.dir, "branch", "dev");
  const dev = fixtureRepo({ "dev.txt": "dev\n" }, repo.dir); // commits on main; dev stays behind
  assert.equal(resolveRef(repo.url), dev.commit);
  assert.equal(resolveRef(repo.url, "main"), dev.commit);
  assert.equal(resolveRef(repo.url, "dev"), repo.commit);
  assert.throws(() => resolveRef(repo.url, "missing"), /cannot resolve refs\/heads\/missing/);
});

test("advances every entry of a repository to one new commit and re-hashes", () => {
  const { a, b, cache, lockFile, read } = setup();
  const next = fixtureRepo({ "skills/alpha/SKILL.md": skillMd("alpha") + "\nMore.\n", "skills/alpha/references/new.md": "new\n" }, a.dir);
  const changes = updateImports({ lockFile, cache });
  const lock = read();
  const [alpha, beta, gamma] = lock.imports;
  assert.equal(alpha.source.commit, next.commit);
  assert.equal(beta.source.commit, next.commit, "same repository, same commit");
  assert.equal(gamma.source.commit, b.commit);
  assert.equal(alpha.source.ref, "main");
  assert.deepEqual(alpha.files, computeHashes(alpha, cache));
  assert.deepEqual(changes.map((c) => c.skill), ["alpha", "beta"], "beta moved commit without content changes");
  assert.deepEqual(changes[0].added, ["skills/alpha/references/new.md"]);
  assert.deepEqual(changes[0].modified, ["skills/alpha/SKILL.md"]);
  assert.match(commitMessage(changes), /alpha: [0-9a-f]{12} -> [0-9a-f]{12}\n  added: skills\/alpha\/references\/new.md/);
});

test("leaves the lock byte-for-byte unchanged when nothing moved", () => {
  const { cache, lockFile } = setup();
  const before = fs.readFileSync(lockFile);
  assert.deepEqual(updateImports({ lockFile, cache }), []);
  assert.deepEqual(fs.readFileSync(lockFile), before);
});

test("never writes a partial lock when any entry fails", () => {
  const failures = [
    // A later repository's skill is renamed upstream: alpha/beta would advance, gamma fails.
    ({ a, b }) => {
      fixtureRepo({ "skills/alpha/SKILL.md": skillMd("alpha") + "\nx\n" }, a.dir);
      fixtureRepo({ "SKILL.md": skillMd("renamed") }, b.dir);
      return /upstream SKILL.md name is "renamed"/;
    },
    // License text changes need a person.
    ({ a }) => {
      fixtureRepo({ LICENSE: "Apache License 2.0\n" }, a.dir);
      return /license file LICENSE changed/;
    },
    // An imported file becomes a symlink.
    ({ a }) => {
      fs.rmSync(path.join(a.dir, "skills/beta/SKILL.md"));
      fs.symlinkSync("/etc/hostname", path.join(a.dir, "skills/beta/SKILL.md"));
      fixtureRepo({}, a.dir);
      return /symlink/;
    },
    // The tracked branch disappears.
    ({ b }) => {
      git(b.dir, "branch", "-m", "main", "trunk");
      return /cannot resolve refs\/heads\/main/;
    },
  ];
  for (const mutate of failures) {
    const ctx = setup();
    const before = fs.readFileSync(ctx.lockFile);
    const expected = mutate(ctx);
    assert.throws(() => updateImports({ lockFile: ctx.lockFile, cache: ctx.cache }), expected);
    assert.deepEqual(fs.readFileSync(ctx.lockFile), before, `lock unchanged after ${expected}`);
    assert.deepEqual(fs.readdirSync(path.dirname(ctx.lockFile)), ["imports.lock.json"], "no temporary files left behind");
  }
});

test("rejects entries of one repository that track different refs", () => {
  const { lockFile, cache, read } = setup();
  const lock = read();
  lock.imports[1].source.ref = "dev";
  fs.writeFileSync(lockFile, JSON.stringify(lock));
  assert.throws(() => updateImports({ lockFile, cache }), /track different refs/);
});

test("lock refs must be branch names", () => {
  const { lockFile, cache, read } = setup();
  const lock = read();
  lock.imports[0].source.ref = "--upload-pack=x";
  fs.writeFileSync(lockFile, JSON.stringify(lock));
  assert.throws(() => updateImports({ lockFile, cache }), /source.ref must be a branch name/);
});
