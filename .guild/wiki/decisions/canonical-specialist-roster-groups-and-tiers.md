---
type: decision
owner: architect
confidence: high
importance: critical
source_refs:
  - .guild/initiatives/active/plugin-docs-code-reconciliation/audit/reconciliation-ledger.md   # R-003 (tier drift), R-010 (group drift)
  - .guild/initiatives/active/plugin-docs-code-reconciliation/audit/dynamic-team-composition.md # filesystem-enumeration rule (Decision §4) — input
  - plugin/agents/                                                                              # the 14 agent files — canonical per-specialist self-declaration (group + model:)
  - plugin/.guild/wiki/entities/team-composition.md                                         # the 4-group table this ADR supersedes
  - plugin/skills/meta/team-compose/SKILL.md                                                    # §7 default_tier table — conform-target
  - plugin/.guild/wiki/decisions/cost-aware-tiering-and-lean-context.md                             # §1 tier ladder, §2 auto-score, §3 advisor, §7 (5-row augmenting table)
created_at: 2026-06-07
updated_at: 2026-06-07
sensitivity: internal
---

# ADR: Canonical specialist roster — groups, default tiers, and the enumeration rule

## Status

**ACCEPTED (pending codex G-lane + lead commit).** Authored 2026-06-07 for the
`plugin-docs-code-reconciliation` Phase-2 OD-1 gate covering ledger rows **R-003** (default-tier
source disagreement) and **R-010** (group-taxonomy disagreement). This ADR is the **binding
canonical source** for specialist grouping and default tiers; it **supersedes** the conflicting
tables wherever they disagree (see *Conform-targets*). It gates the Wave-2 conform work.

## Context

Three shipped sources describe the specialist roster's groups and tiers, and they disagree:

1. **The 14 agent files** (`plugin/agents/*.md`) — each specialist self-declares its group in its
   body (`Engineering group (§6.1)` / `Content & communication group (§6.2)` / `Commercial group
   (§6.3)`) and its working tier via `model:` frontmatter (`opus` / `sonnet`) plus a body
   `**Default tier**` line.
2. **`team-composition.md`** — a **4-group** table (engineering / **ops** / **writing** / commercial)
   that also reassigns membership (e.g. `social-media`/`seo` → commercial).
3. **`team-compose/SKILL.md §7`** — an independent `default_tier` table.

Two specific contradictions were filed (R-003, R-010):

- **Groups (R-010):** the agent files use **3 groups**; `team-composition.md` uses **4** (splitting
  `ops` out of engineering and `writing` out of content), and moves `social-media`/`seo` into
  commercial. No agent file self-identifies as "ops" or "writing".
- **Tiers (R-003):** `security` = `opus`/powerful in its frontmatter + body, but `mid` in
  team-compose §7. `copywriter`/`seo`/`social-media`/`marketing`/`sales` = `sonnet`/mid in their
  agent files, but `cheap→mid` in team-compose §7.

**Root cause (newly established by this audit):** the cited authority for both tier tables — the
cost-aware-tiering ADR **§7 "Roster + default tiers"** — only tabulates **5 augmenting agent types**
(`researcher`, `architect`, `advisor`, `developer`, `doc-writer`). It has **no rows** for `security`,
`copywriter`, `seo`, `marketing`, `sales`, `qa`, `backend`, `frontend`, `mobile`, `social-media`,
`technical-writer`. Both the agent files and team-compose §7 cite "ADR §7 roster row" for those
specialists, but **ADR §7 never tabulated them** — each source *extrapolated independently and
disagreed*. **There is no authoritative full-14 default-tier table today. This ADR creates it.**

The `dynamic-team-composition.md` ADR established that **groups are presentation, not a composition
input** — the dynamic composer enumerates capability per agent and never buckets by group. That
stance is an input here: the group decision is a taxonomy/display choice, not a routing mechanism.

## Decision

### D1 — Canonical grouping: **3 groups**, sourced from the agent files

The canonical taxonomy is the **3-group model the agent files already self-declare**:

| Group | Members (14 shipping specialists) |
|---|---|
| **Engineering** (`§6.1`) | `architect`, `researcher`, `backend`, `frontend`, `mobile`, `devops`, `qa`, `security` |
| **Content & communication** (`§6.2`) | `copywriter`, `technical-writer`, `social-media`, `seo` |
| **Commercial** (`§6.3`) | `marketing`, `sales` |

**Rationale.** (a) The agent files are the per-specialist **canonical self-declaration** — each
agent literally states its group in its body; this is the executable, shipped source. (b) The
website already renders the 3-group model (L5-verified). (c) The 4-group `ops`/`writing` split has
**zero agent-file backing** — no specialist self-identifies as "ops" or "writing". (d) Per
`dynamic-team-composition.md`, groups are presentation-only, so the simpler taxonomy wins;
the composer does not consume groups. (e) `seo`/`social-media` stay in **content & communication**
(their own files' §6.2 self-id, `seo` noted "commercial-flavored per §6.4") — not commercial.

`guild-plan.md` is the frozen v1 record and does not govern. `specialist-teams.svg` /
`03-team-composition.svg` are **group-agnostic** (ledger R-011, verified) and need no change.

### D2 — Canonical default tiers: the agent `model:` frontmatter is binding

The **default working tier** of each specialist is its `model:` frontmatter, mapped through the
cost-aware-tiering §1 ladder (`opus`=powerful, `sonnet`=mid, `haiku`=cheap). This is the full-14
table that did not previously exist:

| Specialist | Group | `model:` | **Canonical default tier** |
|---|---|---|---|
| `architect` | engineering | opus | **powerful** |
| `security` | engineering | opus | **powerful** |
| `researcher` | engineering | sonnet | **mid** |
| `backend` | engineering | sonnet | **mid** |
| `frontend` | engineering | sonnet | **mid** |
| `mobile` | engineering | sonnet | **mid** |
| `devops` | engineering | sonnet | **mid** |
| `qa` | engineering | sonnet | **mid** |
| `copywriter` | content & comms | sonnet | **mid** |
| `technical-writer` | content & comms | sonnet | **mid** |
| `social-media` | content & comms | sonnet | **mid** |
| `seo` | content & comms | sonnet | **mid** |
| `marketing` | commercial | sonnet | **mid** |
| `sales` | commercial | sonnet | **mid** |

Augmenting (non-roster) agent types, per cost-aware ADR §7: `advisor` = **powerful** (opus),
`developer` = **mid** (sonnet), `doc-writer` = **mid** (sonnet). These augment, never count toward
the 14.

**This resolves R-003:** `security` = **powerful** (team-compose §7's `mid` is wrong); the
content/commercial roles = **mid** (team-compose §7's `cheap→mid` understated them).

### D3 — Decouple "default tier" from the per-lane auto-score band

The R-003 confusion came from conflating two distinct, both-valid concepts. This ADR separates them:

- **Default working tier** = a **single** tier (D2 table), the per-specialist frontmatter value.
  It is what the agent runs at when dispatched as that type. This is the canonical "default tier."
- **Per-lane dispatch tier** = the cost-aware §2 auto-score (+ §3 advisor escalation) computed **per
  lane at dispatch**, which may lower a simple lane below its default (e.g. a pure read/summarize
  `researcher` lane → cheap; a mechanical `doc-writer` edit → cheap) or escalate a hard lane upward
  (a security-critical lane → powerful via advisor). This operates **on top of** the default; it
  does not replace or redefine it.

So the old `cheap→mid` notation is **not a default_tier** — it expressed the auto-score band. Under
this ADR the default_tier is the single frontmatter value; the "cheap floor available at dispatch"
is a property of the §2 scorer, recorded as guidance, never as the default. Roles with a genuine
cheap floor for mechanical lanes (`researcher`, `doc-writer`, template-guided content/commercial
generation) retain that floor **through the §2 scorer**, not through a dual-valued default.

### D4 — The enumeration rule (normative anti-drift)

**`team-compose` and any roster/tier consumer MUST enumerate the roster, groups, and default tiers
from the filesystem + agent frontmatter — never from a hand-maintained list, count, or tier table.**

- Roster membership = `plugin/agents/*.md` ∪ project-local `.guild/agents/*.md` (the 14 shipping +
  any minted), minus the augmenting set (`advisor`, `developer`, `doc-writer`).
- Default tier = each agent's `model:` frontmatter via the §1 ladder.
- Group = each agent's self-declared group line.

This makes the drift class **structurally impossible to recur**: there is one source (the files),
and every table is a *derived view* that must be generated from — or removed in favor of reading —
the files. This is the `dynamic-team-composition.md` Decision §4 rule, made **normative** here.

## Conform-targets (gates Wave-2 work)

This ADR creates the following conform obligations. Each is a Wave-2 lane; this ADR is their gate.

| Target | Owner (lane) | Action |
|---|---|---|
| `plugin/agents/*.md` | specialist-agent-writer (**L-ROSTER-CONFORM**, Wave 2) | Verify each body `Default tier` + group line matches D1/D2 (they are the source — mostly already correct; tidy `seo`'s "commercial-flavored" aside so it doesn't read as a group reassignment). |
| `plugin/.guild/wiki/entities/team-composition.md` | docs-writer / specialist-agent-writer | Replace the 4-group table with the D1 3-group table; move `social-media`/`seo` back to content & comms; drop `ops`/`writing`. |
| `plugin/skills/meta/team-compose/SKILL.md §7` | skill-author | Per D4, **read tiers from frontmatter** rather than maintaining a table; if a table is kept it must mirror the D2 values (`security`=powerful; content/commercial=mid). Remove the `cheap→mid` default notation (replace with D3's single-default + §2-floor framing). |
| `plugin/.guild/wiki/decisions/cost-aware-tiering-and-lean-context.md §7` | docs-writer | Add a pointer: §7 tabulates only the 5 augmenting types; the canonical full-14 default-tier table lives in **this ADR**. |
| Any standalone roster doc | docs-writer | **N/A — no separate `specialist-roster.md` exists.** The roster grouping (3-group) + tier reflection is carried by `team-and-routing/team-composition.md` (row above, conformed). Resolved there; no additional roster doc to update. |
| Website specialist/roster pages | followup | L5-verified to already follow the agent files (3-group, frontmatter tiers) — **verify** no residual `cheap→mid`/4-group copy; likely no-op. |

No diagram work: the team-composition SVGs are group-agnostic (R-011).

## Consequences

**Positive.** One canonical source (the files); every table derived or removed; the group/tier drift
class structurally eliminated (D4). `security`=powerful is now consistent everywhere, matching its
opus frontmatter and security-review criticality. The dynamic composer (OD-3) reads exactly this.

**Costs.** Wave-2 conform edits across ~5 docs/skills. team-compose loses its standalone §7 table
(becomes a derived/read view) — a small behavior change for that skill, bounded and gated here.

**Non-goals.** This ADR does not change the §2 auto-score rubric, the §3 advisor mechanism, or the
`models.tiers` host map — those remain as the cost-aware ADR defines them. It only fixes *which
default tier and group each specialist canonically has*, and *where that fact lives*.

## Supersedes

- `team-composition.md` 4-group table (groups) — superseded by D1.
- `team-compose/SKILL.md §7` tier assignments (tiers) — superseded by D2/D3.
- Any "ADR §7 roster row" citation for a specialist not in the cost-aware §7 5-row table — those
  citations were extrapolations; the canonical full-14 table is D2 here.
