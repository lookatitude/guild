---
type: concept
owner: architect
confidence: high
importance: high
source_refs:
  - .guild/research/persistence-schema.md
  - .guild/wiki/_archive/v2-design/sources/12-knowledge-graph-semantic-indexing.md
applies_to: [plugin]
related:
  - agent-memory-systems
  - knowledge-and-advisory
  - memory-and-knowledge
created_at: 2026-05-28
updated_at: 2026-05-28
sensitivity: internal
---

# Agent Memory — SQLite Cache Layer

Canonical reference for the `index.sqlite` derived cache: schema, population
triggers, migration discipline, and the filesystem-canonical contract. Companion to
`agent-memory-systems.md` (the retrieval and recall model).

## Core Contract: Filesystem-Canonical, SQLite-as-Cache

```
Canonical source = .guild/wiki/** + JSON/YAML artifacts
SQLite (.guild/index.sqlite) = rebuildable derived cache
Delete index.sqlite → zero data loss, only speed loss
```

This is the memweave pattern [source: `.guild/research/persistence-schema.md §1.1`,
citing Towards Data Science 2025]. Guild adopts it verbatim: no write goes to
SQLite first; every write goes to the filesystem artifact, and the SQLite cache is
rebuilt from a SHA-256 staleness fingerprint.

**gitignore contract:** `.guild/index.sqlite` is gitignored (ephemeral, per-repo,
never shared). The cache path resolves via `git rev-parse --git-common-dir` so an
ephemeral worktree reads/writes the main repo's `index.sqlite` — preventing cache
fragmentation across worktrees.

## `index.sqlite` Schema (v1)

```sql
PRAGMA user_version = 1;  -- migration sentinel

-- Wiki full-text index (replaces guild-memory MCP grep path at scale)
CREATE TABLE wiki_pages (
  path             TEXT PRIMARY KEY,
  content          TEXT NOT NULL,
  sha256           TEXT NOT NULL,
  frontmatter_json TEXT,
  updated_at       INTEGER
);
CREATE VIRTUAL TABLE wiki_fts USING fts5(
  content, path UNINDEXED,
  content='wiki_pages', content_rowid='rowid',
  tokenize='porter ascii'
);

-- KnowledgeGraph node/edge cache (from knowledge-graph.json)
CREATE TABLE kg_nodes (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  name          TEXT,
  layer_id      TEXT,
  confidence    TEXT,
  metadata_json TEXT,
  graph_sha     TEXT NOT NULL
);
CREATE TABLE kg_edges (
  source    TEXT NOT NULL,
  target    TEXT NOT NULL,
  type      TEXT NOT NULL,
  weight    REAL,
  graph_sha TEXT NOT NULL,
  PRIMARY KEY (source, target, type)
);
CREATE INDEX kg_nodes_layer ON kg_nodes(layer_id);
CREATE INDEX kg_edges_source ON kg_edges(source);
CREATE INDEX kg_edges_target ON kg_edges(target);

-- KnowledgeLinks edge cache (from knowledge-links.json)
CREATE TABLE kl_edges (
  source    TEXT NOT NULL,
  target    TEXT NOT NULL,
  type      TEXT NOT NULL,
  run_id    TEXT,
  links_sha TEXT NOT NULL,
  PRIMARY KEY (source, target, type, run_id)
);
CREATE INDEX kl_edges_source ON kl_edges(source);
CREATE INDEX kl_edges_target ON kl_edges(target);

-- Provenance index (from runs/*/provenance.json)
CREATE TABLE run_provenance (
  run_id          TEXT PRIMARY KEY,
  initiative_id   TEXT,
  prior_run_id    TEXT,
  phase           TEXT,
  status          TEXT,
  closed_at       INTEGER,
  provenance_json TEXT
);
CREATE INDEX prov_initiative ON run_provenance(initiative_id);
CREATE INDEX prov_phase ON run_provenance(phase, status);

-- Migration audit log
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER,
  note       TEXT
);
INSERT INTO schema_migrations VALUES (1, strftime('%s','now'), 'initial');
```

**Not in v1 scope:** vector/embedding tables (G3: deferred until measured);
trace JSONL index (telemetry is separate-repo concern; surfaced via guild-telemetry MCP).

## Population Triggers (Lazy / On-Demand)

| Trigger condition | Table populated | Action |
|---|---|---|
| `knowledge-graph.json` > 1 MB or > 2k nodes | `kg_nodes`, `kg_edges` | Populate on first read; skip if `graph_sha` unchanged |
| `wiki/**` > 500 files | `wiki_fts` | Populate on wiki write (post `wiki-ingest`/`decisions`) |
| `/guild:initiative status` with > 20 runs | `run_provenance` | Populate at run-close |
| `knowledge-links.json` > 2k edges | `kl_edges` | Populate; query by source/target |

Below these thresholds, direct file parse is the correct path — zero overhead, zero
dependency. Exceeding a threshold activates the cache for that table only.

## Migration Discipline

`PRAGMA user_version` is the sole migration sentinel [source: `.guild/research/persistence-schema.md §1.4`,
citing levlaz.org and sqliteforum.com]. Protocol on every open:

1. Read `user_version`. If below expected: run numbered migration scripts in ascending
   order inside atomic `BEGIN … COMMIT` transactions; increment `user_version`.
2. If `index.sqlite` is absent or corrupt: rebuild from scratch (cache miss, not data
   loss). The `schema_migrations` table provides a human-readable audit trail visible
   to `/guild:audit`.

**JSON artifact schema bump invariant:** any schema change that breaks deserialization
of a frozen artifact (`guild.knowledge_graph.v1`, `guild.codebase_map.v1`) must bump
the artifact's `version` string AND add a numbered SQL migration that drops/recreates
the corresponding cache tables.

## Federation Cache (Workspace Root)

The workspace root's `index.sqlite` may cache sub-guild wiki BM25 results in a
`federation_wiki_cache` table keyed by `(sub_guild_root, path, sha256)`. Staleness:
re-read sub-guild `wiki/**` if any `sha256` has changed since last cache write.
Sub-guild provenance/graph queries remain delegated (read-only, no cache) per the
depth-1 / query-don't-duplicate rule.

**Constraint:** The workspace `index.sqlite` never writes into a sub-guild's `.guild/`
(DH-3 invariant preserved).

## Upgrade Path to Hybrid Recall (Vector + BM25)

G3 is reaffirmed for v2.0: BM25-only is correct. The upgrade path when evidence
warrants it [source: `.guild/research/persistence-schema.md §D-PS-5`]:

1. Measure precision miss in telemetry — > 15% of `context-assemble` retrievals
   marked `low_confidence` AND BM25 ranked below correct node in top-3 on > 20%
   of sampled queries.
2. Add `sqlite-vec` extension + vector column to `wiki_fts` (additive migration).
3. Add numbered SQL migration in `schema_migrations`.

The `wiki_fts` table is structured with `content=` external content to enable a
safe FTS rebuild — the column addition requires no schema break.

## Contract Map Registrations Required

Three schema IDs must be registered in `.guild/wiki/_archive/v2-design/implementation-plans/contract-map.md`
before implementation:
- `guild.index_sqlite.v1` (the cache schema; version = `PRAGMA user_version`)
- `guild.federation_wiki_cache.v1`
- `guild.schema_migration.v1` (migration log row)
