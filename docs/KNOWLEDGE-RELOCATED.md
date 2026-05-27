# Knowledge relocated to the workspace root and website

The v2 architecture knowledge, its research corpus, the marketing site, and the
**user-facing plugin guides** were moved out of this plugin repo into independent
workspace repos (2026-05-16 → 2026-05-27, decision D-WEB-2).
This plugin repo now holds only plugin implementation + `guild-plan.md` (the
single source of truth for established Guild architecture).

## Canonical user-facing docs → website (D-WEB-2)

`https://guildstack.dev/docs/` is the documentation home (URL not yet locked — see
`docs/DOCS-SITE.md` for the placeholder note; operator replaces `https://guildstack.dev`
once the website repo move + Pages domain are finalised).
Website source: `../website/src/content/docs/`.

| Was here (`plugin/docs/`) | Now at website (`https://guildstack.dev/docs/<slug>`) |
|---|---|
| `architecture.md` | `https://guildstack.dev/docs/architecture` |
| `configuration.md` | `https://guildstack.dev/docs/configuration` |
| `context-assembly.md` | `https://guildstack.dev/docs/context-assembly` |
| `cost-and-tiering.md` | `https://guildstack.dev/docs/cost-and-tiering` |
| `self-evolution.md` | `https://guildstack.dev/docs/self-evolution` |
| `specialist-roster.md` | `https://guildstack.dev/docs/specialist-roster` — **also kept in-repo** (`docs/specialist-roster.md`) for `scripts/check-roster-consistency.ts` |
| `status-line.md` | `https://guildstack.dev/docs/status-line` |
| `wiki-pattern.md` | `https://guildstack.dev/docs/wiki-pattern` |
| `plugin-marketplace-copy.md` | Retired (marketing artifact; superseded by website) |

## Earlier relocations (2026-05-16)

| Was here | Now lives in |
|---|---|
| `docs/v2/**` (12 docs + 10 diagrams) | Root knowledge base: `../docs/knowledge/` (categories: `architecture/`, `lifecycle/`, `adversarial-review/`, …). Entry: `../docs/knowledge/README.md`, index: `../docs/knowledge/index.md`. |
| `.guild/architecture-research-2026-05-10/research/**` + `architecture/**` + `ideation/**` | Root knowledge base: `../docs/knowledge/research/`, distilled into the semantic categories, `../docs/knowledge/ideation/`. (Was gitignored local-only working material.) |
| `.guild/architecture-research-2026-05-10/research/11-benchmark-datasets-fixtures.md` | Benchmark repo: `../benchmark/docs/research/benchmark-datasets-fixtures.md` (benchmark-engine-exclusive). |
| `docs/website/**` + `.github/workflows/pages.yml` | Website repo: `../website/` (site under `website/site/`, deploy via `website/.github/workflows/pages.yml`). |

## How to query the relocated knowledge

- Index + taxonomy: `../docs/knowledge/index.md`, `../docs/knowledge/README.md`
- Query recipes (ripgrep + guild-memory MCP): `../docs/knowledge/QUERY.md`
- Provenance: every relocated page's `source_refs:` frontmatter cites its
  original `plugin/...` path; follow `related:` for the lineage graph.

`guild-plan.md` was **not** moved — it remains this repo's authoritative plan.
