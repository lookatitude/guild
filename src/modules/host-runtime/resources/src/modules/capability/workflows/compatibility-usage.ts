/**
 * src/modules/capability/workflows/compatibility-usage.ts
 *
 * `guild.compatibility_usage.v1` — the MEASURED input to D03's G5 removal gate.
 *
 * Spec S8. Closes audit gap F4: *"G5 depends on 'compatibility usage telemetry' that
 * nothing defines. No mechanism is specified for instrumenting legacy template/
 * domain-skill use, so the removal gate has no measurable input."*
 *
 * WHAT THIS FILE IS
 *   The typed payload one read of a SHIPPED template (15) or SHIPPED domain skill
 *   (58) produces, the closed vocabulary of reasons such a read can happen for, and
 *   the pure rollup that turns a window of those payloads into a G5 verdict.
 *
 * WHAT THIS FILE IS NOT
 *   It is not a journal. It performs NO I/O, reads no clock, and appends nothing.
 *   Emission rides the EXISTING MH-06 receipt journal (`guild.observability.v1`,
 *   telemetry/receipt-journal.ts) — the plan is explicit that capability discovery
 *   "should emit receipts through this API after it stabilizes, NOT invent another
 *   journal". This module supplies the payload type and the query; the journal
 *   supplies durability, ordering and hashing.
 *
 * NO CLOSED VOCABULARY IS WIDENED. A compatibility read rides as:
 *
 *   event_name   "task.dispatch"                    (already in RECEIPT_EVENT_NAMES)
 *   outcome_type "guild.capability_outcome.v1"      (already in RECEIPT_OUTCOME_TYPES)
 *   disposition  "degraded"                         (already in RECEIPT_DISPOSITIONS)
 *
 * and the specifics live in the outcome payload below. `degraded` is the honest
 * label for a legacy read during the migration window: the work succeeded, but via
 * the path we are retiring. Adding a new event name would be a contract change for
 * something the existing set already expresses.
 *
 * Pure library module; there is no CLI entrypoint. Reached through the capability
 * module's public index.
 */

import { CAPABILITY_RESOLVER_MODES, type CapabilityResolverMode } from "../../config";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const COMPATIBILITY_USAGE_SCHEMA = "guild.compatibility_usage.v1" as const;

/**
 * The receipt vocabulary members a compatibility read binds to. Exported as
 * constants so an emission point cannot quietly pick a different event name and
 * fall out of the G5 query's reach — the binding is part of the contract, not a
 * convention at the call site.
 */
export const COMPATIBILITY_USAGE_EVENT_NAME = "task.dispatch" as const;
export const COMPATIBILITY_USAGE_OUTCOME_TYPE = "guild.capability_outcome.v1" as const;
export const COMPATIBILITY_USAGE_DISPOSITION = "degraded" as const;

// ---------------------------------------------------------------------------
// The closed vocabularies
// ---------------------------------------------------------------------------

/** Which legacy surface was read. */
export const COMPATIBILITY_ASSET_KINDS = ["shipped_template", "shipped_domain_skill"] as const;
export type CompatibilityAssetKind = (typeof COMPATIBILITY_ASSET_KINDS)[number];

/**
 * Why the legacy asset was reached instead of a project-local definition.
 *
 * THIS IS THE LOAD-BEARING DISTINCTION IN S8. Two of these reasons are the
 * migration working CORRECTLY, not evidence of legacy dependence:
 *
 *   mint_source        minting a project role FROM a shipped template reads the
 *                      template by design — that read is the migration succeeding
 *   shadow_comparison  the A-side of a shadow compare is supposed to be legacy
 *
 * A naive total of all reads therefore NEVER reaches zero and G5 could never pass.
 * The G5 input is the DEPENDENCE subset — see `isDependenceRead`.
 */
export const COMPATIBILITY_READ_REASONS = [
  "no_project_definition",
  "explicit_legacy_mode",
  "rollback",
  "mint_source",
  "shadow_comparison",
] as const;
export type CompatibilityReadReason = (typeof COMPATIBILITY_READ_REASONS)[number];

/**
 * The reasons that indicate GENUINE legacy dependence — the only ones G5 counts.
 * Derived from the full vocabulary by exclusion so a newly added reason is counted
 * as dependence by DEFAULT (fail-closed): a future reason that is actually benign
 * must be added to `BENIGN_COMPATIBILITY_READ_REASONS` deliberately, rather than a
 * forgotten one silently suppressing the gate.
 */
export const BENIGN_COMPATIBILITY_READ_REASONS: readonly CompatibilityReadReason[] = [
  "mint_source",
  "shadow_comparison",
];

export const DEPENDENCE_COMPATIBILITY_READ_REASONS: readonly CompatibilityReadReason[] =
  COMPATIBILITY_READ_REASONS.filter((r) => !BENIGN_COMPATIBILITY_READ_REASONS.includes(r));

// ---------------------------------------------------------------------------
// The outcome payload
// ---------------------------------------------------------------------------

/** One read of one legacy asset, as it rides in the receipt's outcome payload. */
export interface CompatibilityUsageV1 {
  readonly schema_version: typeof COMPATIBILITY_USAGE_SCHEMA;

  /** Which legacy surface was read. */
  readonly asset_kind: CompatibilityAssetKind;
  /** Template role slug or skill name. */
  readonly asset_id: string;
  /** Plugin-install-relative path. */
  readonly asset_path: string;
  /** sha256 of the bytes read — proves WHICH version was consumed (S8 invariant 4). */
  readonly content_hash: string;

  /** Why the legacy asset was reached rather than a project-local definition. */
  readonly reason: CompatibilityReadReason;
  /** Resolver mode at read time — correlates usage with migration phase. */
  readonly resolver_mode: CapabilityResolverMode;

  /**
   * True ONLY for test/tooling reads. Set at the EMISSION POINT (S8 invariant 3) —
   * never inferred downstream from a path heuristic, because G5's criterion is
   * "zero NON-TEST reads" and a filter applied later is a filter that can be wrong.
   */
  readonly synthetic: boolean;
  /** The lane, when there is one. */
  readonly specialist_id: string | null;
}

/** Structural validation. Pure, never throws — an invalid payload is a typed `false`. */
export function isCompatibilityUsageV1(value: unknown): value is CompatibilityUsageV1 {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.schema_version === COMPATIBILITY_USAGE_SCHEMA &&
    COMPATIBILITY_ASSET_KINDS.includes(v.asset_kind as CompatibilityAssetKind) &&
    typeof v.asset_id === "string" &&
    v.asset_id.length > 0 &&
    typeof v.asset_path === "string" &&
    v.asset_path.length > 0 &&
    typeof v.content_hash === "string" &&
    v.content_hash.length > 0 &&
    COMPATIBILITY_READ_REASONS.includes(v.reason as CompatibilityReadReason) &&
    CAPABILITY_RESOLVER_MODES.includes(v.resolver_mode as CapabilityResolverMode) &&
    typeof v.synthetic === "boolean" &&
    (v.specialist_id === null || typeof v.specialist_id === "string")
  );
}

/**
 * The G5 predicate: does this record count as legacy DEPENDENCE?
 *
 * > G5 input = records where `synthetic === false` AND
 * > `reason ∈ {no_project_definition, explicit_legacy_mode, rollback}`.
 */
export function isDependenceRead(record: CompatibilityUsageV1): boolean {
  if (record.synthetic) return false;
  return !BENIGN_COMPATIBILITY_READ_REASONS.includes(record.reason);
}

// ---------------------------------------------------------------------------
// The G5 rollup
// ---------------------------------------------------------------------------

export interface CompatibilityUsageRollup {
  readonly window_start_release: string;
  readonly window_end_release: string;
  /** Per asset, the count of DEPENDENCE reads. */
  readonly by_asset: Readonly<Record<string, number>>;
  readonly total_dependence_reads: number;
  /** Assets with zero dependence reads across the whole window. */
  readonly removable: readonly string[];
  /**
   * Records that could not be read (torn tail, hash mismatch). NEVER zero-by-default
   * — the caller supplies the journal's own count of unreadable records.
   */
  readonly unreadable: number;
}

export interface CompatibilityUsageRollupInput {
  readonly window_start_release: string;
  readonly window_end_release: string;
  /** Every VALID payload parsed from the window. */
  readonly records: readonly CompatibilityUsageV1[];
  /**
   * The set of asset ids the rollup is accountable for — the 73 shipped assets
   * (15 templates + 58 domain skills), or a subset under test.
   *
   * REQUIRED, and deliberately not derived from `records`: deriving it would make
   * `removable` mean "assets we happened to see", so an asset that was never
   * instrumented at all would silently never appear and never be reported as
   * removable OR as a coverage gap. Supplying the universe is what lets
   * `coverage_gaps` exist.
   */
  readonly known_asset_ids: readonly string[];
  /** Unreadable-record count from the journal. Not optional — see `unreadable`. */
  readonly unreadable: number;
}

/**
 * Fold a window of payloads into the G5 verdict input. Pure; never throws.
 *
 * `removable` lists assets with zero DEPENDENCE reads — benign `mint_source` /
 * `shadow_comparison` reads and every `synthetic` read are excluded, which is the
 * whole reason a real project can ever reach zero.
 */
export function rollupCompatibilityUsage(
  input: CompatibilityUsageRollupInput,
): CompatibilityUsageRollup {
  const byAsset: Record<string, number> = {};
  for (const id of input.known_asset_ids) byAsset[id] = 0;

  let total = 0;
  for (const record of input.records) {
    if (!isDependenceRead(record)) continue;
    byAsset[record.asset_id] = (byAsset[record.asset_id] ?? 0) + 1;
    total += 1;
  }

  const removable = input.known_asset_ids.filter((id) => (byAsset[id] ?? 0) === 0).sort();

  return {
    window_start_release: input.window_start_release,
    window_end_release: input.window_end_release,
    by_asset: byAsset,
    total_dependence_reads: total,
    removable,
    unreadable: input.unreadable,
  };
}

// ---------------------------------------------------------------------------
// The G5 gate
// ---------------------------------------------------------------------------

export const G5_MIN_CLEAN_RELEASES = 2;

export interface G5Verdict {
  readonly passed: boolean;
  /** Every reason the gate is blocked. Empty iff `passed`. */
  readonly blockers: readonly string[];
  /** Assets G5 clears for removal. Empty unless `passed`. */
  readonly removable: readonly string[];
}

export interface G5Input {
  /** One rollup per release in the window, oldest first. */
  readonly rollups: readonly CompatibilityUsageRollup[];
  /**
   * Every asset id that MUST be instrumented (the 73). An id that appears in no
   * rollup's `by_asset` was never instrumented, which produces a FALSE zero —
   * S8 invariant 5, and the difference between a real gate and a vacuous one.
   */
  readonly required_asset_ids: readonly string[];
}

/**
 * Evaluate G5. Fail-closed on every axis: the gate passes only when it can PROVE
 * zero dependence, not when it merely fails to observe any.
 *
 * Blocking conditions, all independently checkable:
 *   1. fewer than 2 releases of evidence — a window that short is a schedule, not a measurement
 *   2. any dependence read in the window
 *   3. `unreadable > 0` in ANY release — the journal's own rule is that an absent
 *      observation is never success; a partially-readable journal is not evidence of zero
 *   4. a required asset that appears in NO rollup — never instrumented, so its zero is fake
 */
export function evaluateG5(input: G5Input): G5Verdict {
  const blockers: string[] = [];

  if (input.rollups.length < G5_MIN_CLEAN_RELEASES) {
    blockers.push(
      `insufficient window: ${input.rollups.length} release(s) of evidence, need >= ${G5_MIN_CLEAN_RELEASES}`,
    );
  }

  const totalDependence = input.rollups.reduce((sum, r) => sum + r.total_dependence_reads, 0);
  if (totalDependence > 0) {
    blockers.push(`${totalDependence} dependence read(s) in the window`);
  }

  const totalUnreadable = input.rollups.reduce((sum, r) => sum + r.unreadable, 0);
  if (totalUnreadable > 0) {
    // An absent observation is NEVER cleanliness (the journal's central rule).
    blockers.push(
      `${totalUnreadable} unreadable record(s) — a partially-readable journal is not evidence of zero usage`,
    );
  }

  const observed = new Set<string>();
  for (const rollup of input.rollups) {
    for (const id of Object.keys(rollup.by_asset)) observed.add(id);
  }
  const uninstrumented = input.required_asset_ids.filter((id) => !observed.has(id)).sort();
  if (uninstrumented.length > 0) {
    blockers.push(
      `${uninstrumented.length} required asset(s) never instrumented (a false zero): ${uninstrumented.join(", ")}`,
    );
  }

  const passed = blockers.length === 0;
  // `removable` is only meaningful on a passing gate — an asset "removable" under a
  // torn journal is exactly the false-clean claim this contract exists to prevent.
  const removable = passed ? [...input.required_asset_ids].sort() : [];

  return { passed, blockers, removable };
}
