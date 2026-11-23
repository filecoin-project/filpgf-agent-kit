import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { check, setVersion, PLUGIN } from "../scripts/check.mjs";
import { tmpdir } from "./helpers.mjs";

const repo = new URL("..", import.meta.url).pathname;

/** A copy of the files clients install, so tests can tamper with them. */
function copy() {
  const root = tmpdir("filpgf-check-");
  for (const f of [".claude-plugin", ".agents", "plugins", "extensions", "package.json", "imports.lock.json"]) fs.cpSync(path.join(repo, f), path.join(root, f), { recursive: true });
  return root;
}
const edit = (root, f, fn) => {
  const file = path.join(root, f);
  fs.writeFileSync(file, JSON.stringify(fn(JSON.parse(fs.readFileSync(file, "utf8"))), null, 2));
};

test("the repository's plugin, manifests and marketplaces agree", () => {
  assert.deepEqual(check(repo), []);
});

test("OSO is now Artio: one artio and one karma server, OAuth only", () => {
  const mcp = JSON.parse(fs.readFileSync(path.join(repo, PLUGIN, "mcp.json"), "utf8")).mcpServers;
  assert.deepEqual(mcp, { artio: { type: "streamable-http", url: "https://mcp.artio.so/mcp" }, karma: { type: "streamable-http", url: "https://api.karmahq.org/mcp" } });
});

test("check catches drift between copies and unsafe MCP servers", () => {
  const cases = [
    [(r) => edit(r, `${PLUGIN}/.claude-plugin/plugin.json`, (j) => ({ ...j, version: "9.9.9" })), /\.claude-plugin\/plugin\.json: version differs/],
    [(r) => edit(r, "package.json", (j) => ({ ...j, version: "9.9.9" })), /differs from package\.json 9\.9\.9/],
    [(r) => edit(r, `${PLUGIN}/mcp.json`, (j) => ((j.mcpServers.artio.headers = { Authorization: "Bearer x" }), j)), /artio must have only type/],
    [(r) => edit(r, `${PLUGIN}/mcp.json`, (j) => ((j.mcpServers.karma.url = "http://api.karmahq.org/mcp"), j)), /karma url must be plain https/],
    [(r) => edit(r, `${PLUGIN}/mcp.json`, (j) => ((j.mcpServers.extra = { type: "streamable-http", url: "https://x.example/mcp" }), j)), /mcpServers differs from mcp\.json/],
    [(r) => edit(r, `${PLUGIN}/plugin.json`, (j) => ({ ...j, skills: "./skills" })), /field skills is not allowed/],
    [(r) => edit(r, ".claude-plugin/marketplace.json", (j) => ((j.plugins[0].skills = j.plugins[0].skills.slice(1)), j)), /skills must list/],
    [(r) => edit(r, ".agents/plugins/marketplace.json", (j) => ((j.plugins[0].source.path = "./elsewhere"), j)), /must list filpgf-ecosystem once/],
    [(r) => fs.appendFileSync(path.join(r, PLUGIN, "skills/filpgf-ecosystem/SKILL.md"), "\n[gone](references/missing.md)\n"), /broken or escaping link references\/missing\.md/],
    [(r) => fs.cpSync(path.join(r, PLUGIN, "skills/filpgf-plugin-feedback"), path.join(r, PLUGIN, "skills/orphan-skill"), { recursive: true }), /orphan-skill/],
    [(r) => edit(r, "imports.lock.json", (j) => ((j.imports[0].source.commit = "0".repeat(40)), j)), /not at the pinned commit/],
  ];
  for (const [tamper, re] of cases) {
    const root = copy();
    tamper(root);
    assert.match(check(root).join("\n"), re);
  }
});

test("a skill added without a router row, or a router row without a source section, fails", () => {
  const root = copy();
  const router = path.join(root, PLUGIN, "skills/filpgf-ecosystem/SKILL.md");
  fs.writeFileSync(router, fs.readFileSync(router, "utf8").replace("| `fdp` | `fdp` |", "| `fdp-new` | `fdp` |"));
  assert.match(check(root).join("\n"), /source fdp-new has no section in references\/sources\.md/);
});

test("--set-version copies package.json's version into both manifests", () => {
  const root = copy();
  edit(root, "package.json", (j) => ({ ...j, version: "1.2.3" }));
  assert.equal(setVersion(root), "1.2.3");
  assert.deepEqual(check(root), []);
});

test("Pi extension registers every server from mcp.json, without credentials", async () => {
  const root = copy();
  fs.writeFileSync(path.join(root, "extensions/package.json"), '{"type":"module"}');
  const mod = await import(pathToFileURL(path.join(root, "extensions/filpgf-mcp.ts")).href);
  const calls = [];
  mod.default({ registerMcpServer: (n, c) => calls.push([n, c]) });
  assert.deepEqual(calls, [
    ["artio", { url: "https://mcp.artio.so/mcp" }],
    ["karma", { url: "https://api.karmahq.org/mcp" }],
  ]);
  assert.doesNotThrow(() => mod.default({ registerMcpServer: () => { throw new Error("taken"); } }), "a name owned by another extension does not break loading");
});
