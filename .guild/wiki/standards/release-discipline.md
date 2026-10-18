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
updated_at: 2026-10-13
sensitivity: internal
---

# Release discipline

Guild uses two branch-backed distribution channels: `main` is stable and
`next` is beta/integration. `main` holds the stable version; `next` holds the
development version. The normal stable release is one same-repository pull
request from exact `next` to `main`, framed by two ordinary PRs into `next`:
the release cut before it and the dev-version bump after it. No release branch
is used.

## Current contract

| Surface | Contract |
|---|---|
| `next` between releases | Exact `MAJOR.MINOR.PATCH-beta.N` |
| Release cut | PR into `next` that changes only the version metadata to bare `MAJOR.MINOR.PATCH`; its merge SHA is the evidence source commit |
| Promotion | Same-repository exact `next -> main` PR; `next` manifest must be bare |
| `main` after release | Bare `MAJOR.MINOR.PATCH` in every committed manifest, equal to the tag |
| Stable identity | `vMAJOR.MINOR.PATCH` tag read from that manifest, plus the GitHub Release |
| Release bytes | Exact reviewed merged commit; its tree equals the PR head tree |
| Dev-version bump | PR into `next` that sets the next `-beta.1` target |
| Granted token scope | Evidence attester: `id-token: write`, `attestations: write`; release job: built-in `GITHUB_TOKEN` with `contents: write`, `attestations: read`; checkout does not persist credentials |
| Workflow writes | Immutable stable tag and GitHub Release only |
| Protected refs | CI never commits or pushes to `main` or `next` |

The version metadata is `.claude-plugin/plugin.json`,
`.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`,
`guild.inventory.json`, and `.guild-native-claude-package-identity.json`. Only
`plugin.json` is edited; the rest are regenerated.

Releases before v3.0.0 used a short path that left `main` at the reviewed
`X.Y.Z-beta.N` candidate. The gates still accept that legacy `main` when its
`vX.Y.Z` tag points at it. Stable update detection compares the installed
commit with remote `main`. Claude and Codex native installs recover channel
plus commit from their existing host registries when the package cache has no
`.git`; other managed installs use their receipt or clone identity. When a
native candidate package has no host identity yet, the hook defers receipt
minting instead of permanently guessing stable or beta.

## Rules

1. All feature, fix, documentation, and beta-version work targets `next`.
2. `main` accepts only a same-repository PR whose exact head ref is `next`.
3. The promotion PR must pass `branch-policy`, including the applicable
   hash-bound release-evidence gate, generated-manifest consistency, and any
   required GitHub OIDC attestation verification. The gate refuses a `next`
   manifest that is not bare `MAJOR.MINOR.PATCH` (code
   `manifest_version_not_release`) and evidence whose source commit does not
   build exactly that version (`source_version_not_release`). Only the two
   evidence files may change after the source commit.
4. The release workflow re-runs the promotion gate and verifies that the merged
   commit tree equals the exact reviewed `next` head tree. The release PR must
   use GitHub's **Create a merge commit** method so the evidence-bound `next`
   source commit remains an ancestor of the merged `main` commit. Squash and
   rebase merges are invalid for this release path and fail the ancestry gate.
5. CI reads the tag only from the exact bare version in the reviewed manifest.
   Branch names, labels, PR titles, and operator input never choose the
   version.
   Set any version by editing only `.claude-plugin/plugin.json`, then run
   `npm run sync:claude-install` in `scripts/`; it regenerates every
   version-bearing file, including `.codex-plugin/plugin.json`.
6. The tag points to the reviewed merge commit. CI does not create another
   commit and does not rewrite either protected branch.
7. Release notes are the curated `next -> main` PR body. CI appends a compare
   link when the body does not already contain one. The release path does not
   generate or commit a new stable section in `CHANGELOG.md`.
8. Re-runs are idempotent: an existing tag is accepted only if it peels to the
   exact merge commit; a missing GitHub Release may then be created.
9. After the release, `next` may share the bare version only while its tree
   equals `main`. `channel-integrity` fails any other shared-version state, so
   the dev-version bump merges before new code.
10. User-facing changes do not release until the website references and
   `docs/v2` D8 leg are reconciled to shipped reality.
11. Rollback is roll-forward. Never delete or move a published stable tag.

## Release procedure

1. Freeze `next` and open the release cut PR into `next`:

   ```bash
   git checkout -b chore/release-cut-vX.Y.Z origin/next
   npm --prefix scripts ci --prefer-offline
   npm --prefix scripts run finalize:stable-release -- prepare --root ..
   npm --prefix scripts run build:inventory -- --root ..
   npm --prefix scripts run sync:claude-install -- --root ..
   npm --prefix scripts run build:hosts -- --root .. --sync-native-identity
   npm --prefix scripts run build:verify:refresh   # operator box: receipts bind the version
   git add .claude-plugin/plugin.json .claude-plugin/marketplace.json \
     .codex-plugin/plugin.json guild.inventory.json \
     .guild-native-claude-package-identity.json evidence/host-smoke
   git commit -m "chore(release): cut vX.Y.Z"
   gh pr create --base next --title "chore(release): cut vX.Y.Z"
   ```

   Merge it. The merge SHA on `next` is the evidence source commit.

2. Produce the hash-bound evidence for that exact SHA and merge an
   evidence-only PR into `next` containing only
   `.guild/artifacts/release/vX.Y.Z/promotion.json` and `conformance.json`.
   That merge is the final `next` tip for the release.

3. Verify the frozen tip locally:

   ```bash
   git fetch origin main next --tags
   npm --prefix scripts run check:claude-install -- --root ..
   npm --prefix scripts run check:inventory -- --root ..
   npm --prefix scripts run check:channel-integrity -- promotion \
     --source-branch next --head origin/next --stable-ref origin/main --root ..
   ```

4. Open the single release PR with final release notes:

   ```bash
   gh pr create --head next --base main \
     --title "release: vX.Y.Z" --body-file /path/to/notes.md
   ```

5. Wait for every required check, then merge the PR with **Create a merge
   commit**. The `Publish stable release after next merges to main` workflow
   re-verifies the evidence, reads the tag from the bare manifest, tags the
   merge, and publishes the Release.

6. Verify the release:

   ```bash
   git fetch origin main next --tags
   tag_sha="$(git rev-list -n 1 vX.Y.Z)"
   test "$(git rev-parse origin/main)" = "$tag_sha"
   git show origin/main:.claude-plugin/plugin.json | grep '"version": "X.Y.Z"'
   gh release view vX.Y.Z
   npm --prefix scripts run check:channel-integrity -- \
     --stable origin/main --beta origin/next
   ```

7. Open the dev-version bump PR into `next`. Set `version` in
   `.claude-plugin/plugin.json` to the next target (for example
   `X.(Y+1).0-beta.1`), run the same `build:inventory`, `sync:claude-install`,
   and `build:hosts -- --sync-native-identity` commands plus `build:verify:refresh`
   on the operator box, commit the same five files with the refreshed
   `evidence/host-smoke` receipts, and merge before any code PR. Host-smoke
   receipts are bound to the manifest version, so `check:host-support-matrix`
   fails a version change that does not refresh them.

## Bounded v2.7.0 provenance-only basis

The fixture-era WOTS custodians cannot authorize a fresh full-suite record:
their private seeds were intentionally discarded. Re-labeling a local Claude
review or GitHub build provenance as independent cryptographic conformance
would be false. For exactly v2.7.0, the gate therefore accepts a separately
named `guild.release_basis.v1` record that says the opposite explicitly:

- `decision` is `provenance_release_only` and `conformance_authority` is
  `not_established`;
- the 31-scenario attachment is `unattested_documentation` and cannot authorize
  promotion;
- the Claude review is recorded as `cross_family_co_located`, advisory, and
  cannot authorize cryptographic conformance;
- the two unfinished migration/custody windows remain
  `post_release_observe` follow-ups;
- the basis hash-binds both attachments and names the exact source commit;
- only the three evidence files may differ after that source commit; and
- GitHub OIDC attests the basis after it lands on exact `next`. Both
  `branch-policy.yml` and `release.yml` verify the artifact digest plus exact
  repository, signer workflow, `refs/heads/next`, source digest, and hosted
  runner provenance.

This is build/release provenance, not conformance authority. The code path is
mechanically pinned to stable core `2.7.0`; `2.7.1` and every later release use
the ordinary conformance path. Restoring real external custody requires fresh
custodian roots and ceremonies and remains a post-release follow-up.

For v2.7.0 only, the evidence sequence is:

1. Merge the implementation/workflow change into `next`; record that merge SHA
   as `source_commit`.
2. Produce `scenario-documentation.json` and a satisfied, checksum-bound Claude
   `external-review.json`, then generate `release-basis.json` over their exact
   bytes.
3. Merge only those three files into `next`. Wait for
   `release-evidence-attestation.yml` to attest `release-basis.json` at that
   exact `next` SHA.
4. Run the ordinary local verification and open the single `next -> main` PR.
   This historical sequence kept the beta-shaped manifest; the gate routes
   only exact `2.7.0-beta.N` to this basis.
   The protected pre-merge and post-merge workflows perform the online OIDC
   verification; a local pass alone is not sufficient.

## Failure and recovery

- A non-`next` PR, fork PR, non-bare `next` manifest, missing evidence, evidence
  not built at the release cut, failed conformance decision (or, for exact
  v2.7.0, a malformed/over-claiming basis or missing/mismatched OIDC
  attestation), tree mismatch, missing or mismatched prior stable tag, or
  non-advancing version stops before tag creation.
- A tag collision fails unless the existing tag already peels to the exact
  reviewed merge commit.
- If tag creation succeeds but GitHub Release creation fails, re-run the same
  workflow; it validates the tag and creates only the missing Release.
- There is a bounded fail-closed window between the merge and tag push. A
  coincident `next` channel check may report the missing stable tag; re-run it
  after the release workflow creates the tag.
- If code lands on `next` before the dev-version bump, `channel-integrity`
  reports the shared bare version; merge the bump PR and re-run the check.
- A bad published release is repaired on `next`, promoted as a new patch, and
  released under a new immutable tag.

## Deferred hardening

A later follow-up may introduce an environment-scoped, repository-only GitHub
App that opens the release cut and dev-version bump PRs automatically. It must
preserve the one-PR promotion interface.
