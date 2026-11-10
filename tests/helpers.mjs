import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const created = [];
process.on("exit", () => {
  for (const d of created) fs.rmSync(d, { recursive: true, force: true });
});

export function tmpdir(prefix = "filpgf-test-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(d);
  return d;
}

const gitEnv = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: gitEnv, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

/** Create a local git repository with `files` (path -> content) and return { dir, url, commit }. */
export function fixtureRepo(files, dir = tmpdir("filpgf-upstream-")) {
  if (!fs.existsSync(path.join(dir, ".git"))) {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "uploadpack.allowAnySHA1InWant", "true");
  }
  for (const [p, content] of Object.entries(files)) {
    const f = path.join(dir, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (content === null) fs.rmSync(f);
    else fs.writeFileSync(f, content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "fixture", "--allow-empty");
  return { dir, url: `file://${dir}`, commit: git(dir, "rev-parse", "HEAD") };
}

export const MIT = "MIT License\n\nCopyright (c) 2026 Fixture\n";

export const skillMd = (name, extra = "") => `---\nname: ${name}\ndescription: Fixture skill ${name}. Use in tests.\n${extra}---\n\n# ${name}\n\nSee [catalog](/datasets.md) and [ext](https://example.com/x).\n`;
