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
related: [example-dangling-related, nonexistent-page]
---

# Example Dangling Related

Fake concept page that has a dangling `related:` slug — `nonexistent-page`
does not correspond to any page in this fixture. The self-reference
`example-dangling-related` resolves because this file's own slug is valid.
Only `nonexistent-page` triggers check #11 (dangling-related).
