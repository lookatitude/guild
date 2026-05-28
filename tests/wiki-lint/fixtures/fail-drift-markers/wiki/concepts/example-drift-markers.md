---
type: concept
owner: architect
confidence: medium
importance: medium
source_refs: []
created_at: 2026-04-24
updated_at: 2026-04-24
expires_at: null
supersedes: null
sensitivity: internal
related: []
---

# Example Drift Markers

Fake concept page describing wiki query workflows.

## Querying the wiki

To query the wiki in v1 you would run `/guild-wiki` with a search term.
The wiki returned a list of matching pages.

## Architecture

Pages are stored under `.guild/wiki/` in the consuming project's root.
Each page uses §10.1.1 frontmatter. The BM25 index is rebuilt on demand.
