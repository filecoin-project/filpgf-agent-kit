#!/usr/bin/env node
// Write the upstream skills pinned in imports.lock.json into the plugin, with
// their licenses, UPSTREAM.json provenance and THIRD_PARTY_NOTICES.md.
//
// Usage: node scripts/sync-skills.mjs [--check]
//
// --check writes nothing: it fails when the committed copies differ from what
// the pinned commits produce. Upstream files are read as git blobs, never run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLock, materializeImport } from "./lib/imports.mjs";
import { listFiles } from "./lib/skills.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN = "plugins/filpgf";

export function syncSkills({ root = ROOT, check = false, cache = path.join(ROOT, ".cache/imports") } = {}) {
  const lock = loadLock(path.join(root, "imports.lock.json"));
  const plugin = path.join(root, PLUGIN);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "filpgf-sync-"));
  const drift = [];
  try {
    const provenance = lock.imports.map((e) => materializeImport(e, scratch, cache));
    const expected = { "THIRD_PARTY_NOTICES.md": renderNotices(provenance) };
    for (const p of provenance) for (const f of listFiles(path.join(scratch, p.skill))) expected[`skills/${p.skill}/${f}`] = fs.readFileSync(path.join(scratch, p.skill, f));
    // Files of imported skills that exist in the plugin but not upstream count as drift too.
    const actual = ["THIRD_PARTY_NOTICES.md", ...provenance.flatMap((p) => (fs.existsSync(path.join(plugin, "skills", p.skill)) ? listFiles(path.join(plugin, "skills", p.skill)).map((f) => `skills/${p.skill}/${f}`) : []))];
    for (const f of new Set([...Object.keys(expected), ...actual])) {
      const file = path.join(plugin, f);
      const want = expected[f];
      if (want === undefined || !fs.existsSync(file) || !fs.readFileSync(file).equals(Buffer.from(want))) drift.push(f);
    }
    if (!check) {
      for (const p of provenance) {
        fs.rmSync(path.join(plugin, "skills", p.skill), { recursive: true, force: true });
        fs.cpSync(path.join(scratch, p.skill), path.join(plugin, "skills", p.skill), { recursive: true });
      }
      fs.writeFileSync(path.join(plugin, "THIRD_PARTY_NOTICES.md"), expected["THIRD_PARTY_NOTICES.md"]);
    }
    return drift;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function renderNotices(provenance) {
  const lines = ["# Third-party notices", "", "This plugin includes the following upstream skills, copied from pinned commits and verified against SHA-256 hashes in `imports.lock.json`.", ""];
  for (const p of provenance) {
    lines.push(`## ${p.skill}`, "", `- Source: ${p.sourceUrl}`, `- Commit: \`${p.commit}\``, `- License: ${p.license} (full text in \`skills/${p.skill}/${p.licenseFile}\`)`);
    if (p.licenseEvidence) lines.push(`- License evidence: ${p.licenseEvidence}`);
    for (const t of p.transforms) lines.push(`- Modified: ${t.type} in \`${t.file}\` (origin ${t.origin})`);
    lines.push("");
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  try {
    const drift = syncSkills({ check });
    if (check && drift.length) {
      console.error(`upstream skills differ from imports.lock.json (run npm run sync):\n- ${drift.join("\n- ")}`);
      process.exit(1);
    }
    console.log(drift.length ? `${check ? "would update" : "updated"} ${drift.length} files` : "upstream skills match imports.lock.json");
  } catch (err) {
    console.error(`sync failed: ${err.message}`);
    process.exit(1);
  }
}
