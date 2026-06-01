# Gap-handling options, approval shapes & team.yaml schema

Detail for `guild:team-compose` steps 3–4. Per `guild-plan.md §7.1`.

## The four gap-handling options

For every domain classified as a *gap* (covered by neither the shipped roster nor an already-minted `.guild/agents/*.md` project specialist), present:

- **A · auto-create** — invoke `guild:create-specialist` to mint the missing role before proceeding. Per the **v2 DH-3 boundary** (cited by pointer: `templates-and-migration.md` / `architecture/target-architecture.md §"Canonical template-version strings + derived_from_template invariant"`), the new agent is minted into the consuming repo's `.guild/agents/<role>.md` carrying `derived_from_template: guild.agent_template.v1` (template id resolved via `contract-map.md §A`) — **never** into the read-only plugin install dir. The freshly-minted specialist is **proposed to the user for explicit approval** before it joins the team (see Approval shapes). Adjacent-specialist boundary updates are proposed as part of that flow (`guild-plan.md §12`).
- **B · skip gap** — proceed with existing specialists only; the missing coverage is flagged in the final task report (`coverage_flags`).
- **C · substitute** — reassign the gap to an existing specialist with an explicit scope override recorded in `team.yaml`.
- **D · compose from scratch** — discard the proposal entirely and hand-pick the team via `/guild:plan`.

## Approval shapes

Exactly **one** of two approval shapes runs before step 4 writes `team.yaml`, selected by whether Classify surfaced any gap the user resolved with option A (auto-create):

- **(i) All needed specialists already exist.** Every match is *existing* (shipped roster or `.guild/agents/*.md`), or every gap was resolved with B/C/D so nothing is minted. The user gives a **single approval — the team constitution** (resolved roster + per-specialist scope + chosen backend). No specialist-creation approval is requested because no new agent is created.
- **(ii) One or more specialists must be created.** At least one gap was resolved with option A. Each freshly-minted specialist is **proposed for approval first** — one approval per minted role, surfaced as it returns from `guild:create-specialist`, before that role is added to the roster — **and then** the team constitution is approved as in (i). A minted specialist the user rejects falls back to options B/C/D for that gap; it is **never** silently added to the team.

Reuse is automatic: an existing specialist from **either** source never triggers a creation approval. The constitution approval is mandatory in both shapes; shape (ii) layers the per-specialist creation approvals **ahead** of it.

## team.yaml — annotated schema

```yaml
spec: .guild/spec/<slug>.md
backend: subagent  # or: agent-team
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

The top-level `backend` field is a **mirror** (for audit/readability) of the snapshot-resolved backend — it is **not** the authority. The execution backend is resolved at run-start intake by `runStartPreflight` and read from the run's resolved-settings snapshot (`readResolvedSettingsSnapshot` → `snapshot.effective.agent_mode`); `team.yaml` is composition-only. The team is capped at 6 entries unless `allow_larger: true` is set.
