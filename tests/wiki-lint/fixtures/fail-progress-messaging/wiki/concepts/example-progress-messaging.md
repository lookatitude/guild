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
---

# Example Pattern With Progress Messaging

This is a fake concept page that describes how widgets work in the system.

## Design

Widgets are initialized during system startup. The routing table resolves
each widget to its handler by priority.

## Status

Currently this feature is TODO and coming next wave. ✅ Wave-6 done.
We then moved on to the next batch of features. For now, this is WIP.

## Architecture

Widgets communicate via the message bus. Each widget registers a handler
at startup time and deregisters on shutdown.
