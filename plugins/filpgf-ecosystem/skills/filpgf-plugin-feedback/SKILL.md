---
name: filpgf-plugin-feedback
description: Reports significant blockers or recurring friction that a small change to FilPGF Agent Kit could fix, such as broken setup steps, missing prerequisites, stale links, or unclear skill routing. Use when these problems interrupt a task or the user asks to report plugin feedback.
license: MIT
---

# Report plugin friction

Finish the user's task first when a safe workaround exists. Do not report every minor inconvenience or speculate about problems you have not observed.

## Decide whether to report

Report a blocker or recurring problem when a small change to this plugin could help the next user. Examples include a wrong install command, an undocumented credential requirement, or a skill that sends agents to the wrong source.

Do not report incorrect upstream data, service outages, or missing account permissions as plugin bugs. Follow the source map to the upstream maintainer instead. Missing instructions for handling those failures can still be a plugin issue. If the cause is uncertain, say so.

## Draft and submit

1. Check https://github.com/filecoin-project/filpgf-agent-kit/issues for an existing report. If you cannot search issues, say that duplicate checking was unavailable. Reuse an existing issue when appropriate.
2. Draft the report below using the smallest reproducible example. Suggest a small fix only when the evidence supports one.
3. Remove secrets, authentication headers, private records, and identifying details that the report does not need. Do not attach conversation history or raw logs. This repository's issues are public.
4. Show the exact report to the user and ask permission to post it. After approval, use an available GitHub tool to create the issue or comment on the existing issue. If no authenticated tool is available, give the user the draft and https://github.com/filecoin-project/filpgf-agent-kit/issues/new. Never request a GitHub token in chat. Return the issue URL only after submission succeeds.

Do not interrupt the task with repeated approval requests. Combine related friction into one report and do not create labels or assign maintainers.

## Report format

```text
Title: [Short description of the blocker]

Task: What the user was trying to do.
Environment: Client, plugin version or commit if known, and affected skill.
Reproduce: Minimal steps, with public links where useful.
Expected: What should have happened.
Observed: What happened, including the effect on the task.
Workaround: What worked, or "none found".
Suggested fix: A small plugin change, or "needs investigation".
```
