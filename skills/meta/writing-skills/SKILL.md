---
# Derived from the canonical skill template (DH-3 boundary): instance frontmatter
# carries derived_from_template for traceability to the canonical base.
name: writing-skills
description: "The authoring discipline that fills the canonical SKILL.template.md skeleton — a method, not the skeleton. Guides how a new or evolved skill instance is written into .guild/skills/ with the required heading set and a derived_from_template stamp."
when_to_use: "When authoring a new skill instance or rewriting a skill body — invoked by create-specialist (which mints instances from the skeleton) and during evolve-skill body edits."
type: meta
derived_from_template: guild.skill_template.v1
---

> **Meta skill** — forked from `superpowers:writing-skills` v5.0.7 §13 (MIT, © 2025 Jesse Vincent). Guild-native adaptation, **zero runtime dependency** on superpowers. See `LICENSE-attribution.md`.

# When to use it

Use when a skill body must be written or substantially rewritten — minting a
new instance from the canonical skeleton, or authoring an evolved body. This
skill is the **method that fills** `plugin/templates/skills/SKILL.template.md`
(the skeleton is the canonical base; this is the discipline). Cited as the
instantiation-source authoring method by `create-specialist` (mints
instances into `.guild/skills/`) per the template's VC-F1 note.

# When not to use it

Not for the skeleton itself (that is the canonical template — static
read-only plugin state, never runtime-written). Not for evolving a skill's
description/trigger only (`guild:evolve-skill` owns the pipeline; this is the
body-authoring craft it calls). Not for agent/specialist authoring (that is
the AGENT template lineage). Not for writing commands or hooks.

# Required inputs

- The canonical skeleton `SKILL.template.md` (pinned frontmatter keys + the
  9 required heading labels) — by pointer, never re-spelled.
- The target skill's purpose, triggers, and boundary against existing
  skills.
- The target write location: the consuming repo's `.guild/skills/` (never
  plugin install state).

# Output format

A skill instance `SKILL.md` under `.guild/skills/<id>/` carrying: the
template frontmatter keys (`name`, `description`, `when_to_use`, `type`),
the **mandatory** `derived_from_template: guild.skill_template.v1` stamp,
and **all 9 required headings** (When to use it / When not to use it /
Required inputs / Output format / Workflow steps / Evidence requirements /
Escalation rules / Safety constraints / Eval cases). Headings are the
required label set only (VC-F7 no-rigidity guard) — body prose is authored,
not templated.

# Workflow steps

1. Resolve the canonical skeleton by pointer (do not copy the template
   file; do not write to plugin template state).
2. Define the skill's trigger surface and its boundary vs sibling skills.
3. Author each of the 9 required sections with concrete, evidence-bearing
   content (no filler).
4. Stamp `derived_from_template: guild.skill_template.v1` on the instance
   frontmatter (mandatory for traceability to the canonical base).
5. Write the instance under `.guild/skills/<id>/SKILL.md`.
6. Hand to the eval/promotion path (`guild:evolve-skill`) — never
   self-promote.

# Evidence requirements

Every authored section makes a checkable claim (trigger examples, real
inputs, concrete eval cases). The `derived_from_template` stamp is present
and matches the template version string. The boundary section names the
specific sibling skills it must not collide with.

# Escalation rules

Trigger overlap with an existing skill → flag for boundary review (do not
ship a colliding instance). Missing required heading or absent
`derived_from_template` → reject the draft, do not write. A request to write
into plugin template state → refuse (DH-3 boundary; that is a v2 defect).

# Safety constraints

Instances are written only under the consuming repo's `.guild/skills/`,
never back into plugin state, never outside `.guild/` (DH-3 boundary,
canonical in `architecture/target-architecture.md`, cited by pointer). The
canonical template file is never runtime-written. No network egress.

# Eval cases

- New skill request → instance under `.guild/skills/` with all 9 headings +
  `derived_from_template` stamp present.
- Draft missing a required heading → rejected before write.
- Attempt to edit `plugin/templates/skills/SKILL.template.md` at runtime →
  refused as a boundary violation.
- Trigger collides with a sibling skill → flagged for boundary review, not
  shipped.
