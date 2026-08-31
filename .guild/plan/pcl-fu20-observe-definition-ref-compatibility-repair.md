---
type: plan
spec: .guild/spec/pcl-fu20-observe-definition-ref-compatibility-repair.md
team: .guild/team/pcl-fu20-observe-definition-ref-compatibility-repair.plan.yaml
backend: agent-team
created_at: 2026-08-23
approved: true
approved_at: 2026-08-23T19:26:06Z
---

# Plan: PCL-FU-20 observe definition-ref compatibility repair

## PRD

PRD: `.guild/prd/pcl-fu20-observe-definition-ref-compatibility-repair.md`

## Lane: eval-engineer

- task-id: T1-eval-engineer
- owner: eval-engineer
- participant-id: eval-engineer-plan
- depends-on: []
- spine: true
- consumed-contract:
  - `scripts/__tests__/agent-team-launcher.test.ts` resolved-ref/mode regression contract — consumed by T2-tooling-engineer.
  - `scripts/__tests__/migration-window.test.ts` verifier CLI/write-freedom contract — consumed by T2-tooling-engineer.
  - `.guild/runs/<run-id>/handoffs/T1-eval-engineer.md` exact focused/full rail matrix — consumed by T2-tooling-engineer.
- complexity_score: 4
- tier: powerful
- scope: Author the adversarial red-first regression contract with a shipped-template-bearing `researcher` fixture, the read-only verifier CLI controls, and the exact convergence-rail matrix. Own the failed plan-impact producer through one bounded post-change retry and an explicit degradation disposition.
- success-criteria:
  - Plant an integration control in `scripts/__tests__/agent-team-launcher.test.ts` where the shipped `researcher` template and a valid project `researcher` definition ref coexist under `observe`. Use the already canonical fixture task id `T0-researcher` and pin the host to `claude-code-cli`; require exactly one PCL-09 receipt whose `operation_id` is `compatibility-read:task-cell-identity-T0-researcher-researcher`, `receipt.recorded_at < assignment.written_at`, `assignment.specialist_profile_id === "researcher"`, `record.versions.host_id === "claude-code-cli"`, and `assignment.host_id === "claude-code-cli"`.
  - Prove the positive read is genuine: receipt `input_hash` equals the catalog content hash of the exact shipped researcher template bytes; `output_hash` equals the retained compatibility-payload bytes; the parsed payload has `synthetic: false`, `specialist_id: "researcher"`, and dispatch intent.
  - Require the TaskCell's computed type/profile hashes to equal the approved ref, and plant a divergent-ref control that refuses before assignment when the identity derived from the actually read template/local definition disagrees with either ref hash. A telemetry-only or stubbed loader must not pass.
  - Plant paired `project-local` and `strict` researcher controls that retain the same valid ref but emit no compatibility receipt, plus a project-only/no-template role that emits none in `observe`. Clarify that the dev-team build lanes themselves are not FU19 observations; this researcher fixture proves the future FU19 path.
  - Add a compatibility-enabled multi-lane control proving each matching shipped-template task emits exactly one receipt with its own exact operation id and cannot cross-link to another assignment. Retain a `--dry-run` control that snapshots the recursive run/project bytes and proves preflight does not invoke the compatibility loader or write any receipt.
  - Plant CLI tests in `scripts/__tests__/migration-window.test.ts` for valid acceptance; structurally valid compatibility-only, malformed, and detached observation refusal with exit `2`; unknown/stray option refusal with exit `1`; no `--boundary` requirement for verify; recursive project/observation byte snapshots proving `window verify` writes nothing; and `--help` output containing the exact `window verify --project-root <root> --observation <path> [--json]` usage form.
  - Require `verify` to appear in the exact `allowedByAction` key set with only `project-root`, `observation`, and `json`, and to execute before the generic boundary-required branch.
  - Retry `diff-learn` once after the bounded source/test diff exists. If it still reports a path without persisting bytes, retain the exact failure and verify the explicit changed-file list with Git; never claim a valid impact artifact.
  - Record the focused test commands and the full source-of-truth, module-resource, inventory, compiled-worker, generated-host, package-integrity, channel-integrity, docs-architecture, and full scripts rails in the lane handoff.
- autonomy-policy:
  - may act without asking after the build proposal explicitly grants Bash: edit only the two approved test files, retry the plan-impact producer once, write the run-scoped lane handoff, and run focused tests to prove the planted controls fail before implementation.
  - requires confirmation: any production-source edit, new dependency, test-surface expansion, or acceptance weakening.
  - forbidden: editing launcher/CLI implementation, mirrors, generated files, version metadata, docs, initiative state, or making a red control pass by loosening an assertion.

## Lane: tooling-engineer

- task-id: T2-tooling-engineer
- owner: tooling-engineer
- participant-id: tooling-engineer-plan
- depends-on: [T1-eval-engineer]
- spine: true
- consumed-contract:
  - `scripts/agent-team-launcher.ts` and `src/modules/dispatch/resources/scripts/agent-team-launcher.ts` resolver-mode correction — consumed by T3-docs-writer.
  - `scripts/capability-adopt.ts` and `src/modules/capability/resources/scripts/capability-adopt.ts` `window verify` exit contract — consumed by T3-docs-writer.
  - `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.codex-plugin/plugin.json` next-beta identity — consumed by T3-docs-writer.
- complexity_score: 2
- tier: mid
- scope: Implement the smallest production correction that satisfies T1 without changing the resolver ladder or definition-ref identity, add the read-only verifier CLI, synchronize canonical mirrors/digests, rebuild embedded/generated distributions, and advance the next beta identity. The lane retains the approved plan-phase mid tier; any powerful build-tier escalation must be explicit in the build proposal and decision.
- success-criteria:
  - Refactor `specialistIdentity` so compatibility-enabled modes run the existing real shipped-template loader before the complete-ref return when a matching catalog entry exists. Derive type/profile ids and hashes from the actual template/local definition bytes, require ids to equal the lane name and hashes to equal the complete ref, then return that verified identity with the real receipt timestamp for assignment ordering.
  - Preserve typed refusal behavior: a refused required compatibility read or template/ref identity divergence fails before TaskCell assignment; a project-only role with no catalog template continues through its valid ref without a fabricated receipt; project-local/strict use the complete ref and never call the loader.
  - Add `window verify --project-root <root> --observation <path> [--json]` to `scripts/capability-adopt.ts`, registered in the exact per-action allowlist and handled before the generic boundary requirement. Back it directly with `verifySubstantiveMigrationObservation`; success exits `0`, verifier refusal exits `2`, usage error exits `1`, and the action performs no write or counter update.
  - Make all T1 tests green without weakening them; synchronize the dispatch and capability module-resource mirrors/digests using the canonical scripts.
  - Rebuild every compiled worker and host package that embeds either changed source. Change only `.claude-plugin/plugin.json` as the canonical version source from `2.7.0-beta.17` to `2.7.0-beta.18`, then run `sync:claude-install` and canonical host/inventory builders to regenerate marketplace, Codex manifest, package identity, and inventory bytes; never hand-edit generated version projections. Run `npm run check:channel-integrity` as a named required rail.
  - Pass the focused launcher/migration tests and every rail named by T1; retain exact command/result evidence in the lane handoff.
- autonomy-policy:
  - may act without asking after the build proposal explicitly grants Bash: edit the two bounded authored scripts, their canonical module mirrors/digests, required compiled/generated packages, only the canonical Claude version manifest, and the run-scoped handoff; run deterministic build and test tooling.
  - requires confirmation: dependency changes, resolver policy/schema changes, edits outside the mirror/generated blast radius, release-channel operations, or acceptance changes.
  - forbidden: stable-main edits, fabricated receipts, post-close operations, counter changes, verifier weakening, manual generated-byte patches, force-passing tests/review, or PR merge.

## Lane: docs-writer

- task-id: T3-docs-writer
- owner: docs-writer
- participant-id: docs-writer-plan
- depends-on: [T2-tooling-engineer]
- complexity_score: 2
- tier: powerful
- scope: Author a run-scoped, line-addressed docs/v2 reconciliation handoff for the exact implemented resolver-mode and read-only verifier behavior. The umbrella repo owns the actual docs/v2 edits; this plugin lane must not write across repository boundaries.
- success-criteria:
  - Produce `.guild/runs/<run-id>/handoffs/T3-docs-writer.md` with exact replacement prose and line anchors for umbrella-owned `docs/v2/architecture/modules/capability.html`: legacy/observe/shadow perform the real load-bearing template read and identity equality check when a matching template exists; project-local/strict and project-only roles remain read-free.
  - In the same handoff, specify the exact `docs/v2/lifecycle.html` addition for `capability-adopt window verify`, exit meanings, write-freedom, second-checkout use, and the distinction between a beta boundary and an accepted observation.
  - Use portable commit/tree/package identities only and do not claim FU19, FU06, stable promotion, or D8 closure. The handoff must name the umbrella repo as the sole owner of the actual page edits.
  - Provide the exact umbrella docs architecture/document-contract commands the operator must run after applying the handoff.
- autonomy-policy:
  - may act without asking: read the implemented plugin diff and the two umbrella docs pages, then write only the run-scoped documentation handoff.
  - requires confirmation: changes to product contracts, source code, additional documentation surfaces, or claims beyond implemented evidence.
  - forbidden: editing either repository's docs pages, tests, implementation, mirrors, generated host packages, versions, initiative counters, or publishing operator-identifying data.

## Operator-owned verification and landing gates

1. Re-compose the build-phase team from this approved plan and obtain a new
   hash-bound user decision before dispatch. The proposal must explicitly grant
   `Read, Write, Edit, Glob, Grep, Bash` to eval-engineer and tooling-engineer,
   retain docs-writer's read/run-handoff scope without cross-repo writes, and
   explicitly decide any tooling-engineer escalation from mid to powerful.
2. After all lanes complete, run the full rail matrix from a clean exact-tree
   checkout. Require authored/mirror digests, compiled workers, generated hosts,
   package identities, inventory, docs, focused tests, and full scripts suite to
   agree; a partial green set does not qualify.
3. Apply the approved T3 handoff only in the isolated umbrella evidence branch,
   commit the two docs/v2 pages in the umbrella repository, and run its docs
   architecture/document-contract rails. Bind that commit to the plugin repair
   commit as one cross-repo rollout in a run-scoped receipt containing both full
   commit/tree identities and the exact successful docs-rail outputs; verify both
   identities from clean checkouts before the plugin PR can merge. This is an
   explicit operator-enforced landing gate because the plugin repository cannot
   mechanically require an umbrella commit; the later D8 close gate remains the
   fail-closed repository check against a missing or stale docs leg.
4. Run a fresh checksum-bound independent review over the exact candidate diff,
   planted controls, generated surfaces, and docs. Zero blocking findings and a
   deterministic verifier pass are required.
5. Commit only the reviewed repair slice, push the isolated branch, open a PR to
   `next`, and require all protected checks. Merging and the automatic next-beta
   workflow each remain explicit operator gates.
6. After merge, verify the remote merge commit/tree and OIDC-attested boundary.
   Only then update umbrella PCL-FU-20 and repoint FU19; do not add an FU06
   observation or counter until the later genuine runtime run passes.

The lane metadata is intentionally asymmetric: T1 and T2 are the implementation
spine, while T3 is a post-implementation reconciliation handoff. T3 retains the
operator-approved powerful tier because it owns exact consumer-facing contract
language; T2 retains the approved mid tier unless the build proposal explicitly
requests and the operator approves an escalation.
