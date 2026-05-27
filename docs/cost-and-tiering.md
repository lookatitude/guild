# Cost and Model Tiering

Implements `guild-plan.md §CLAUDE.md §"Model tiering + §task§agent lifecycle"`.

Normative ADR: `/Users/miguelp/Projects/guild/docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md`
(§1 tier ladder · §2 auto-score · §3 advisor · §4 lean lead + recall · §5
handoff schema · §6 lifecycle · §8 learn tiering · §10 config keys).

This document is the user-facing summary. All normative detail lives in the ADR
above. Config keys are documented in [`configuration.md`](configuration.md) —
they are not re-spelled here.

---

## The three tiers

| Tier | Claude model | Typical work |
|---|---|---|
| `cheap` | haiku | File read, tokenize, chunk, summarize, classify, tag — pure I/O, template-guided, low ambiguity. |
| `mid` | sonnet | Draft, reason, plan subtasks, single-doc + cross-file relationship extraction. **Default task-agent tier.** |
| `powerful` | opus | Architecture decisions, security review, graph schema/topology, advisor/critic passes — high-stakes, low frequency. |

The tier→model map is **host-agnostic**: it lives in `settings.json` under
`models.tiers` as `{ cheap, mid, powerful } → { claude, codex, gemini }`.
Codex/Gemini slots are `null` now (non-goal); adding a host later is a config
edit + adapter, not a redesign.

## Auto-scoring a lane

For each lane the orchestrator computes a **complexity score** from deterministic
signals and maps it to a tier:

| Score band | Tier |
|---|---|
| 0 | `cheap` |
| 1–2 | `mid` |
| ≥ 3 | `powerful` |

**Signals** (each contributes a small integer; weights are tunable via
`models.scoreWeights`):

- `workType` verb: read/summarize → 0; draft/extract → +1; architect/review/schema → +2.
- Declared blast-radius or file count: moderate → +1; high → +2.
- Upstream `depends-on:` contract present → +1.
- Security/correctness sensitivity flag → +1.
- Prior-attempt escalation on this lane → +1 (sticky for the run).

Score and resolved tier are **printed at dispatch** — never silent. A
`powerful` invocation must be justified by the score, an explicit lane
override, or an advisor request; the default biases cheap.

### Precedence (normative)

```
--model-tier=<tier>  CLI flag      (top — run-level escape hatch)
  > model_tier: <tier> in plan     (per-lane override)
    > settings.json models:        (repo config)
      > built-in default           (cheap-biased tier-map)
```

Use `--model-tier` only as a one-off escape. Permanent adjustments belong in
`settings.json` or the plan lane. See [`configuration.md`](configuration.md)
for all `models.*` config keys.

## Advisor escalation

When a low-tier agent hits something above its tier, it gets **one** powerful
sub-answer for that sub-question only — it is **not** re-run wholesale on the
expensive model.

**Three triggers** cause advisor escalation:

1. **Explicit signal** — the agent emits `status: "escalate"` plus an
   `escalate_reason` in its `guild.handoff.v2` envelope.
2. **Uncertainty markers** — the coordinator detects uncertainty phrases in the
   output (e.g. "I'm not sure", "unclear", "cannot determine") matching the
   `models.escalationMarkers` list.
3. **O-3 short-output heuristic** — output token count falls below the
   per-`(task_type, tier)` floor stored in `models.shortOutputThreshold` (see
   below). This trigger is **silent until the bucket has ≥30 calibration
   samples**; before that, only triggers 1 and 2 apply.

**Protocol.** The advisor receives only the draft + the escalated sub-question
+ a compact critique instruction (~50 tokens). It **never** sees raw file
context — this is what keeps the expensive call cheap. The original agent
continues with the advisor's answer folded in.

**Round cap.** `models.advisorRounds` (default `2`) caps advisor consults per
lane. Exhaustion records the lane `inconclusive: advisor budget exhausted`
rather than silently escalating cost. The escalation trail (trigger,
sub-question, advisor tier, result, round count) is recorded under
`.guild/runs/<run-id>/`.

## O-3 short-output threshold — calibration

The `models.shortOutputThreshold` key (see [`configuration.md`](configuration.md))
maps `task_type → tier → output-token floor`. When a lane's output token count
falls below the floor for its `(task_type, tier)` bucket the coordinator treats
it as an anomalously short response and fires an advisor escalation.

**The key is empty by default** — O-3 is dormant until you calibrate it.
Nothing auto-writes this key.

To calibrate:

1. Accumulate ≥30 run samples for the `(task_type, tier)` buckets you want to
   tune (normal runs create samples automatically; check
   `/Users/miguelp/Projects/guild/docs/knowledge/decisions/v2-observability-and-replay.md`
   §D-OBS-3 for the activation discipline).
2. Run the analyzer:
   ```bash
   npx tsx benchmark/src/calibrate-o3-cli.ts
   ```
3. The CLI **prints** a proposed `models.shortOutputThreshold` JSON fragment
   (p10 output-token baseline per bucket). **Nothing is written** — you review
   the proposal and land it in `.guild/settings.json` yourself.

Example output from the CLI:

```jsonc
// proposed — review before landing in .guild/settings.json
"shortOutputThreshold": {
  "draft": { "cheap": 40, "mid": 120 },
  "extract": { "mid": 80 }
}
```

## §task§agent ephemeral lifecycle

**One agent per task. Dismissed on completion. Never shared across tasks.**

1. **Spawn.** A new agent is created for the task at its resolved tier, with
   its pulled task-scoped context (recall-before-read; 6k hard cap — see
   [`context-assembly.md`](context-assembly.md)).
2. **Work.** The agent executes, escalating via the advisor protocol above if
   it hits something above its tier.
3. **Extract.** On completion the agent extracts learnings into its
   `guild.handoff.v2` envelope (`learnings[]`). The coordinator lands these in
   the run record (`.guild/runs/<run-id>/`) as candidates for gated reflection
   (`guild:reflect`). Nothing auto-promotes.
4. **Dismiss.** The agent terminates. No idle agents persist. The next task
   spawns a fresh agent.

Two concurrent tasks get two **distinct** agents — never shared. This lifecycle
is **orthogonal** to the D5 `agent_mode` dispatch ladder (team/agent/subagent):
D5 picks the backend, §task§agent fixes the per-task lifecycle on whichever
backend D5 selects.

## See also

- [`configuration.md`](configuration.md) — all `models.*` config keys.
- [`context-assembly.md`](context-assembly.md) — recall-before-read + the
  two-path recall implementation (SQLite FTS5 / guild-memory MCP BM25).
- `/Users/miguelp/Projects/guild/docs/knowledge/decisions/cost-aware-tiering-and-lean-context.md`
  — normative ADR (tier ladder, auto-score, advisor, lifecycle, caching,
  config keys, validation criteria).
- `/Users/miguelp/Projects/guild/docs/knowledge/decisions/v2-observability-and-replay.md`
  §D-OBS-3 — O-3 short-output threshold discipline (activate after ≥30
  samples; analyzer-owns-derivation / coordinator-only-reads contract).
- `/Users/miguelp/Projects/guild/docs/knowledge/decisions/v2-persistence-and-sqlite-index.md`
  — D-PS-1/D-PS-2, wiki_fts gate, `index.sqlite` schema body.
