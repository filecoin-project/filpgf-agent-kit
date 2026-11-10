---
name: filpgf-oso-metrics
description: Reads Filecoin project, program, pod and network metrics from Open Source Observer (OSO, now Artio) with read-only SQL over the filecoin.filpgf_public mart tables. Use when a FilPGF review or question needs OSO metrics, such as developer activity, funding totals or onboarded data for a project identified by its oso_project_slug.
license: MIT
compatibility: Needs an OSO MCP server (named `oso` in this toolkit, opt-in) connected with the user's own OSO/Artio credentials and a subscription to the filecoin.filpgf_public datasets.
metadata:
  maintainer: FilPGF ecosystem contributors
---

# OSO metrics for FilPGF

OSO is the authority for metrics in FilPGF reviews. Karma stays the authority for amounts, milestones and payments.

## Read only

This skill never changes OSO state. Use only discovery and query tools: list or get datasets and tables, SQL and semantic queries, and fetching async query results. Refuse requests to create, update, delete, publish, dispatch, sync or comment through OSO, and tell the user to do that in OSO directly. If a write-capable tool is visible, do not call it. Through SQL tools, run only `SELECT`, `WITH ... SELECT`, `SHOW`, `DESCRIBE` and `EXPLAIN` statements: a query tool can still change state if the credential allows it.

## Connect

- MCP endpoint: `https://mcp.oso.xyz/mcp` (named in filpgf.io/llms.txt). OSO also documents `https://mcp.artio.so/mcp` and says the old endpoint keeps working.
- Authentication belongs to the user: an API key in `OSO_TOKEN`, or the client's OAuth sign-in where OSO allows that client (for example, the OSO connector in Claude chat).
- To help the user create a key or connect OSO, follow `references/credentials.md` in the `filpgf-ecosystem` skill. If that skill is not installed, send the user to https://docs.opensource.observer/docs/mcp.md.
- If the server is missing, returns 401 or 403, or a table needs a subscription, say so and stop. Never ask for a key in chat. In a review, mark the affected figures "Can't verify" instead of estimating.

## Use the Filecoin guide

OSO maintains a Filecoin agent guide (Apache-2.0). Read the pinned version: https://github.com/opensource-observer/insights/blob/2782f052fbd4dc3ebd3366aed29b5e755e69a09e/community/filecoin/skills.md

Its main rules:

- Default to the community mart `filecoin.filpgf_public.*` plus public `oso.*`. Use deeper `filecoin.*` layers only if the user confirms Filecoin org access and the mart cannot answer.
- SQL dialect is Trino.
- Look up metric names, units and sources in `filecoin.filpgf_public.metric_catalog` instead of guessing. Snapshot metrics use `latest_` or `total_` prefixes; timeseries metrics use bare names.
- Timeseries start at 2024-01-01, so lifetime totals cover post-2024 activity only.

## Identify the project

All mart tables join on `oso_project_slug`. That slug is the OSS Directory project name.

1. Start from Karma's `osoProjectSlug` for Kernel projects (see `filpgf-read-karma`), or from a slug the user gives.
2. Confirm the slug in `filecoin.filpgf_public.projects`. Check `filecoin.filpgf_public.projects_to_projects` for cross-system identities (OSS Directory, Karma, Drips, Data Portal).
3. Do not match projects by display name alone, and do not use OSO workspace project tools for identity: those manage OSO work items, not OSS Directory projects. If the slug is ambiguous, ask the user.

## Query

- Inspect the table schema first (list tables, or `DESCRIBE`).
- Filter by `oso_project_slug`, metric names and date range, and always add an explicit `LIMIT`.
- Report each figure with the table, the SQL, the date range, units (from `metric_catalog`), and the time you ran it. Note caveats from the guide that apply, for example DDO onramps having NULL `client_*` metrics.

## When something looks wrong

Point the user to the relevant maintainer:

- Platform problems: https://github.com/opensource-observer/oso/issues/new
- Filecoin metric definitions: https://github.com/opensource-observer/insights/issues/new
- Project identity or repository mapping: https://github.com/opensource-observer/oss-directory/issues/new
