/**
 * src/modules/capability/workflows/inspection-record.ts
 *
 * The PRODUCTION writer for M0 inspection evidence (T8R / F3).
 *
 * WHY THIS EXISTS. `persistInspectionReport` (inspection-persist.ts) is the
 * only writer of `.guild/runs/<id>/inspection/*.json`, and the M2 gate
 * (`gateM2` → `loadVerifiedM0Reports`) plus the dispatch module's resolver-input
 * sourcing (`deriveResolveInputsFromM0Evidence`) are the only readers. T8's
 * integrated verification found the writer had **zero production callers**:
 * `guild models inspect` is READ-ONLY by contract and the launcher's lane model
 * planner supplied no resolver inputs, so in a real run the M0 evidence dir was
 * always empty, the derived inputs were always null, and M2 could never reach a
 * v2 selection. A correct gate with no writer is a dead feature claimed as
 * integrated — this module closes that leg.
 *
 * WHAT IT DOES. Composed entirely from surfaces that already exist; no new
 * channel, no injectable seam:
 *
 *   1. reads the rollout flags from the consuming repo's `.guild/settings.json`
 *      (`loadRoutingFlags`);
 *   2. loads the run's SELF-VERIFYING sources — the frozen
 *      `guild.session_context.v1` record and the content-addressed catalog
 *      snapshot keyed off that record's identity tuple (`loadVerifiedSources`,
 *      the SAME reader `guild models inspect` rebuilds its trusted view from);
 *   3. builds the pure, deep-frozen report (`buildModelInspection`);
 *   4. persists it through the binding-verified writer
 *      (`persistInspectionReport`) — which re-verifies the run binding against
 *      the REAL filesystem before anything reaches disk.
 *
 * WHAT IT DELIBERATELY DOES NOT DO — the honest scope of F3's fix:
 *
 *   - **It never runs at M0 defaults.** Recording is gated on v2 routing being
 *     opted in (`model_routing.shadow` or `model_routing.enabled` = on). With
 *     the ADR defaults (both off) this function writes NOTHING and the dispatch
 *     path stays byte-identical to legacy.
 *   - **It never manufactures evidence.** No verified session context, or a
 *     report that does not come back `state: "ok"`, means NO write and an
 *     honest reason — never a half-bound artifact that `loadVerifiedM0Reports`
 *     would then have to reject.
 *   - **It cannot on its own make M2 reachable end-to-end.** The report's
 *     catalog block is `state: "ok"` only when a catalog snapshot exists for
 *     the run's target identity, and Guild still has no production discovery
 *     writer that publishes one (T7-M5 / T8-F7: only `nullIo` exists, and
 *     `withBudget` bounds the wait rather than the subprocess). So in a real
 *     run today this records an M0 report whose catalog is honestly `absent`,
 *     the derived resolver inputs stay null, and the resolver fails CLOSED
 *     exactly as before. What changed is that the writer is now on the real
 *     path: the moment a catalog snapshot is on record — caller-published or
 *     from a real `DiscoveryIo` — the M0→M2 chain completes with no further
 *     wiring. The remaining gap is the discovery channel (F7), not this writer.
 */

import { buildModelInspection, type ModelInspectionV1 } from "./model-inspect";
import { persistInspectionReport } from "./inspection-persist";
import { loadRoutingFlags, loadVerifiedSources } from "./models-command";

/** One report per label; the dispatch path records under this one by default. */
export const DEFAULT_INSPECTION_LABEL = "dispatch";

export interface RecordRunInspectionInput {
  /** Consuming repo root (the `.guild/` parent). */
  root: string;
  /** The run's verified binding envelope — required, never inferred. */
  binding: { run_id: string; binding_ref: string };
  /** File label (safe path segment); defaults to `dispatch`. */
  label?: string;
  /** Caller-supplied RFC3339 clock — this module never reads wall time. */
  now: string;
}

export interface RecordRunInspectionOutcome {
  /** True only when a report actually reached disk. */
  recorded: boolean;
  /** Run-dir-relative ref the M2 gate consumes, when recorded. */
  ref: string | null;
  absPath: string | null;
  /** Why the report was or was not recorded — always populated. */
  reason: string;
  /** `loadVerifiedSources` notes: what could NOT be bound, surfaced not silent. */
  notes: string[];
}

/**
 * Record this run's M0 inspection report as on-record evidence.
 *
 * Fail-closed and non-throwing on ABSENCE (no flags, no session context, no
 * usable report → `recorded: false` with a reason). It does NOT swallow a
 * binding failure: an absent/closed/mismatched binding throws
 * `BindingRejectedError` out of `persistInspectionReport`, exactly like every
 * other run-local writer — an unverifiable dispatch records nothing and says so
 * loudly.
 */
export function recordRunInspectionEvidence(
  input: RecordRunInspectionInput
): RecordRunInspectionOutcome {
  const { root, binding, now } = input;
  const label = input.label ?? DEFAULT_INSPECTION_LABEL;
  const { flags } = loadRoutingFlags(root);

  const v2OptedIn =
    flags["model_routing.shadow"] === "on" || flags["model_routing.enabled"] === "on";
  if (!v2OptedIn) {
    return {
      recorded: false,
      ref: null,
      absPath: null,
      reason:
        "v2 routing is not opted in (model_routing.shadow and model_routing.enabled are both " +
        "off) — M0 defaults record no inspection evidence and the dispatch path is unchanged",
      notes: [],
    };
  }
  if (flags["model_routing.inspect"] !== "on") {
    return {
      recorded: false,
      ref: null,
      absPath: null,
      reason:
        "model_routing.inspect is off — the inspection surface is rolled back, so no report " +
        "is built or recorded",
      notes: [],
    };
  }

  const sources = loadVerifiedSources(root, binding.run_id);
  if (sources.session_context === null) {
    return {
      recorded: false,
      ref: null,
      absPath: null,
      reason:
        `no verified guild.session_context.v1 record for run ${binding.run_id} — refusing to ` +
        "record an inspection report with an unknown identity",
      notes: sources.notes,
    };
  }

  const report: ModelInspectionV1 = buildModelInspection({
    session_context: sources.session_context,
    catalog_snapshot: sources.catalog_snapshot,
    // Policy / receipt / §7a adjudication have no verified reader in this
    // module (see loadVerifiedSources) — they stay honest unknowns rather than
    // being copied from anywhere untrusted.
    policy: null,
    receipt: null,
    adjudication: null,
    flags,
    now,
  });
  if (report.state !== "ok") {
    return {
      recorded: false,
      ref: null,
      absPath: null,
      reason: `inspection report came back state "${report.state}" — not recorded as evidence`,
      notes: sources.notes,
    };
  }

  // Binding-verified, atomic, run-local. Throws on an unverifiable binding.
  const written = persistInspectionReport({ root, report, binding, label });
  return {
    recorded: true,
    ref: written.ref,
    absPath: written.absPath,
    reason:
      `recorded M0 inspection evidence for run ${binding.run_id} under label "${label}" ` +
      `(catalog ${report.catalog.state})`,
    notes: sources.notes,
  };
}
