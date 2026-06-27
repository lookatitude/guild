---
type: decision
owner: architect
confidence: medium
importance: medium
source_refs: ["docs/knowledge/decisions/current-project-implementation-plan.md#new-specialist-same-session-constraint"]
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [current-project-implementation-plan, v2x-command-surface-dispatch-and-internalization, templates-and-migration]
---

# ADR: New-Specialist Same-Session Availability Constraint

## Status

Accepted (operator-ratified 2026-05-26; v2.0-full-scope program). Extracted
from `current-project-implementation-plan.md`; all other implementation-plan
decisions are superseded by the v2 ADR suite.

## Context

When `guild:create-specialist` writes a new specialist agent file to
`agents/`, Claude Code has already loaded the plugin manifest at session
start. Plugin agents are **discovered once per session** — there is no
hot-reload path. A newly written `.md` file in `agents/` is therefore not
dispatchable via normal plugin agent discovery within the same session.

Three options were identified:

| # | Option | Trade-off |
|---|---|---|
| 1 | **Defer production use to next session** — creation always succeeds (file written); dispatch waits until a new session loads the manifest. | Safe; no degraded state at runtime. |
| 2 | Generic specialist runner with explicit prompt-file path — invokes the `.md` body directly without plugin discovery. | Works same-session; bypasses the plugin dispatch chain; not provider-portable. |
| 3 | tmux/manual teammate prompt referencing the generated file path. | Works same-session; manual; Claude-specific. |

## Decision

**Option 1 is the default.** Production dispatch of a newly created
specialist is **deferred until the next Claude Code session**, at which
point the plugin manifest reload discovers the new file.

Same-session execution (options 2/3) remains available as an **explicit,
degraded fallback**:

- The `guild:create-specialist` skill output MUST state clearly: "Specialist
  `<name>` created. Start a new session to dispatch via normal plugin
  routing. For immediate same-session use, load via explicit prompt path
  (degraded mode — not provider-portable; log the workaround)."
- Any same-session workaround is logged to the run trace with
  `degraded: true` and `reason: "pre-manifest-reload dispatch"`.
- The workaround is never silently activated; it requires operator
  acknowledgement.

## Consequences

- Specialist creation is a **two-step UX**: create → restart → dispatch.
  This must be surfaced in the skill output and in the user-facing
  documentation for `guild:create-specialist`.
- The evolution gate (`guild:evolve-skill`) and shadow-mode replay are
  not affected — they operate on skill bodies, not agent dispatch.
- Provider portability is preserved: the default path (defer to next
  session) does not depend on Claude-specific discovery internals.
- Future work: if Claude Code adds a live manifest-reload API, this
  decision can be revisited with a targeted amendment (no broader
  constraint changes needed).
