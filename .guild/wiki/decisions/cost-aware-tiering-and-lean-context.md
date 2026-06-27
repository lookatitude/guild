---
type: decision
owner: architect
confidence: high
importance: critical
source_refs:
  - .guild/spec/cost-aware-tiering-and-lean-context.md            # goal, D1/D2/D3, SC-1..12, non-goals, constraints
  - .guild/research/cost-techniques.md                            # cost claims + recommended-defaults table (cited)
  - docs/knowledge/decisions/config-surface-settings-json.md      # settings.json closed-key surface + reject rules
  - docs/knowledge/architecture/command-surface.md                # §4.4 settings schema (canonical key-set ref)
  - docs/knowledge/decisions/v2x-command-surface-dispatch-and-internalization.md  # D5 agent_mode dispatch ladder
  - docs/knowledge/architecture/target-architecture.md            # §handoff_receipt contract (frozen guild.handoff_receipt.v1)
  - docs/knowledge/decisions/guild-boundary-config-and-tracking.md # CR-D .guild/ ownership map + closed-key config
  - plugin/skills/meta/context-assemble/SKILL.md                  # 3-layer bundle, ~3k target / 6k hard cap
  - plugin/skills/knowledge/learn-map/SKILL.md                    # two-phase script+LLM learn pipeline
  - docs/knowledge/implementation/contract-map.md                 # contract registry (new schema registered here)
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [config-surface-settings-json, v2x-command-surface-dispatch-and-internalization, guild-boundary-config-and-tracking, workspace-aware-init-and-federation, continuous-knowledge-and-learning-loop, command-surface, target-architecture]
---

# ADR: Cost-aware model tiering, lean lead + per-agent context-pull, and the §task§agent lifecycle

## Status

Accepted (2026-05-26). Operator approved at the architecture major-gate
("Approve & build"); open items O-1..O-4 are resolved in the "Open items"
section below and are binding for implementation. Additive to the frozen v2 contract set: it
introduces **one new self-versioned dispatch envelope** (`guild.handoff.v2`,
the lead↔agent return schema — distinct from and *not* superseding the frozen
`guild.handoff_receipt.v1` review/verify receipt), **new closed-key
`settings.json` additions** (all under the existing closed-key reject regime),
and **behavior branches** inside dispatch, `context-assemble`, and the `learn-*`
family. Tiering is **orthogonal** to backend selection: it composes with the D5
`agent_mode` ladder, never replaces it. Zero-config repos keep current behavior
except cheaper learn (the built-in tier-map biases cheap).

Inputs: the spec's three locked decisions (D1 host-agnostic model ladder; D2
auto-score + config + per-lane override + advisor escalation; D3 ephemeral
§task§agent lifecycle), SC-1..12, the non-goals (no Gemini/third host now; no
persistent agent pool; no new MCP server; no auto-promotion of learned
knowledge; pane option preserved), and the research file's six technique
sections + the "Recommended Defaults" table (cited inline as evidence).

## Context

Every unit of LLM work in Guild today runs on whatever the dispatching backend
selects, with no notion of "cheapest model that can do this task." The lead
absorbs full specialist transcripts; agents receive broadcast project context;
inter-agent messages are free-form prose; and `learn-*` runs its LLM halves at a
single (expensive) tier regardless of whether the work is pure I/O or
high-judgment relationship extraction. The research lane quantifies the waste:
routing 85% of queries to cheaper models preserves ~95% of frontier quality at
45–85% cost reduction (RouteLLM / TianPan; `cost-techniques.md §1`); a Haiku-class
model handles 80% of document processing at ~6% of Opus-class cost for ~80%
accuracy (`§5`); structured JSON inter-agent messages cut token overhead 73% and
raise task accuracy 34% over prose (G²CP, `§4`); prompt caching drops a 100-turn
Opus session from $50–100 to $10–19 at ~90% hit rate (`§2`).

The mechanisms to capture this are already in place: the Agent tool's `model`
param (`haiku|sonnet|opus`) is the tiering lever within Claude; per-agent
`model:` frontmatter already exists; `guild-memory` (BM25 over `.guild/wiki/`
with `cwd` override) + `kg-query` already give agents a recall path; the D5
`agent_mode` ladder already governs the execution backend. What is missing is
(a) a host-agnostic tier→model map and an auto-scorer to pick the tier, (b) a
compact typed return envelope so the lead stays lean, (c) a recall-before-read
discipline so each agent pulls only its task context, (d) an escalation protocol
so a cheap agent gets one powerful sub-answer instead of a wholesale re-run, and
(e) an ephemeral one-agent-per-task lifecycle. This ADR freezes all five plus
the supporting roster, learn-tiering, caching guidance, and config keys.

## Decision

### 1. Model tier ladder — host-agnostic seam (D1)

Tiers are the stable vocabulary: **`cheap | mid | powerful`**. The
**host-agnostic** tier→model map lives in `settings.json` as
`{tier: {claude, codex, gemini}}` so a Codex/Gemini adapter slots in later as
**config + an adapter, not a redesign** (spec Assumption; mirrors the
host-agnostic discipline of the frozen `guild.handoff_receipt.v1`). Built-in
default (zero-config), per the research "Recommended Defaults" model-tier table
(`cost-techniques.md §"Recommended Defaults"`):

```jsonc
"models": {
  "tiers": {
    "cheap":    { "claude": "haiku",  "codex": null, "gemini": null },
    "mid":      { "claude": "sonnet", "codex": null, "gemini": null },
    "powerful": { "claude": "opus",   "codex": null, "gemini": null }
  }
}
```

- **cheap = haiku** → read, tokenize, chunk, summarize, classify/tag (pure I/O,
  template-guided, low ambiguity).
- **mid = sonnet** → draft, reason, plan subtasks, single-doc + cross-file
  relationship extraction (default task-agent tier).
- **powerful = opus** → architecture decisions, security review, graph
  schema/topology, advisor/critic passes (high-stakes, low frequency).

`codex`/`gemini` are **`null` now** (no third host — non-goal). A `null` host
slot means "this host has no model for this tier; fall through to the selected
host's mapping." The seam is **designed, not wired**: adding Codex is a future
config edit + adapter, recorded as a follow-on. Within Claude the map binds
directly to the Agent tool `model:` param.

### 2. Complexity auto-score + tier selection (D2)

The orchestrator scores each lane's complexity from **deterministic signals**,
maps the score to a tier, and **prints the score + chosen tier** (never silent —
spec Risk: "scores are surfaced, not silent"). One-shot routing, per
`cost-techniques.md §1` (a classifier scores upfront and dispatches to a tier).

**Rubric (signals → score → tier).** Signals (each contributes a small integer;
weights are config-tunable but ship fixed): work-type verb (read/summarize=0,
draft/extract=+1, architect/review/schema=+2), declared blast-radius / file
count, presence of an upstream `depends-on:` contract, security/correctness
sensitivity flag, prior-attempt escalation on this lane (+1, sticky for the
run). Sum → band:

| Score band | Tier | Typical work |
|---|---|---|
| 0 | `cheap` | file read, summarize, classify, tag |
| 1–2 | `mid` | draft, reason, plan, extract relationships |
| ≥3 | `powerful` | architecture, security review, graph schema |

**Precedence (normative, mirrors the established config ladder):**
**`--model-tier=` CLI escape hatch > per-lane plan override > `settings.json`
tier-map/thresholds > built-in default.** A plan lane may pin a tier
(`model_tier: powerful`) when the author knows the auto-score will under-call.
Scoring is **deterministic** (same inputs → same tier) so a dispatch trace is
reproducible. The score and resolved tier are recorded in the run record and
printed in the dispatch line. Cost discipline (spec constraint): a `powerful`
invocation must be justified by the score, an explicit override, or an advisor
request — the default biases cheap.

### 3. Advisor escalation (cheap labor, expensive supervision on demand)

When a low-tier agent hits something above its tier it gets **one powerful
sub-answer for that sub-question only**, then continues — it is **not** re-run
wholesale on the expensive model (spec D2; `cost-techniques.md §1` advisor/critic
pattern, §"Advisor-Escalation Rule").

**Protocol.**
1. A low-tier agent emits `status: "escalate"` + an `escalate_reason` in its
   `guild.handoff.v2` envelope (see §5). The coordinator **also** triggers on
   the research heuristics: uncertainty markers in output (config
   `escalationMarkers`, e.g. "I'm not sure", "unclear", "cannot determine") OR
   anomalously short output for the task type (`cost-techniques.md §1`
   escalation heuristic — calibrated, not absolute).
2. A `powerful` **advisor** answers **that sub-question only**, seeing the
   **draft + the question + a compact critique instruction (~50 tokens)** — and
   crucially **never the raw file context** (`§1`: "the strong model sees only
   the candidate + a compact audit prompt"). This is what keeps the expensive
   call cheap.
3. The advisor returns via the same `guild.handoff.v2` envelope; the original
   cheap agent **continues** with the advisor's answer folded in.
4. **Round cap** mirrors the existing `codex_cap`/`loop_cap` discipline: a new
   `models.advisorRounds` (default `2`) caps advisor consults per lane;
   exhaustion records the lane `inconclusive: advisor budget exhausted` rather
   than silently escalating cost (mitigates the spec's "advisor chattiness"
   risk).
5. **Trail location.** The escalation trail (trigger, sub-question, advisor
   tier, result ref, round count) is recorded in the run record under
   `.guild/runs/<run-id>/` (alongside the dispatch trace), so SC-6 is verifiable.

### 4. Lean lead + recall-before-read + per-agent context-pull

**Lean lead.** The coordinator dispatches **by pointer**, never absorbs full
specialist transcripts, and consumes only compact `guild.handoff.v2` envelopes
(§5). It holds **last-N envelopes in full + a rolling summary** of older work,
and **recomputes at a capacity threshold** (`cost-techniques.md §4`: trigger at
~70% of context capacity; default last-N = 5). For technical artifacts
(file paths, error codes, identifiers) it uses **compaction (verbatim pruning),
not summarization** — 98% verbatim accuracy, zero hallucination, reversible
(`§4`); rolling summary is reserved for narrative/reasoning history where
paraphrase is safe. Full transcripts remain in `.guild/runs/` for audit; they
never enter lead context.

**Recall-before-read + per-agent context-pull.** Each agent assembles its **own**
task-scoped context by **querying the knowledge base** (wiki/KG/memory via
`guild-memory` BM25 + `kg-query`) for exactly its task — not a broadcast of the
whole project (spec area 3). The **recall-before-read rule**
(`cost-techniques.md §3`, §"Recall-Before-Read Rule"): before an agent reads a
file, recall the task description against the wiki; if recall returns ≥1 chunk
with **score ≥ threshold** (`models.recallScoreThreshold`, default `0.4`), the
agent receives the chunk(s) + specific file references and **skips the full file
read**. Full reads are permitted only when recall returns 0 hits OR the task
requires source-of-truth verification (e.g. `verify-done`). KG traversal is
bounded (default 2 hops; `§6`) and reserved for relationship-heavy queries.
**The 6k hard cap is unchanged**: `context-assemble` becomes agent-driven pull +
cap, but the ~3k target / **6k hard-cap** budget and its summarization-on-overflow
rules stand verbatim (`context-assemble/SKILL.md §"Size budget"` — bound by
pointer, not re-spelled).

### 5. Structured handoff/return schema — `guild.handoff.v2` (canonical body)

A **new self-versioned** typed envelope for lead↔agent and agent↔agent dispatch
communication. **It does NOT supersede the frozen `guild.handoff_receipt.v1`**
(the host-agnostic specialist→review/verify receipt at
`target-architecture.md §"handoff_receipt contract"`): that receipt remains the
G6 review/verify linchpin. `guild.handoff.v2` is the **lighter, in-flight
dispatch envelope** the coordinator accumulates instead of prose transcripts
(`cost-techniques.md §4`: typed JSON cuts inter-agent overhead 73%, raises
accuracy 34%). It is **registered in the contract map as a new self-versioned
sibling owned by this ADR**; skills/scripts bind it **by pointer** and never
re-spell it. Canonical body (the single source of truth — defined once here):

```jsonc
{
  "schema_version": "guild.handoff.v2",   // self-versioned; lenient-reader
  "task_id": "backend-api-001",            // required; the task this envelope answers
  "tier": "cheap|mid|powerful",            // required; the tier that produced this
  "status": "done|blocked|escalate",       // required; terminal disposition
  "summary": "<= ~100 token outcome>",     // required; prose ONLY here (size-capped)
  "artifacts": ["<file>:<line-range>"],    // required (may be []); pointers, never dumps
  "issues": ["<typed issue>"],             // required (may be []); typed, not prose blobs
  "escalate_reason": null,                 // required-when status==escalate; the sub-question
  "learnings": []                          // optional; candidate notes for the run record (§6)
}
```

**Binding rules.** Every list field is required-but-may-be-empty (`[]`) — same
discipline as `guild.handoff_receipt.v1`. Prose is permitted **only** in
`summary`, capped at ~100 tokens (`cost-techniques.md §"Structured
Communications Default"`); an optional bounded free-text `notes` may be added at
implementation time to mitigate the spec's "schema rigidity" risk, size-capped.
A **lint/validation step rejects free-form bloat** (SC-7): a return that is not
a valid `guild.handoff.v2` envelope (or that over-runs the `summary` cap) is a
dispatch defect. On terminal completion the agent's `guild.handoff.v2` envelope
is the input from which the **frozen `guild.handoff_receipt.v1`** is produced for
review/verify — the two compose (in-flight envelope → durable receipt), they do
not compete. The exact compose relationship in the durable receipt — v1
frontmatter as the human-review wrapper that **embeds exactly ONE** fenced
`guild.handoff.v2` block as the machine truth — is fixed by
[`communication-format-policy.md`](communication-format-policy.md)
§"Handoff contract"; this section defines only the in-flight envelope body.

### 6. §task§agent lifecycle — ephemeral, one-per-task (D3)

**One agent per task; never shared across tasks; never left idle.** The
**default execution unit is an ephemeral per-task agent** (a short-lived
subagent / short-lived teammate spawned for exactly that task), **not** a
persistent pane. This is orthogonal to and composes with the D5 `agent_mode`
ladder: D5 picks the *backend* (team/agent/subagent) — resolved once at run-start
intake and frozen in the run's resolved-settings snapshot — this decision fixes
the *lifecycle* (ephemeral, per-task) on whichever backend D5 selects. The
visible-pane team backend remains a D5-selectable option (non-goal: no removal of
the pane option).

**Sequence: spawn → work → extract → dismiss.**
1. **Spawn.** Dispatch creates a new agent for the task at its resolved tier
   (§2), with its pulled task-scoped context (§4). Two concurrent tasks get two
   **distinct** agents (never shared — SC-8).
2. **Work.** The agent executes, escalating via §3 if it hits something above
   its tier.
3. **Extract.** On completion the agent extracts **learnings** into its
   `guild.handoff.v2` envelope (`learnings[]`), which the coordinator lands in
   the **run record** (`.guild/runs/<run-id>/`) and, where the gated reflection
   policy applies, into **gated reflections** (`.guild/reflections/` via
   `reflect`). Learnings are **candidates only** — no auto-promotion (non-goal;
   promotion stays with `wiki-ingest`/`decisions`).
4. **Dismiss.** The agent **terminates**. No idle agents persist; the next task
   is a **new** agent. This is why the default is an ephemeral per-task agent and
   not a long-lived worker pool (non-goal: no persistent always-on pool).

### 7. Roster + default tiers

New agent types, each with a **default tier** and a one-line scope. These
**augment** the existing dev-team/specialist rosters (they do not replace the 14
specialists or dev-team agents); boundary/trigger blocks are updated and
DO-NOT-TRIGGER scans kept clean (SC-9):

| Augmenting type | Default tier | Scope (one line) |
|---|---|---|
| `advisor` | `powerful` | Answer **one** escalated sub-question seeing draft + question only (§3); never raw context. |
| `developer` | `mid` | Implement a domain-less task lane (draft/reason/build); escalates to advisor when above tier. |
| `doc-writer` | `mid` | Write/update docs from a settled decision (`cheap` only as the §2 auto-scorer drop for mechanical edits — not the default; D3). |

> **Scope note:** this table tabulates only the three **augmenting-worker** types
> (`advisor` / `developer` / `doc-writer`) — roles that are NOT among the 14 shipping
> specialists. The canonical **full-14 per-specialist default-tier table** (including
> `researcher` and `architect`, which are shipping specialists) lives in
> [`canonical-specialist-roster-groups-and-tiers.md`](./canonical-specialist-roster-groups-and-tiers.md)
> (D2) — it derives each specialist's default tier from its agent-file `model:`
> frontmatter via the §1 ladder. Not duplicated here (single-source per that ADR's
> D4 enumeration rule). Per D3 the default tier is a single value; `cheap→mid` notation
> is retired — `cheap` is the §2 scorer drop, never a dual-valued default.

**Gap surfaced:** there is **no dedicated reviewer/critic agent type** in this
list — review/critic work is handled by the `advisor` (powerful) escalation pass
and the existing `guild:review`/`qa` lanes; no new always-on reviewer agent is
introduced (keeps the roster minimal, simplicity-first). See Open Item O-1 if the
operator wants a standalone reviewer type.

### 8. Learn-pipeline tiering

`learn-*` LLM halves map to tiers; the deterministic **script halves stay free**
(no LLM) — unchanged (`learn-map/SKILL.md §"two-phase"`). Per
`cost-techniques.md §5` (three-tier KG-construction pattern: Haiku=I/O,
Sonnet=single-doc extraction/classify, Opus=cross-doc relationships + schema):

| Learn stage (LLM half) | Tier | Rationale (cited) |
|---|---|---|
| file read / scan | `cheap` | pure I/O (`§5` Haiku-class) |
| chunk + per-file summarize | `cheap` | template-guided, low ambiguity (`§5`) |
| categorize + tag (taxonomy) | `mid` | single-doc classification (`§5` Sonnet-class) |
| cross-file/topic relationship extraction | `mid` | moderate judgment, high volume (`§5`) |
| graph edge validation + schema/topology | `powerful` | high-stakes, low frequency (`§5` Opus-class) |

`powerful` (graph schema) is invoked **only** when an edge-candidate count
exceeds a configurable threshold OR a `mid` agent flags `escalate` in its typed
output (`§5`). A regular `/guild:init` cheap-scan **never** invokes `powerful`
(SC-1). A learn run updates **memory + wiki + KG in one pass** (SC-2), each store
carrying `source_refs`, as **candidates only** — no auto-promote (non-goal).

### 9. Caching strategy (guidance Guild should follow)

The 3-breakpoint plan from `cost-techniques.md §2` + §"When to Cache" — adopted
as **guidance** (Anthropic prompt caching; cache reads ~10% of base input,
writes 125%/200%; ≤4 breakpoints; breakpoints only on stable content):

| Content | TTL | Breakpoint |
|---|---|---|
| Coordinator system prompt + full tool definitions | `1h` | 1st (stable across the session) |
| `guild-memory` wiki context for the task domain | `1h` | 2nd (stable within an agent's lifecycle) |
| Task-specific recall (RAG) result | `5m` | 3rd (after wiki, before user message) |
| Task description + variable content | uncached | after all breakpoints |

**Rule:** never place a breakpoint on content that changes between turns. TTL
hints surface as config (`models.cacheTTL.coordinator` default `"1h"`,
`models.cacheTTL.leaf` default `"5m"`). Caches are model-specific, so tier
switches use separate sub-agent processes (`§2`) — which the ephemeral per-task
lifecycle (§6) already gives us for free.

### 10. Config keys (new closed-key `settings.json` additions)

All additions land under the existing **closed-key** regime
(`config-surface-settings-json.md`): unknown keys rejected at intake, validated,
documented in the `_help` block, scaffolded by `/guild config init`. **Defaults
preserve zero-config behavior** (the built-in tier-map biases cheap; absent block
⇒ current v2 except cheaper learn — SC-10). New top-level `models:` block:

| Key | Allowed values | Default | Meaning |
|---|---|---|---|
| `models.enabled` | bool | `true` | Master toggle for cost-tiering. |
| `models.tiers` | `{cheap,mid,powerful}: {claude,codex,gemini}` (host→model\|null) | the §1 map | Host-agnostic tier→model map (D1). |
| `models.scoreWeights` | object (signal→int) | the §2 rubric | Auto-score signal weights (tunable; ship fixed). |
| `models.thresholds` | `{mid:int, powerful:int}` | `{mid:1, powerful:3}` | Score-band cutoffs (§2). |
| `models.advisorRounds` | int > 0 | `2` | Advisor consults per lane (§3 cap). |
| `models.escalationMarkers` | string[] | research defaults | Uncertainty phrases that trigger escalation (§3). |
| `models.recallBeforeRead` | bool | `true` | Enforce recall-before-read (§4). |
| `models.recallScoreThreshold` | float 0–1 | `0.4` | Min recall score to skip a file read (§4). |
| `models.structuredOutputRequired` | bool | `true` | Reject non-`guild.handoff.v2` returns (§5). |
| `models.cacheTTL.coordinator` | `"1h"\|"5m"\|off` | `"1h"` | Coordinator cache TTL hint (§9). |
| `models.cacheTTL.leaf` | `"1h"\|"5m"\|off` | `"5m"` | Leaf-agent cache TTL hint (§9). |
| `models.importanceGate` | int 1–5 | `3` | Min wiki importance for routine recall (`§6`). |

A single **CLI escape hatch** `--model-tier=cheap|mid|powerful` pins the tier for
a run (top of the precedence ladder, §2) — the only new flag, per the spec's
"prefer config over new CLI flags" v2-grammar constraint.

## Validation criteria (tied to spec SC-1..12)

- **VC-1 (SC-1, learn tiering):** `learn-*` runs read/summarize on `cheap`,
  categorize/extract on `mid`, graph-schema on `powerful`; the token/cost split
  is recorded per run; a plain `/guild:init` cheap-scan invokes **zero**
  `powerful` calls.
- **VC-2 (SC-2, three-store update):** one learn run updates memory + wiki
  candidate + KG nodes/edges in one pass, each with `source_refs`; no store left
  stale; nothing auto-promoted.
- **VC-3 (SC-3, lean lead):** per-lane lead intake is a size-capped
  schema-validated `guild.handoff.v2` envelope; full transcripts never enter
  lead context; measured lead context growth per lane ≤ the set budget.
- **VC-4 (SC-4, agent self-context):** a dispatched agent assembles its context
  via KB query ≤ the `context-assemble` **6k hard cap**, demonstrably scoped to
  its task (not the whole project).
- **VC-5 (SC-5, tier selection):** each lane is scored + dispatched at the lowest
  viable tier; tier-map + thresholds honored; per-lane override works; precedence
  **`--model-tier` > per-lane > settings > built-in** holds; scores printed.
- **VC-6 (SC-6, advisor):** a low-tier agent emitting `escalate` gets a
  `powerful` advisor answer for that sub-question (advisor sees draft + question,
  not raw context), then continues — no wholesale re-run; the trail is recorded;
  `advisorRounds` cap enforced.
- **VC-7 (SC-7, structured comms):** lead↔agent / agent↔agent exchanges conform
  to `guild.handoff.v2`; the lint rejects a planted free-form / over-cap return;
  the schema is documented once (here) and bound by pointer.
- **VC-8 (SC-8, lifecycle):** dispatch is one-agent-per-task; on completion
  learnings are extracted + the agent terminated; no idle agents persist; two
  concurrent tasks get two distinct agents — verified by a dispatch trace.
- **VC-9 (SC-9, roster):** the new agent definitions exist (researcher,
  architect, advisor, developer, doc-writer) each with a default tier;
  boundary/trigger blocks updated; adjacent DO-NOT-TRIGGER scans clean.
- **VC-10 (SC-10, config):** the `models:` keys land in `settings.json`
  (closed-key, validated, in `_help`), scaffolded by `/guild config init`;
  zero-config default preserved (built-in cheap-biased tier-map).
- **VC-11 (SC-11, docs):** architecture + dispatch + learn + roster docs + this
  ADR reflect the model; `CLAUDE.md` updated; `MIGRATION.md` notes the
  `models:` surface addition + the `--model-tier` flag.
- **VC-12 (SC-12, tests):** tier-selection, advisor-escalation trace,
  `guild.handoff.v2` schema validation, learn-tiering routing, and §task§agent
  lifecycle are eval/test-covered; existing suites stay green.

## Open items (RESOLVED by operator 2026-05-26)

**Resolutions (binding):** **O-1** → no standalone reviewer type; fold critic/review into the `advisor` pass + existing `guild:review`/`qa`. **O-2** → **SHIP** the single `--model-tier` CLI escape hatch (config stays primary; top of the precedence ladder). **O-3** → **DEFER** the "short-output" heuristic (tune after build); the deterministic `status: escalate` + uncertainty-marker triggers ship now. **O-4** → **INCLUDE** an optional, size-capped `notes` (≤200 chars) field in the `guild.handoff.v2` canonical body now (not v2.1).

Original items (for traceability):


- **O-1 — Standalone reviewer agent type?** §7 folds critic/review work into the
  `advisor` escalation pass + existing `guild:review`/`qa` lanes and adds **no**
  dedicated reviewer agent. If the operator wants a first-class `reviewer` type
  (its own tier + boundary block), say so — otherwise the minimal roster stands.
- **O-2 — `--model-tier` flag: ship or defer?** The spec marks the single CLI
  escape hatch "TBD in plan." This ADR specifies it (top of the precedence
  ladder) but its inclusion is the operator's call; per-lane override + config
  already satisfy SC-5 without it.
- **O-3 — Escalation short-output heuristic calibration.** The "anomalously
  short output" trigger (§3) is per-domain and needs calibration data the build
  will produce; the explicit `status: escalate` + uncertainty-marker triggers are
  deterministic and ship regardless. Flagging the heuristic as tune-after-build,
  not block-the-gate.
- **O-4 — `notes` free-text field in `guild.handoff.v2`.** The spec's
  schema-rigidity mitigation suggests an optional size-capped `notes`. This ADR
  leaves it **optional, added at implementation** rather than freezing it in the
  canonical body now — confirm whether to bake it into v2 or hold for v2.1.

## Consequences

- Guild captures the research-quantified cost savings (45–85% routing, ~6%
  Haiku-class document processing, 73% inter-agent token reduction, ~90%
  cache-hit Opus sessions; `cost-techniques.md §1/§2/§4/§5`) while preserving
  quality via the advisor safety net and configurable tier-map.
- The lead stays lean (compact typed envelopes + compaction), agents pull only
  their task context (recall-before-read under the 6k cap), and learn runs are
  cheap by default — directly serving the spec's four goal areas.
- One new self-versioned contract (`guild.handoff.v2`) is registered in the
  contract map and owned here; it **composes with**, never supersedes, the
  frozen `guild.handoff_receipt.v1`. No frozen `guild.*.v1` field set changes.
- Tiering is orthogonal to the D5 `agent_mode` ladder and the existing
  `host`/backend semantics — additive, backward-compatible, zero-config-stable.
- The host-agnostic seam means adding Codex/Gemini later is config + an adapter,
  honoring the "no third host now" non-goal without painting a future corner.
- Risks are mitigated as the spec requires: cheap-model quality loss (advisor +
  configurable tiers + `mid` fallback); advisor chattiness (`advisorRounds`
  cap + trail); auto-score misjudgment (thresholds + per-lane override + advisor
  net + surfaced scores); schema rigidity (optional bounded `notes`, O-4).
