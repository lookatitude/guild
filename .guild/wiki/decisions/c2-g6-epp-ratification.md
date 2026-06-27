---
type: decision
owner: architect
confidence: high
importance: medium
source_refs: [".guild/runs/v2-final/DECISIONS-LOCKED.md#L19-L24", ".guild/runs/v2-final/DECISIONS-LOCKED.md#L38-L42", ".guild/runs/v2-final/20-design-dossier.md#L94-L127"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [codebase-understanding, claude-code-adapter, codex-openai-adapter, v2-scope-and-risk-g1-g8]
---

# ADR: C2 — G6 co-equal-host / external-plugin-policy ratification

## Status

Accepted — **RATIFIED**, not a NEEDS-USER item. The component package raised
this as an `ESCALATE` (G6 contradicts the prior-turn "Codex = exactly 3
surfaces" do-not-reopen ceiling). `DECISIONS-LOCKED.md` line 19 ("This
SUPERSEDES the old 'Codex = 3-surface ceiling' framing") and line 24 ("the
3-surface *ceiling* is lifted and **must be rewritten wherever it appears**"),
plus the **U1 RATIFIED** post-dossier confirmation, already constitute the
user's explicit authorization. No further sign-off required.

## Context

G6 makes Codex a co-equal host adapter; the old framing capped Codex at
exactly three surfaces. These cannot both stand. The LOCKED text resolves it
in G6's favor and mandates a verbatim rewrite everywhere the ceiling appeared.

## Decision

The canonical replacement string — pasted verbatim wherever the 3-surface
ceiling / "exactly three surfaces" appeared:

> **v2-EPP-1 (G6-amended):** Codex (`openai-codex`) is the **sole permitted
> external runtime plugin**. It serves as a **co-equal host adapter**
> (originate / execute / review runs via the neutral `task_run` contract)
> *plus* the rescue, stop-time-review, and CLI-runtime carve-out surfaces.
> There is **no fixed surface-count ceiling** on Codex. The external-plugin
> **exclusivity** rule is unchanged: understand-anything, superpowers, and all
> other third-party capabilities are forked/internalized under MIT attribution
> and are **never runtime dependencies**.

## Consequences

Every location below receives this exact string; no other phrasing survives,
and "exactly three surfaces" is never re-introduced:

- `research/25 §1` (v2-EPP-1a), `research/README.md`
- `architecture/architecture-overview.md` ("External Plugin Policy")
- `architecture/codebase-understanding.md` (non-goals)
- `architecture/v2-index.md` (binding principles)
- `architecture/edge-cases.md` ("Asked to depend on understand-anything")
- `team-and-routing/codex-openai-adapter.md`,
  `team-and-routing/claude-code-adapter.md`

The external-plugin **exclusivity** rule stands; only the surface-count
**ceiling** is lifted.
