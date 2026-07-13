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
  required-heading SET only — the shape every shipped machinery agent
  (`agents/*.md`) and specialist type template (`templates/specialists/*.md`)
  actually carries. They are LABELS, never templated body prose; the HTML notes
  under each say what the section covers so an author fills, not copies. Canonical
  authoring shape: https://guildstack.dev/docs/architecture (agent/skill factory
  — cited, never re-spelled here). operating_style + personality are first-class
  bounded-enum frontmatter slots above.

  Instantiation-source citers (VC-F1/F2): `create-specialist` (mints agent
  instances from this skeleton into .guild/agents/) and `writing-skills`
  (the authoring discipline that fills the skeleton) cite this canonical
  template as their instantiation source; their bodies are NOT duplicated
  here. `derived_from_template: guild.agent_template.v1` is MANDATORY on
  every .guild/agents/ instance; the template file itself is the canonical
  base and carries none.
-->

# <name>

<!-- Role mission: one paragraph — what this agent owns, which group it belongs to,
     and its default tier. State the tier explicitly (`**Default tier: `<tier>`**`,
     derived from `model:`); note that the auto-scorer picks the lowest viable tier
     per lane and a need above tier escalates to the `advisor`, never self-promotes. -->

## Skills pulled

<!-- One bullet per `skills:` entry: `` `<skill-name>` (<taxonomy tier: core|meta|
     knowledge|specialists>, <authoring status: exists | needs authoring>) `` — one
     line on what the skill contributes. `guild-principles` (core) is the mandatory
     prelude for every agent. Pull only the 2–5 skills the frontmatter lists. -->

## When to invoke

<!-- Trigger patterns expanded from the frontmatter `description` TRIGGER clause
     (what work routes here, with the expected output per pattern). Machinery agents
     may substitute a binding protocol section (e.g. an escalation/return-envelope
     contract) in place of trigger patterns. -->

## Scope boundaries

<!-- **Owned:** the concrete artifacts/decisions this agent produces.
     **Forbidden:** the adjacent lanes it must hand off (name the owning agent per
     boundary — the pushy DO-NOT-TRIGGER discipline). Close with the handoff line:
     list crossings under `followups:` per the `guild.handoff.v2` receipt contract
     (`skills/meta/execute-plan` §"Handoff protocol"). Never commit — main session does. -->
