import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as A from "../scripts/lib/adapters.mjs";
import { tmpdir } from "./helpers.mjs";

const m = {
  name: "demo",
  version: "1.2.3",
  description: "Demo",
  author: { name: "Team" },
  license: "MIT",
  interface: { displayName: "Demo", category: "Productivity" },
  mcpServers: {
    open: { url: "https://open.example/mcp" },
    tok: { url: "https://tok.example/mcp", auth: { scheme: "bearer", env: "TOK_TOKEN" }, allowedTools: ["read_a", "read_b"] },
    key: { url: "https://key.example/mcp", auth: { scheme: "header", header: "x-api-key", env: "KEY_API_KEY" } },
  },
};

test("portable mcp.json uses streamable-http and never carries auth", () => {
  const p = A.portableMcp(m);
  assert.equal(p.$schema, A.PORTABLE_MCP_SCHEMA);
  for (const s of Object.values(p.mcpServers)) assert.deepEqual(Object.keys(s), ["type", "url"]);
  assert.equal(p.mcpServers.tok.type, "streamable-http");
});

test("portable plugin.json keeps only spec fields and namespaces OpenAI metadata", () => {
  const p = A.portablePlugin(m);
  assert.equal(p.$schema, A.PORTABLE_PLUGIN_SCHEMA);
  assert.deepEqual(p.extensions["com.openai"].interface, m.interface);
  assert.equal(p.interface, undefined);
});

test("Claude maps env auth to ${VAR} headers", () => {
  const c = A.claudeMcp(m).mcpServers;
  assert.deepEqual(c.open, { type: "http", url: "https://open.example/mcp" });
  assert.deepEqual(c.tok.headers, { Authorization: "Bearer ${TOK_TOKEN}" });
  assert.deepEqual(c.key.headers, { "x-api-key": "${KEY_API_KEY}" });
  const mk = A.claudeMarketplace(m);
  assert.equal(mk.plugins[0].source, "./plugins/demo");
  assert.ok(mk.owner.name && mk.description);
});

test("Codex maps env auth to bearer_token_env_var and env_http_headers", () => {
  const c = A.codexMcp(m).mcpServers;
  assert.equal(c.tok.bearer_token_env_var, "TOK_TOKEN");
  assert.deepEqual(c.key.env_http_headers, { "x-api-key": "KEY_API_KEY" });
  for (const s of Object.values(c)) assert.equal(s.headers, undefined);
  assert.deepEqual(c.tok.enabled_tools, ["read_a", "read_b"]);
  assert.equal(c.open.enabled_tools, undefined);
  const p = A.codexPlugin(m);
  assert.equal(p.skills, "./skills/");
  assert.equal(p.mcpServers, "./.mcp.json");
  const mk = A.codexMarketplace(m);
  assert.deepEqual(mk.plugins[0].source, { source: "local", path: "./plugins/demo" });
  assert.equal(mk.plugins[0].policy.installation, "AVAILABLE");
});

test("Pi extension registers only servers whose credentials are present", async () => {
  const template = fs.readFileSync(new URL("../adapters/pi/extension.ts", import.meta.url), "utf8");
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  const file = path.join(dir, "ext.ts");
  fs.writeFileSync(file, A.piExtensionSource(template, m));
  const mod = await import(pathToFileURL(file).href);
  const run = (env) => {
    const saved = { TOK_TOKEN: process.env.TOK_TOKEN, KEY_API_KEY: process.env.KEY_API_KEY };
    delete process.env.TOK_TOKEN;
    delete process.env.KEY_API_KEY;
    Object.assign(process.env, env);
    const calls = [];
    try {
      mod.default({ registerMcpServer: (n, c) => calls.push([n, c]) });
    } finally {
      for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
    }
    return calls;
  };
  assert.deepEqual(run({}).map(([n]) => n), ["open"]);
  const all = run({ TOK_TOKEN: "t", KEY_API_KEY: "k" });
  assert.deepEqual(all.map(([n]) => n), ["open", "tok", "key"]);
  assert.deepEqual(all[1][1].headers, { Authorization: "Bearer ${TOK_TOKEN}" }, "secret value is never inlined");
  assert.equal(all[1][1].exposure, "hidden", "Pi is configured to hide tools outside the name allowlist");
  assert.deepEqual(all[1][1].toolExposure, { read_a: "codemode", read_b: "codemode" });
  assert.equal(all[0][1].exposure, undefined);
  // A host that throws on duplicate registration must not break loading.
  assert.doesNotThrow(() => mod.default({ registerMcpServer: () => { throw new Error("taken"); } }));
});

test("Pi package omits the extension when no MCP server is built", () => {
  assert.equal(A.piPackageJson({ ...m, mcpServers: {} }).pi.extensions, undefined);
});

test("Pi package declares resources and a host peer dependency", () => {
  const p = A.piPackageJson(m);
  assert.ok(p.keywords.includes("pi-package"));
  assert.deepEqual(p.pi, { skills: ["./skills"], extensions: ["./extensions"] });
  assert.equal(p.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.equal(p.dependencies, undefined);
});
