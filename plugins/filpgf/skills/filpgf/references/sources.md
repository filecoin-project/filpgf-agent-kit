# FilPGF source directory

Edit this file directly. Every source the router table names must have a section here.

Start from https://www.filpgf.io/llms.txt for the current list of program pages, app links and data.

## filpgf.io and app.filpgf.io (`filpgf`)

- Covers: Program pages, rounds, reports, financials; entry point for agents is llms.txt
- Where: https://www.filpgf.io/llms.txt
- Access: Public web pages
- Auth: none
- Authority: Program descriptions and links
- Route: public, no account needed
- Upstream guide: https://www.filpgf.io/llms.txt
- Skills (when installed): `filpgf`
- Maintainer: FilPGF program team (site source: show-karma/filecoin-grants)
- Report problems: https://github.com/show-karma/filecoin-grants/issues/new

## Karma GAP API (`karma-gap-api`)

- Covers: Programs, funding applications, grants, milestones, payouts, Kernel functions, commitments and readings (community `filecoin`)
- Where: https://gapapi.karmahq.xyz
- Docs: https://gapapi.karmahq.xyz/v2/docs/json
- Access: Public HTTP GET
- Auth: none for GET
- Authority: Wins for amounts, milestone status and payments
- Route: public, no account needed
- Upstream guide: https://github.com/show-karma/filecoin-grants/tree/main/skills
- Skills (when installed): `filpgf-read-karma`, `filpgf-review-work`
- Maintainer: Karma
- Report problems: info@karmahq.xyz (see https://www.karmahq.org/mcp/connect); no public API issue tracker verified

## Karma MCP server (`karma-mcp`)

- Covers: Karma API operations, program financials, docs search
- Where: https://api.karmahq.org/mcp
- Docs: https://www.karmahq.org/for-agents
- Access: MCP server `karma`, bundled in the plugin
- Auth: OAuth sign-in in the client; no key in the plugin
- Authority: Same data as the GAP API
- Route: needs the user's own sign-in; hand off to the user
- Upstream guide: https://www.karmahq.org/for-agents
- Handoff: Not needed for public reads: use `karma-gap-api`. For MCP tools, the user signs in to `karma` from their client (see references/credentials.md).
- Maintainer: Karma
- Report problems: info@karmahq.xyz (see https://www.karmahq.org/mcp/connect)

## Artio (formerly Open Source Observer, OSO) (`artio`)

- Covers: Project metrics and code activity; Kernel projects on Karma carry `osoProjectSlug`
- Where: https://mcp.artio.so/mcp
- Docs: https://docs.opensource.observer/docs/mcp.md ; Filecoin guide: https://github.com/opensource-observer/insights/blob/2782f052fbd4dc3ebd3366aed29b5e755e69a09e/community/filecoin/skills.md (Apache-2.0)
- Access: MCP server `artio`, bundled in the plugin. filpgf.io/llms.txt and older guides still call it OSO and list the old endpoint https://mcp.oso.xyz/mcp, which keeps working
- Auth: OAuth sign-in in the client with an Artio account; no key in the plugin
- Authority: Wins for metrics
- Route: needs the user's own sign-in; hand off to the user
- Upstream guide: https://github.com/opensource-observer/insights/blob/2782f052fbd4dc3ebd3366aed29b5e755e69a09e/community/filecoin/skills.md
- Handoff: The user signs in to `artio` from their client (see references/credentials.md). Until then, say Artio was not checked and mark metrics "Can't verify". Karma's `osoProjectSlug` still identifies the project.
- Skills (when installed): `filpgf-artio-metrics`, `filpgf-review-work`
- Maintainer: Artio (formerly Open Source Observer)
- Report problems: Platform: https://github.com/opensource-observer/oso/issues/new; Filecoin metrics and guides: https://github.com/opensource-observer/insights/issues/new; project identities: https://github.com/opensource-observer/oss-directory/issues/new

## Filecoin Data Portal (`fdp`)

- Covers: Daily Parquet and DuckDB tables for network, storage provider, PDP, Filecoin Pay and market data
- Where: https://filecoindataportal.xyz
- Docs: https://filecoindataportal.xyz/datasets.md
- Access: Public files over HTTPS
- Auth: none
- Authority: Derived chain and market datasets; check each dataset page for coverage and method
- Route: public, no account needed
- Upstream guide: https://github.com/davidgasquez/filecoin-data-portal/blob/main/web/public/SKILL.md
- Handoff: Dataset pages are readable on the web. Querying Parquet or DuckDB needs a code runtime; without one, read the dataset page or `https://data.filecoindataportal.xyz/daily_network_metrics.json`, or give the user the query to run.
- Skills (when installed): `fdp`
- Maintainer: David Gasquez
- Report problems: https://github.com/davidgasquez/filecoin-data-portal/issues/new

## Filoscope (`filoscope`)

- Covers: Searchable index of Filecoin docs, FIPs, specs, code, ecosystem projects and datasets
- Where: https://github.com/davidgasquez/filoscope
- Access: Local QMD index pulled through the `filoscope` npm package
- Auth: none
- Authority: Pointers to primary documents; cite the underlying document
- Route: needs a local shell or runtime; hand off when unavailable
- Upstream guide: https://github.com/davidgasquez/filoscope/blob/main/SKILL.md
- Handoff: Needs a shell with Node.js to run the `filoscope` npm package, which downloads a search index; ask the user before the first download. Without a shell, read and cite the primary documents instead (https://docs.filecoin.io, https://github.com/filecoin-project/FIPs).
- Skills (when installed): `filoscope`
- Maintainer: David Gasquez
- Report problems: https://github.com/davidgasquez/filoscope/issues/new

## Project git repositories (`git`)

- Covers: Code and release history of each funded project
- Access: Each project's own repository
- Auth: public repositories: none
- Authority: Wins for code
- Route: public, no account needed
- Skills (when installed): `filpgf-review-work`
- Maintainer: Each project team
- Report problems: The project's own issue tracker
