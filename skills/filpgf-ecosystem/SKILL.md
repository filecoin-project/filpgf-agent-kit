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
2. Read [references/sources.md](references/sources.md) for each source's coverage, access, auth, maintainer and where to report problems.
3. Load the matching skill:

| Question | Skill |
|---|---|
| Programs, applications, grants, milestones, payouts, Kernel data | `filpgf-read-karma` |
| Review a milestone or funded project | `filpgf-review-work` |
| Project metrics or code activity from OSO | `filpgf-oso-metrics` |
| Filecoin network, storage provider, PDP, Filecoin Pay or market data | `fdp` |
| Filecoin docs, FIPs, specs, code and ecosystem projects | `filoscope` |
| Significant setup blockers or recurring plugin friction | `filpgf-plugin-feedback` |

If a listed skill is not installed, follow the source's docs link in `references/sources.md` instead.

If a task needs an OSO or Karma credential, or the user asks how to get one, follow [references/credentials.md](references/credentials.md).

`filoscope` downloads a search index and runs the `filoscope` npm package through `npx`. Ask the user before the first download.

## Reconcile sources

- Karma wins for amounts, milestone status and payments; OSO for metrics; git for code (as stated by filpgf.io/llms.txt).
- When sources disagree, show both values, name each source and its as-of date. Do not silently pick one.
- Give every figure its scope, date, unit and source link. Write "not found" rather than estimating.

## Access boundaries

- Karma GAP GET, Filecoin Data Portal files and filpgf.io pages are public.
- OSO needs the user's own credentials (`OSO_TOKEN` or the client's OAuth sign-in) and is opt-in in this toolkit. Never ask the user to paste a token into the conversation. Point them to [references/credentials.md](references/credentials.md).
- Data workflows here are read-only. The feedback skill may post a public GitHub issue or comment only after the user approves the exact report.
- Access to public guidance does not imply access to a team's private records. If something is private, link it and mark it PRIVATE instead of quoting it.
