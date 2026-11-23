import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as A from "../scripts/lib/adapters.mjs";
import { tmpdir } from "./helpers.mjs";

const m = {
  name: "filpgf-ecosystem",
  version: "1.2.3",
  description: "Demo plugin.",
  author: { name: "Demo" },
  license: "MIT",
  keywords: ["k"],
  interface: { displayName: "Demo", category: "Productivity", defaultPrompt: ["Try me"] },
  mcpServers: {
    open: { url: "https://open.example/mcp" },
    read: { url: "https://read.example/mcp", allowedTools: ["read_a", "read_b"] },
  },
};

test("shared .mcp.json has no credentials and carries the Codex tool allowlist", () => {
  assert.deepEqual(A.mcpJson(m).mcpServers, {
    open: { type: "http", url: "https://open.example/mcp" },
    read: { type: "http", url: "https://read.example/mcp", enabled_tools: ["read_a", "read_b"] },
  });
});

test("Claude and Codex manifests describe the same plugin folder", () => {
  assert.deepEqual(A.claudePlugin(m), { name: m.name, version: m.version, description: m.description, author: m.author, license: "MIT", keywords: ["k"] });
  const x = A.codexPlugin(m);
  assert.equal(x.skills, "./skills/");
  assert.equal(x.mcpServers, "./.mcp.json");
  assert.deepEqual(x.interface.defaultPrompt, ["Try me"]);
  const cm = A.claudeMarketplace(m);
  const xm = A.codexMarketplace(m);
  assert.equal(cm.name, "filpgf-ecosystem-marketplace");
  assert.equal(xm.name, cm.name);
  assert.deepEqual(cm.plugins.map((p) => [p.name, p.source, p.version]), [[m.name, "./plugins/filpgf-ecosystem", "1.2.3"]]);
  assert.deepEqual(xm.plugins[0].source, { source: "local", path: "./plugins/filpgf-ecosystem" });
  assert.equal(xm.plugins[0].policy.authentication, "ON_INSTALL");
});

test("Pi package at the marketplace root loads the plugin's skills and the MCP extension", () => {
  const p = A.piPackageJson(m);
  assert.ok(p.keywords.includes("pi-package"));
  assert.deepEqual(p.pi, { skills: ["./plugins/filpgf-ecosystem/skills"], extensions: ["./extensions"] });
  assert.equal(p.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.equal(p.dependencies, undefined);
});

test("Pi extension registers every server from .mcp.json without credentials", async () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  A.write(path.join(dir, "plugins/filpgf-ecosystem/.mcp.json"), A.mcpJson(m));
  fs.mkdirSync(path.join(dir, "extensions"));
  const file = path.join(dir, "extensions/filpgf-mcp.ts");
  fs.copyFileSync(new URL("../adapters/pi/extension.ts", import.meta.url), file);
  const mod = await import(pathToFileURL(file).href);
  const calls = [];
  mod.default({ registerMcpServer: (n, c) => calls.push([n, c]) });
  assert.deepEqual(calls, [
    ["open", { url: "https://open.example/mcp" }],
    ["read", { url: "https://read.example/mcp", exposure: "hidden", toolExposure: { read_a: "codemode", read_b: "codemode" } }],
  ]);
  // A host that throws on duplicate registration must not break loading.
  assert.doesNotThrow(() => mod.default({ registerMcpServer: () => { throw new Error("taken"); } }));
});
