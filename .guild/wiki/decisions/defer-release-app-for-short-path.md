---
type: decision
owner: user
confidence: medium
source_refs:
  - plugin/.github/workflows/release.yml
  - plugin/.guild/wiki/standards/release-discipline.md
created_at: 2026-08-30
updated_at: 2026-08-30
expires_at: null
supersedes: null
sensitivity: internal
date: 2026-08-30
asker: user
task: simplify-direct-release
category: architecture
---
# Defer the dedicated release App for the short path

## Context

The direct `next -> main` release design had grown to require a dedicated
GitHub App, protected environment, ruleset bypass, post-merge metadata commit,
and atomic updates of both channel refs. That provisioning blocked a release
whose intended operator path is a single promotion PR.

## Options considered

- A: Provision the App, environment, and ruleset bypass before releasing.
- B: Keep the direct promotion gate, then use the built-in repository token to
  tag the reviewed merge commit and publish the GitHub Release.

## Decision

Choose B. The user's direction was: "We can keep the app for later but now we
need to follow the shortest path." CI derives the stable tag from the reviewed
beta manifest and never rewrites either protected branch.

## Consequences

- A stable release needs one same-repository `next -> main` PR.
- The stable tag and GitHub Release are authoritative for the bare release
  version; the tagged manifest retains the reviewed beta provenance.
- App-backed bare-version metadata convergence remains a non-blocking follow-up.
- A published tag is immutable; recovery rolls forward and never retags bytes.
