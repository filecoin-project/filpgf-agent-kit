#!/usr/bin/env node
// Record SHA-256 hashes for upstream imports at their pinned commits.
//
// Usage: node scripts/pin-imports.mjs [--lock imports.lock.json] [--skill NAME] [--check]
//
// Review the upstream content before pinning; the hashes certify what you reviewed.
// --check verifies that the recorded hashes still match (exit 1 on drift).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeHashes, loadLock } from "./lib/imports.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function pin({ lockFile, skill = null, check = false, cache }) {
  const lock = loadLock(lockFile);
  const changes = [];
  for (const entry of lock.imports) {
    if (skill && entry.skill !== skill) continue;
    const hashes = computeHashes(entry, cache);
    if (JSON.stringify(hashes) !== JSON.stringify(entry.files)) {
      changes.push(entry.skill);
      entry.files = hashes;
    }
  }
  if (skill && !lock.imports.some((e) => e.skill === skill)) throw new Error(`no import named ${skill}`);
  if (!check && changes.length) fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
  return changes;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const get = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const check = args.includes("--check");
  try {
    const changes = pin({ lockFile: path.resolve(ROOT, get("--lock") ?? "imports.lock.json"), skill: get("--skill") ?? null, check, cache: path.resolve(ROOT, ".cache/imports") });
    if (check && changes.length) {
      console.error(`hash drift: ${changes.join(", ")}`);
      process.exit(1);
    }
    console.log(changes.length ? `${check ? "would update" : "updated"}: ${changes.join(", ")}` : "lock is up to date");
  } catch (err) {
    console.error(`pin failed: ${err.message}`);
    process.exit(1);
  }
}
