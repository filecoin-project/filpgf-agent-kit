# Get OSO and Karma credentials

Most FilPGF work needs no credentials. These sources are public and keyless:

- filpgf.io pages and llms.txt
- Karma GAP API GET requests, used by `filpgf-read-karma` and `filpgf-review-work`
- Filecoin Data Portal files, used by `fdp`
- Filoscope, used by `filoscope`

Only OSO metrics need a credential. The Karma MCP server also needs one, but this toolkit does not include it.

## Rules for agents

- Never ask the user to paste a key into the conversation. Tell them where to create the key and where to store it.
- The user stores the key in the environment that starts the agent, or signs in through the client's connector settings.
- Do not run setup tools that create wallets or keys, such as the `setup-agent` skill from `show-karma/skills`.
- If a credential is missing, name the missing credential, point the user to this page, and continue with public sources. In a review, mark the affected figures "Can't verify".

## Create an OSO API key

An OSO (Artio) API key gives full access to the data your organization can read. It is not a read-only key. Create it in an organization that has only the access you need.

1. Sign in at https://www.artio.so/login.
2. Open your organization's **Settings**, then **API Keys**.
3. Select **New Key**, then create the key.
4. Copy the key and save it in your password manager. Artio shows the key only once.
5. Set the key as the `OSO_TOKEN` environment variable in the shell or service that starts the agent.

Queries on `filecoin.filpgf_public` tables also need your organization to have access to those datasets.

Docs: https://docs.opensource.observer/docs/mcp.md

## Connect OSO in Claude chat

To use OSO in Claude chat, connect it with OAuth instead of an API key. You must be an owner or admin of an Artio organization.

1. Open the OSO connector in the Claude directory: https://claude.ai/directory/oso.
2. Connect it and approve access for your Artio organization.

If the directory connector is not available to you, add a custom connector with the URL `https://mcp.artio.so/mcp`. Leave the client ID and client secret blank.

The older endpoint `https://mcp.oso.xyz/mcp` still works. The toolkit's opt-in OSO build uses that endpoint because filpgf.io/llms.txt names it.

## Connect the Karma MCP server

You do not need this for reading programs, grants, milestones, or payouts. The public GAP API covers those reads without a key.

If you connect the Karma MCP server (`https://api.karmahq.org/mcp`) yourself:

- In an interactive client, sign in with OAuth through the client's connector settings. This is the preferred option.
- Otherwise, generate a scoped API key in your Karma settings and give it the narrowest scope that works. Clients send the key in the `x-api-key` header. Locally, store it as `KARMA_API_KEY`.

Docs: https://www.karmahq.org/mcp/connect and https://www.karmahq.org/for-agents
