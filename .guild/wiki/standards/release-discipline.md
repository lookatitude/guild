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
  - plugin/scripts/release-changelog.ts
  - plugin/scripts/build-inventory.ts
  - plugin/scripts/build-host-packages.ts
created_at: 2026-07-12
updated_at: 2026-08-29
sensitivity: internal
---

# Release discipline

Guild has two distribution channels because marketplace installs track a git
ref: `main` is stable and `next` is beta/integration. Humans change both through
pull requests. The sole direct-push exception is the narrowly scoped release
GitHub App used by the protected stable-release workflow.

## Channel and version contract

| Channel | Ref | Manifest shape | Audience |
|---|---|---|---|
| Stable | `main` | exact `MAJOR.MINOR.PATCH` | default installs |
| Beta | `next` | newer `MAJOR.MINOR.PATCH-beta.N` while diverged | beta installs |

At the quiescent release point, both branches and the peeled stable tag resolve
to the same metadata-only stable commit and therefore carry the same bare
version. When development resumes, the first material `next` change establishes
the next beta version again.

`.claude-plugin/plugin.json` is the single canonical version field.
`.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`,
`guild.inventory.json`, and `.guild-native-claude-package-identity.json` are
generated and must never be hand-edited for a release.

## Rules

1. All feature, fix, documentation, and beta-version work targets `next`.
2. `main` accepts only a same-repository PR whose exact head ref is `next`.
   Forks and look-alike branch names fail `branch-policy`.
3. Stable promotion requires the hash-bound promotion and full conformance pair
   under `.guild/artifacts/release/vX.Y.Z/`. The required PR check and the
   post-merge release job both re-run the production promotion decision.
4. The stable version is derived from the reviewed `X.Y.Z-beta.N` manifest on
   the merge commit and must strictly advance the bare version on `main`. A
   branch name, PR title, label, or operator input never chooses the tag.
5. CI creates exactly one stable metadata commit with this path set:
   `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`,
   `.codex-plugin/plugin.json`, `.guild-native-claude-package-identity.json`,
   `CHANGELOG.md`, and `guild.inventory.json`. Any missing or extra path fails.
6. The stable tag points to the stable release point, never the beta merge
   commit. Normally that is the metadata commit. If GitHub used squash/rebase
   and the PR head is not its ancestor, CI adds one empty-tree-delta merge
   commit whose second parent is the exact reviewed `next` head. The workflow
   then advances `main`, `next`, and the tag in one atomic push. No force push,
   release branch, or manual sync-back exists.
7. The default `GITHUB_TOKEN` remains read-only. Release writes use an ephemeral
   installation token from a dedicated GitHub App, scoped to this repository
   with `contents: write` plus `pull-requests: read` for changelog lookups.
8. Release notes are the curated `next -> main` PR body. CI also generates the
   matching changelog section from merged PR history before it seals the native
   package identity.
9. User-facing changes do not release until the website references and
   `docs/v2` D8 leg are reconciled to shipped reality.
10. Rollback is roll-forward. Fix the problem on `next`, increment the patch
    beta target, regenerate and verify evidence, and promote again. Never delete
    or move a published stable tag.

## Normal release procedure

1. Freeze the release candidate code at the current `next` tip, SHA-T. Produce
   the full 31-scenario evaluator package with independently provisioned
   authority bound to that exact SHA. The repository contains no production
   attestor key or package; the operator supplies it from the controlled
   custody process. Emit the pair on a preparation branch created from SHA-T:

   ```bash
   git fetch origin main next --tags
   git switch --create release-evidence/vX.Y.Z origin/next
   source_sha="$(git rev-parse HEAD)"
   export GUILD_RELEASE_EVALUATOR_PACKAGE=/controlled/path/evaluator-package.json
   test -f "$GUILD_RELEASE_EVALUATOR_PACKAGE"
   npm --prefix scripts ci --prefer-offline
   npm --prefix scripts run emit:release-conformance -- \
     --suite scripts/__tests__/fixtures/release-conformance/conformance-scenarios.v1.json \
     --package "$GUILD_RELEASE_EVALUATOR_PACKAGE" \
     --source-commit "$source_sha" \
     --generated-at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     --out ".guild/artifacts/release/vX.Y.Z/conformance.json" \
     --promotion-out ".guild/artifacts/release/vX.Y.Z/promotion.json" \
     --version X.Y.Z
   git add -- ".guild/artifacts/release/vX.Y.Z/conformance.json" \
     ".guild/artifacts/release/vX.Y.Z/promotion.json"
   git diff --cached --name-only
   git commit -m "chore(release): bind vX.Y.Z promotion evidence"
   git push -u origin release-evidence/vX.Y.Z
   gh pr create --base next --head release-evidence/vX.Y.Z
   ```

   The evidence PR must change exactly those two paths. Merge it into `next`,
   then freeze `next`: no beta bump, regeneration, documentation change, or
   other commit may land before the direct promotion completes. SHA-T remains
   the evidence source; the evidence-only merge commit becomes the reviewed
   final `next` tip.

2. Fetch and verify the frozen final `next` tip:

   ```bash
   git fetch origin main next --tags
   git switch next
   git pull --ff-only origin next
   npm --prefix scripts ci --prefer-offline
   npm --prefix scripts run check:claude-install -- --root ..
   npm --prefix scripts run check:inventory -- --root ..
   npm --prefix scripts run check:channel-integrity -- promotion \
     --source-branch next --head origin/next --root ..
   ```

3. Confirm the release PR body is final release-note copy and open the direct PR:

   ```bash
   gh pr create --head next --base main --title "release: vX.Y.Z" --body-file /path/to/notes.md
   ```

4. Wait for every required check, including `branch-policy`, then merge. Keep
   `next` frozen until the stable workflow finishes; the job refuses if its tip
   no longer equals the reviewed PR head. No local version bump, release branch,
   tag, or sync-back command is performed.

5. Verify the post-merge `Finalize stable release after next merges to main`
   workflow. Then verify convergence:

   ```bash
   git fetch origin main next --tags
   tag_sha="$(git rev-list -n 1 vX.Y.Z)"
   test "$(git rev-parse origin/main)" = "$tag_sha"
   test "$(git rev-parse origin/next)" = "$tag_sha"
   gh release view vX.Y.Z
   ```

## Dedicated release App: one-time setup

Create a GitHub App dedicated to Guild stable publication and install it only on
`lookatitude/guild`.

- Repository permissions: Contents, read and write; Pull requests, read-only.
  Do not grant Actions, Administration, Issues, Secrets, or organization
  permissions.
- Store the App id as the `stable-release` environment secret
  `RELEASE_APP_ID` and its private key as `RELEASE_APP_PRIVATE_KEY`.
- Configure the `stable-release` environment to allow only the protected `main`
  branch. Add a required reviewer if the repository plan and operating model
  call for a human publication gate. For a merged `pull_request` close event,
  GitHub sets `GITHUB_REF` to the fully qualified branch the PR merged into, so
  this job is evaluated as `refs/heads/main`, not the closed PR merge ref.
- Convert the legacy `main` and `next` branch protections to equivalent active
  branch rulesets. Preserve PR-only access and required status checks, then add
  this App as the only always-allow bypass actor needed for its atomic release
  push. Do not grant a user, team, or broad admin role the same bypass.
- Rotate the private key on the normal credential schedule and immediately on
  suspected exposure. Delete the retired key after the new environment secret
  has passed a dry run.

The workflow uses `actions/create-github-app-token` to mint a short-lived token.
The action masks and revokes the token; no long-lived PAT or reusable bot token
is stored in repository configuration.

## Failure and re-run behavior

- Missing App id/private key, missing evidence, malformed or non-advancing beta version,
  generated drift, an extra metadata path, or a failed test stops before any
  ref update.
- If `next` advances after the release PR merges but before finalization, the
  job fails rather than releasing or overwriting those later bytes. Open a new
  direct promotion PR for the new tip after diagnosing the interrupted window.
- `main`, `next`, and the tag move in an atomic push. GitHub either accepts all
  three updates or none of them.
- Tag and GitHub Release existence are checked separately. On re-run, an
  existing tag is accepted only when its peeled commit is exact `main`, is an
  ancestor of the current `next` tip, descends from the reviewed merge, and
  passes the metadata verifier. This permits a missing GitHub Release to be
  created safely even if ordinary beta development resumed after the atomic
  ref/tag push but before the original run published the Release object.
- A tag collision, branch divergence, or metadata mismatch is an incident. Do
  not delete or force-move the tag; inspect the workflow logs and roll forward.

## Bounded post-merge transition

GitHub first merges the reviewed `next` commit to `main`; the protected workflow
then creates and atomically publishes the stable metadata commit. During that
bounded interval, `main` contains reviewed release code but still reports the
beta manifest version. The workflow is serialized with one `stable-release`
concurrency group, and any failure is visible in Actions plus the channel
integrity gate. Eliminating this interval would require a pre-merge publication
transaction rather than GitHub's ordinary PR-merge event and is not claimed by
this process.
