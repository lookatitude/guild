---
type: decision
owner: architect
confidence: high
importance: high
source_refs:
  - .guild/wiki/research/persistence-schema.md                  # D-PS-1..6 decision surface + §4.2 schema body (cited inline)
  - .guild/wiki/decisions/guild-boundary-config-and-tracking.md # CR-D .guild/ ownership map; the `.lock, index.sqlite` cache row (bound by pointer)
  - plugin/.guild/wiki/decisions/config-surface-settings-json.md       # settings.json closed-key surface + reject rules (defaults.index.*)
  - plugin/.guild/wiki/decisions/workspace-aware-init-and-federation.md # D-OQ1/2/3 + depth-1 + query-don't-duplicate (federation cache dependency)
  - plugin/.guild/wiki/decisions/cost-aware-tiering-and-lean-context.md # recall-before-read BM25 path (wiki_fts consumer); guild.handoff.v2
  - plugin/.guild/wiki/decisions/v2-scope-and-risk-g1-g8.md            # G3 (filesystem-only durable state) + DH-3 (no new MCP)
  - .guild/wiki/_archive/v2-design/implementation-plans/contract-map.md                  # B-post additive-contract registry (team-lead registers the 3 new schemas after)
created_at: 2026-05-26
updated_at: 2026-05-26
expires_at: null
supersedes: null
sensitivity: internal
applies_to: [plugin]
related: [guild-boundary-config-and-tracking, config-surface-settings-json, workspace-aware-init-and-federation, cost-aware-tiering-and-lean-context, v2-scope-and-risk-g1-g8, continuous-knowledge-and-learning-loop]
---

# ADR: v2.0 persistence model — filesystem-canonical + `index.sqlite` rebuildable cache

## Status

Accepted (operator-ratified 2026-05-26; v2.0-full-scope program). Authored as part of the v2.0 architecture-research pack. **Design-complete,
additive, no build scheduled in v2.0** — like GR-7's Codex-cloud, this ADR locks the
contract + threshold surface and is registry-cited only; the SQLite cache stays *dark*
(never populated) until the D-PS-1 measured-slowness gate fires. Zero-config repos below
every threshold behave byte-identically to today: direct file parse, no `index.sqlite`
on disk. Closes the six decisions raised by the persistence-schema brief
(`research/persistence-schema.md §5`, D-PS-1..6). Additive to the frozen v2 contract set:
introduces **three new self-versioned schemas** (listed in "New contracts" below; the
team lead registers them in `contract-map.md §B-post` after this ADR lands) and **new
closed-key `settings.json` additions** (`defaults.index.*`, under the existing closed-key
reject regime). Preserves G3 (filesystem-only durable state) and DH-3 (no new MCP).

## Context

The CR-D ownership map already reserves the cache slot — row `.lock, index.sqlite`,
category *concurrency / cache*, owner *core*, lifetime *ephemeral*, git policy *gitignored*
(`guild-boundary-config-and-tracking.md §"Normative .guild/ ownership map"`). The slot
exists; the schema was never defined, so the cache is unwired today
(`persistence-schema.md §2`, "not yet wired"). Every agent that reads
`knowledge-graph.json`, `knowledge-links.json`, or globs `runs/*/provenance.json` does a
full JSON parse on each use — free at ~500 nodes, 50–200 ms at ~5k
(`persistence-schema.md §3`, gaps G-PS-1..7).

The 2025–2026 state of the art is unambiguous: **SQLite as a derived index over
file-canonical sources** (memweave; sqlite-memory; mcp-memory-sqlite —
`persistence-schema.md §1.1`). SQLite earns its keep only past three measured thresholds
(grep degradation > ~5k wiki files / > 200 ms; concurrent write pressure; in-memory
cross-index joins — `§1.1`). Below them, flat-file parse wins outright. G3 deferred SQLite
deliberately and correctly; this ADR defines the *measured-slowness upgrade path* G3
anticipated, without spending it now.

## Decision

### 0. Core contract — filesystem-canonical, SQLite-as-rebuildable-cache

The memweave contract, applied to Guild (`persistence-schema.md §4.1`):

> **Canonical source of truth = `.guild/wiki/**` + the JSON/YAML artifacts. `index.sqlite`
> = rebuildable derived cache. Deleting `index.sqlite` causes zero data loss — only speed
> loss; it is never the system of record and is never the primary write target.**

This is the single invariant the other five decisions hang from. It satisfies G3
(durable state stays on the filesystem), DH-3 (no new MCP — the cache is in-process,
read via the same host runtime), and matches the existing CR-D *rebuildable* /
*gitignored* policy for the slot. `index.sqlite` is a **write-through projection**:
populated lazily from a canonical artifact, validated by a `sha256` fingerprint of that
artifact, dropped-and-rebuilt on any staleness or corruption signal.

### D-PS-1 — Lazy/on-demand population at a configurable threshold (the formal G3 gate)

**Resolved.** Population is **lazy/on-demand**, never eager-on-write. The plugin populates
a cache table only when its source artifact crosses a fingerprint-gated threshold; below
threshold the direct file parse remains the path (zero overhead, zero dependency). This is
the formal realization of G3's "measured slowness" gate. Built-in defaults
(`persistence-schema.md §4.3`):

| Source | Built-in trigger | Cache table |
|---|---|---|
| `knowledge-graph.json` | > 1 MB **or** > 2 000 nodes | `kg_nodes` / `kg_edges` |
| `knowledge-links.json` | > 2 000 edges | `kl_edges` |
| `runs/*/provenance.json` | > 20 runs | `run_provenance` |
| `wiki/**` | > 500 files | `wiki_fts` (see D-PS-2) |

The thresholds are **closed-key `settings.json` additions** under `defaults.index.*`
(per `config-surface-settings-json.md`; unknown `defaults.*` keys rejected at intake):

- `defaults.index.enabled` (bool, default `true`) — master switch; `false` ⇒ always
  direct-parse, no `index.sqlite` ever written. Equivalent to the existing
  `/guild:stats --no-index` one-shot, made persistent.
- `defaults.index.kg_node_threshold` (int, default `2000`)
- `defaults.index.kg_size_threshold_mb` (number, default `1`)
- `defaults.index.links_edge_threshold` (int, default `2000`)
- `defaults.index.runs_threshold` (int, default `20`)
- `defaults.index.wiki_file_threshold` (int, default `500`)

Cache hit when the source `sha256` matches; rebuild that table when it does not.
The existing `/guild:stats --rebuild-index` / `--no-index` flags are the manual
override surface (already in the command grammar) — no new verb.

**Rejected** (`persistence-schema.md §5 D-PS-1`): always-on eager population (adds write
latency to every `wiki-ingest` and run-close); external SQLite MCP (violates DH-3 + G3);
DuckDB / LanceDB (heavier deps, no measured benefit at Guild scale).

**Followup (not in this ADR's scope):** the six `defaults.index.*` keys must be registered
as closed keys in `architecture/command-surface.md §4.4` before any implementation lane —
flagged, not edited here.

### D-PS-2 — `wiki_fts` ownership and population trigger

**Resolved.** The FTS5 wiki index is populated and refreshed **only** by the two existing
promotion paths — `guild:wiki-ingest` and `guild:decisions` — as a post-write side-effect
(`persistence-schema.md §5 D-PS-2`). **No new hook, no new MCP surface.** Reads below the
`wiki_file_threshold` keep using the `guild-memory` MCP BM25 grep path unchanged; at/above
threshold the plugin queries `index.sqlite wiki_fts` directly — **identical BM25 semantics,
higher throughput**. The `recall-before-read` consumer in
`cost-aware-tiering-and-lean-context.md` is unaffected: same interface, same results, no
cost-tiering contract change. Ownership is exclusive: no other skill writes `wiki_fts`,
keeping the canonical→cache write fan-in to the two promotion gates only.

### D-PS-3 — `PRAGMA user_version` migration runner — location and failure contract

**Resolved.** `PRAGMA user_version` is the **sole migration sentinel**
(`persistence-schema.md §1.4, §4.4`). A thin migration module
(`scripts/index-migrate.ts` or the host-equivalent — owned by `tooling-engineer`, not this
ADR) runs at the first open of `index.sqlite` each session. Contract:

1. Read `PRAGMA user_version`. If `< expected`, run every missing numbered migration in
   ascending order, each in its own `BEGIN … COMMIT`, then write the new `user_version`.
2. **On any failure** (or absent / corrupt DB): log to `.guild/runs/<run-id>/logs/`,
   then **drop and rebuild from scratch** — a cache miss, never data loss (the canonical
   filesystem source is intact).
3. The `schema_migrations` table is the human-readable audit trail; `/guild:audit` reports
   the current `user_version` + last-applied migration.

**Migration invariant:** every schema change that breaks deserialization of a v2-frozen
JSON artifact (`guild.knowledge_graph.v1`, `guild.codebase_map.v1`, `guild.knowledge_links.v1`,
`guild.provenance.v1`) must (a) bump that artifact's `schema_version` string — a breaking
change per the lenient-reader rule (`contract-map.md §C`) — **and** (b) add a numbered SQL
migration that drops/recreates only the corresponding cache tables, leaving unrelated
tables (`wiki_fts`, `run_provenance`) intact. No cross-project migration coordination is
ever needed: `index.sqlite` is per-repo, per-`.guild/`, never shared.

### D-PS-4 — Federation cache layer for workspace sub-guild queries

**Resolved.** The **workspace root's** `index.sqlite` caches **sub-guild wiki BM25 results
only** — never sub-guild graph or provenance (`persistence-schema.md §5 D-PS-4`). A
`federation_wiki_cache` table (+ its `federation_wiki_fts` virtual table) is keyed by
`(sub_guild_root, path)` with a `sha256` staleness fingerprint: re-read a sub-guild's
`wiki/**` only if any `sha256` changed since the last cache write. Sub-guild
graph/provenance queries stay **delegated, read-only, uncached**, honoring the depth-1-hard
/ query-don't-duplicate rule (`workspace-aware-init-and-federation.md §"Federation model"`,
D-OQ1).

**Boundary invariant (bound by pointer, not re-spelled):** the workspace `index.sqlite`
lives under the **workspace's own** `.guild/` and **never** writes into a sub-guild's
`.guild/` — the DH-3 / CR-D read-only-sub-guild rule of
`workspace-aware-init-and-federation.md §"Boundary discipline"` holds unchanged. This table
is present **only** in a workspace-root `.guild/`; a leaf project's `index.sqlite` never
carries it.

**Dependency:** the locked federation decisions D-OQ1/2/3
(`workspace-aware-init-and-federation.md §"The three G-spec-locked decisions"`).

### D-PS-5 — No vector / embedding store in v2.0 (G3 reaffirmed)

**Resolved: No.** BM25 (FTS5) is the v2.0 recall primitive; embeddings stay deferred
(`persistence-schema.md §1.2, §5 D-PS-5`). `wiki_fts` is defined with `content=` external
content so a future `chunks_vec` column can be added by an additive migration **without
schema breakage** — the upgrade path to hybrid (RRF: ~70% vector / 30% BM25) is (a) measure
precision miss in telemetry, (b) add the `sqlite-vec` column, (c) add migration v2. No
design change is needed and **no timeline is committed**.

**Evidence threshold for revisiting** (`persistence-schema.md §5 D-PS-5`): > 15% of
`context-assemble` retrievals marked `low_confidence` in `guild-telemetry` traces **AND**
BM25 ranking below the correct node in top-3 on > 20% of sampled queries. Until both fire,
v2.0 ships BM25-only.

### D-PS-6 — Gitignore + worktree-safe cache root

**Resolved.** `.guild/index.sqlite` is gitignored (already so in the CR-D ownership row).
The cache open/write path resolves the `.guild/` root via
`git rev-parse --git-common-dir`, **not** the worktree path
(`persistence-schema.md §5 D-PS-6`) — so a build running in an ephemeral worktree
reads/writes the **main repo's** `index.sqlite`, preventing cache fragmentation across
worktrees. This generalizes the same worktree-redirect rule already applied to graph
writes. Worktree-specific invalidation is handled by the source artifact's `sha256`
fingerprint (itself worktree-redirected for graph writes), so a single shared cache stays
correct across worktrees.

## New contracts (listed here; team lead registers in `contract-map.md §B-post`)

Three new self-versioned schemas. Each is **additive only** — none changes the locked
frozen / sibling counts or the §G path predicate (`contract-map.md §B-post, §G`).
*(SC-12 context, 2026-05-30: the baseline was frozen-13 / sibling-12 / §G 25-path when this
ADR was written; SC-12 promoted `guild.run.v1` + `guild.harvest_candidates.v1` into the
locked set, making it frozen-13 / sibling-14 / §G 27-path. These three schemas remain
additive and post-v2, outside that locked set.)*
This ADR is the canonical body pointer for all three; the schema is not to be re-spelled in
`contract-map.md` (per `§B-post`'s pointer-only rule).

| Contract | schema_version | Canonical body pointer | Owner (writer) | `.guild/` slot |
|---|---|---|---|---|
| Cache index | `guild.index_sqlite.v1` | this ADR §"`index.sqlite` schema body" + `research/persistence-schema.md §4.2`; version = `PRAGMA user_version` | core (lazy populate) | `.guild/index.sqlite` (CR-D row, reserved) |
| Federation wiki cache | `guild.federation_wiki_cache.v1` | this ADR D-PS-4 (`federation_wiki_cache` table) | core (workspace root only) | workspace-root `.guild/index.sqlite` |
| Migration log row | `guild.schema_migration.v1` | this ADR D-PS-3 (`schema_migrations` row) | migration runner | `.guild/index.sqlite` `schema_migrations` table |

CR-D ownership map and the existing 25 frozen+sibling contracts are **bound by pointer**,
not re-spelled: the `.guild/index.sqlite` slot is the CR-D `.lock, index.sqlite` row
(`guild-boundary-config-and-tracking.md`); the JSON artifacts this cache derives from
(`guild.knowledge_graph.v1`, `guild.codebase_map.v1`, `guild.knowledge_links.v1`,
`guild.provenance.v1`, `guild.initiatives_registry.v1`) keep their existing canonical body
pointers in `target-architecture.md` / `contract-map.md`.

### `index.sqlite` schema body (canonical, `guild.index_sqlite.v1`, user_version = 1)

Reproduced from `research/persistence-schema.md §4.2` as the canonical body; the
workspace-only `federation_wiki_cache` tables (D-PS-4) are appended.

```sql
PRAGMA user_version = 1;  -- migration sentinel (D-PS-3)

-- Wiki full-text index (D-PS-2; replaces guild-memory grep path at threshold)
CREATE TABLE wiki_pages (
  path       TEXT PRIMARY KEY,        -- relative to .guild/wiki/
  content    TEXT NOT NULL,
  sha256     TEXT NOT NULL,           -- fingerprint for incremental re-index
  frontmatter_json TEXT,              -- parsed YAML frontmatter as JSON
  updated_at INTEGER
);
CREATE VIRTUAL TABLE wiki_fts USING fts5(
  content, path UNINDEXED,
  content='wiki_pages', content_rowid='rowid',
  tokenize='porter ascii'            -- D-PS-5: chunks_vec added additively later
);

-- KnowledgeGraph node/edge cache (D-PS-1; derived from knowledge-graph.json)
CREATE TABLE kg_nodes (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  name       TEXT,
  layer_id   TEXT,
  confidence TEXT,
  metadata_json TEXT,
  graph_sha  TEXT NOT NULL            -- fingerprint of source knowledge-graph.json
);
CREATE TABLE kg_edges (
  source TEXT NOT NULL, target TEXT NOT NULL, type TEXT NOT NULL,
  weight REAL, graph_sha TEXT NOT NULL,
  PRIMARY KEY (source, target, type)
);
CREATE INDEX kg_nodes_layer  ON kg_nodes(layer_id);
CREATE INDEX kg_edges_source ON kg_edges(source);
CREATE INDEX kg_edges_target ON kg_edges(target);

-- KnowledgeLinks edge cache (D-PS-1; derived from knowledge-links.json)
CREATE TABLE kl_edges (
  source TEXT NOT NULL, target TEXT NOT NULL, type TEXT NOT NULL,
  run_id TEXT, links_sha TEXT NOT NULL,
  PRIMARY KEY (source, target, type, run_id)
);
CREATE INDEX kl_edges_source ON kl_edges(source);
CREATE INDEX kl_edges_target ON kl_edges(target);

-- Provenance index (D-PS-1; derived from runs/*/provenance.json)
CREATE TABLE run_provenance (
  run_id         TEXT PRIMARY KEY,
  initiative_id  TEXT, prior_run_id TEXT, phase TEXT, status TEXT,
  closed_at      INTEGER,
  provenance_json TEXT
);
CREATE INDEX prov_initiative ON run_provenance(initiative_id);
CREATE INDEX prov_phase      ON run_provenance(phase, status);

-- Schema migration log (D-PS-3; guild.schema_migration.v1 rows)
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY, applied_at INTEGER, note TEXT
);
INSERT INTO schema_migrations VALUES (1, strftime('%s','now'), 'initial');

-- Federation wiki cache (D-PS-4; guild.federation_wiki_cache.v1) — WORKSPACE ROOT ONLY
CREATE TABLE federation_wiki_cache (
  sub_guild_root TEXT NOT NULL,       -- workspace-relative path to a sub-guild .guild/
  path           TEXT NOT NULL,       -- page path relative to that sub-guild's wiki/
  content        TEXT NOT NULL,
  sha256         TEXT NOT NULL,       -- staleness fingerprint (re-read iff changed)
  frontmatter_json TEXT,
  cached_at      INTEGER,
  PRIMARY KEY (sub_guild_root, path)
);
CREATE VIRTUAL TABLE federation_wiki_fts USING fts5(
  content, sub_guild_root UNINDEXED, path UNINDEXED,
  content='federation_wiki_cache', content_rowid='rowid',
  tokenize='porter ascii'
);
```

**Not in v1 scope:** vector/embedding tables (D-PS-5 / G3); a trace-JSONL index — telemetry
is a separate-repo concern read directly from `runs/*.jsonl` by the `guild-telemetry` MCP,
which is **not** a consumer of `index.sqlite` (`persistence-schema.md §6`, no coupling).

## Validation criteria

- **VC-PS-1 (cache is pure speed):** deleting `.guild/index.sqlite` mid-project changes no
  query *answer* — only latency; every consumer falls back to direct file parse. (D-PS-1, §0)
- **VC-PS-2 (zero-config dark):** a repo below every `defaults.index.*` threshold produces
  **no** `index.sqlite` on disk and behaves byte-identically to pre-ADR Guild. (D-PS-1)
- **VC-PS-3 (lazy gate):** crossing a single threshold (e.g. 2 001 nodes) populates **only**
  that source's tables on next read; a matching `sha256` on a later read is a cache hit (no
  re-parse, no re-populate). (D-PS-1)
- **VC-PS-4 (`wiki_fts` ownership):** only `wiki-ingest` and `decisions` writes mutate
  `wiki_fts`; at/below `wiki_file_threshold` the `guild-memory` BM25 path is unchanged;
  results are identical across the threshold boundary. (D-PS-2)
- **VC-PS-5 (migration safety):** a forced `user_version` regress + corrupt-DB injection
  both resolve to drop-and-rebuild with zero data loss; `schema_migrations` + `/guild:audit`
  report the current version. (D-PS-3)
- **VC-PS-6 (federation read-only):** a workspace-root query populates
  `federation_wiki_cache` and **never** writes into any sub-guild `.guild/`; sub-guild
  graph/provenance stays delegated + uncached; the table is absent in a leaf
  `index.sqlite`. (D-PS-4)
- **VC-PS-7 (no vectors):** v2.0 ships BM25-only; the hybrid path stays a documented,
  unbuilt migration; the revisit gate is the two-condition telemetry threshold. (D-PS-5)
- **VC-PS-8 (worktree single-cache):** a build in an ephemeral worktree reads/writes the
  main repo's `index.sqlite` (via `--git-common-dir`); no per-worktree fragment is created.
  (D-PS-6)

## Consequences

- G3's "measured slowness" deferral gains a **concrete, configurable trigger** instead of
  an unbounded "someday" — the cache is dark until a real artifact crosses a real
  threshold, and even then carries no durable state.
- The CR-D ownership map needs **no new row** — the `.lock, index.sqlite` slot already
  exists; this ADR fills its schema. DH-3 holds (no new MCP); G3 holds (filesystem stays
  canonical).
- Three additive `guild.*.v1` schemas enter `contract-map.md §B-post` (team-lead followup);
  the locked frozen / sibling / §G path predicate is **unchanged by this ADR** (baseline at
  authoring: frozen-13 / sibling-12 / 25-path; SC-12 later moved it to frozen-13 /
  sibling-14 / 27-path, 2026-05-30 — these three schemas stay post-v2).
- Six new `defaults.index.*` closed keys must be registered in `command-surface.md §4.4`
  (followup, owner: config-surface lane) — they ride the existing reject regime.
- The hybrid-recall door is **left open without being walked through**: `wiki_fts`'s
  external-content definition makes the future vector column an additive migration, so
  D-PS-5 costs nothing to revisit when the telemetry evidence arrives.
