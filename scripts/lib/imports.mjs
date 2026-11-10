// Reproducible build-time imports of upstream skills.
//
// Each lock entry pins a git repository to a full commit SHA, names the skill
// directory inside it, and records the SHA-256 of every imported file. The
// build fetches exactly that commit, refuses any file set or content that
// differs from the lock, then applies declared transforms and writes
// provenance next to the skill.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { NAME_RE, parseFrontmatter } from "./skills.mjs";

const SHA_RE = /^[0-9a-f]{40}$/;
const SPDX_RE = /^[A-Za-z0-9.+-]+$/;
// Branch to track for updates; the build always uses source.commit.
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]+(?<![/.])$/;

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// Isolate git from user/system config (credential helpers, url rewrites, hooks).
const gitEnv = () => ({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
});

function git(args, opts = {}) {
  return execFileSync("git", args, { env: gitEnv(), stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20, ...opts });
}

function safeRel(p, what) {
  if (typeof p !== "string") throw new Error(`${what} must be a string`);
  if (p === "") return p;
  const norm = path.posix.normalize(p);
  if (path.posix.isAbsolute(p) || norm.startsWith("..") || norm !== p.replace(/\/$/, "")) throw new Error(`${what} must be a normalized relative path: ${p}`);
  return norm;
}

/** Validate the structure of a lock entry (no network). */
export function validateLockEntry(e, { requireFiles = true } = {}) {
  const id = e?.skill;
  const fail = (msg) => {
    throw new Error(`import ${JSON.stringify(id)}: ${msg}`);
  };
  if (typeof id !== "string" || !NAME_RE.test(id)) fail("skill must be a valid skill name");
  if (e.source?.type !== "git") fail("source.type must be \"git\"");
  if (typeof e.source.url !== "string" || !/^(https:\/\/|file:\/\/)/.test(e.source.url)) fail("source.url must be an https:// (or file:// for fixtures) git URL");
  if (!SHA_RE.test(e.source.commit ?? "")) fail("source.commit must be a full 40-character lowercase commit SHA (branches and tags are not immutable)");
  if (e.source.ref !== undefined && !BRANCH_RE.test(e.source.ref)) fail("source.ref must be a branch name to track (omit it to track the default branch)");
  safeRel(e.path ?? "", "path");
  if (e.include !== undefined && (!Array.isArray(e.include) || e.include.length === 0)) fail("include must be a non-empty array when present");
  for (const inc of e.include ?? []) safeRel(inc, "include entry");
  if (!e.license || !SPDX_RE.test(e.license.spdx ?? "")) fail("license.spdx is required (SPDX identifier)");
  if (typeof e.license.file !== "string" || !e.license.file) fail("license.file (repository path of the license text) is required");
  safeRel(e.license.file, "license.file");
  for (const t of e.transforms ?? []) {
    if (t.type !== "rewrite-root-relative-links") fail(`unknown transform ${t.type}`);
    if (!/^https:\/\/[^/]+$/.test(t.origin ?? "")) fail("rewrite-root-relative-links needs origin like https://host");
    safeRel(t.file ?? "", "transform file");
  }
  if (requireFiles) {
    if (!e.files || typeof e.files !== "object" || !Object.keys(e.files).length) fail("files is empty; run `npm run imports:pin` to record hashes");
    for (const [f, h] of Object.entries(e.files)) {
      safeRel(f, "files key");
      if (!/^[0-9a-f]{64}$/.test(h)) fail(`files[${f}] must be a sha256 hex digest`);
    }
  }
  return e;
}

/**
 * Resolve a tracked branch (or the remote default branch when `ref` is undefined)
 * to a full commit SHA with `git ls-remote`. Nothing is fetched or executed.
 */
export function resolveRef(url, ref) {
  const pattern = ref === undefined ? "HEAD" : `refs/heads/${ref}`;
  let out;
  try {
    out = git(["ls-remote", "--exit-code", url, pattern]).toString();
  } catch (err) {
    throw new Error(`cannot resolve ${pattern} at ${url}: ${err.stderr?.toString().trim() || err.message}`);
  }
  const line = out.split("\n").find((l) => l.endsWith(`\t${pattern}`));
  const sha = line?.split("\t")[0];
  if (!SHA_RE.test(sha ?? "")) throw new Error(`cannot resolve ${pattern} at ${url}: unexpected ls-remote output`);
  return sha;
}

/** Fetch a single pinned commit into a cache directory (bare repo). Returns git dir. */
export function fetchCommit(source, cacheRoot) {
  const key = sha256(`${source.url}\n${source.commit}`).slice(0, 16);
  const gitDir = path.join(cacheRoot, `${key}.git`);
  const has = () => {
    try {
      git(["--git-dir", gitDir, "cat-file", "-e", `${source.commit}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };
  if (fs.existsSync(gitDir) && has()) return gitDir;
  fs.mkdirSync(cacheRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(cacheRoot, "tmp-"));
  try {
    git(["init", "-q", "--bare", tmp]);
    git(["--git-dir", tmp, "fetch", "-q", "--depth", "1", "--no-tags", source.url, source.commit]);
    const got = git(["--git-dir", tmp, "rev-parse", "FETCH_HEAD"]).toString().trim();
    if (got !== source.commit) throw new Error(`fetched ${got}, expected ${source.commit}`);
    fs.rmSync(gitDir, { recursive: true, force: true });
    fs.renameSync(tmp, gitDir);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error(`cannot fetch ${source.url}@${source.commit}: ${err.stderr?.toString().trim() || err.message}`);
  }
  return gitDir;
}

/** Return Map(repoPath -> Buffer) of the files selected by a lock entry, plus the license text. */
export function readSelectedFiles(entry, gitDir) {
  const base = entry.path ? `${entry.path.replace(/\/$/, "")}/` : "";
  const listing = git(["--git-dir", gitDir, "ls-tree", "-r", "-z", "--full-tree", entry.source.commit]).toString();
  const all = new Map(); // path -> {mode, oid}
  for (const rec of listing.split("\0").filter(Boolean)) {
    const [meta, p] = rec.split("\t");
    const [mode, type, oid] = meta.split(" ");
    if (type === "blob") all.set(p, { mode, oid });
  }
  let wanted;
  if (entry.include) wanted = entry.include.map((i) => base + i);
  else wanted = [...all.keys()].filter((p) => p.startsWith(base));
  const out = new Map();
  for (const p of wanted.sort()) {
    const meta = all.get(p);
    if (!meta) throw new Error(`import ${entry.skill}: ${p} not found at ${entry.source.commit}`);
    if (meta.mode === "120000") throw new Error(`import ${entry.skill}: ${p} is a symlink; refusing to import`);
    out.set(p, git(["--git-dir", gitDir, "cat-file", "blob", meta.oid]));
  }
  if (!out.size) throw new Error(`import ${entry.skill}: no files under ${entry.path || "/"}`);
  const lic = all.get(entry.license.file);
  if (!lic) throw new Error(`import ${entry.skill}: license file ${entry.license.file} not found at ${entry.source.commit}`);
  const license = git(["--git-dir", gitDir, "cat-file", "blob", lic.oid]);
  return { files: out, license };
}

/** Compute the `files` map for a lock entry (used by the pin command). */
export function computeHashes(entry, cacheRoot) {
  validateLockEntry(entry, { requireFiles: false });
  const { files, license } = readSelectedFiles(entry, fetchCommit(entry.source, cacheRoot));
  const hashes = {};
  for (const [p, buf] of files) hashes[p] = sha256(buf);
  hashes[entry.license.file] = sha256(license);
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}

function applyTransforms(entry, rel, buf) {
  let text = null;
  for (const t of entry.transforms ?? []) {
    if (t.file !== rel) continue;
    text ??= buf.toString("utf8");
    // Markdown links and images whose target starts with a single "/".
    text = text.replace(/\]\(\/(?!\/)/g, `](${t.origin}/`);
  }
  return text === null ? buf : Buffer.from(text, "utf8");
}

/**
 * Materialize one verified import into `destSkillsDir/<skill>/`.
 * Returns a provenance record.
 */
export function materializeImport(entry, destSkillsDir, cacheRoot) {
  validateLockEntry(entry);
  const { files, license } = readSelectedFiles(entry, fetchCommit(entry.source, cacheRoot));
  const actual = new Map([...files].map(([p, b]) => [p, sha256(b)]));
  actual.set(entry.license.file, sha256(license));
  const expected = new Map(Object.entries(entry.files));
  const problems = [];
  for (const [p, h] of expected) {
    if (!actual.has(p)) problems.push(`missing ${p}`);
    else if (actual.get(p) !== h) problems.push(`sha256 mismatch for ${p}: lock ${h}, got ${actual.get(p)}`);
  }
  for (const p of actual.keys()) if (!expected.has(p)) problems.push(`unexpected file ${p} (not in lock)`);
  if (problems.length) throw new Error(`import ${entry.skill}: integrity check failed: ${problems.join("; ")}`);

  const base = entry.path ? `${entry.path.replace(/\/$/, "")}/` : "";
  const dest = path.join(destSkillsDir, entry.skill);
  if (fs.existsSync(dest)) throw new Error(`import ${entry.skill}: destination already exists (skill name collision)`);
  // A transform that matches no file would still be reported in UPSTREAM.json and the notices.
  for (const t of entry.transforms ?? []) if (!files.has(base + t.file)) throw new Error(`import ${entry.skill}: transform file ${t.file} is not among the imported files`);
  for (const [p, buf] of files) {
    const rel = p.slice(base.length);
    const target = path.join(dest, ...rel.split("/"));
    if (!target.startsWith(dest + path.sep)) throw new Error(`import ${entry.skill}: path escapes skill dir: ${p}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, applyTransforms(entry, rel, buf));
  }
  const skillMd = path.join(dest, "SKILL.md");
  if (!fs.existsSync(skillMd)) throw new Error(`import ${entry.skill}: SKILL.md not among imported files`);
  const fm = parseFrontmatter(fs.readFileSync(skillMd, "utf8")).data;
  if (fm.name !== entry.skill) throw new Error(`import ${entry.skill}: upstream SKILL.md name is ${JSON.stringify(fm.name)}`);
  if (typeof fm.license === "string" && fm.license !== entry.license.spdx && !fm.license.includes(entry.license.spdx)) {
    throw new Error(`import ${entry.skill}: SKILL.md license ${JSON.stringify(fm.license)} disagrees with lock ${entry.license.spdx}`);
  }
  const licenseName = fs.existsSync(path.join(dest, "LICENSE")) ? "UPSTREAM-LICENSE" : "LICENSE";
  fs.writeFileSync(path.join(dest, licenseName), license);
  const provenance = {
    skill: entry.skill,
    repository: entry.source.url,
    commit: entry.source.commit,
    path: entry.path || ".",
    sourceUrl: entry.source.url.startsWith("https://github.com/")
      ? `${entry.source.url}/tree/${entry.source.commit}/${entry.path ?? ""}`.replace(/\/$/, "")
      : entry.source.url,
    license: entry.license.spdx,
    licenseFile: licenseName,
    licenseEvidence: entry.license.evidence ?? null,
    files: entry.files,
    transforms: entry.transforms ?? [],
  };
  fs.writeFileSync(path.join(dest, "UPSTREAM.json"), JSON.stringify(provenance, null, 2) + "\n");
  return provenance;
}

export function loadLock(file) {
  const lock = JSON.parse(fs.readFileSync(file, "utf8"));
  if (lock.lockfileVersion !== 1 || !Array.isArray(lock.imports)) throw new Error(`${file}: unsupported lockfile`);
  const seen = new Set();
  for (const e of lock.imports) {
    if (seen.has(e.skill)) throw new Error(`${file}: duplicate import ${e.skill}`);
    seen.add(e.skill);
  }
  return lock;
}
