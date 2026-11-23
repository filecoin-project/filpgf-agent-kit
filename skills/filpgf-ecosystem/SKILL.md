---
name: filpgf-ecosystem
description: Routes Filecoin public goods funding (FilPGF) questions to the right source, skill and maintainer (filpgf.io/llms.txt, Karma, OSO, Filecoin Data Portal, Filoscope and project repositories) and says which source wins when they disagree. Use first for any FilPGF, ProPGF, Kernel, Revenue Development or R&D program question, or when unsure where Filecoin ecosystem data lives.
license: MIT
metadata:
  maintainer: FilPGF ecosystem contributors
---

# FilPGF ecosystem router

Pick the narrowest source that answers the question. A map of sources is more useful than loading everything.

## Steps

1. Read https://www.filpgf.io/llms.txt for the current program pages, app links and data entry points. It changes; do not rely on memory.
2. Read [references/sources.md](references/sources.md) for each source's coverage, route, upstream guide, auth, maintainer and where to report problems.
3. Match the question to a source, then hand off as described below:

| Question | Source | Skill, when installed |
|---|---|---|
| Program pages, rounds, reports, financials | `filpgf` | none; read the pages |
| Programs, applications, grants, milestones, payouts, Kernel data | `karma-gap-api` | `filpgf-read-karma` |
| Review a milestone or funded project | `karma-gap-api`, `oso`, `git` | `filpgf-review-work` |
| Project metrics or code activity from OSO | `oso` | `filpgf-oso-metrics` |
| Filecoin network, storage provider, PDP, Filecoin Pay or market data | `fdp` | `fdp` |
| Filecoin docs, FIPs, specs, code and ecosystem projects | `filoscope` | `filoscope` |
| Significant setup blockers or recurring plugin friction | https://github.com/filecoin-project/filpgf-agent-kit/issues | `filpgf-plugin-feedback` |

## Hand off

- **Skill installed:** load it and follow it.
- **Skill not installed:** follow the source's *Upstream guide* in `references/sources.md`. These are the maintainers' own agent instructions; prefer them over reconstructing an API from memory. Then use the source's docs.
- **No browsing or fetching:** answer from `references/sources.md` (coverage, authority, maintainer), give the user the exact URLs to open, and say which figures you could not check live. Never invent figures.
- **Route needs a sign-in or a local runtime:** this is a handoff, not a prerequisite. Tell the user what the source's *Handoff* line says, continue with public sources, and mark the affected figures "Can't verify". Ask before any download or local command.

If OSO or Karma needs a sign-in, or the user asks how to connect them, follow [references/credentials.md](references/credentials.md).

## Reconcile sources

- Karma wins for amounts, milestone status and payments; OSO for metrics; git for code (as stated by filpgf.io/llms.txt).
- When sources disagree, show both values, name each source and its as-of date. Do not silently pick one.
- Give every figure its scope, date, unit and source link. Write "not found" rather than estimating.

## Access boundaries

- Karma GAP GET, Filecoin Data Portal files and filpgf.io pages are public.
- The `oso` and `karma` MCP servers need the user's own OAuth sign-in in their client. Never ask the user to paste a key or token into the conversation. Point them to [references/credentials.md](references/credentials.md).
- Data workflows here are read-only. The feedback skill may post a public GitHub issue or comment only after the user approves the exact report.
- Access to public guidance does not imply access to a team's private records. If something is private, link it and mark it PRIVATE instead of quoting it.
