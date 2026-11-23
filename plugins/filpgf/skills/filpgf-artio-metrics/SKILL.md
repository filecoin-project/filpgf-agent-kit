---
name: filpgf-artio-metrics
description: Reads Filecoin project, program, pod and network metrics from Artio (formerly Open Source Observer, OSO) with read-only SQL over the filecoin.filpgf_public mart tables. Use when a FilPGF review or question needs Artio (OSO) metrics, such as developer activity, funding totals or onboarded data for a project identified by its oso_project_slug.
license: MIT
compatibility: Needs the Artio MCP server (`artio` in this plugin) signed in with the user's own Artio account, and an Artio organization that can read the filecoin.filpgf_public dataset.
metadata:
  maintainer: FilPGF ecosystem contributors
---

# Artio metrics for FilPGF

Artio is the authority for metrics in FilPGF reviews. It was formerly Open Source Observer (OSO); its datasets, table names and GitHub repositories still use `oso`. Karma stays the authority for amounts, milestones and payments.

## Read only

This skill never changes Artio state. Use only discovery and query tools: list or get datasets and tables, SQL and semantic queries, and fetching async query results. Refuse requests to create, update, delete, publish, dispatch, sync or comment through OSO, and tell the user to do that in Artio directly. If a write-capable tool is visible, do not call it. Through SQL tools, run only `SELECT` and `WITH ... SELECT` statements: a query tool can still change state if the sign-in allows it. Artio rejects `DESCRIBE` and `EXPLAIN` with `OSO_UNSUPPORTED_STATEMENT`, and `SHOW TABLES FROM filecoin.filpgf_public` returns `PERMISSION_DENIED` even when the tables are readable.

## Connect

- MCP endpoint: `https://mcp.artio.so/mcp`. filpgf.io/llms.txt still lists the old `https://mcp.oso.xyz/mcp`, which keeps working.
- The user signs in with OAuth from their client (for example `/mcp` in Claude Code, `codex mcp login artio` in Codex). Never ask for an API key.
- To help the user sign in, follow `references/credentials.md` in the `filpgf` skill. If that skill is not installed, send the user to https://docs.opensource.observer/docs/mcp.md.
- Every query tool takes an `orgId`. Call `GetViewer` and pick the organization that can read `filecoin.filpgf_public`. If the user belongs to more than one, ask which one to use.
- `filecoin.filpgf_public` is not listed in the Artio marketplace, so users cannot subscribe to it. The `filecoin` organization shares it with named organizations; the user's organization must have that share.
- If the server is missing or needs sign-in (401 or 403), or the organization cannot read the mart, say so, give the user the sign-in step, and stop. Never ask for a key in chat. In a review, mark the affected figures "Can't verify" instead of estimating.

## Use the Filecoin guide

Artio maintains a Filecoin agent guide (Apache-2.0). Read the pinned version: https://github.com/opensource-observer/insights/blob/2782f052fbd4dc3ebd3366aed29b5e755e69a09e/community/filecoin/skills.md

Its main rules:

- Default to the community mart `filecoin.filpgf_public.*` plus public `oso.*`. Use deeper `filecoin.*` layers only if the user confirms Filecoin org access and the mart cannot answer.
- SQL dialect is Trino.
- Look up metric names, units and sources in `filecoin.filpgf_public.metric_catalog` instead of guessing. Snapshot metrics use `latest_` or `total_` prefixes; timeseries metrics use bare names.
- Timeseries start at 2024-01-01, so lifetime totals cover post-2024 activity only.

## Identify the project

All mart tables join on `oso_project_slug`. That slug is the OSS Directory project name.

1. Start from Karma's `osoProjectSlug` for Kernel projects (see `filpgf-read-karma`), or from a slug the user gives.
2. Confirm the slug in `filecoin.filpgf_public.projects`. Check `filecoin.filpgf_public.projects_to_projects` for cross-system identities (OSS Directory, Karma, Drips, Data Portal).
3. Do not match projects by display name alone, and do not use Artio workspace project tools for identity: those manage Artio work items, not OSS Directory projects. If the slug is ambiguous, ask the user.

## Query

- `SqlQuery` returns only a `runId`. Call `GetAsyncQueryResult` with the same `orgId` and `runId` until the status is `COMPLETED` or `FAILED`; a `FAILED` run gives the reason in `message`.
- If `GetAsyncQueryResult` says no run with that id exists, the organization most likely cannot read a table in the query. Run a query on a public `oso.*` table to check the connection, then treat the mart as not shared.
- Read a table's columns with `SELECT * FROM <table> LIMIT 0`, or with `ListTablesForDataset` when you have the dataset id.
- Filter by `oso_project_slug`, metric names and date range, and always add an explicit `LIMIT`.
- Report each figure with the table, the SQL, the date range, units (from `metric_catalog`), and the time you ran it. Note caveats from the guide that apply, for example DDO onramps having NULL `client_*` metrics.

## When something looks wrong

Point the user to the relevant maintainer:

- Platform problems: https://github.com/opensource-observer/oso/issues/new
- Filecoin metric definitions: https://github.com/opensource-observer/insights/issues/new
- Project identity or repository mapping: https://github.com/opensource-observer/oss-directory/issues/new
