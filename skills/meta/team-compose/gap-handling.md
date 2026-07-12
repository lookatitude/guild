# Gap-handling options, approval shapes & per-phase team-file schema

Detail for `guild:team-compose` steps 3–4, implementing the phase-aware composition loop (`dynamic-team-composition.md §1`). The write target is the **per-phase** file `.guild/team/<slug>.<phase>.yaml` (via `teamFilePath`, T1) plus the `.guild/team/<slug>.current` pointer — never the legacy single-file `<slug>.yaml`.

## The four gap-handling options

For every domain classified as a *gap* (covered by neither a shipped type template (mintable — never a gap) nor shipped skills nor an already-minted `.guild/agents/*.md` / `.guild/skills/*` project artifact), present. **Per-phase gap analysis is the SOLE gated mid-lifecycle trigger into mint** (`dynamic-team-composition.md §1`): a gap is either a missing **role** (→ `create-specialist`) or a missing **capability/skill** (→ `create-skill`).

- **A · auto-create** — mint the missing artifact before proceeding: a **role** gap invokes `guild:create-specialist`; a **capability/skill** gap invokes `guild:create-skill`. Per the **v2 DH-3 boundary**, the new agent/skill is minted into the consuming repo's `.guild/agents/<role>.md` / `.guild/skills/<name>/` carrying `derived_from_template: guild.agent_template.v1` / `guild.skill_template.v1` (template id resolved via `contract-map.md §A`) — **never** into the read-only plugin install dir. The freshly-minted artifact is **proposed to the user for explicit approval** and **must clear its mint gate** (paired evals + shadow) **before the phase team finalizes** (see Approval shapes); on gate failure the gap falls back to B/C/D. Adjacent-boundary updates are proposed as part of that flow (see `guild:create-specialist`).
- **B · skip gap** — proceed with existing specialists only; the missing coverage is flagged in the final task report (`coverage_flags`).
- **C · substitute** — reassign the gap to an existing specialist with an explicit scope override recorded in `team.yaml`.
- **D · compose from scratch** — discard the proposal entirely and hand-pick the team via `/guild:plan`.

## Approval shapes

Exactly **one** of two approval shapes runs before step 4 writes the per-phase team file (`.guild/team/<slug>.<phase>.yaml`), selected by whether Classify surfaced any gap the user resolved with option A (auto-create):

- **(i) All needed specialists already exist.** Every match is *existing* (an `.guild/agents/*.md` instance, or a shipped template minted deterministically this compose), or every gap was resolved with B/C/D so nothing is minted. The user gives a **single approval — the team constitution** (resolved roster + per-specialist scope + chosen backend). No specialist-creation approval is requested because no new agent is created.
- **(ii) One or more specialists must be created.** At least one gap was resolved with option A. Each freshly-minted specialist is **proposed for approval first** — one approval per minted role, surfaced as it returns from `guild:create-specialist`, before that role is added to the roster — **and then** the team constitution is approved as in (i). A minted specialist the user rejects falls back to options B/C/D for that gap; it is **never** silently added to the team.

Reuse is automatic: an existing specialist from **either** source never triggers a creation approval. The constitution approval is mandatory in both shapes; shape (ii) layers the per-specialist creation approvals **ahead** of it.

## per-phase team-file — annotated schema

Written to `.guild/team/<slug>.<phase>.yaml` (via `teamFilePath`, T1); `.guild/team/<slug>.current` records the active phase token. The legacy `.guild/team/<slug>.yaml` is read-only back-compat — never written here.

```yaml
spec: .guild/spec/<slug>.md
phase: build       # the phase this team was composed for; matches <phase> in the filename
backend: subagent  # or: agent-team — MIRROR of the intake-resolved snapshot; per-phase files all mirror the SAME value (ADR A4)
allow_larger: false  # true only if user passed --allow-larger
specialists:
  - name: architect
    scope: "System boundaries, component split, tradeoff matrix for the pricing service."
    depends-on: []
    implied-by: "multi-component"  # or omit if user-requested
    # capability_scope is OPTIONAL — absent ⇒ no scoping (additive; current behaviour unchanged)
    capability_scope:
      - "Read"
      - "Write"
      - "Edit"
      - "Glob"
      - "Grep"
      - "WebSearch"
      - "WebFetch"
  - name: backend
    scope: "REST contract + data layer for /pricing endpoints."
    depends-on: [architect]
    capability_scope:
      - "Read"
      - "Write"
      - "Edit"
      - "Bash"
      - "Glob"
      - "Grep"
  - name: qa
    scope: "Property-based tests for quote calculator; regression suite hookup."
    depends-on: [backend]
    implied-by: "backend-present"
    capability_scope:
      - "Read"
      - "Write"
      - "Edit"
      - "Bash"
      - "Glob"
      - "Grep"
  - name: security
    scope: "Auth flow review for the new pricing admin routes."
    depends-on: [backend]
    implied-by: "auth-touched"
    capability_scope:
      - "Read"
      - "Glob"
      - "Grep"
      - "WebSearch"
      - "WebFetch"
gaps_resolved:
  - proposed_role: data-scientist
    resolution: "B"  # A / B / C / D
    notes: "User accepted missing coverage; flagged in final report."
coverage_flags:
  - "No specialist covers ML modelling (user selected B on data-scientist gap)."
```

Per-specialist fields:
- `name` — exact specialist slug from the roster.
- `scope` — one-sentence bounded responsibility for *this* task. No copy-paste of the specialist's full remit.
- `depends-on` — list of other specialist slugs whose handoff this specialist waits on.
- `implied-by` (optional) — records which hard rule triggered the inclusion (`multi-component`, `auth-touched`, `backend-present`) so the user can audit.
- `capability_scope` (optional) — list of Claude Code tool-permission rules (e.g. `"Read"`, `"Bash"`, `"Write"`) serialised as `GUILD_CAPABILITY_SCOPE` by `guild:execute-plan` at dispatch so the PreToolUse hook can enforce tool-level isolation. **Absent ⇒ no scoping** (additive: current behaviour unchanged). See `SKILL.md §"Capability scope defaults"` for the role→scope defaults table and rule syntax reference (`hooks/lib/security/enforce.ts`).

- `phase` (top-level) — the phase this team was composed for; matches the `<phase>` segment of the filename. Self-description/audit so a per-phase file is identifiable without parsing its name.

The top-level `backend` field is a **mirror** (for audit/readability) of the snapshot-resolved backend — it is **not** the authority. The execution backend is resolved at run-start intake by `runStartPreflight` and read from the run's resolved-settings snapshot (`readResolvedSettingsSnapshot` → `snapshot.effective.agent_mode`); the team file is composition-only. **Every per-phase file mirrors the SAME intake-resolved backend value — it is never re-resolved per phase** (ADR A4). The team is capped at 6 entries **per phase** (union of concurrently-active specialists; sequential phases get a fresh budget) unless `allow_larger: true` is set.
