---
schema_version: guild.prd.v1
spec: .guild/spec/pcl-fu20-observe-definition-ref-compatibility-repair.md
initiative: project-capability-localization
right_size_trigger: initiative-attached
created_at: 2026-08-23
approved: true
approved_at: 2026-08-23T19:26:06Z
---

# PRD: PCL-FU-20 observe definition-ref compatibility repair

## Problem

The beta.17 launcher accepts a complete project definition ref and immediately
returns its identity hashes. In compatibility-enabled resolver modes this skips
the sole shipped-template compatibility loader, so no task-bound PCL-09 receipt
precedes assignment. FU19 can therefore complete a TaskCell but can never emit
the linked substantive operation or pass `window seal-run`.

The observation verifier is also only an exported function. A second committed
checkout has no concrete read-only CLI that can verify a retained projection and
return a machine-checkable exit status.

## Features

1. Resolver-mode-aware identity resolution: legacy, observe, and shadow perform
   the real pre-assignment template compatibility read when a shipped template
   exists, derive the load-bearing identity from the bytes actually read, and
   require it to equal the approved project ref before assignment. Project-local,
   strict, and project-only roles remain read-free.
2. Read-only observation verification: `capability-adopt window verify` invokes
   the production substantive verifier with explicit success/refusal exits and
   byte-for-byte write-freedom.
3. Distribution convergence: adversarial regressions, module mirrors/digests,
   compiled workers, generated hosts, next-channel version identity, package
   checks, a coordinated umbrella-owned docs/v2 commit, and independent review
   converge as one rollout before a plugin PR can land.

## Acceptance

- A resolved-ref observe-mode `researcher` dispatch produces exactly one durable
  non-synthetic compatibility receipt over the actual shipped template before
  assignment, proves the TaskCell join ids/host, and refuses any computed
  template/local identity that diverges from the approved project ref.
- Project-local/strict and no-template controls produce no compatibility receipt.
- `window verify` accepts only a production-valid self-resolving observation,
  refuses planted invalid inputs, and leaves every input/project byte unchanged.
- Authored/mirrored/generated package bytes and docs/v2 agree; focused and full
  required rails pass on the exact candidate tree.
- A reviewed PR lands on `next` as a distinct beta and yields an OIDC-attested
  merge-built boundary. It changes no FU06 counter by itself.

## Rollback

Revert the bounded repair commit on `next` and keep beta.17 plus FU19's blocker
record intact. Do not rewrite old boundaries, observations, or counters.
