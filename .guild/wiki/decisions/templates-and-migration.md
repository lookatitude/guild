---
type: decision
owner: architect
confidence: high
importance: high
source_refs: ["CONCEPT-BRIEF.md", "DECISIONS-LOCKED.md"]
created_at: 2026-05-17
updated_at: 2026-05-17
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [concept-integration, continuous-knowledge-and-learning-loop, guild-boundary-config-and-tracking, skill-creator, agent-and-skill-factory, skills-and-self-evolution, team-composition]
---

# ADR: Skill + agent templates, classifier, and lazy/staged migration (CR-B)

## Status

Accepted (2026-05-17). Binding. Inputs: `CONCEPT-BRIEF.md` Concepts 2/3/8 +
review questions 4, 5, 6, 7, 8, 9, 15; `DECISIONS-LOCKED.md` (DH-2 all
concept machinery `[v2]`; DH-3 plugin ships static read-only base assets,
`.guild/` holds project-authored/evolved instances + overrides; DH-5
superpowers/understand-everything = concept refs only, Guild-native, v2-EPP-1
exclusivity; N2 `personality` bounded enum + optional flavor line; D5
human-gated carve-out; agents-emit-candidates-only).

## Context

The word "template" did not appear in any factory, team-composition, or
architecture knowledge doc; `plugin/templates/{skills,agents}/` held only a
`.gitkeep`. The de-facto template was *imitation of a sample sibling file*.
Concept 2 and Concept 3 each demand five explicit mechanisms (canonical
template; creation; evolution; one-vs-template classifier; template-change →
migrate). The doc set shipped ~1.5/5 for skills and ~1/5 for agents. In
addition, `create-specialist` step 2/7 today drafts into `agents/proposed/`
and registers by moving files into `plugin/agents/` +
`plugin/skills/specialists/` — i.e. it **writes plugin state**, a real
pre-existing contradiction with DH-3.

## Decision

### Template artifacts (minimal/contractual, static read-only plugin state)

The plugin ships exactly two canonical templates as **static read-only
plugin install state** (DH-3):
`plugin/templates/skills/SKILL.template.md` (`guild.skill_template.v1`) and
`plugin/templates/agents/AGENT.template.md` (`guild.agent_template.v1`). Both
are **minimal/contractual, not prescriptive**: they pin frontmatter keys +
the required section-heading set only (the 9 skill-creator items / the 8
Persona-Structure items **+ the two CONCEPT-BRIEF §3 fields `operating_style`
+ `personality` as bounded enum slots**). **No body prose is templated.**
`writing-skills` (the superpowers fork) remains the *authoring discipline
that fills* the skeleton — it is a method, not the skeleton.

Per **N2**, agent `personality` is a bounded closed enum
`{terseness, pushback_posture, escalation_bias}` **plus one optional short
prose line** (flavor-only, length-capped, never trigger-bearing). Free-text
persona paragraphs are banned. `operating_style` and `personality` are
first-class `AGENT.template.md` slots.

### Instance/override placement (resolves the create-specialist defect)

Every project-authored or evolved agent/skill instance + override is written
to the consuming repo's `.guild/agents/` and `.guild/skills/` — never into
plugin state, never outside `.guild/`. Every instance frontmatter carries
`derived_from_template: guild.{skill,agent}_template.vN`.

> **DH-3 defect resolved (canonical):** `create-specialist` (and
> `evolve-skill` / any factory write) must draft + register-live into the
> consuming repo's `.guild/agents/` & `.guild/skills/`, with
> `derived_from_template` stamped at draft; the session-restart/registration
> note is unchanged; the plugin install dir is never written at runtime.
> The prior "move into `plugin/agents/`" behavior is an explicit **v2 defect
> to fix**.

### One-vs-template classifier (single mechanism, two entry points)

A single classifier — in `guild:reflect` and in the per-phase
LearningCheckpoint `{skill,agent}_template` columns
(see [continuous-knowledge-and-learning-loop](continuous-knowledge-and-learning-loop.md))
— buckets every agent/skill improvement proposal as **specific** (→ existing
per-instance evolve queue) or **systemic** (→ new
`.guild/evolve/template/{skill,agent}/<v>/` queue). Systemic requires ALL of:
(i) ≥3 distinct skills/agents (or ≥2 in one run), (ii) the **same
machine-checkable defect signature**, (iii) explicit user approval at the
interactive **template-change gate** (the only new gate introduced across the
concept pass; human-gated by construction, consistent with
agents-emit-candidates + D5). This **reuses the existing `create-specialist`
"≥3 unrelated runs" extraction-signal mechanic**, generalized from new-role
to template-change. One classifier, two entry points, one threshold.

### Migration (lazy + staged, never big-bang)

An approved template version bump records the new template + a **conformance
report** only — it mutates **zero** instances. **Additive** changes (a new
optional heading) follow the already-canonical lenient-reader rule (a `vN`
instance stays valid under a `vN+1` additive template — non-conformance note
only, no migration). Only a **breaking** change (renamed/removed required
heading) forces per-instance migration, and each runs through the **existing
`guild:evolve-skill` paired-eval + shadow gate**, lazily — either when the
instance is next evolved for its own reasons, or when an instance is
**explicitly selected for migration via the `/guild evolve` maintenance verb's
`<id>` positional + `--to-template=vN` flag**. That migration trigger is the
*only* lazy/staged trigger; its CLI surface is **canonically defined in
[command-surface.md](../architecture/command-surface.md) §3.5** (this ADR cites
it by pointer and does not re-spell the command spec — the ADR's trigger
description and the canonical command must not diverge). Migration is never a
bulk find-replace and never auto-applied.

### understand-everything / superpowers wiring (Q15, Guild-native)

superpowers adaptation is unchanged (already Guild-native + MIT-attributed +
zero runtime dep). The factory's extraction-signal computation **may read**
`.guild/indexes/knowledge-graph.json` + `.guild/reflections/` as a durable
alternative evidence source (read-only query; no new component, no MCP, no UA
machinery import). This is a query, not a coupling.

## `.guild/` structure delta (CR-B)

```
.guild/
  agents/                       # project-authored/evolved agent instances + overrides
  skills/                       # project-authored/evolved skill instances + overrides
  evolve/
    template/
      skill/<template-version>/
        proposal.md             # systemic-defect proposal (≥3-distinct + signature rule)
        conformance-report.md   # per-instance drift on a version bump
        migrations/<skill>.md   # status: conformant | needs-migration | manual
      agent/<template-version>/ # symmetric for agents
  skill-versions/               # (existing) per-skill rollback snapshots
```

Canonical templates stay read-only in `plugin/templates/`; all instances and
overrides are under `.guild/` (DH-3).

## Validation criteria (Concepts 2/3/8)

- **VC-F1 (skill template):** canonical `SKILL.template.md` exists with
  `template_version`; `create-specialist`/`writing-skills` cite it as the
  instantiation source; every shipped `SKILL.md` carries
  `derived_from_template`.
- **VC-F2 (agent template):** canonical `AGENT.template.md` exists with
  `template_version` and all 5 §3 fields (role, responsibilities,
  constraints, **operating_style**, **personality**) as bounded slots; every
  `agents/*.md` carries `derived_from_template`.
- **VC-F3 (classifier):** ≥3 distinct skills/agents with the same defect
  signature ⇒ a *template-defect* proposal (not N instance proposals) routed
  to `.guild/evolve/template/`; a single bad skill does NOT trigger it.
- **VC-F4 (migration):** a template version bump produces a conformance
  report + per-instance migration records; an **additive** bump migrates
  **zero** instances (lenient-reader, flags non-conformance only); a
  **breaking** bump forces per-instance gated `evolve-skill` runs and cannot
  proceed without the human template-change gate.
- **VC-F5 (DH-3):** no mint/evolve writes outside the consuming repo's
  `.guild/`; canonical templates stay read-only plugin state; every instance
  is traceable via `derived_from_template`; `create-specialist` targets
  `.guild/{agents,skills}/`, not plugin state.
- **VC-F6 (UA/superpowers, Q15):** superpowers adaptation is Guild-native +
  MIT-attributed + zero runtime dep; factory extraction signals can be
  sourced from the durable knowledge-graph/reflections, not only a raw run
  scan, with no new component or MCP.
- **VC-F7 (no-rigidity guard):** the skill template templates headings/keys
  only, no body prose; skill length distribution unchanged
  post-introduction.

## Phased plan slice (CR-B)

- **P4 — Templates & migration:** `SKILL.template.md`, `AGENT.template.md`;
  classifier; template-change gate; lazy/staged migration
  (`skill-creator.md`, `agent-and-skill-factory.md`, `team-composition.md`,
  `run-replay-and-evolution-workflows.md`, diagrams D-12/D-20). Depends on
  P1; P3 (the classifier shares the LearningCheckpoint column).

## Consequences

- The factory becomes template-driven and DH-3-clean; the
  `create-specialist`-writes-plugin-state contradiction is fixed.
- Migration blast radius is opt-in: additive = lenient-reader no-op, breaking
  = lazy gated per-instance evolve — reusing the existing pipeline, never
  inventing a new persistence philosophy.
- One new gate only (template-change); every other path reuses an existing
  surface.
