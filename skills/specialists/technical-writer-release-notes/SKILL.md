---
name: technical-writer-release-notes
description: Authors release notes / changelog entries for a version — grouped as Added / Changed / Fixed / Deprecated / Removed / Security, with breaking-change callouts and upgrade notes. Pulled by the `technical-writer` specialist. TRIGGER: "write the release notes for v2.4", "draft the changelog entry for this release", "document what's new in version Y", "write the upgrade notes for the breaking change in X", "summarize this PR set into release notes". DO NOT TRIGGER for: marketing launch announcements (use `marketing-launch-plan`), blog posts about a release (use `copywriter-long-form`), API reference updates (use `technical-writer-api-docs`), user manual updates (use `technical-writer-user-manual`), tutorial updates (use `technical-writer-tutorial`), social post announcing the release (social-media-platform-post).
when_to_use: The parent `technical-writer` specialist pulls this skill when the task is producing a changelog or release-notes page for a specific version. Also fires on explicit user request.
type: specialist
---

# technical-writer-release-notes

Implements `guild-plan.md §6.2` (technical-writer · release-notes) under `§6.4` writing principles: match commit/PR facts exactly, don't rewrite adjacent versions' notes, evidence = a changelog a user on the previous version can upgrade from without surprise.

## What you do

Turn a set of merged changes into a version entry the reader can skim, filter, and act on. Release notes are for humans upgrading — not for marketing, not for internal brag-lists.

- Group entries by type — Added, Changed, Fixed, Deprecated, Removed, Security — in that order. Keep-a-Changelog conventions are fine.
- One bullet per change. Start with a verb, name the surface, link to PR/issue, link to docs if it's a new feature.
- Breaking changes get a top-of-release callout with migration steps or a pointer to a migration guide.
- Deprecations state the replacement and the removal target version.
- Security fixes get a line even when embargoed — credit reporters if agreed.
- Pull from merged PRs, conventional-commit titles, and the milestone. Ask the owning specialist to verify ambiguous entries.

## Output shape

Markdown appended to `CHANGELOG.md` or a version page:

```
## [2.4.0] - 2026-04-24

### Breaking changes
- `POST /orders` now requires `idempotencyKey` header. [migration](./migrations/2.4.md)

### Added
- Webhook retries with exponential backoff. (#1234)

### Changed
- Default page size raised from 25 to 50. (#1240)

### Fixed
- Fixed crash when exporting empty workspace. (#1241)

### Deprecated
- `GET /v1/users/me`; use `GET /v1/session` (removal in 3.0).
```

Store at `.guild/runs/<run-id>/docs/release-<version>.md` if tracked; otherwise patch `CHANGELOG.md` or the release-notes page.

## Anti-patterns

- Internal jargon: "refactored the WidgetFooBar factory" — rewrite for the user-visible outcome or drop it.
- Missing breaking-change callouts — upgrade bricks happen here.
- Marketing speak: "we're thrilled to announce" belongs in the launch post, not the changelog.
- Copy-pasting commit messages verbatim (`fix: wtf`).
- No PR/issue links — the reader can't dig in when a line affects them.
- One-line "various fixes and improvements" — users cannot plan upgrades against vapor.

## Handoff

Return the release-notes path/diff to the invoking `technical-writer` specialist. If a change warrants more coverage, chain into `copywriter-long-form` (blog post) or `marketing-launch-plan` (launch). For social teasers, hand off to `social-media-platform-post`. This skill does not dispatch.
