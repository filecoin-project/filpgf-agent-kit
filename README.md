# FilPGF Agent Kit

FilPGF Agent Kit helps agents with Filecoin public goods funding (FilPGF). It picks the right skill, MCP server, or data source and says which source wins in a conflict.

It ships seven skills (four from upstream maintainers) and the Artio and Karma MCP servers. This repository is the marketplace: every client installs the plugin straight from it.

## Install

### Claude Code

> [!TIP]
> **Ask your agent:** Install the `filecoin-project/filpgf-agent-kit` plugin in Claude Code.

```sh
claude plugin marketplace add filecoin-project/filpgf-agent-kit
claude plugin install filpgf-ecosystem@filpgf-ecosystem-marketplace
```

### Codex CLI and ChatGPT desktop

> [!TIP]
> **Ask your agent:** Install the `filecoin-project/filpgf-agent-kit` plugin in Codex.

```sh
codex plugin marketplace add filecoin-project/filpgf-agent-kit
codex plugin add filpgf-ecosystem@filpgf-ecosystem-marketplace
```

ChatGPT desktop picks up the marketplace after a restart. Install the kit from its Plugins Directory.

### Pi

> [!TIP]
> **Ask your agent:** Install the `filecoin-project/filpgf-agent-kit` package in Pi.

```sh
pi install git:github.com/filecoin-project/filpgf-agent-kit
```

### VS Code

> [!TIP]
> **Ask your agent:** Add the `filecoin-project/filpgf-agent-kit` marketplace to my VS Code settings.

Add `"filecoin-project/filpgf-agent-kit"` to the `chat.plugins.marketplaces` setting, then install `filpgf-ecosystem` from the Extensions view.

### ChatGPT workspace

> [!TIP]
> **Ask your agent:** Help me import the `filecoin-project/filpgf-agent-kit` marketplace into my ChatGPT workspace.

Admins: **Admin console > Plugins > Add > Import marketplace**, source `https://github.com/filecoin-project/filpgf-agent-kit`, branch `main`. See [OpenAI's guide](https://help.openai.com/en/articles/20001504).

### Claude chat and Cowork

> [!TIP]
> **Ask your agent:** Help me upload the latest `filecoin-project/filpgf-agent-kit` release ZIP to Claude.

Download `filpgf-ecosystem-<version>.zip` from the [latest release](https://github.com/filecoin-project/filpgf-agent-kit/releases/latest) and upload it without extracting in **Customize > Plugins > Add > Upload plugin**.

## Sign in to Artio and Karma

The plugin carries no keys. The first time you use Artio or Karma, sign in with OAuth from your client:

| Client | Sign in |
|---|---|
| Claude Code | `/mcp`, select `plugin:filpgf-ecosystem:artio` or `:karma`, then **Authenticate** |
| Codex | `codex mcp login artio` and `codex mcp login karma` |
| Pi | `/mcp login artio` and `/mcp login karma` |

Artio metrics also need your Artio organization to have access to the `filecoin.filpgf_public` dataset. See the [sign-in guide](plugins/filpgf-ecosystem/skills/filpgf-ecosystem/references/credentials.md).

## Update

- Claude Code: `claude plugin marketplace update filpgf-ecosystem-marketplace && claude plugin update filpgf-ecosystem@filpgf-ecosystem-marketplace`
- Codex: `codex plugin marketplace upgrade filpgf-ecosystem-marketplace && codex plugin add filpgf-ecosystem@filpgf-ecosystem-marketplace`
- Pi: `pi update --extensions`

## Try it

> Which sources should I use to check a FilPGF milestone, and which one wins if they disagree?

A good answer cites Karma for milestones and payouts, Artio (formerly OSO) for metrics, and Git for code.

Report problems in [GitHub issues](https://github.com/filecoin-project/filpgf-agent-kit/issues).

## Maintainers

The plugin lives in [`plugins/filpgf-ecosystem/`](plugins/filpgf-ecosystem/README.md). Every file is edited by hand; there is no build step.

- **Skills and the source map:** `plugins/filpgf-ecosystem/skills/`. The router's [`sources.md`](plugins/filpgf-ecosystem/skills/filpgf-ecosystem/references/sources.md) describes every source the router table names.
- **MCP servers:** `mcp.json` and `.claude-plugin/plugin.json` in the plugin, which must list the same servers.
- **Upstream skills:** pinned in `imports.lock.json` and copied into the plugin by `npm run sync`. A daily 05:17 UTC workflow moves them to the latest upstream commit and commits the result.

```sh
npm test             # offline tests
npm run check        # manifests, marketplaces, skills and the router agree
npm run sync:check   # upstream copies match their pinned commits
npm run smoke        # install and upgrade with the local claude, codex and pi CLIs
```

Clients install from `main` and update when the plugin version changes. To release, run `npm version patch` (or `minor`, `major`) on `main`. It sets the version in `package.json` and both plugin manifests, commits and tags. Push with `git push --follow-tags`. The tag publishes a GitHub release with the plugin ZIP.

The kit is MIT-licensed. Upstream skills keep their licenses (see [`THIRD_PARTY_NOTICES.md`](plugins/filpgf-ecosystem/THIRD_PARTY_NOTICES.md)).
