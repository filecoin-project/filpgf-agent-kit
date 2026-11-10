import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { computeHashes, materializeImport, validateLockEntry, loadLock } from "../scripts/lib/imports.mjs";
import { pin } from "../scripts/pin-imports.mjs";
import { fixtureRepo, tmpdir, MIT, skillMd, git } from "./helpers.mjs";

function setup() {
  const repo = fixtureRepo({
    LICENSE: MIT,
    "skills/alpha/SKILL.md": skillMd("alpha", "license: MIT\n"),
    "skills/alpha/references/notes.md": "notes\n",
    "skills/beta/SKILL.md": skillMd("beta"),
    "README.md": "readme\n",
  });
  const entry = (over = {}) => ({
    skill: "alpha",
    source: { type: "git", url: repo.url, commit: repo.commit },
    path: "skills/alpha",
    license: { spdx: "MIT", file: "LICENSE" },
    files: {},
    ...over,
  });
  return { repo, entry, cache: tmpdir("filpgf-cache-"), out: tmpdir("filpgf-out-") };
}

test("pins hashes for a whole skill directory plus license", () => {
  const { entry, cache } = setup();
  const hashes = computeHashes(entry(), cache);
  assert.deepEqual(Object.keys(hashes), ["LICENSE", "skills/alpha/references/notes.md", "skills/alpha/SKILL.md"]);
  for (const h of Object.values(hashes)) assert.match(h, /^[0-9a-f]{64}$/);
});

test("materializes a verified import with provenance and license", () => {
  const { entry, cache, out } = setup();
  const e = entry();
  e.files = computeHashes(e, cache);
  const prov = materializeImport(e, out, cache);
  assert.equal(prov.commit, e.source.commit);
  assert.ok(fs.existsSync(path.join(out, "alpha", "references", "notes.md")));
  assert.equal(fs.readFileSync(path.join(out, "alpha", "LICENSE"), "utf8"), MIT);
  const up = JSON.parse(fs.readFileSync(path.join(out, "alpha", "UPSTREAM.json"), "utf8"));
  assert.equal(up.license, "MIT");
  assert.deepEqual(up.files, e.files);
  assert.ok(!fs.existsSync(path.join(out, "beta")), "only the selected path is imported");
});

test("rejects content that does not match the lock", () => {
  const { entry, cache, out } = setup();
  const e = entry();
  e.files = computeHashes(e, cache);
  e.files["skills/alpha/SKILL.md"] = "0".repeat(64);
  assert.throws(() => materializeImport(e, out, cache), /sha256 mismatch for skills\/alpha\/SKILL.md/);
});

test("rejects files added upstream that are not in the lock", () => {
  const { repo, entry, cache, out } = setup();
  const e = entry();
  e.files = computeHashes(e, cache);
  const next = fixtureRepo({ "skills/alpha/extra.sh": "echo surprise\n" }, repo.dir);
  e.source.commit = next.commit;
  assert.throws(() => materializeImport(e, out, cache), /unexpected file skills\/alpha\/extra.sh/);
});

test("requires immutable full commit SHAs", () => {
  const { entry } = setup();
  for (const commit of ["main", "v1.0.0", "abc1234"]) {
    assert.throws(() => validateLockEntry(entry({ source: { type: "git", url: "https://example.com/r", commit } })), /40-character/);
  }
});

test("requires license metadata and an existing license file", () => {
  const { entry, cache } = setup();
  assert.throws(() => validateLockEntry(entry({ license: { file: "LICENSE" } }), { requireFiles: false }), /license.spdx/);
  assert.throws(() => computeHashes(entry({ license: { spdx: "MIT", file: "COPYING" } }), cache), /license file COPYING not found/);
});

test("rejects SKILL.md license that contradicts the lock", () => {
  const { entry, cache, out } = setup();
  const e = entry({ license: { spdx: "Apache-2.0", file: "LICENSE" } });
  e.files = computeHashes(e, cache);
  assert.throws(() => materializeImport(e, out, cache), /disagrees with lock Apache-2.0/);
});

test("rejects path traversal and unpinned locks", () => {
  const { entry } = setup();
  assert.throws(() => validateLockEntry(entry({ path: "../outside" }), { requireFiles: false }), /normalized relative path/);
  assert.throws(() => validateLockEntry(entry({ include: ["../../etc/passwd"] }), { requireFiles: false }), /normalized relative path/);
  assert.throws(() => validateLockEntry(entry()), /run `npm run imports:pin`/);
});

test("rejects skill name mismatch between lock and upstream", () => {
  const { entry, cache, out } = setup();
  const e = entry({ skill: "gamma" });
  e.files = computeHashes(e, cache);
  assert.throws(() => materializeImport(e, out, cache), /upstream SKILL.md name is "alpha"/);
});

test("imports single files from a repository root and applies declared link rewrites", () => {
  const repo = fixtureRepo({ LICENSE: MIT, "web/public/SKILL.md": skillMd("solo"), "web/public/other.txt": "x" });
  const cache = tmpdir();
  const out = tmpdir();
  const e = {
    skill: "solo",
    source: { type: "git", url: repo.url, commit: repo.commit },
    path: "web/public",
    include: ["SKILL.md"],
    license: { spdx: "MIT", file: "LICENSE" },
    transforms: [{ type: "rewrite-root-relative-links", file: "SKILL.md", origin: "https://data.example.org" }],
    files: {},
  };
  e.files = computeHashes(e, cache);
  assert.deepEqual(Object.keys(e.files), ["LICENSE", "web/public/SKILL.md"]);
  materializeImport(e, out, cache);
  const text = fs.readFileSync(path.join(out, "solo", "SKILL.md"), "utf8");
  assert.match(text, /\]\(https:\/\/data\.example\.org\/datasets\.md\)/);
  assert.match(text, /\]\(https:\/\/example\.com\/x\)/);
  assert.ok(!fs.existsSync(path.join(out, "solo", "other.txt")));
  // A transform naming a file outside the import would be reported but never applied.
  const stray = { ...e, skill: "solo", transforms: [{ ...e.transforms[0], file: "README.md" }] };
  assert.throws(() => materializeImport(stray, tmpdir(), cache), /transform file README.md is not among the imported files/);
});

test("refuses symlinks in imported content", () => {
  const repo = fixtureRepo({ LICENSE: MIT, "s/link/SKILL.md": skillMd("link") });
  fs.symlinkSync("/etc/hostname", path.join(repo.dir, "s", "link", "evil"));
  git(repo.dir, "add", "-A");
  git(repo.dir, "commit", "-q", "-m", "link");
  const commit = git(repo.dir, "rev-parse", "HEAD");
  const e = { skill: "link", source: { type: "git", url: repo.url, commit }, path: "s/link", license: { spdx: "MIT", file: "LICENSE" } };
  assert.throws(() => computeHashes(e, tmpdir()), /symlink/);
});

test("pin command writes hashes and --check detects drift", () => {
  const { entry, cache } = setup();
  const lockFile = path.join(tmpdir(), "imports.lock.json");
  fs.writeFileSync(lockFile, JSON.stringify({ lockfileVersion: 1, imports: [entry()] }));
  assert.deepEqual(pin({ lockFile, check: true, cache }), ["alpha"]);
  assert.deepEqual(loadLock(lockFile).imports[0].files, {}, "--check does not write");
  assert.deepEqual(pin({ lockFile, cache }), ["alpha"]);
  assert.deepEqual(pin({ lockFile, check: true, cache }), []);
});

test("repository lock is fully pinned", () => {
  const lock = loadLock(new URL("../imports.lock.json", import.meta.url).pathname);
  for (const e of lock.imports) {
    validateLockEntry(e);
    assert.match(e.source.url, /^https:\/\//);
  }
});
