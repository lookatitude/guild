---
type: decision
owner: architect
confidence: high
importance: high
source_refs: [".guild/runs/v2-final/DECISIONS-LOCKED.md#L13-L21", ".guild/runs/v2-final/20-design-dossier.md"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [v2-index, lifecycle-overview, codebase-understanding, cross-host-review-and-loop-control]
---

# ADR: v2 scope & risk — the G1–G8 user answers

## Status

Accepted (user-approved, 2026-05-17, `DECISIONS-LOCKED.md`). Binding;
not to be re-litigated. Debate is allowed only on HOW, never WHETHER.

## Context

The v2 finalization required eight scope/risk calls (G1–G8) that the user
answered directly. They set the outer boundary for every downstream design
and doc.

## Decision

| ID | Decision |
|---|---|
| **G1 Command breakage** | FULL CLEAN SLATE. New phase verbs only; old `/guild:*` removed outright; migration documented only (see G7 + the command-clean-slate ADR). |
| **G2 v2 scope** | Reconciled phase model + brownfield knowledge-graph engine + the 4 superpowers gap-forks + clean-slate command redesign + cross-host reciprocal review broker IS in v2. Quality/Operations as full first-class skills deferred to v2.x unless they fall out naturally; SQLite deferred. |
| **G3 Persistence** | FILESYSTEM-ONLY. SQLite explicitly deferred until measured slowness. No new MCP, no embeddings (BM25 + graph filters first). |
| **G4 Initiatives** | OPT-IN. One-off runs first-class; auto-attach only on durable-goal signals or "continue prior work"; attach is always asked, never silent. |
| **G5 Autonomy** | INTERACTIVE-BY-DEFAULT for plugin users (spec/team/plan approvals required; dev autonomous only after explicit plan approval; destructive/network ops always ask). `--auto-approve` is opt-in. Guild self-build remains always-on. |
| **G6 Target host** | CLAUDE + CODEX CO-EQUAL HOSTS. Ship the host-adapter layer + a neutral `task_run` contract so either host can originate/execute/review runs. Supersedes the old "Codex = 3-surface ceiling". |
| **G7 Versioning** | Each evolved doc carries `supersedes:` + a changelog block; commands ship a dedicated `MIGRATION.md`. |
| **G8 Brownfield engine** | BUILD NOW — full Guild-owned analyzer engine. Scope-guarded: no web dashboard, no MCP, no embeddings, gated refresh. |

## Consequences

- Every evolved doc adds frontmatter `supersedes:` + a `## Changelog` block.
- `guild-plan.md` is frozen as the superseded v1 record.
- Detailed ratifications/derivations are recorded in the sibling ADRs:
  phase/spine reconciliation, C2 G6/EPP ratification, command clean-slate,
  PRD right-sizing, Quality/Operations asymmetry.
