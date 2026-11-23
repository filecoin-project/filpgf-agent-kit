# Sign in to OSO and Karma

Most FilPGF work needs no account. These sources are public:

- filpgf.io pages and llms.txt
- Karma GAP API GET requests, used by `filpgf-read-karma` and `filpgf-review-work`
- Filecoin Data Portal files, used by `fdp`
- Filoscope, used by `filoscope`

The plugin also includes two MCP servers: `oso` (https://mcp.oso.xyz/mcp) and `karma` (https://api.karmahq.org/mcp). They carry no keys. The client signs the user in with OAuth the first time a server is used, then stores and refreshes the token itself.

## Rules for agents

- Never ask the user to paste a key or token into the conversation, and never ask them to create an API key for this plugin.
- If a server needs sign-in, tell the user the command for their client below and continue with public sources. In a review, mark the affected figures "Can't verify".
- Do not run setup tools that create wallets or keys, such as the `setup-agent` skill from `show-karma/skills`.

## Sign in

| Client | How |
|---|---|
| Claude Code | Run `/mcp`, select `plugin:filpgf-ecosystem:oso` or `plugin:filpgf-ecosystem:karma`, then **Authenticate**. |
| Codex | Run `codex mcp login oso` or `codex mcp login karma` in a terminal. |
| Pi | Run `/mcp login oso` or `/mcp login karma` in a session. |
| Claude chat | Use the OSO connector at https://claude.ai/directory/oso, or add a custom connector with the server URL. |

The browser opens the provider's sign-in page. Approve only the organization and access you need: OSO and Karma can also offer write tools, and the plugin's skills only read.

If you already connected OSO or Karma in your client under another name, you can keep that connection and disable the plugin's copy in the client's MCP settings.

## OSO (Artio)

- Sign in with your Artio account. An owner or admin of the Artio organization may need to approve the connection.
- Queries on `filecoin.filpgf_public` tables also need your organization to have access to that dataset. It is not in the OSO marketplace, so you cannot subscribe to it yourself: the `filecoin` organization shares it with named organizations. Ask for a share before you use the OSO metrics skill.
- OSO also documents the newer endpoint `https://mcp.artio.so/mcp`. The plugin uses `https://mcp.oso.xyz/mcp` because filpgf.io/llms.txt names it. Both work.

Docs: https://docs.opensource.observer/docs/mcp.md

## Karma

You do not need Karma's MCP server to read programs, grants, milestones, or payouts. The public GAP API covers those reads without an account.

Docs: https://www.karmahq.org/mcp/connect and https://www.karmahq.org/for-agents
