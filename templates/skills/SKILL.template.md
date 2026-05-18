---
# guild.skill_template.v1 — canonical minimal skill skeleton.
# Pinned frontmatter keys ONLY (fill values per instance; do not add prose here).
template_version: guild.skill_template.v1
name:
description:
when_to_use:
type:
---

<!--
  DH-3 BOUNDARY (static read-only plugin install state).
  This file is versioned with the plugin and is NEVER written at runtime.
  Every project-authored or evolved skill INSTANCE is written to the consuming
  repo's .guild/skills/ (never back into plugin state, never outside .guild/)
  and `derived_from_template: guild.skill_template.v1` is MANDATORY on every
  such instance's frontmatter for traceability to this canonical base (the
  template file itself is the canonical base, NOT an instance, so it carries
  no `derived_from_template`). A runtime write to plugin template state is a
  v2 defect.
  Boundary + version string canonical in:
    architecture/target-architecture.md §"Canonical template-version strings
    + derived_from_template invariant" (cited, never re-spelled).
  Contractual/minimal (VC-F7 no-rigidity guard): the headings below are the
  required section-heading SET only — labels, never templated body prose.
  Instantiation-source citers (VC-F1): `create-specialist` (mints instances
  from this skeleton into .guild/skills/) and `writing-skills` (the authoring
  discipline that fills the skeleton — a method, not the skeleton) cite this
  canonical template as their instantiation source; their bodies are NOT
  duplicated here.
  Required-heading set = the 9 skill-creator items
    (factory/skill-creator.md §"Skill Body Requirements", cited by pointer).
-->

# When to use it

# When not to use it

# Required inputs

# Output format

# Workflow steps

# Evidence requirements

# Escalation rules

# Safety constraints

# Eval cases
