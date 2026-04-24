# Handoff Contract

Every dev agent closes its invocation with a structured receipt, mirroring the shape of `guild-plan.md §8.2` (specialist handoff contract). Main session consumes these to decide what to dispatch next.

## Schema

Emit a fenced markdown block at the end of your final message, tagged `handoff`:

````
```handoff
changed_files:
  - <absolute or repo-relative path>
  - ...
opens_for:
  - <name of downstream dev agent now unblocked, or "none">
assumptions:
  - <thing you inferred without asking, and why it was safe>
evidence:
  - <test command + outcome | sample output | grep count | validator pass>
followups:
  - <scoped work you noticed but did not do, or "none">
```
````

## Field rules

- **changed_files** — every file you created or modified. If none, write `- none`.
- **opens_for** — downstream agents whose hard dependencies you just satisfied. If nothing new unblocks, `- none`.
- **assumptions** — anything you decided without pausing to ask. Main session audits these against the plan.
- **evidence** — at least one concrete artifact (command output, file size, lint result). Never "looks good" or "should work".
- **followups** — work you saw but did not do. Prevents silent scope creep.

## Hard rules

- Never commit. Main session commits after reading your receipt.
- Never dispatch another agent. Only main session orchestrates.
- If blocked, emit the receipt with `evidence: - blocked: <why>` and stop — do not force a partial fix.
- If you edited a file outside your owned scope (see your `Scope boundaries` section), list it under `followups:` with a note — main session decides whether to keep the edit.
