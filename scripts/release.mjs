#!/usr/bin/env node
// Release gates used by .github/workflows/release.yml.
//
//   node scripts/release.mjs verify-tag vX.Y.Z          toolkit.json and package.json must match the tag
//   node scripts/release.mjs decide vX.Y.Z [CURRENT]    prints publish=true|false; CURRENT is the version on stable ("" if none)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function tagVersion(tag) {
  const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag ?? "");
  if (!m) throw new Error(`tag ${tag} is not v<semver>`);
  return m[1];
}

export function verifyTag(tag, root = ROOT) {
  const v = tagVersion(tag);
  const errors = [];
  for (const f of ["toolkit.json", "package.json"]) {
    const got = JSON.parse(fs.readFileSync(path.join(root, f), "utf8")).version;
    if (got !== v) errors.push(`${f} version ${got} does not match tag ${tag}`);
  }
  return errors;
}

const release = (v) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);

/** Whether `tag` may replace the stable branch at version `current`. Prereleases and older versions never do. */
export function shouldPublish(tag, current) {
  const next = release(tagVersion(tag));
  if (!next) return { publish: false, reason: `${tag} is a prerelease; stable is not updated` };
  if (!current) return { publish: true, reason: "stable branch does not exist yet" };
  const cur = release(current);
  if (!cur) throw new Error(`stable branch has unrecognised version ${current}`);
  for (let i = 0; i < 3; i++) {
    if (next[i] > cur[i]) return { publish: true, reason: `${tag} is newer than stable ${current}` };
    if (next[i] < cur[i]) break;
  }
  return { publish: false, reason: `${tag} is not newer than stable ${current}; stable is left unchanged` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, tag, current] = process.argv.slice(2);
  try {
    if (cmd === "verify-tag") {
      const errors = verifyTag(tag);
      for (const e of errors) console.error(`error: ${e}`);
      if (errors.length) process.exit(1);
      console.log(`versions match ${tag}`);
    } else if (cmd === "decide") {
      const d = shouldPublish(tag, current);
      console.error(d.reason);
      console.log(`publish=${d.publish}`);
    } else throw new Error("usage: release.mjs verify-tag|decide <tag> [current]");
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
