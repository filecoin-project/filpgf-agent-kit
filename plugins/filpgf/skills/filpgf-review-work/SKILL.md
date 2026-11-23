---
name: filpgf-review-work
description: Produces an evidence packet for a FilPGF milestone or project review — scope, research, reconcile sources, assess, render Markdown with every figure sourced. Use when a committee member or reviewer asks to review a milestone, check a funded project, or prepare a ProPGF or Kernel review.
license: MIT
---

# Reviewing Kernel work

The output is a packet a human reviewer decides from. Every figure links to its source and date; anything that can't be found says "not found", never an estimate.

## Pick the review

- **A milestone** marked complete → follow [references/milestone-review.md](references/milestone-review.md). Evidence only: open questions, no verdict.
- **A funded project** as a whole → follow [references/project-review.md](references/project-review.md). Ends with a draft judgement for the reviewer to accept or change.

Both render into the outline in [references/packet.md](references/packet.md).

## Pipeline

Copy this checklist and tick it off:

```
Review progress:
- [ ] 1. Scope
- [ ] 2. Research
- [ ] 3. Reconcile
- [ ] 4. Assess
- [ ] 5. Render
```

1. **Scope**: the project and Karma application reference, the program, the milestone if any, and the as-of date. Confirm them with the user if any is ambiguous.
2. **Research**: gather from each source — Karma (filpgf-read-karma), OSO through its MCP server, the project's git repository. Run independent lookups in parallel.
3. **Reconcile**: Karma wins for amounts, milestone status and payments; OSO for metrics; git for code. When sources disagree, show both values and name each source.
4. **Assess**: as the reference file for the review type says.
5. **Render**: the packet, then a short run log listing each call made and anything that failed.

## Rules

- Don't quote private material. If a source is PLFIF-only, link it and mark it PRIVATE.
- Don't rate a criterion you couldn't check: use "Can't verify" and say why.
