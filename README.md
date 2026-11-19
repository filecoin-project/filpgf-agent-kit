# FilPGF Agent Kit

FilPGF Agent Kit helps agents with Filecoin public goods funding (FilPGF). It picks the right skill, MCP server, or data source and says which source wins in a conflict.

## Install

Download the ZIP for your client from the [latest release](https://github.com/filecoin-project/filpgf-agent-kit/releases/latest). For example:

```sh
gh release download --repo filecoin-project/filpgf-agent-kit --pattern '*-claude-marketplace.zip'
```

### ChatGPT web

> [!TIP]
> **Ask your agent:** Help me get the `filecoin-project/filpgf-agent-kit` router plugin ZIP and upload it to my ChatGPT workspace.

There is no public listing. Workspace admins can [upload plugins](https://help.openai.com/en/articles/20001256) in **Admin console > Plugins > Add > Upload plugin**. Use `*-router-plugin.zip` from the latest release. If the release has no router ZIP yet, clone this repo and run `npm run build:router` to create one in `.cache/dist-router/packages/`. Not tested here.

### Claude Code

> [!TIP]
> **Ask your agent:** Install `filecoin-project/filpgf-agent-kit` in Claude Code from the latest release's `*-claude-marketplace.zip`.

Extract the asset, then run in the same folder:

```sh
claude plugin marketplace add ./filpgf-ecosystem-claude-marketplace
claude plugin install filpgf-ecosystem@filpgf-ecosystem-marketplace
```

### Codex CLI

> [!TIP]
> **Ask your agent:** Install `filecoin-project/filpgf-agent-kit` in Codex CLI from the latest release's `*-codex-marketplace.zip`.

Extract the asset, then run in the same folder:

```sh
codex plugin marketplace add ./filpgf-ecosystem-codex-marketplace
codex plugin add filpgf-ecosystem@filpgf-ecosystem-marketplace
```

### Pi

> [!TIP]
> **Ask your agent:** Install `filecoin-project/filpgf-agent-kit` in Pi from the latest release's `*-pi-package.zip`.

Extract the asset to a folder you will keep, then run `pi install ./filpgf-ecosystem` there.

### Other clients

These follow vendor documentation. Not tested here.

#### Claude chat and Cowork

> [!TIP]
> **Ask your agent:** Help me upload the latest `filecoin-project/filpgf-agent-kit` release's `*-claude-plugin.zip` to Claude.

Upload the ZIP without extracting it in **Customize > Plugins > Add > Upload plugin**.

#### VS Code

> [!TIP]
> **Ask your agent:** Help me load the latest `filecoin-project/filpgf-agent-kit` release's `*-agent-plugin.zip` in VS Code.

Extract the asset, run **Chat: Install Plugin from Source**, and select the `filpgf-ecosystem` folder. [Agent Plugins](https://agent-plugins.org/specification) clients load the same folder.

#### ChatGPT desktop

> [!TIP]
> **Ask your agent:** Help me install `filecoin-project/filpgf-agent-kit` in ChatGPT desktop from the latest release's `*-codex-marketplace.zip`.

Add the marketplace with the [Codex CLI](#codex-cli) command, restart ChatGPT, and install the kit from the [Plugins Directory](https://developers.openai.com/plugins/build/plugins).

> [!NOTE]
> **After the `stable` branch is published** (not yet), it will hold the newest router plugin. Add it with `claude plugin marketplace add filecoin-project/filpgf-agent-kit#stable` or `codex plugin marketplace add filecoin-project/filpgf-agent-kit --ref stable`, then install `filpgf-ecosystem@filpgf-ecosystem-marketplace`. In VS Code, add `filecoin-project/filpgf-agent-kit#stable` to the `chat.plugins.marketplaces` setting. ChatGPT workspace admins can [import the branch](https://help.openai.com/en/articles/20001504) for daily sync. Claude Code and Codex CLI installs and upgrades were tested against a local copy. The hosted branch, VS Code, and ChatGPT are not tested here.

## Try it

> Which sources should I use to check a FilPGF milestone, and which one wins if they disagree?

A good answer cites Karma for milestones and payouts, OSO for metrics, and Git for code.

## Release contents

Each release has seven skills, four from upstream, and no MCP servers or credentials. Claude Code, Codex CLI, and Pi installs were tested here. For OSO metrics, follow the [connection guide](skills/filpgf-ecosystem/references/credentials.md). Verify ZIPs against the release's `SHA256SUMS` with `sha256sum -c --ignore-missing SHA256SUMS`. Report problems in [GitHub issues](https://github.com/filecoin-project/filpgf-agent-kit/issues).

## Maintainers

Edit [`toolkit.json`](toolkit.json) for the resource map and `skills/` for instructions. The source [`sources.md`](skills/filpgf-ecosystem/references/sources.md) is a pointer, and the build fills it from `toolkit.json`.

Run `npm test`, `npm run build`, `npm run validate`, and `npm run smoke`. A daily 05:17 UTC workflow updates upstream skills without releasing. The next new tag that matches `package.json` and `toolkit.json` publishes the `stable` branch.

The kit is MIT-licensed. Upstream skills keep their licenses (see `THIRD_PARTY_NOTICES.md`).
