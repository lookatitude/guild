# Guild — `.guild/settings.json` Configuration Reference

> **Source of truth:** `scripts/read-guild-config.ts` — every key, type, default, and
> validation rule in this document was derived from that file. Do not invent keys.
>
> **Canonical schema section:** `architecture/command-surface.md §4.4`  
> **Regenerate a blank settings.json:** `/guild:config init`  
> **Validate an existing file:** `/guild:config show` or
> `npx tsx scripts/read-guild-config.ts --validate`

---

## Zero-config guarantee

An absent `settings.json` (or an absent _block_ within it) is equivalent to
every key set to its documented default. Config failures never block the Guild
lifecycle; parse errors fall back to built-in defaults and print a warning to
stderr. You only need settings.json when you want to override a default.

---

## Precedence ladder

From highest priority (first wins) to lowest:

```
1. CLI flag (--rigor=deep, --agent-mode=team, --model-tier=cheap …)
2. --rigor profile expansion (fills only keys the user did NOT set explicitly)
3. .guild/settings.json
4. Built-in defaults
```

**Model-tier only:** `--model-tier=cheap|mid|powerful` > per-lane plan
`model_tier:` override > `models.tiers` + `models.thresholds` > built-in map.

---

## Top-level keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `rigor` | `"quick"` \| `"standard"` \| `"deep"` | `"standard"` | Expands into `loops`, `loop_cap`, and `review` via the rigor profile. Explicit values for those keys override the profile. See [Rigor profiles](#rigor-profiles) below. |
| `auto_approve` | `string[]` | `[]` | Opt-in autonomy — which lifecycle gates skip the user-approval pause. Values: `"spec"`, `"plan"`, `"build"`, `"all"`. Destructive, network, and spend actions still ask regardless. |
| `review` | `"local"` \| `"cross"` \| `"off"` | `"local"` | Review broker mode. `cross` engages the Claude↔Codex adversarial broker. `rigor=deep` auto-implies `cross`; override to `local`/`off` to suppress. |
| `host` | `"claude"` \| `"codex"` \| `"auto"` | `"auto"` | Co-equal host adapter selection. |
| `initiative_default` | `string \| null` | `null` | Attach all runs to a named initiative by default. |
| `index` | `"auto"` \| `"off"` | `"auto"` | Top-level SQLite read-through cache gate. `auto` = lazy-build when measured slowness thresholds are exceeded. `off` = always direct-parse; no `index.sqlite` written. Fine-grained thresholds live under [`defaults.index.*`](#defaultsindex). |
| `agent_mode` | `"team"` \| `"agent"` \| `"subagent"` \| `"auto"` | `"auto"` | Execution backend. See [Agent-mode dispatch ladder](#agent-mode-dispatch-ladder). Supersedes the deprecated `defaults.agent_team`. |
| `workspace` | `{ mode: "auto"\|"on"\|"off" }` | `{ mode: "auto" }` | Workspace federation mode (`guild.workspace.v1`). `auto` detects by immediate-child rule (presence of `.git`/`.guild`). Depth is hard-fixed at 1 — no `max_depth` knob. |
| `loops` | `string \| null` | `null` (derive from rigor) | Adversarial-loop scope override. Values: `"none"`, `"spec"`, `"plan"`, `"implementation"`, `"all"`, or a comma-separated subset. `null` means derive from `rigor`. |
| `loop_cap` | `integer` 1–256 | `16` | Maximum rounds per adversarial loop. |
| `codex_cap` | `integer` 1–10 | `5` | Maximum rounds per Codex adversarial review gate. CLI: `--codex-cap=N`. |

### Rigor profiles

`rigor` fills `loops`, `loop_cap`, and `review` only for keys you did **not** set
explicitly (in settings.json or as a CLI flag). Explicit values always win.

| rigor | loops | loop_cap | review |
|-------|-------|----------|--------|
| `quick` | `"none"` | — (no cap) | `"off"` |
| `standard` | `"spec,plan"` | `16` | `"local"` |
| `deep` | `"all"` | `16` | `"cross"` (falls back to `"local"` if Codex unavailable, env `GUILD_CROSS_HOST_AVAILABLE=0`) |

The resolved expansion is always visible as `_rigor_expanded` in `--validate`
output and in the JSON resolved by `read-guild-config.ts`.

---

### Agent-mode dispatch ladder

`agent_mode: "auto"` resolves at runtime in this order — **team and independent
agents are primary; subagent is the last resort:**

1. **`$TMUX` set** → **team** in-session (new tmux window, one pane per
   specialist, `select-window`ed immediately). Never clobbers the active pane.
2. **tmux installed** (not inside one) → **team** in a fresh detached session,
   then attaches your terminal.
3. **No tmux, host supports independent agents** (`claude`/`codex`) → **agent**
   (independent, no tmux).
4. **Else** → **subagent** fallback: `guild:execute-plan` dispatches via the
   Agent tool; no tmux required (CI, fresh installs).

Pinning `agent_mode: "team"` on a tmux-less host is rejected with a warning.
`defaults.agent_team` is a **deprecated alias** (warn-once, removed at v2.1.0).
Migration: `auto→auto`, `on→team`, `off→subagent`.

**Example:**
```json
{ "agent_mode": "subagent" }
```

---

## `models.*` — Cost tiering

> ADR: `cost-aware-tiering-and-lean-context` (§1 tiers · §2 auto-score ·
> §3 advisor · §4 recall · §5 handoff · §6 lifecycle · §8 learn · §10 config)

Closed key set — unknown `models.*` keys are rejected by `--validate`.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `models.enabled` | `boolean` | `true` | Master toggle for cost tiering. `false` = all lanes run at `mid` (current v2 behavior). |
| `models.tiers` | `{ cheap, mid, powerful }` | see below | Host-agnostic tier→model map (ADR §1). Each tier is `{ claude, codex, gemini }`. A `null` host slot means no model for that tier on that host. Partial overrides deep-merge over built-in defaults. |
| `models.scoreWeights` | `Record<string, number>` | see below | Auto-score rubric weights (ADR §2). Signals: `workType`, `blastRadius`, `dependsOn`, `security`, `priorEscalation`. Tunable per-repo. |
| `models.thresholds` | `{ mid: int, powerful: int }` | `{ mid: 1, powerful: 3 }` | Score-band cutoffs (ADR §2). `score < mid` → cheap; `mid ≤ score < powerful` → mid; `score ≥ powerful` → powerful. |
| `models.advisorRounds` | `integer ≥ 1` | `2` | Max advisor consults per lane before recording inconclusive (ADR §3). |
| `models.escalationMarkers` | `string[]` | see below | Uncertainty phrases that trigger advisor escalation (ADR §3). |
| `models.recallBeforeRead` | `boolean` | `true` | Enforce recall-before-read: query the wiki before opening a file (ADR §4). |
| `models.recallScoreThreshold` | `float` 0–1 | `0.4` | Min BM25 recall score to skip a full file read (ADR §4). |
| `models.structuredOutputRequired` | `boolean` | `true` | Reject non-`guild.handoff.v2` agent returns (ADR §5). |
| `models.cacheTTL.coordinator` | `"1h"` \| `"5m"` \| `"off"` | `"1h"` | Coordinator prompt-cache TTL hint (ADR §9). |
| `models.cacheTTL.leaf` | `"1h"` \| `"5m"` \| `"off"` | `"5m"` | Leaf-agent prompt-cache TTL hint (ADR §9). |
| `models.importanceGate` | `integer` 1–5 | `3` | Min wiki importance level for routine recall (ADR §6). Pages below this level are skipped in the recall pass. |
| `models.ingestSimilarityGate` | `float` 0–1 | `0.80` | BM25 top-1 similarity threshold for the wiki ingest anomaly gate (D-INGEST-GATE). When a candidate page scores ≥ this against existing pages, `guild:wiki-ingest` pauses for user decision (supersede / skip / proceed) — never silently overwrites. |
| `models.shortOutputThreshold` | `Record<task_type, Record<tier, number>>` | `{}` | O-3 short-output advisor trigger buckets (D-OBS-3). Each entry maps a `task_type` → `tier` → output-token floor. Empty map (default) ⇒ O-3 trigger is silent for all buckets. Proposed values come from `benchmark/src/calibrate-o3-cli.ts`; operator reviews and lands them here — nothing auto-writes this key. |

### Default tier map

```json
{
  "models": {
    "tiers": {
      "cheap":    { "claude": "haiku",  "codex": null, "gemini": null },
      "mid":      { "claude": "sonnet", "codex": null, "gemini": null },
      "powerful": { "claude": "opus",   "codex": null, "gemini": null }
    }
  }
}
```

`codex` and `gemini` slots are `null` (no third host yet); they slot in as
config + adapter when available.

### Default score weights

```json
{
  "models": {
    "scoreWeights": {
      "workType":        0,
      "blastRadius":     1,
      "dependsOn":       1,
      "security":        1,
      "priorEscalation": 1
    }
  }
}
```

`workType` is a base offset: read/summarize = +0, draft/extract = +1,
architect/review/schema = +2. The other weights are additive per signal.

### Default escalation markers

```json
{
  "models": {
    "escalationMarkers": [
      "I'm not sure",
      "unclear",
      "cannot determine",
      "I don't know",
      "ambiguous",
      "uncertain",
      "not enough information"
    ]
  }
}
```

**Example — tune thresholds and disable escalation for a cheap lane:**
```json
{
  "models": {
    "thresholds": { "mid": 2, "powerful": 4 },
    "advisorRounds": 1
  }
}
```

### `models.shortOutputThreshold` — O-3 calibration buckets

> ADR: `v2-observability-and-replay` §D-OBS-3

The O-3 "anomalously short output" advisor trigger fires when a lane's output
token count falls below the p10 baseline for that `(task_type, tier)` bucket.
Thresholds are **not built-in** — they must be derived from ≥ 30 run samples
and landed here by the operator.

**Workflow:**
1. Run `npx tsx benchmark/src/calibrate-o3-cli.ts` (after sufficient samples).
2. The CLI prints a `models.shortOutputThreshold` JSON fragment with proposed
   floors per `(task_type, tier)`.
3. Operator reviews the proposal and merges it into `.guild/settings.json`.
4. Nothing auto-writes this key — all writes are explicit.

Until a `(task_type, tier)` pair appears in this map, the O-3 trigger is silent
for that bucket (only deterministic `status: escalate` + uncertainty-marker
triggers apply).

**Example** (after calibration on a mature repo):
```json
{
  "models": {
    "shortOutputThreshold": {
      "build":  { "cheap": 80,  "mid": 150, "powerful": 200 },
      "review": { "cheap": 120, "mid": 200, "powerful": 300 },
      "plan":   { "mid": 180,   "powerful": 250 }
    }
  }
}
```

Malformed outer entries (non-object task-type values) and malformed inner
entries (non-number tier values) are silently dropped — a partial or
in-progress calibration proposal never hard-blocks config load.

---

## `security.*` — bypassPermissions governance

> ADR: `v2-security-and-untrusted-content` (D-BYPASS)

Closed key set — only `bypass_permissions_policy` is valid.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `security.bypass_permissions_policy` | `"deny"` \| `"audit"` \| `"allow"` | `"audit"` | bypassPermissions governance during Guild-managed runs. `deny`: hard-block + security event (forced under `auto_approve` / autonomous-after-plan). `audit`: surfaces always-ask channel + security event (default for interactive mode). `allow`: opt-in for interactive mode only. Guild cannot govern bypass outside its own run lifecycle. |

**Example:**
```json
{ "security": { "bypass_permissions_policy": "deny" } }
```

---

## `secrets_policy.*` — Secrets redaction

> ADR: `v2-security-and-untrusted-content` (D-SECRETS)

Closed key set.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `secrets_policy.env_allowlist` | `string[]` | `[]` | Env var names explicitly permitted in agent-context injection. All others are redacted before context assembly. |
| `secrets_policy.redaction_patterns` | `string[]` | `[]` | Regex patterns applied as the first stage of the 3-stage secrets scrubber (prefix regexes → Shannon-entropy → file-path context). Run over all `.guild/` artifact writes. |
| `secrets_policy.fail_mode_durable` | `"closed"` \| `"open"` | `"closed"` | On scrub failure for durable shared-git artifacts (handoff, provenance, wiki, review): `closed` = block the write + surface always-ask; `open` = warn + proceed. |
| `secrets_policy.fail_mode_telemetry` | `"open"` \| `"closed"` | `"open"` | On scrub failure for local gitignored telemetry writes (`runs/<id>/logs/*.jsonl`): `open` = warn + security event + proceed; `closed` = block. |

**Example:**
```json
{
  "secrets_policy": {
    "env_allowlist": ["GITHUB_TOKEN"],
    "redaction_patterns": ["sk-[A-Za-z0-9]{32,}"],
    "fail_mode_durable": "closed",
    "fail_mode_telemetry": "open"
  }
}
```

---

## `mcp.*` — MCP description pinning

> ADR: `v2-security-and-untrusted-content` (D-MCP, PI-6)

Closed key set — only `tool_description_hashes` is valid.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `mcp.tool_description_hashes` | `Record<string, string>` | `{}` | Map of MCP tool-name → SHA-256 hash of `(description + inputSchema)`, pinned at `/guild:config init` time. `PreToolUse` compares the live hash per call. Drift triggers a warn+gate-on-approval. Re-pin via `/guild:config update-mcp-hashes`. |

---

## `defaults.*` — Per-run behavioral defaults

The `defaults` block configures default posture for each Guild run. All keys
deep-merge: absent sub-keys inherit the built-in defaults.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `defaults.agent_team` | `"auto"` \| `"on"` \| `"off"` | `"auto"` | **DEPRECATED** — use top-level `agent_mode` instead. Warn-once alias: `auto→auto`, `on→team`, `off→subagent`. Removed at v2.1.0. Run `/guild:config init` to migrate. |
| `defaults.auto_learn` | `boolean` | `false` | When `true`, `/guild:init` runs the full `learn-*` pipeline at bootstrap (D3). Precedence: `--learn` CLI flag > this setting > built-in `false`. |
| `defaults.adversarial` | `"on"` \| `"off"` | `"on"` | Adversarial review posture. **`"off"` is rejected for Guild self-build** (`--self-build --validate`). |
| `defaults.team.size` | `integer \| null` | `null` | Team size cap. `null` = apply the 3–4 rule. Values capped at 6 unless explicitly overridden. |
| `defaults.team.always_include` | `string[]` | `[]` | Specialists always included in the team regardless of composition. Subset of the 14 specialist names. |
| `defaults.review_workflow` | `"standard"` \| `"cross"` \| `"minimal"` | `"standard"` | Default review depth for lane reviews. |
| `defaults.skill_policy` | `"standard"` \| `"conservative"` | `"standard"` | Default skill-usage posture. |
| `defaults.gates.auto_approve` | `string[]` | `[]` | Default approval-gate posture. Values: `"spec"`, `"plan"`, `"build"`, `"all"`. **Never auto-approves `qa` or `ops` gates.** |
| `defaults.wiki.share_mode` | `"team"` \| `"private"` | `"team"` | Wiki share mode (moved here from legacy `project.yaml`). |
| `defaults.wiki.autopromote` | `boolean` | `false` | **Always `false`. `true` is rejected always** — agents emit candidates only; humans promote. |
| `defaults.quality.budget.per_class_minutes` | `integer > 0` | `10` | Per-check-class wall-clock cap for the QA phase. |
| `defaults.quality.budget.total_minutes` | `integer > 0` | `30` | Whole-QA-phase wall-clock cap. |
| `defaults.reporting` | `"standard"` \| `"quiet"` \| `"verbose"` | `"standard"` | Default task/progress reporting verbosity. |

---

## `defaults.index.*` — SQLite lazy-cache thresholds

> ADR: `v2-persistence-and-sqlite-index` (D-PS-1)

Closed key set. These thresholds determine when the lazy `index.sqlite` cache is
populated. Below each threshold the existing BM25 grep path is used unchanged.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `defaults.index.enabled` | `boolean` | `true` | Master switch for `index.sqlite`. `false` = always direct-parse, no `index.sqlite` ever written. Equivalent to `--no-index` made persistent. |
| `defaults.index.kg_node_threshold` | `positive integer` | `2000` | Populate `kg_nodes`/`kg_edges` tables when `knowledge-graph.json` has more than N nodes. |
| `defaults.index.kg_size_threshold_mb` | `positive number` | `1` | Populate `kg_nodes`/`kg_edges` tables when `knowledge-graph.json` exceeds N MB. |
| `defaults.index.links_edge_threshold` | `positive integer` | `2000` | Populate `kl_edges` table when `knowledge-links.json` has more than N edges. |
| `defaults.index.runs_threshold` | `positive integer` | `20` | Populate `run_provenance` table when `runs/*/provenance.json` count exceeds N. |
| `defaults.index.wiki_file_threshold` | `positive integer` | `500` | Populate `wiki_fts` table when wiki file count exceeds N. Below threshold, guild-memory BM25 grep path is used unchanged. |

**Example — disable index entirely for a small repo:**
```json
{
  "defaults": {
    "index": { "enabled": false }
  }
}
```

---

## `defaults.cross_host.*` — Cross-host SSH routing

> ADR: `v2-cross-host-orchestration` (CR-1 / CH-1)

**Security:** address/port/user only — **no secrets, no passwords, no key
paths.** SSH authentication must be via keys or the ssh-agent socket
(`~/.ssh/config` or `SSH_AUTH_SOCK`). The validator hard-rejects any key
other than `address`, `port`, and `user` on each host entry.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `defaults.cross_host.enabled` | `boolean` | `false` | Master toggle for mixed-host routing and teams. `false` ⇒ single-host behavior byte-identical to today. **Env override:** `GUILD_CROSS_HOST_ENABLED=1` enables cross-host even when this key is `false`; the env var wins when set. |
| `defaults.cross_host.hosts` | `Record<string, HostEntry>` | `{}` | SSH endpoint config keyed by `guild.host_capability.v1` host ID. Each entry: `{ address: string, port?: integer 1–65535, user?: string }`. Non-standard ports prefer `~/.ssh/config` Host entries over the `port` field. |

**Example:**
```json
{
  "defaults": {
    "cross_host": {
      "enabled": true,
      "hosts": {
        "codex-worker-1": {
          "address": "192.168.1.50",
          "port": 2222,
          "user": "guild"
        }
      }
    }
  }
}
```

> **Never add `password`, `private_key`, `key_path`, or any credential to a
> host entry.** The validator rejects unknown host-entry keys.

---

## Complete minimal example

```json
{
  "agent_mode": "auto",
  "rigor": "standard",
  "review": "local",
  "codex_cap": 5,
  "loop_cap": 16,
  "models": {
    "enabled": true,
    "thresholds": { "mid": 1, "powerful": 3 },
    "advisorRounds": 2,
    "recallScoreThreshold": 0.4,
    "importanceGate": 3
  },
  "security": {
    "bypass_permissions_policy": "audit"
  },
  "defaults": {
    "auto_learn": false,
    "adversarial": "on",
    "wiki": { "share_mode": "team", "autopromote": false },
    "index": { "enabled": true },
    "cross_host": { "enabled": false, "hosts": {} }
  }
}
```

---

## Validation and tooling

| Command | What it does |
|---------|-------------|
| `/guild:config init` | Scaffold `settings.json` with all keys + self-documenting `_help` block. |
| `/guild:config show` | Print the resolved config (merged defaults + file + CLI flags). |
| `/guild:config update-mcp-hashes` | Re-pin MCP tool description hashes in `mcp.tool_description_hashes`. |
| `npx tsx scripts/read-guild-config.ts --validate` | Validate `settings.json` against the closed-key set; exit non-zero on violation. |
| `npx tsx scripts/read-guild-config.ts --scaffold` | Print the canonical `settings.json` scaffold to stdout. |

---

## Migration from v1 `config.yml`

`.guild/config.yml` is read via a one-time back-compat shim when
`settings.json` is absent. Once `settings.json` exists it is authoritative and
`config.yml` is ignored. Run `/guild:config init` to migrate. See `MIGRATION.md §3`.

Key mapping:
| v1 `config.yml` key | v2 `settings.json` key |
|---------------------|----------------------|
| `loops` | `loops` |
| `loop_cap` | `loop_cap` |
| `codex_cap` | `codex_cap` |
| `codex_review: true` | `review: "cross"` |
| `auto_approve: spec-and-plan` | `auto_approve: ["spec", "plan"]` |
| `auto_approve: all` | `auto_approve: ["all"]` |
| `auto_approve: implementation` | `auto_approve: ["build"]` |
