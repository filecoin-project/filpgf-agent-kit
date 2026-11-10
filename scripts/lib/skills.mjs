// Agent Skills (https://agentskills.io/specification) parsing and validation.
import fs from "node:fs";
import path from "node:path";

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Parse the YAML frontmatter subset used by SKILL.md files: `key: value`
 * scalars (optionally quoted) and one level of nested maps (e.g. metadata).
 */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) throw new Error("missing YAML frontmatter delimited by ---");
  const data = {};
  let parent = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
    const nested = /^\s+/.test(raw);
    const kv = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
    if (!kv) throw new Error(`unsupported frontmatter line: ${raw}`);
    const [, key, rawValue] = kv;
    const value = unquote(rawValue.trim());
    if (nested) {
      if (!parent) throw new Error(`indented key without parent: ${key}`);
      data[parent][key] = value;
    } else if (rawValue.trim() === "") {
      data[key] = {};
      parent = key;
    } else {
      data[key] = value;
      parent = null;
    }
  }
  return { data, body: text.slice(m[0].length) };
}

function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

/** Validate a skill directory. Returns { name, description, frontmatter }. Throws on errors. */
export function validateSkillDir(dir, { expectedName } = {}) {
  const file = path.join(dir, "SKILL.md");
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`${dir}: SKILL.md not found`);
  const { data } = parseFrontmatter(fs.readFileSync(file, "utf8"));
  const errors = [];
  const name = data.name;
  if (typeof name !== "string" || !NAME_RE.test(name) || name.length > 64) errors.push(`invalid name ${JSON.stringify(name)}`);
  const dirName = path.basename(dir);
  if (name !== dirName) errors.push(`name ${JSON.stringify(name)} does not match directory ${JSON.stringify(dirName)}`);
  if (expectedName && name !== expectedName) errors.push(`name ${JSON.stringify(name)} does not match expected ${JSON.stringify(expectedName)}`);
  if (typeof data.description !== "string" || !data.description.trim()) errors.push("description is required");
  else if (data.description.length > 1024) errors.push("description exceeds 1024 characters");
  if (data.compatibility !== undefined && (typeof data.compatibility !== "string" || data.compatibility.length > 500)) errors.push("compatibility must be a string of at most 500 characters");
  if (data.metadata !== undefined && (typeof data.metadata !== "object" || data.metadata === null)) errors.push("metadata must be a map");
  if (errors.length) throw new Error(`${file}: ${errors.join("; ")}`);
  return { name, description: data.description, frontmatter: data };
}

/** List immediate child skill directories of `root`. */
export function listSkillDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "SKILL.md")))
    .map((d) => path.join(root, d.name))
    .sort();
}
