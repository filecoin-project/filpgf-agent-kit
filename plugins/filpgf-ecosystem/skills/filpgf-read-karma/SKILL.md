---
name: filpgf-read-karma
description: Reads public FilPGF data from the Karma API — programs, funding applications and their criteria, project grants and milestones, the milestone verification queue, payouts, and Kernel functions, commitments and readings. No key needed. Use when a task needs FilPGF or app.filpgf.io application, milestone, grant, payout or Kernel data.
license: MIT
---

# Reading Karma data

app.filpgf.io runs on Karma. Its data is public over plain HTTP GET at `https://gapapi.karmahq.xyz`, community slug `filecoin`. Use any HTTP client.

The OpenAPI spec is the reference for every path, parameter and response shape:

- JSON: https://gapapi.karmahq.xyz/v2/docs/json
- YAML: https://gapapi.karmahq.xyz/v2/docs/yaml
- Browsable: https://gapapi.karmahq.xyz/v2/docs

Fetch the spec and search it for a path rather than guessing one.

## Paths FilPGF work uses

| Need | GET |
|---|---|
| Programs and their IDs | `/v2/communities/filecoin/programs` |
| Applications to a program | `/v2/funding-applications/program/{programId}` |
| One application | `/v2/funding-applications/{referenceNumber}` |
| Milestones awaiting verification | `/v2/communities/filecoin/milestones/pending-verification` |
| A project | `/v2/projects/{identifier}` |
| A project's grants and milestones | `/v2/projects/{identifier}/grants` |
| Payouts per grant | `/v2/communities/filecoin/payouts/public` |
| Kernel | `/v2/kernel/overview`, `/functions`, `/projects`, `/commitments` |
| A project's Kernel indicators | `/v2/indicators/projects/{projectUID}` |

List endpoints page with `page` and `limit`; a page holds at most 50 items, so follow the pagination fields in the response until the last page.

## How the records connect

- An application (`referenceNumber`, `APP-…`) holds the form answers in `applicationData`, including the deliverables and criteria a milestone is judged against. `projectUID` links it to the project.
- A project's grants each carry `milestones` with `currentStatus`, `endsAt` and `statusHistory`.
- The pending-verification queue gives `projectUid` and `grantUid` for each milestone a team marked complete.
- Kernel projects carry `osoProjectSlug`, the key for their data on OSO.

## Writing

This skill only reads. To apply, post updates or verify milestones, use Karma's skills: https://github.com/show-karma/skills
