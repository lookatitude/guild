---
# guild.agent_template.v1 — canonical minimal agent skeleton.
# Pinned frontmatter keys ONLY (fill values per instance; do not add prose here).
template_version: guild.agent_template.v1
name:
description:
model:
tools:
skills:
# operating_style — bounded enum slot (first-class §3 field, not free prose).
operating_style:
# personality — bounded CLOSED enum (N2): exactly the three axes below,
# PLUS one optional short flavor line (length-capped, never trigger-bearing).
# Free-text persona paragraphs are BANNED (prompt-bloat / routing-ambiguity).
# Canonical enum: see https://guildstack.dev/docs/architecture (agent personality
# binding — cited, never re-spelled here).
personality:
  terseness:
  pushback_posture:
  escalation_bias:
  flavor:            # optional, single short line, flavor-only
---

<!--
  DH-3 BOUNDARY (static read-only plugin install state).
  This file is versioned with the plugin and is NEVER written at runtime.
  Every project-authored or evolved agent INSTANCE is written to the consuming
  repo's .guild/agents/ (never back into plugin state, never outside .guild/)
  and carries `derived_from_template: guild.agent_template.v1` in its
  frontmatter. `create-specialist` / `evolve-skill` / any factory write
  targets .guild/{agents,skills}/ — a runtime write to plugin template state
  is a v2 defect. Boundary + version + personality enum canonical in the
  agent/skill factory design (see https://guildstack.dev/docs/architecture
  — cited, never re-spelled here).
  Contractual/minimal (VC-F7 no-rigidity guard): the headings below are the
  required-heading SET only (the 8 Persona-Structure items —
  factory/agent-and-skill-factory.md §"Canonical Agent Template", cited by
  pointer) — labels, never templated body prose. operating_style +
  personality are first-class bounded-enum frontmatter slots above.
  Instantiation-source citers (VC-F1/F2): `create-specialist` (mints agent
  instances from this skeleton into .guild/agents/) and `writing-skills`
  (the authoring discipline that fills the skeleton) cite this canonical
  template as their instantiation source; their bodies are NOT duplicated
  here. `derived_from_template: guild.agent_template.v1` is MANDATORY on
  every .guild/agents/ instance; the template file itself is the canonical
  base and carries none.
-->

# Role mission

# Responsibilities

# Trigger and do-not-trigger boundaries

# Constraints

# Expected artifacts, upstream dependencies, downstream handoff expectations

# Allowed tools and MCP requirements

# Review posture and evidence standard

# Failure and escalation rules
