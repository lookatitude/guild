---
type: spec
initiative: project-capability-localization
work_item: PCL-FU-20
workspace_source: project-capability-localization/PCL-FU-20
approved: false
approval_basis: null
---

# PCL-FU-20 observe-mode definition-ref compatibility repair

## Goal

Repair the beta.17 contradiction that makes FU19 impossible: a valid project
definition ref must not suppress the legacy-authoritative compatibility read in
legacy, observe, or shadow mode. Add the missing read-only production
verification CLI, land both changes on `next`, and obtain a new attested beta
boundary before retrying the genuine observation.

## Audience

Guild maintainers and independent reviewers deciding whether the launcher,
migration observation verifier, generated host packages, and docs are ready to
produce a new exact beta boundary for FU19.

## Success criteria

- `specialistIdentity` consults the real shipped-template compatibility loader
  before assignment in legacy, observe, and shadow modes even when the lane has
  complete project definition-ref hashes. It preserves those project type/profile
  hashes for TaskCell identity and threads the compatibility receipt timestamp
  into the assignment-order guard.
- Project-local and strict dispatches do not produce compatibility usage. A
  project-only role with no shipped template never receives a fabricated receipt.
- `capability-adopt window verify --project-root <root> --observation <path>
  [--json]` invokes `verifySubstantiveMigrationObservation`, exits `0` only for a
  valid self-resolving observation, exits `2` on a verifier refusal, and does not
  mutate the project or observation.
- Focused regression tests prove the positive and negative paths, including a
  valid resolved ref in observe mode and byte-for-byte write-freedom of the new
  verifier command.
- Authored sources, module-resource mirrors/digests, compiled workers, generated
  host packages, package manifests, docs/v2, and the next beta version converge;
  every relevant rail and independent review passes.
- A reviewed PR lands on `next` and the release workflow emits a distinct
  OIDC-attested merge-built boundary. FU19 is repointed to that boundary without
  retroactively changing beta.17 or any FU06 counter.

## Constraints

- Preserve the resolver ladder: legacy/observe/shadow keep legacy authority;
  project-local/strict do not gain ambient fallback.
- Preserve definition-ref integrity and type/profile identity while recording
  the real pre-assignment compatibility read in compatibility-enabled modes.
- Do not weaken TaskCell identity, receipt ordering, journal/checkpoint, seal,
  projection, or privacy verification.
- Do not manufacture a compatibility record when no shipped template was read.
- Do not edit stable `main`, publish stable, or mark FU19/FU06 complete here.
- Treat docs/v2 as a mandatory same-rollout target.

## Non-goals

- Capturing the genuine post-repair observation; FU19 owns that external fact.
- Completing FU04 key custody, the remainder of FU06, FU05 promotion, or D8.
- Broad resolver redesign or new capability schemas.

## Risks

- A compatibility read added only for telemetry would be synthetic. The repair
  must preserve the existing legacy-authoritative decision in legacy, observe,
  and shadow modes while retaining the project-ref identity envelope.
- An over-broad branch could reintroduce ambient fallback in project-local or
  strict mode; planted mode controls must prove those paths remain read-free.
- A verifier command can claim to be read-only while rewriting an observation,
  receipt, checkpoint, or project metadata; byte snapshots before and after the
  command must prove write-freedom.
- Authored sources can pass while a module mirror, compiled worker, or generated
  host package remains stale; all distribution convergence rails are mandatory.

## Autonomy policy

- May act without asking after approval: edit the bounded launcher/CLI/tests,
  required mirrors/digests/generated packages, version metadata, docs/v2, and
  repair evidence on this isolated branch; run deterministic tests and reviews.
- Requires confirmation: this revised specialist team, any participant or scope
  change, PR landing into `next`, and any release/channel operation beyond the
  automatic next-channel beta workflow.
- Forbidden: fabricated receipts, counter edits, force-passing review, weakening
  refusal behavior, stable promotion, or publishing operator-identifying data.
