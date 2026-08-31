---
name: adopt
description: "Project capability localization — report shipped role/skill dependencies, freeze the deprecated compatibility catalog, apply or roll back an approved adoption manifest, operate the D03 migration window, and evaluate the journal-derived G5 removal gate. This is distinct from /guild:migrate, which remains the v1-to-v2 layout converter."
argument-hint: "<report|catalog|adopt|rollback|status|window|g5> [options]"
allowed-tools: Read, Write, Bash
---

# /guild:adopt — project capability adoption

This command localizes shipped specialist templates and domain skills into the
current project's `.guild/` state. It is deliberately separate from
`/guild:migrate`, which only converts the v1 filesystem layout to v2.

Safe discovery comes first:

```bash
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/capability-adopt.ts report --project-id <id> --project-root "$(pwd)"
npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT:-$HOME/.local/share/guild/dist/claude-code}}/scripts/capability-adopt.ts catalog --project-root "$(pwd)" --freeze
```

`report`, `status`, and an unfrozen `catalog` are read-only. `catalog --freeze`,
`adopt`, `rollback`, and `window` mutate project-owned `.guild/` state and require
operator confirmation before invocation. `adopt` requires a reviewed decisions
JSON file plus the explicit run id and its caller-held `--binding-ref`, authority,
and RFC3339 timestamp. The tool verifies the pair against the still-open lifecycle
binding; naming another open run is not authorization. `rollback` appends reversal
entries and preserves history.

The D03 window is machine-enforced:

```bash
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window start --project-root "$(pwd)" --boundary <beta-boundary.json> --project-id <id> --to observe
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window restart --project-root "$(pwd)" --boundary <newer-beta-boundary.json> --reason "upgrade legacy observations to baseline-bound v2"
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window seal-run --project-root "$(pwd)" --run-id <completed-real-run-id>
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window evidence --plugin-root "$GUILD_PLUGIN_ROOT" --project-root "$(pwd)" --boundary <beta-boundary.json> --project-id <id> --runtime-host <claude-code-cli|codex-cli> --mode observe --run-ids <real-run-id>
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window record --project-root "$(pwd)" --boundary <beta-boundary.json> --observation <observation.json>
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window record --project-root "$(pwd)" --boundary <newer-beta-boundary.json> --observation <observation.json>
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts window advance --project-root "$(pwd)" --boundary <newer-beta-boundary.json> --to shadow
npx tsx $GUILD_PLUGIN_ROOT/scripts/capability-adopt.ts g5 --project-root "$(pwd)" --windows <release-windows.json> --project-local-default <semver> --current-version <semver>
```

The `g5` verdict is the removal verdict, not telemetry alone: it also enforces
the two-minor rollback floor and refuses legacy removal throughout v2.

Start accepts only a hash-bound <code>guild.capability_migration_boundary.v1</code>
emitted by the post-merge <code>next</code> workflow and begins the prospective
observe clock before any evidence can count. Record pairs that boundary with a
<code>guild.capability_migration_observation.v2</code> rebuilt from real whole-run
profiles, intact receipt journals/checkpoints, non-synthetic PCL-09 payloads, and
the immutable run-start baseline captured inside the lifecycle start transaction.
The lifecycle appends a sequence-1, checkpoint-bound receipt for the exact snapshot
before returning the new run. The baseline command publishes that already-captured,
manifest-hash-bound snapshot only when the lifecycle receipt matches;
it never re-hashes mutable project trees and calls the later state a run-start fact.
The durable append-only receipt is written before any pending or final baseline;
it makes an interrupted capture idempotently recoverable while a caller-shaped
pending file without that prior receipt is refused.
The observation retains and hash-binds the start snapshot, published baseline,
terminal run manifest, lifecycle <code>provenance.json</code>, and the exact terminal
trace log; it verifies the provenance pointer resolves to one matching
<code>run_closed</code> event and requires the
baseline to predate the qualifying compatibility receipt and profile generation to
follow the receipt but precede the real <code>run_closed</code> event. After the run
is genuinely closed, <code>window seal-run</code> appends the distinct terminal
PCL-09 receipt and binds both verified close provenance and the freshly re-read capability trees to the final profile;
evidence refuses a missing, stale, detached, or non-final seal. Source files
are fully verified before one run's snapshot tree is atomically published; the
three-release window supplies the three distinct runs. Legacy v1 observations,
including already-completed phases, remain readable as history but never count
toward a new advance.
The boundary commits to the exact generated Claude and Codex package trees; evidence
must name one host and hash to that attested package, so a version string alone never
qualifies. Accepted run material is copied into immutable project evidence storage,
so normal run retention does not detach a live migration window.
The boundary must also pass GitHub CLI artifact-attestation verification against
the exact production workflow, source commit, `next` ref, and GitHub-hosted runner;
a self-consistent local JSON file is not release provenance. Every admitted boundary
is retained beside the window and its remote attestation is reverified whenever
persisted state is read, so structurally valid historical JSON cannot be injected.
That read is intentionally online and fail-closed: if GitHub or authenticated
<code>gh</code> verification is unavailable, <code>window status</code> reports
<code>provenance_unavailable</code> rather than labelling the local bytes damaged;
restore access and retry without rewriting the window. The beta-only window schema is
<code>guild.capability_migration_window.v4</code>; pre-beta v1-v3 fixtures are not
upgraded in place and must be retired before starting this first attested window.
If an active observe or shadow window already contains legacy v1 observations, the narrowly
scoped <code>window restart</code> action requires a strictly newer attested beta,
retains the complete prior window under a content-addressed history record, and
hash-binds that record independently into both the live window and the matching
same-mode feature-gate history. Completed observe history remains intact when a
legacy shadow window restarts. Deleting either binding, or deleting or
semantically tampering with the record, invalidates status, record, and advance.
It refuses v2-only
windows, so it is not a general-purpose soak-timer reset. Interrupted restart
recovery reverifies the archived observations and boundary provenance before it
may publish that history record.
Caller-supplied release labels, timestamps, and conformance booleans do not count.
For D03, the machine-derived <code>guild.capability_migration_advance_conformance.v1</code>
verdict is the conformance leg: it is recomputed from attested boundaries,
package-bound whole-run observations, and the ordered resolver transition. The
separate activated-host 31/31 release-conformance authority remains the downstream
FU04/FU05 stable-promotion gate; requiring it here would create a promotion cycle.
Evidence produced before entry into the current mode is refused. Advance closes
the current phase and opens the next; collect and record the new mode's first evidence
after that switch. Observe and shadow each require at least three distinct verified beta
boundaries, three distinct whole-run profiles, and fourteen GitHub-observed days.
The later project-local to strict rung still requires an attested newer boundary and
the next ordered transition, but does not repeat the observe/shadow soak. `g5 --windows <file>` rebuilds its verdict only from hash-bound
compatibility payloads referenced by intact MH-06 receipt journals. Missing
payloads, damaged journals, uninstrumented assets, fewer than two clean release
windows, or any dependence read block removal.

Always show the CLI result verbatim. Exit `0` means the requested operation
completed; `1` is invalid usage; `2` is a fail-closed refusal.
