# FilPGF Agent Kit

FilPGF Agent Kit helps agents with Filecoin public goods funding (FilPGF). It picks the right skill, MCP server, or data source and says which source wins in a conflict.

It ships seven skills (four from upstream maintainers) and the OSO and Karma MCP servers. Every client installs it from the [`stable`](https://github.com/filecoin-project/filpgf-agent-kit/tree/stable) branch.

## Install

### Claude Code

> [!TIP]
> **Ask your agent:** Install the `filecoin-project/filpgf-agent-kit` plugin in Claude Code from its `stable` marketplace.

```sh
claude plugin marketplace add filecoin-project/filpgf-agent-kit#stable
claude plugin install filpgf-ecosystem@filpgf-ecosystem-marketplace
```

### Codex CLI and ChatGPT desktop

> [!TIP]
> **Ask your agent:** Install the `filecoin-project/filpgf-agent-kit` plugin in Codex from its `stable` marketplace.

```sh
codex plugin marketplace add filecoin-project/filpgf-agent-kit --ref stable
codex plugin add filpgf-ecosystem@filpgf-ecosystem-marketplace
```

ChatGPT desktop picks up the marketplace after a restart. Install the kit from its Plugins Directory.

### Pi

> [!TIP]
> **Ask your agent:** Install the `filecoin-project/filpgf-agent-kit` package in Pi from its `stable` branch.

```sh
pi install git:github.com/filecoin-project/filpgf-agent-kit@stable
```

### VS Code

> [!TIP]
> **Ask your agent:** Add the `filecoin-project/filpgf-agent-kit` `stable` marketplace to my VS Code settings.

Add `"filecoin-project/filpgf-agent-kit#stable"` to the `chat.plugins.marketplaces` setting, then install `filpgf-ecosystem` from the Extensions view.

### ChatGPT workspace

> [!TIP]
> **Ask your agent:** Help me import the `filecoin-project/filpgf-agent-kit` marketplace into my ChatGPT workspace.

Admins: **Admin console > Plugins > Add > Import marketplace**, source `https://github.com/filecoin-project/filpgf-agent-kit`, branch `stable`. See [OpenAI's guide](https://help.openai.com/en/articles/20001504).

### Claude chat and Cowork

> [!TIP]
> **Ask your agent:** Help me upload the latest `filecoin-project/filpgf-agent-kit` release ZIP to Claude.

Download `filpgf-ecosystem-<version>.zip` from the [latest release](https://github.com/filecoin-project/filpgf-agent-kit/releases/latest) and upload it without extracting in **Customize > Plugins > Add > Upload plugin**.

## Sign in to OSO and Karma

The plugin carries no keys. The first time you use OSO or Karma, sign in with OAuth from your client:

| Client | Sign in |
|---|---|
| Claude Code | `/mcp`, select `plugin:filpgf-ecosystem:oso` or `:karma`, then **Authenticate** |
| Codex | `codex mcp login oso` and `codex mcp login karma` |
| Pi | `/mcp login oso` and `/mcp login karma` |

OSO metrics also need your Artio organization to have access to the `filecoin.filpgf_public` dataset. See the [sign-in guide](skills/filpgf-ecosystem/references/credentials.md).

## Update

- Claude Code: `claude plugin marketplace update filpgf-ecosystem-marketplace && claude plugin update filpgf-ecosystem@filpgf-ecosystem-marketplace`
- Codex: `codex plugin marketplace upgrade filpgf-ecosystem-marketplace`
- Pi: `pi update --extensions`

## Try it

> Which sources should I use to check a FilPGF milestone, and which one wins if they disagree?

A good answer cites Karma for milestones and payouts, OSO for metrics, and Git for code.

Report problems in [GitHub issues](https://github.com/filecoin-project/filpgf-agent-kit/issues).

## Maintainers

Edit [`toolkit.json`](toolkit.json) for the source map and MCP servers, and `skills/` for instructions. [`sources.md`](skills/filpgf-ecosystem/references/sources.md) is a placeholder that the build fills from `toolkit.json`. Upstream skills are pinned in `imports.lock.json`.

```sh
npm test            # offline unit and fixture tests
npm run build       # dist/stable/ (the stable branch) and dist/packages/ (the plugin ZIP)
npm run validate
npm run smoke       # installs dist/stable/ with the local claude, codex and pi CLIs
```

To release, bump `version` in `toolkit.json` and `package.json`, merge to `main`, and push a `vX.Y.Z` tag. The release workflow tests and builds the tag, publishes the ZIP, and commits `dist/stable/` to the `stable` branch. A daily 05:17 UTC workflow updates the pinned upstream skills without releasing.

The kit is MIT-licensed. Upstream skills keep their licenses (see `THIRD_PARTY_NOTICES.md` in the plugin).
