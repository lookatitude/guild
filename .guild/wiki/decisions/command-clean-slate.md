---
type: decision
owner: architect
confidence: high
importance: high
source_refs: [".guild/runs/v2-final/DECISIONS-LOCKED.md#L14", ".guild/runs/v2-final/DECISIONS-LOCKED.md#L40", ".guild/runs/v2-final/20-design-dossier.md#L186-L220", ".guild/runs/v2-final/20-design-dossier.md#L443-L451"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [phase-entrypoints, lifecycle-overview, v2-scope-and-risk-g1-g8]
---

# ADR: Command clean-slate redesign

## Status

Accepted (2026-05-17, G1 FULL CLEAN SLATE + U2 OVERRIDE + U3 RATIFIED).

> **Corrected-in-part (2026-05-26) by [`v2x-command-surface-dispatch-and-internalization`](v2x-command-surface-dispatch-and-internalization.md) D1.** Decision **#1 ("colon drop") is overruled**: the `/guild:` colon is a Claude Code plugin-namespace requirement and is **retained** in v2. The clean-slate intent survives as a **prefix drop** — v2 drops the redundant `guild-` command prefix, so the surface is `/guild:<verb>` (e.g. `/guild:init`, `/guild:ops`), not the space-form `/guild <verb>` shown in #2–#7 below. Read every `/guild <verb>` and "no colon anywhere" in this ADR as `/guild:<verb>`. Items #2–#7 (ops verb, flag-profile, print-only stubs, CI hard-fail) stand unchanged. Binding grammar: `architecture/command-surface.md §1`.

## Context

v1 shipped colon-namespaced `/guild:*` commands plus a `/guild:diagnose` that
never made it into `guild-plan.md §13.1`. G1 mandates a full clean slate,
DX-first.

## Decision

1. **Colon drop.** No `/guild:` colon anywhere. Grammar is the C1 canonical
   token set only: phase *concept* names in prose; command *verbs* in command
   context. The verb↔phase map is stated once where relevant.
2. **Operations verb is `ops`, NOT `ship` (U2 OVERRIDE).** Every doc /
   diagram / migration-map uses `/guild ops`. The dossier's `ship` is
   superseded by this line.
3. **Surface (tiered):** 3 daily (`/guild [brief]`, `/guild status`,
   `/guild wiki`) · 6 phase (`init ideate plan build qa ops`) · 6 maintenance
   (`evolve rollback stats audit fix` + `initiative`).
4. **Flag-profile (U3 RATIFIED).** `--rigor=deep` auto-implies
   `--review=cross`; the expanded profile (incl. cross-host Codex review) is
   **printed before the first gate**. No separate explicit flag required;
   `--auto-approve` prints-but-does-not-block.
5. **`/guild:diagnose` → `/guild fix`.** The clean-slate redesign supersedes
   the un-tabled `/guild:diagnose`; the migration is recorded (G7) in the
   command `MIGRATION.md`.
6. **Print-only-stub interpretation of G1.** "Removed outright" means the old
   colon commands do not execute; a back-compat shim **prints** the migration
   redirect (per-row, from the command map) and exits — it does not silently
   re-route. Old-form invocation is a hard, actionable redirect, never silent
   autonomy.
7. **Non-interactive/CI (OQ11): hard-fail** with an actionable message when an
   interactive gate is reached without `--auto-approve=` or a named phase.

## Consequences

- `guild-plan.md §13.1` command table is replaced by a reference to the
  dossier §2.3 surface; `guild-plan.md` carries a `supersedes:` pointer.
- A repo-root `MIGRATION.md` carries the full command map with a printed
  redirect per row, the flag cheat-sheet, and a deprecation timeline.
