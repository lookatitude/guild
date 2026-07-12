---
type: decision
owner: architect
confidence: high
importance: critical
source_refs:
  - .guild/wiki/decisions/canonical-specialist-roster-groups-and-tiers.md   # D1/D2/D4 inputs; partially superseded by this ADR
  - agents/                                                                 # machinery agents (advisor, developer)
  - templates/specialists/                                                  # the 15 domain type templates
  - scripts/lib/roster.ts                                                   # listSpecialistTemplates + mintFromTemplate
  - scripts/roster-resolve.ts                                               # the `mint <role>` CLI
  - skills/meta/team-compose/SKILL.md                                       # mintable classification (step 2)
created_at: 2026-07-12
updated_at: 2026-07-12
sensitivity: internal
---

# ADR: Machinery agents vs the specialist template library

## Status

**ACCEPTED (operator-directed, 2026-07-12).** Implements the operator rule: *orchestration
machinery lives on the plugin side; domain specialists live on the project side.* Partially
supersedes `canonical-specialist-roster-groups-and-tiers.md` — its D1 grouping, D2 tier
table, and D4 enumeration rule stand, but its notion of a **shipped, host-registered
14-specialist roster** is replaced by the template library below.

## Context

Until this ADR the plugin shipped 17 host-registered agents (`agents/*.md`): 14 product
specialists + `advisor`/`developer`/`doc-writer`. That contradicted the project-specialist
architecture shipped earlier (roster-resolve, definition-path dispatch, DH-3 mint
boundary): domain expertise belongs to the consuming project as tailorable
`.guild/agents/` instances, while the plugin is the factory. The audit (2026-07-12) found
the shipped `.md` roster was effectively a Claude-only surface (no other host package
shipped agent files), and every build/inventory consumer already enumerated the
filesystem — the placement, not the plumbing, was the defect.

## Decision

### D1 — The plugin ships exactly two registered agents: the machinery set

`agents/advisor.md` (the powerful escalation supervisor) and `agents/developer.md` (the
generic mid-tier lane worker). Both stay `augmenting: true` in roster resolution —
dispatchable, never domain-matched, never counted toward cap-6. There is no shipped
`orchestrator` agent: orchestration is lead-session behavior (`commands/guild.md`).

### D2 — Every domain specialist is a shipped TYPE TEMPLATE

The 15 domain roles (architect, researcher, backend, frontend, mobile, devops, qa,
security, copywriter, doc-writer, technical-writer, social-media, seo, marketing, sales)
live at `templates/specialists/<role>.md`, stamped `template_version:
guild.specialist_template.v1`. Same frontmatter shape as an agent file (name /
description / model / tools / skills — the D2 tier table of the roster ADR continues to
govern the `model:` values). Templates are read-only feedstock (DH-3): never dispatched,
never written at runtime.

### D3 — Deterministic mint, code not prose

`guild:team-compose` classifies a matched domain as *existing* (project instance),
*mintable* (template, no instance), or *gap* (neither). A mintable role is instantiated
by CODE: `roster-resolve.ts mint <role> --cwd .` → byte-preserving copy to
`.guild/agents/<role>.md` with `template_version:` swapped for `derived_from_template:`,
then the derived agents registry is refreshed. The CLI refuses to overwrite an existing
instance (exit 3 — the reuse signal) and fails closed on unknown/unstamped/unsafe names.
Template instantiation needs NO create-specialist gates — the trigger boundaries were
blessed when the template shipped. The full gated mint (`guild:create-specialist`)
remains the only path for NOVEL types.

### D4 — Dispatch is unchanged; domain lanes are always project instances

Minted instances dispatch via the existing definition-path rail (`definition_source:
project`, host-generic subagent type + definition-adoption prompt). `definition_source:
shipped` now occurs only for the machinery pair (and dev-team self-build agents under
`.claude/agents/`, which remain repo-internal and unshipped).

### D5 — Templates ship in every host package

`build-host-packages.ts` copies `templates/` into every installable host tree
(`copyTemplates`), and `verify-host-packages` requires `templates/specialists/` per
package — minting is host-neutral. The 58 `skills/specialists/**` families stay shipped
as the read-only skill library that templates (and their minted instances) reference.

## Consequences

- Host-native auto-routing to domain specialists (Claude subagent descriptions) no longer
  exists out of the box; domain routing flows through Guild composition + minted
  instances. This is the intended boundary, not a regression.
- The five hand-maintained mirrors changed in lockstep: `specialist-roster.ts`
  (`MACHINERY_AGENT_IDS` + `SPECIALIST_TEMPLATE_IDS`), the specialists manifest
  `owns.agents`, `docs/specialist-roster.md`, README/AGENTS.md prose, and
  `capability-catalogs.test.ts` (now also filesystem-pinned to both trees).
- `AUGMENTING_AGENT_IDS` = `{advisor, developer}`; `doc-writer` is an ordinary domain
  template.
- A project may still override or specialize any role — the project instance always wins
  the merged roster.
