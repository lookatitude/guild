---
type: concept
owner: architect
confidence: high
importance: critical
source_refs:
  - .guild/research/cost-techniques.md
  - plugin/scripts/lib/provider-detect.ts
  - plugin/scripts/lib/runstart-preflight.ts
  - .guild/initiatives/active/settings-control-and-tmux/briefing.md §6
  - .guild/initiatives/active/settings-control-and-tmux/decisions.md OD-5,OD-6
applies_to: [plugin]
related:
  - team-composition
  - tools-and-mcp
  - agent-memory-systems
  - knowledge-and-advisory
created_at: 2026-05-28
updated_at: 2026-06-01
sensitivity: internal
---

# Cost-Aware Tiering and Context Management

Canonical reference for Guild's model-tier dispatch, prompt caching, retrieval-over-reading,
context compaction, learn-pipeline tiering, and structured inter-agent communication.
Distilled from `.guild/research/cost-techniques.md` (2026-05-26).

## Native-Provider Preference and Review-Provider Routing (settings-control-and-tmux — shipped 2026-06-01)

For adversarial review Guild prefers the **native host integration** over external CLIs.
On a Claude host with the `codex-plugin` adapter (`codex:codex-rescue`) available,
`review.adversarial.provider=auto` recommends `codex-plugin` (strongest independence,
no auth-token round-trip).

The selection ladder for `review=cross` on a Claude host:
1. `codex-plugin` — selectable when detected (native plugin adapter, preferred).
2. `codex-cli` — selectable when detected AND authed (binary + stored auth or env key).
3. Other different-family CLIs (`gemini-cli`, `pi`, `antigravity`) — detect-only until
   their adapters ship; not selectable for cross review.
4. Same-family reviewer — degrades to `local` / `skipped` with an explicit reason (never
   a false signoff; AC-8 hard invariant).
5. No selectable reviewer + `review=cross` — returns `skipped` with reason (not a signoff).

`provider=auto` re-detects each run (OD-5 — never stale-pins a recommendation). An
explicit `config set review.adversarial.provider <id>` persists the operator's choice.
The run-provenance snapshot (`.guild/runs/<id>/resolved-settings.json`) records what
was recommended and selected per run.

The communication contract (`review_result.v1`, packet/result/trail paths under
`.guild/runs/<id>/review/<gate>/`) is **provider-invariant** — provider choice changes
who reviews, not how.

## Model Tier Map

| Work type | Default tier | Rationale |
|---|---|---|
| File read, tokenize, chunk | `cheap` (haiku-class) | Pure I/O, no judgment |
| Summarize, classify, tag | `cheap` (haiku-class) | Template-guided, low ambiguity |
| Draft, reason, plan subtasks | `mid` (sonnet-class) | Default task-agent tier |
| Cross-file relationship extraction | `mid` (sonnet-class) | Moderate judgment, high volume |
| Architecture decisions, security review, graph schema | `powerful` (opus-class) | High-stakes, low frequency |
| Critic/advisor pass on a mid-tier draft | `powerful` (opus-class) | Sees draft only, not full context |

Research evidence: 85% of queries can route to cheaper models (RouteLLM, arXiv 2406.18665);
well-designed routing delivers 45–85% cost reduction while maintaining 95% quality.
[source: `.guild/research/cost-techniques.md §1`]

**Advisor pattern:** For `architect` or `security` tasks, run `mid` first to produce a
draft, then call `powerful` with a compact critic prompt ("Review this plan for correctness
and security. Flag issues only."). The `powerful` call sees the draft, not the full file
context.

**Escalation heuristic:** If a `cheap` agent's output contains uncertainty markers
(`"I'm not sure"`, `"unclear"`, `"cannot determine"`) or returns anomalously few tokens
for its task type, the coordinator re-dispatches to `mid`. Full O-3 calibration (p10
output-token baseline) activates only after ≥ 30 run samples per `(task_type, tier)`
bucket exist in the benchmark analyzer.

## Prompt / Context Caching

Anthropic prompt caching reuses processed prompt prefixes: cache reads cost 10% of base
input price; writes cost 125% (5-min TTL) or 200% (1-hour TTL).
[source: `.guild/research/cost-techniques.md §2`, citing Anthropic Docs]

Minimum cacheable block: 1,024 tokens (Sonnet/Haiku), 4,096 tokens (Opus 4.x). Up to
4 cache breakpoints per request.

**Breakpoint ordering rule — always:** tools → system prompt → stable documents → variable
user message.

| Content | TTL | Breakpoint position |
|---|---|---|
| Team-lead system prompt + full tool definitions | `1h` | First breakpoint |
| `guild-memory` wiki context for task domain | `1h` | Second breakpoint |
| Task-specific RAG retrieval result | `5m` | Third breakpoint |
| Task description + variable user content | (uncached) | After all breakpoints |

**Rule:** Never place a breakpoint on content that changes between agent turns. A 100-turn
Opus session drops from ~$50–100 to ~$10–19 with ~90% cache hit rate.
[source: `.guild/research/cost-techniques.md §2`, citing claudecodecamp.com]

Model-specific caches: caches are model-specific; switching models within a session forces
a cold start. Use separate sub-agent processes for different model tiers.

## Retrieval Over Re-Reading

Hybrid retrieval (BM25 + dense embeddings, RRF at k=60) delivers recall 0.72 → 0.91
(+26%) and precision 0.68 → 0.87 (+28%) over either strategy alone. For Guild v2 (BM25-only
tier), BM25 is the first recall layer; embedding is the upgrade path.
[source: `.guild/research/cost-techniques.md §3`]

Chunking parameters for ingestion:
- Chunk size: 200–500 tokens with 10–15% overlap.
- Semantic chunking improves faithfulness 70% over naive fixed-size (score 0.79–0.82
  vs 0.47–0.51).
- Parent-child retrieval: retrieve small precise chunks for ranking; pass larger parent
  context to the LLM.
- Re-ranking (cross-encoder): +10–25% additional precision at modest cost.

Cost gap: full-context loading vs. RAG is 1,250x at scale. Agentic RAG (multi-hop)
costs 10–100x more than naive RAG — reserve it for genuinely complex queries.

## Context Compaction

Two strategies for keeping coordinator context small [source: `.guild/research/cost-techniques.md §4`]:

**Compaction (verbatim pruning):** removes low-relevance tokens while preserving exact
surviving text. 50–70% compression, 98% verbatim accuracy, zero hallucination risk.
Reversible — agent can re-retrieve removed content. Best for technical content (paths,
error codes, identifiers).

**Rolling summarization:** maintains last N turns in full + compact rolling summary of
older turns. Summarization triggers at ~70% context capacity. Risk: hallucinated paraphrasing
of exact details; can cause re-reading loops. Best for narrative/reasoning history.

Claude Code auto-compact triggers at ~95% context window and generates a 7,000–12,000
character structured summary.

**Observation masking** (JetBrains research): targeted compression of tool call outputs
achieves 26–54% peak token reduction while matching summarization quality.

## Structured Inter-Agent Communication

Structured sub-agent output schema (JSON envelope, not free prose) reduces inter-agent
token overhead by 73% and improves task completion accuracy by 34% while eliminating
cascading hallucinations. [source: `.guild/research/cost-techniques.md §4`, citing G²CP
arXiv 2602.13370]

**Required envelope schema:**
```json
{
  "status": "done|blocked|escalate",
  "summary": "<100 token outcome>",
  "artifacts": ["<file>:<line>", ...],
  "issues": ["<typed issue>", ...],
  "escalate_reason": null
}
```

Coordinator accumulates these typed envelopes, not raw agent conversations. Full
transcripts remain in `.guild/runs/` for audit. Rolling coordinator summary: keep last
5 agent result envelopes in full + 200-token rolling summary of completed work; trigger
rewrite at 70% coordinator context window.

**Compaction vs. summarization rule:** use compaction (not summarization) for technical
artifacts — file paths, error codes, and identifiers must survive verbatim.

## Learn-Pipeline Tier Assignment

Validated pattern for knowledge-graph construction and content extraction pipelines
[source: `.guild/research/cost-techniques.md §5`]:

| Phase | Tier | Task |
|---|---|---|
| 1 — File scan / read | `cheap` | Read files, emit raw text blob |
| 2 — Chunk + summarize | `cheap` | Produce per-file 200-token summaries |
| 3 — Categorize + tag | `mid` | Map summaries to taxonomy, emit typed tags |
| 4 — Topic/relationship extraction | `mid` | Identify cross-file links from summaries only |
| 5 — Graph edge validation + schema | `powerful` | Validate ambiguous edges; called only when edge candidate count > N or mid agent flags `escalate: true` |

Using `cheap` for 80% of document processing delivers ~80% accuracy at ~6% of
`powerful`-class cost. [source: `.guild/research/cost-techniques.md §5`, citing
Medium/claudiubranzan]

## Advisor-Escalation Protocol

1. Task dispatched to `mid` (default).
2. `mid` output checked: if `status == "escalate"` OR output contains uncertainty
   markers OR output is anomalously short → re-dispatch to `powerful`.
3. `powerful` call receives: the `mid` draft, the original task spec, and a 50-token
   critique instruction. It does NOT receive the full file context.
4. `powerful` result returns to coordinator via the same typed envelope.

## Recommended `settings.json` Keys

```json
{
  "costTiering": {
    "enabled": true,
    "tierDefaults": {
      "read":      "haiku",
      "summarize": "haiku",
      "draft":     "sonnet",
      "reason":    "sonnet",
      "architect": "opus",
      "review":    "opus"
    },
    "escalationMarkers": ["I'm not sure", "unclear", "cannot determine", "ambiguous"],
    "cacheTTL": {
      "coordinator": "1h",
      "leaf":        "5m"
    },
    "recallBeforeRead":       true,
    "recallScoreThreshold":   0.4,
    "structuredOutputRequired": true,
    "importanceGate":         3
  }
}
```
