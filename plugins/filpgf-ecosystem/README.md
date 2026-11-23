# filpgf-ecosystem plugin

FilPGF Agent Kit routes Filecoin public goods funding (FilPGF) questions to the right source and skill, and says which source wins when they disagree. It bundles seven skills and the Artio and Karma MCP servers. Install instructions are in the [repository README](../../README.md).

| File | Contents | Read by |
|---|---|---|
| [`plugin.json`](plugin.json) | The portable [Agent Plugins](https://agent-plugins.org/specification) manifest. `extensions.com.openai` holds the Codex and ChatGPT listing. | Codex, ChatGPT, VS Code and other Agent Plugins clients |
| [`mcp.json`](mcp.json) | The `artio` and `karma` MCP servers | Agent Plugins clients, and Pi through [`extensions/filpgf-mcp.ts`](../../extensions/filpgf-mcp.ts) |
| [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) | The same metadata and MCP servers in Claude Code's format | Claude Code |
| [`skills/`](skills) | The skills. [`filpgf-ecosystem`](skills/filpgf-ecosystem/SKILL.md) is the router; its [`references/sources.md`](skills/filpgf-ecosystem/references/sources.md) is the source map. | Every client |
| [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) | Licenses of the skills copied from upstream | People |

The MCP servers carry no credentials. Sign in with OAuth the first time you use one: `/mcp` in Claude Code, `codex mcp login <server>` in Codex, `/mcp login <server>` in Pi. See [`references/credentials.md`](skills/filpgf-ecosystem/references/credentials.md).

`fdp`, `filoscope`, `filpgf-read-karma` and `filpgf-review-work` are copies of their maintainers' skills at the commits pinned in [`imports.lock.json`](../../imports.lock.json), each with an `UPSTREAM.json`. Don't edit them here: report problems upstream, or run `npm run imports:update` to move to the latest upstream version.
