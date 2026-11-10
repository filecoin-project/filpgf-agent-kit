# FilPGF Agent Kit 🧰

> Gives your AI agent skills for Filecoin public goods funding (FilPGF)!

This plugin makes your agent learn where FilPGF data lives, which source to trust, and how to do common workflows. The resources cover filpgf.io, Karma, Open Source Observer (OSO), the Filecoin Data Portal, and Filoscope.

## What you can ask

- "Which sources should I use to check this FilPGF milestone?"
- "List the open milestones for this Kernel project on Karma."
- "Review this project's milestone and prepare an evidence packet."
- "Show onboarded data over the last week from the Filecoin Data Portal."
- "Find the FIP that changed storage provider penalties."

The toolkit includes these skills:

| Skill | Use it to |
|---|---|
| `filpgf-ecosystem` | Pick the right source and skill, and settle disagreements between sources |
| `filpgf-read-karma` | Read programs, grants, milestones, and payouts from Karma's public API |
| `filpgf-review-work` | Review a milestone or a funded project |
| `filpgf-oso-metrics` | Read project metrics from OSO (needs your own OSO credentials) |
| `fdp` | Query Filecoin network and market datasets |
| `filoscope` | Search Filecoin docs, FIPs, specs, and code |

`filpgf-read-karma`, `filpgf-review-work`, `filoscope`, and `fdp` come from their maintainers' repositories at pinned commits. Their licenses are in `THIRD_PARTY_NOTICES.md` in each package.

## Get the packages

Download a package from [release 0.1.0](https://github.com/filecoin-project/filpgf-agent-kit/releases/tag/v0.1.0) and follow the steps for your client below. You do not need to clone or build this repository.

The release includes `SHA256SUMS` to verify the downloads. Packages include skills and their upstream licenses, but no credentials or configured MCP servers.

## Install in your client

Isolated smoke tests loaded the toolkit in Claude Code with `--plugin-dir`, in Codex CLI through the marketplace install, and in Pi with `-e`. The other steps follow the vendors' docs but were not tested.

### Claude Code

Download and extract [the Claude marketplace ZIP](https://github.com/filecoin-project/filpgf-agent-kit/releases/download/v0.1.0/filpgf-ecosystem-0.1.0-claude-marketplace.zip). From the directory where you extracted it, run:

```sh
claude plugin marketplace add ./filpgf-ecosystem-claude-marketplace
claude plugin install filpgf-ecosystem@filpgf-ecosystem-marketplace
```

### Claude chat and Cowork

1. Download [the Claude plugin ZIP](https://github.com/filecoin-project/filpgf-agent-kit/releases/download/v0.1.0/filpgf-ecosystem-0.1.0-claude-plugin.zip). Do not extract it.
2. In Claude, open **Customize**, then **Plugins**.
3. Select **Add**, then **Upload plugin**, and choose the ZIP. Do not upload the marketplace ZIP.

Skills that run local programs may not work in chat. For example, `filoscope` runs `npx`. To use OSO in Claude, connect it separately in the **Connectors** tab. See [Connect OSO in Claude chat](skills/filpgf-ecosystem/references/credentials.md#connect-oso-in-claude-chat).

### Codex CLI

Download and extract [the Codex marketplace ZIP](https://github.com/filecoin-project/filpgf-agent-kit/releases/download/v0.1.0/filpgf-ecosystem-0.1.0-codex-marketplace.zip). From the directory where you extracted it, run:

```sh
codex plugin marketplace add ./filpgf-ecosystem-codex-marketplace
codex plugin add filpgf-ecosystem@filpgf-ecosystem-marketplace
```

### ChatGPT

No published ChatGPT plugin exists for this toolkit, and no ChatGPT install was tested.

- **ChatGPT desktop:** OpenAI documents local plugin marketplaces for ChatGPT desktop (Work and Codex). The Codex marketplace ZIP uses the documented marketplace layout. See [Build plugins](https://developers.openai.com/plugins/build/plugins).
- **ChatGPT web:** you can add OSO as a custom MCP server. Go to [chatgpt.com/plugins](https://chatgpt.com/plugins), select **+**, then **Add custom MCP server**, then **Create as plugin**. This step adds only OSO's tools. It does not install the toolkit's skills.

### Pi

Download and extract [the Pi package ZIP](https://github.com/filecoin-project/filpgf-agent-kit/releases/download/v0.1.0/filpgf-ecosystem-0.1.0-pi-package.zip). From the directory where you extracted it, run:

```sh
pi install ./filpgf-ecosystem
```

To try it for one session without installing, run `pi -e ./filpgf-ecosystem` instead.

### Other Agent Plugins clients

Download and extract [the portable plugin ZIP](https://github.com/filecoin-project/filpgf-agent-kit/releases/download/v0.1.0/filpgf-ecosystem-0.1.0-agent-plugin.zip), then load its `filpgf-ecosystem` folder. That folder follows [Agent Plugins 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md).

## Check that it works

Ask your agent:

> Which sources should I use to check a FilPGF milestone, and which one wins if they disagree?

The agent reads filpgf.io/llms.txt, names Karma for milestone status and payments, OSO for metrics, and git for code, and links each source.

## Add credentials (optional)

Karma reads, Filecoin Data Portal files, Filoscope, and filpgf.io pages need no key.

Only OSO metrics need a credential. To create an OSO key or connect OSO with OAuth, follow [Get OSO and Karma credentials](skills/filpgf-ecosystem/references/credentials.md). Never paste a key into a chat.

The release does not configure OSO. Connect OSO separately using the credential guide. If you build from source, `npm run build:with-oso` generates an opt-in variant for CLI clients; set `OSO_TOKEN` in the shell that starts the client and install the generated package.

The OSO key gives full access to your organization's OSO data. The Codex and Pi builds limit OSO tools by name, and the Claude build does not limit them. None of these limits makes the key read-only, so use a key with the least access you need. The portable package also leaves OSO tools unfiltered.

## Know the limits

- Only loading in Claude Code, Codex CLI, and Pi was tested. Browser and desktop apps were not tested.
- No test has used the real OSO server.
- `filoscope` downloads a large search index through `npx`. The agent asks you first.
- The toolkit does not include Karma's MCP server. The public Karma API covers the read workflows.

## Report a problem

Report a problem in a data source to that source's maintainer, listed in the toolkit's source map. Report problems with imported skills to their upstream repositories. Report problems with this toolkit's own skills, source map, or packages in this repository.

## Maintain the toolkit

Edit `toolkit.json` for the source map and tool connections, and `skills/` for the toolkit's own instructions. `imports.lock.json` records upstream skills, tracked branches, commit hashes, and licenses. Builds generate the client packages in `dist/`.

```sh
npm test                 # Run offline tests.
npm run imports:update   # Fetch the latest upstream skills and update the lock.
npm run build            # Build all client packages in dist/.
npm run validate         # Check the generated packages.
```

On GitHub, the update workflow checks upstream skills every day at 05:17 UTC. When skills change, it tests the update, commits `imports.lock.json`, and builds fresh packages. License changes stop the update for manual review. Enable Actions on the default branch and allow the workflow to push commits; branch protection may block the bot. You can also start the workflow manually from the Actions tab. Automatic updates accept upstream instructions without human review. These updates produce CI artifacts, not new versioned releases; release 0.1.0 remains unchanged.

## License

This repository's own files use the MIT license. Imported skills keep their upstream licenses.
