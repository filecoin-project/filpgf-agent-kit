import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const update = read(".github/workflows/update-imports.yml");
const ci = read(".github/workflows/ci.yml");

test("daily update runs on a schedule and on demand, and the docs give the same time", () => {
  assert.match(update, /cron: "17 5 \* \* \*"/);
  assert.match(update, /^  workflow_dispatch:/m);
  assert.match(read("README.md"), /05:17 UTC/);
});

test("only the commit job can write, and it commits only the lock", () => {
  assert.equal(update.match(/contents: write/g).length, 1);
  assert.match(update, /^permissions: \{\}$/m);
  const commitJob = update.slice(update.indexOf("\n  commit:"), update.indexOf("\n  ci:"));
  assert.match(commitJob, /contents: write/);
  assert.match(commitJob, /commit -q -F "\$RUNNER_TEMP\/update\/commit-message.txt" -- imports.lock.json/);
  assert.match(commitJob, /test "\$\(git status --porcelain\)" = " M imports.lock.json"/);
  assert.doesNotMatch(commitJob, /npm |node scripts/, "the write job runs no repository code");
});

test("the pushed commit is built through the reusable CI workflow", () => {
  assert.match(update, /uses: \.\/\.github\/workflows\/ci\.yml\n\s+with:\n\s+ref: \$\{\{ needs\.commit\.outputs\.sha \}\}/);
  assert.match(ci, /workflow_call:/);
  assert.match(ci, /ref: \$\{\{ inputs\.ref \}\}/);
});

test("third-party actions are pinned to full commit SHAs", () => {
  for (const text of [update, ci]) {
    for (const [, ref] of text.matchAll(/uses: (?!\.\/)\S+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
  }
});
