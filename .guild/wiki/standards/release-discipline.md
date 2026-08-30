---
type: standard
owner: plugin-engineer
confidence: high
importance: high
source_refs:
  - plugin/.github/workflows/release.yml
  - plugin/.github/workflows/branch-policy.yml
  - plugin/.github/workflows/channel-integrity.yml
  - plugin/scripts/check-channel-integrity.ts
  - plugin/scripts/finalize-stable-release.ts
created_at: 2026-07-12
updated_at: 2026-08-30
sensitivity: internal
---

# Release discipline

Guild uses two branch-backed distribution channels: `main` is stable and
`next` is beta/integration. The normal stable release is one same-repository
pull request from exact `next` to `main`. No release branch is used.

## Current short-path contract

| Surface | Contract |
|---|---|
| Candidate branch | `next` with exact `MAJOR.MINOR.PATCH-beta.N` manifest |
| Promotion | Same-repository exact `next -> main` PR |
| Stable identity | CI-derived `vMAJOR.MINOR.PATCH` tag and GitHub Release |
| Release bytes | Exact reviewed merged commit; its tree equals the PR head tree |
| Granted token scope | Release job only: built-in `GITHUB_TOKEN` with `contents: write`; checkout does not persist it |
| Workflow writes | Immutable stable tag and GitHub Release only |
| Protected refs | CI never commits or pushes to `main` or `next` |

The stable tag and GitHub Release are authoritative for the bare stable
version. The tagged manifest intentionally retains the reviewed beta candidate
identifier as provenance in this short path. A dedicated release App and a
generated bare-version metadata commit are deferred hardening, not a current
release prerequisite. The next promotion binds the retained candidate version
on `main` to the corresponding published stable tag before comparing versions.
Stable update detection compares the installed commit with remote `main`.
Claude and Codex native installs recover channel plus commit from their existing
host registries when the package cache has no `.git`; other managed installs use
their receipt or clone identity. A commit-less stable fallback treats a
candidate whose core equals the latest stable tag as those same published bytes,
so the candidate label cannot create a permanent false update.

## Rules

1. All feature, fix, documentation, and beta-version work targets `next`.
2. `main` accepts only a same-repository PR whose exact head ref is `next`.
3. The promotion PR must pass `branch-policy`, including the hash-bound release
   promotion evidence gate and generated-manifest consistency check.
4. The release workflow re-runs the promotion gate and verifies that the merged
   commit tree equals the exact reviewed `next` head tree. Merge, squash, and
   rebase PR methods are valid because later channel checks search `next`
   history for that exact released tree rather than depending on merge topology.
5. CI derives the bare tag only from exact `X.Y.Z-beta.N` in the reviewed
   manifest. Branch names, labels, PR titles, and operator input never choose
   the version.
6. The tag points to the reviewed merge commit. CI does not create another
   commit and does not rewrite either protected branch.
7. Release notes are the curated `next -> main` PR body. CI appends a compare
   link when the body does not already contain one. The short path does not
   generate or commit a new stable section in `CHANGELOG.md`.
8. Re-runs are idempotent: an existing tag is accepted only if it peels to the
   exact merge commit; a missing GitHub Release may then be created.
9. User-facing changes do not release until the website references and
   `docs/v2` D8 leg are reconciled to shipped reality.
10. Rollback is roll-forward. Never delete or move a published stable tag.

## Release procedure

1. Freeze the current `next` candidate and merge the independently authorized,
   hash-bound conformance and promotion evidence for that exact source commit.
   The evidence-only merge is the final `next` tip for this release.

2. Verify the frozen tip locally:

   ```bash
   git fetch origin main next --tags
   npm --prefix scripts ci --prefer-offline
   npm --prefix scripts run check:claude-install -- --root ..
   npm --prefix scripts run check:inventory -- --root ..
   npm --prefix scripts run check:channel-integrity -- promotion \
     --source-branch next --head origin/next --stable-ref origin/main --root ..
   ```

3. Open the single release PR with final release notes:

   ```bash
   gh pr create --head next --base main \
     --title "release: vX.Y.Z" --body-file /path/to/notes.md
   ```

4. Wait for every required check, then merge the PR. The
   `Publish stable release after next merges to main` workflow re-verifies the
   evidence, derives the stable tag, tags the merge, and publishes the Release.

5. Verify the release:

   ```bash
   git fetch origin main --tags
   tag_sha="$(git rev-list -n 1 vX.Y.Z)"
   test "$(git rev-parse origin/main)" = "$tag_sha"
   gh release view vX.Y.Z
   npm --prefix scripts run check:channel-integrity -- \
     --stable origin/main --beta origin/next
   ```

## Failure and recovery

- A non-`next` PR, fork PR, malformed beta version, missing evidence, failed
  conformance decision, tree mismatch, missing or mismatched prior stable tag,
  or non-advancing version stops before tag
  creation.
- A tag collision fails unless the existing tag already peels to the exact
  reviewed merge commit.
- If tag creation succeeds but GitHub Release creation fails, re-run the same
  workflow; it validates the tag and creates only the missing Release.
- There is a bounded fail-closed window between the merge and tag push. A
  coincident `next` channel check may report the missing stable tag; re-run it
  after the release workflow creates the tag.
- A bad published release is repaired on `next`, promoted as a new patch, and
  released under a new immutable tag.

## Deferred hardening

The later App follow-up may introduce an environment-scoped, repository-only
GitHub App to generate a bare-version metadata commit and converge `main`,
`next`, and the tag atomically. That work must preserve the one-PR operator
interface and is not required for the current release.
