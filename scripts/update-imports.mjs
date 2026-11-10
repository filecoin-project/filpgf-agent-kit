#!/usr/bin/env node
// Move upstream imports to the current commit of their tracked branch and
// re-record their hashes. Used by the daily update workflow.
//
// Usage: node scripts/update-imports.mjs [--lock imports.lock.json] [--message FILE]
//
// Each entry tracks `source.ref` (a branch) or, if omitted, the remote default
// branch. Entries that share a repository URL must track the same branch and
// always move to the same commit. Upstream files are only read as git blobs,
// never checked out or executed.
//
// All entries are resolved, hashed and test-materialized before anything is
// written; the lock is then replaced atomically, or not at all. An entry whose
// license text changed is an error, because license changes need a person.
// --message writes a commit message describing the changes (only when the lock changed).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeHashes, loadLock, materializeImport, resolveRef, validateLockEntry } from "./lib/imports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function updateImports({ lockFile, cache, resolve = resolveRef }) {
  const lock = loadLock(lockFile);
  for (const e of lock.imports) validateLockEntry(e);

  // One tracked branch, and therefore one commit, per repository.
  const refs = new Map();
  for (const e of lock.imports) {
    const ref = e.source.ref ?? null;
    if (refs.has(e.source.url) && refs.get(e.source.url) !== ref) throw new Error(`imports from ${e.source.url} track different refs (${refs.get(e.source.url)} and ${ref}); use one`);
    refs.set(e.source.url, ref);
  }
  const heads = new Map([...refs].map(([url, ref]) => [url, resolve(url, ref ?? undefined)]));

  const next = structuredClone(lock);
  const changes = [];
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "filpgf-update-"));
  try {
    for (const e of next.imports) {
      const commit = heads.get(e.source.url);
      const updated = { ...e, source: { ...e.source, commit } };
      updated.files = computeHashes(updated, cache);
      if (updated.files[e.license.file] !== e.files[e.license.file]) {
        throw new Error(`import ${e.skill}: license file ${e.license.file} changed at ${commit}; review the license and run \`npm run imports:pin\` by hand`);
      }
      // Run the build's checks (skill name, SKILL.md license, transforms) before accepting.
      materializeImport(updated, scratch, cache);
      const before = Object.keys(e.files);
      const after = Object.keys(updated.files);
      const change = {
        skill: e.skill,
        from: e.source.commit,
        to: commit,
        added: after.filter((f) => !before.includes(f)),
        removed: before.filter((f) => !after.includes(f)),
        modified: after.filter((f) => before.includes(f) && e.files[f] !== updated.files[f]),
      };
      if (change.from !== change.to || change.added.length || change.removed.length || change.modified.length) changes.push(change);
      Object.assign(e, updated);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  if (changes.length) {
    const tmp = `${lockFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
    fs.renameSync(tmp, lockFile);
  }
  return changes;
}

export function commitMessage(changes) {
  const lines = ["Update pinned upstream skill imports", ""];
  for (const c of changes) {
    lines.push(`- ${c.skill}: ${c.from.slice(0, 12)} -> ${c.to.slice(0, 12)}`);
    for (const [label, files] of [["added", c.added], ["removed", c.removed], ["modified", c.modified]]) if (files.length) lines.push(`  ${label}: ${files.join(", ")}`);
  }
  lines.push("", "Automated by .github/workflows/update-imports.yml after tests, build and validation passed.");
  return lines.join("\n") + "\n";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  try {
    const changes = updateImports({ lockFile: path.resolve(ROOT, get("--lock") ?? "imports.lock.json"), cache: path.resolve(ROOT, ".cache/imports") });
    if (!changes.length) console.log("imports are up to date with their tracked branches");
    else {
      process.stdout.write(commitMessage(changes));
      if (get("--message")) fs.writeFileSync(get("--message"), commitMessage(changes));
    }
  } catch (err) {
    console.error(`update failed (lock unchanged): ${err.message}`);
    process.exit(1);
  }
}
