/**
 * src/modules/host-runtime/workflows/degradation-trace.ts
 *
 * FDC degradation trace rows (deferred item 17;
 * docs/v2/dispatch-execution.html §Degradation signal table).
 *
 * Pure builders for the degradation trace rows that the dispatch-execution
 * doc identifies as `[v2.x]` emitters (no shipped emitter yet). Each
 * `makeDegradationRow(kind, fields)` call returns a typed
 * `guild.trace_event.v1`-shaped row ready to be appended to a run's
 * `logs/v1.4-events.jsonl`.
 *
 * **Covered degradation kinds (the closed enum `DegradationKind`):**
 * - `coordination.parallelism` — FDC-5: coordination lost host-native parallelism
 *   (backend_rung falls to 3 or 4; serial execution).
 * - `backend_rung` — FDC-5: explicit backend rung recorded on a dispatch.
 * - `dispatch.deferred` — FDC-5 / connector-only: dispatch was deferred (not
 *   immediately run; connector-only surface, no shipped emitter in v2.0).
 * - `feature_degraded` — FDC general: a named feature ran in degraded mode
 *   (the companion to the YAML `degraded: true` field in the primary artifact).
 * - `degraded_retrieval` — FDC-1 / FDC-3: retrieval fell back (e.g. `fs_bm25`
 *   when MCP is unavailable).
 * - `tier_degraded` — FDC dispatch §4: a lane's model tier collapsed to a
 *   lower model (single-model host detect-only surface).
 * - `degraded_reason` — per-surface: any surface emitting a `degraded_reason`
 *   string into its primary artifact; carries that reason in the trace row.
 *
 * **Determinism contract:** exported builder functions NEVER call Date.now(),
 * Math.random(), or any I/O. The CALLER supplies `ts` (timestamp) and `run_id`.
 * A `if (require.main === module)` CLI harness at the bottom may use Date.now()
 * for ad-hoc inspection only — never imported.
 *
 * **Default-safe config reads:** this module has no dependency on
 * `read-guild-config.ts` or any settings key. If a caller wants to suppress
 * emission behind a feature flag, it gates the call-site, not this module.
 *
 * **Wiring status:** all builders are dormant (no production call-site in v2.0).
 * Wire them from the dispatch / recall / tier-scoring paths when the
 * corresponding `[v2.x]` items land.
 *
 * Owned by tooling-engineer.
 */

// ── Schema / event version ────────────────────────────────────────────────────

/** Schema version for rows this module emits. */
export const DEGRADATION_TRACE_SCHEMA = "guild.trace_event.v1" as const;

/** Event type that all degradation rows use (consistent with the trace schema). */
export const DEGRADATION_EVENT_TYPE = "feature_degraded" as const;

// ── Closed enum of degradation kinds ─────────────────────────────────────────

/**
 * Closed set of degradation kinds this module can build rows for.
 *
 * Each value maps 1-to-1 to a signal in dispatch-execution.md §Degradation
 * signal table (FDC rows). Do NOT add new values without a corresponding FDC
 * row or v2.x deferred-item number.
 */
export const DEGRADATION_KINDS = Object.freeze([
  /** FDC-5: coordination lost host-native parallelism; parallelism field set. */
  "coordination.parallelism",
  /** FDC-5: backend rung explicitly recorded on a dispatch attempt. */
  "backend_rung",
  /** FDC-5 / connector-only: dispatch was deferred (not immediately run). */
  "dispatch.deferred",
  /** FDC general: a named feature ran in degraded mode. */
  "feature_degraded",
  /** FDC-1 / FDC-3: retrieval fell back (e.g. fs_bm25 when MCP unavailable). */
  "degraded_retrieval",
  /** FDC dispatch §4: lane model tier collapsed to a lower model. */
  "tier_degraded",
  /** Per-surface: a degraded_reason string emitted alongside a degraded artifact. */
  "degraded_reason",
] as const);

export type DegradationKind = (typeof DEGRADATION_KINDS)[number];

// ── Coordination parallelism values ──────────────────────────────────────────

/**
 * Closed set of `coordination.parallelism` values (FDC-5 coordination.yaml
 * contract). Matches the `parallelism` field in the FDC-5 artifact signal.
 */
export const PARALLELISM_MODES = Object.freeze([
  "host_native",
  "tmux",
  "subagent",
  "serial",
] as const);
export type ParallelismMode = (typeof PARALLELISM_MODES)[number];

// ── Backend rung ──────────────────────────────────────────────────────────────

/**
 * The 4-rung backend ladder (canonical: dispatch-execution.md §3 and
 * host-adversarial-adaptability.md). Rung 1 = tmux team (strongest),
 * Rung 4 = serial (universal floor). Stored as a number for arithmetic
 * comparisons in the scoring path.
 */
export type BackendRung = 1 | 2 | 3 | 4;

// ── Retrieval fallback values ─────────────────────────────────────────────────

/**
 * Closed set of retrieval fallback values (FDC-1 / FDC-3 `degraded_retrieval`).
 * `fs_bm25` is the primary fallback when MCP is unavailable.
 */
export const RETRIEVAL_FALLBACK_KINDS = Object.freeze([
  "fs_bm25",
  "fs_scan",
  "inline_advisory",
] as const);
export type RetrievalFallbackKind = (typeof RETRIEVAL_FALLBACK_KINDS)[number];

// ── Shared row shape ──────────────────────────────────────────────────────────

/**
 * The base fields every degradation trace row carries.
 * Extends `guild.trace_event.v1` with a narrowed `event_type` and a
 * `degradation` payload block.
 */
export interface DegradationTraceRowBase {
  /** Always "guild.trace_event.v1" — the frozen trace schema version. */
  schema_version: typeof DEGRADATION_TRACE_SCHEMA;
  /** Always "feature_degraded" — the event_type for degradation rows. */
  event_type: typeof DEGRADATION_EVENT_TYPE;
  /** The specific degradation kind (drives the shape of `degradation`). */
  kind: DegradationKind;
  /** The run this row belongs to. */
  run_id: string;
  /** RFC-3339 UTC timestamp supplied by the caller (never Date.now() here). */
  ts: string;
  /** The degradation payload — shape depends on `kind`. */
  degradation: DegradationPayload;
}

// ── Per-kind payload shapes ───────────────────────────────────────────────────

export interface PayloadCoordinationParallelism {
  kind: "coordination.parallelism";
  /** The parallelism mode that was actually used (after degradation). */
  parallelism: ParallelismMode;
  /** The backend rung that corresponds to the parallelism mode. */
  backend_rung: BackendRung;
  /** Why parallelism degraded (e.g. "tmux_unavailable", "subagent_fallback"). */
  degraded_reason: string | null;
  /** The lane DAG topological order that was actually executed. */
  dag_order?: string[];
}

export interface PayloadBackendRung {
  kind: "backend_rung";
  /** The rung selected for this dispatch attempt. */
  backend_rung: BackendRung;
  /** The `agent_mode` key that produced this rung. */
  agent_mode?: string | null;
  /** Whether this rung is a downgrade from the requested rung. */
  degraded: boolean;
  degraded_reason: string | null;
}

export interface PayloadDispatchDeferred {
  kind: "dispatch.deferred";
  /** The task_id that was deferred. */
  task_id: string;
  /** Why the dispatch was deferred. */
  deferred_reason: string | null;
  /** The connector surface this applies to (connector-only surface). */
  connector?: string | null;
}

export interface PayloadFeatureDegraded {
  kind: "feature_degraded";
  /** The FDC feature name (e.g. "agent_communication", "retrieval", "tier"). */
  feature: string;
  /** The FDC row number for cross-reference (e.g. "FDC-5"). */
  fdc_row?: string | null;
  /** Why the feature degraded. */
  degraded_reason: string | null;
  /** Which host capability was missing (from host_capability.v1). */
  host_capability_missing?: string[] | null;
  /** The degraded path taken (e.g. "file_bus_polled"). */
  degraded_path?: string | null;
}

export interface PayloadDegradedRetrieval {
  kind: "degraded_retrieval";
  /** Which fallback retrieval mechanism was used. */
  retrieval: RetrievalFallbackKind;
  /** The run-scoped context-bundle path that recorded the degradation. */
  context_bundle_path?: string | null;
  degraded_reason: string | null;
}

export interface PayloadTierDegraded {
  kind: "tier_degraded";
  /** The tier that was requested / scored. */
  requested_tier: string;
  /** The tier that was actually used (collapsed-to model). */
  collapsed_to: string;
  /** Why the tier collapsed (e.g. "single_model_host", "model_unavailable"). */
  degraded_reason: string | null;
  /** The lane this applies to, if known. */
  lane_id?: string | null;
}

export interface PayloadDegradedReason {
  kind: "degraded_reason";
  /** The surface that emitted this reason (e.g. "context_assembly", "recall"). */
  surface: string;
  /** The verbatim degraded_reason string from the primary artifact. */
  degraded_reason: string;
  /** Optional pointer to the primary artifact that carries the degraded: true field. */
  artifact_path?: string | null;
}

/**
 * The discriminated union of all per-kind payloads. The `kind` discriminant
 * is repeated inside the payload (mirroring the outer `kind`) so a consumer
 * reading only the `degradation` block can still identify the row type.
 */
export type DegradationPayload =
  | PayloadCoordinationParallelism
  | PayloadBackendRung
  | PayloadDispatchDeferred
  | PayloadFeatureDegraded
  | PayloadDegradedRetrieval
  | PayloadTierDegraded
  | PayloadDegradedReason;

// ── Row result type (discriminated union keyed on kind) ───────────────────────

/** A fully-typed degradation trace row for kind "coordination.parallelism". */
export interface DegradationRowCoordinationParallelism extends DegradationTraceRowBase {
  kind: "coordination.parallelism";
  degradation: PayloadCoordinationParallelism;
}

/** A fully-typed degradation trace row for kind "backend_rung". */
export interface DegradationRowBackendRung extends DegradationTraceRowBase {
  kind: "backend_rung";
  degradation: PayloadBackendRung;
}

/** A fully-typed degradation trace row for kind "dispatch.deferred". */
export interface DegradationRowDispatchDeferred extends DegradationTraceRowBase {
  kind: "dispatch.deferred";
  degradation: PayloadDispatchDeferred;
}

/** A fully-typed degradation trace row for kind "feature_degraded". */
export interface DegradationRowFeatureDegraded extends DegradationTraceRowBase {
  kind: "feature_degraded";
  degradation: PayloadFeatureDegraded;
}

/** A fully-typed degradation trace row for kind "degraded_retrieval". */
export interface DegradationRowDegradedRetrieval extends DegradationTraceRowBase {
  kind: "degraded_retrieval";
  degradation: PayloadDegradedRetrieval;
}

/** A fully-typed degradation trace row for kind "tier_degraded". */
export interface DegradationRowTierDegraded extends DegradationTraceRowBase {
  kind: "tier_degraded";
  degradation: PayloadTierDegraded;
}

/** A fully-typed degradation trace row for kind "degraded_reason". */
export interface DegradationRowDegradedReason extends DegradationTraceRowBase {
  kind: "degraded_reason";
  degradation: PayloadDegradedReason;
}

/**
 * The complete discriminated union of all degradation trace row types.
 * Use this when storing rows in a mixed-kind array.
 */
export type DegradationTraceRow =
  | DegradationRowCoordinationParallelism
  | DegradationRowBackendRung
  | DegradationRowDispatchDeferred
  | DegradationRowFeatureDegraded
  | DegradationRowDegradedRetrieval
  | DegradationRowTierDegraded
  | DegradationRowDegradedReason;

// ── Builder overloads ─────────────────────────────────────────────────────────

/** Base fields every `makeDegradationRow` call requires. */
export interface MakeDegradationRowBase {
  run_id: string;
  /** RFC-3339 UTC string. Supplied by the caller — never Date.now() here. */
  ts: string;
}

/**
 * `makeDegradationRow` — pure factory for degradation trace rows.
 *
 * Returns a typed `DegradationTraceRow` ready to be serialized as a single
 * NDJSON line in `logs/v1.4-events.jsonl`. The caller is responsible for
 * writing the row to disk (this function is I/O-free).
 *
 * Overloads ensure the return type narrows to the specific row kind.
 */
export function makeDegradationRow(
  kind: "coordination.parallelism",
  fields: MakeDegradationRowBase & Omit<PayloadCoordinationParallelism, "kind">
): DegradationRowCoordinationParallelism;

export function makeDegradationRow(
  kind: "backend_rung",
  fields: MakeDegradationRowBase & Omit<PayloadBackendRung, "kind">
): DegradationRowBackendRung;

export function makeDegradationRow(
  kind: "dispatch.deferred",
  fields: MakeDegradationRowBase & Omit<PayloadDispatchDeferred, "kind">
): DegradationRowDispatchDeferred;

export function makeDegradationRow(
  kind: "feature_degraded",
  fields: MakeDegradationRowBase & Omit<PayloadFeatureDegraded, "kind">
): DegradationRowFeatureDegraded;

export function makeDegradationRow(
  kind: "degraded_retrieval",
  fields: MakeDegradationRowBase & Omit<PayloadDegradedRetrieval, "kind">
): DegradationRowDegradedRetrieval;

export function makeDegradationRow(
  kind: "tier_degraded",
  fields: MakeDegradationRowBase & Omit<PayloadTierDegraded, "kind">
): DegradationRowTierDegraded;

export function makeDegradationRow(
  kind: "degraded_reason",
  fields: MakeDegradationRowBase & Omit<PayloadDegradedReason, "kind">
): DegradationRowDegradedReason;

// Implementation ──────────────────────────────────────────────────────────────
//
// The implementation body must appear immediately after the last overload
// signature — no statements between them. The implementation uses a wider
// `fields` type that is a supertype of all the overload fields types.

export function makeDegradationRow(
  kind: DegradationKind,
  fields: MakeDegradationRowBase & (
    | Omit<PayloadCoordinationParallelism, "kind">
    | Omit<PayloadBackendRung, "kind">
    | Omit<PayloadDispatchDeferred, "kind">
    | Omit<PayloadFeatureDegraded, "kind">
    | Omit<PayloadDegradedRetrieval, "kind">
    | Omit<PayloadTierDegraded, "kind">
    | Omit<PayloadDegradedReason, "kind">
  ),
): DegradationTraceRow {
  const { run_id, ts, ...payload } = fields as unknown as MakeDegradationRowBase & Record<string, unknown>;

  const degradation = { kind, ...payload } as DegradationPayload;

  return {
    schema_version: DEGRADATION_TRACE_SCHEMA,
    event_type: DEGRADATION_EVENT_TYPE,
    kind,
    run_id,
    ts,
    degradation,
  } as DegradationTraceRow;
}

// ── Validation ────────────────────────────────────────────────────────────────

const KIND_SET = new Set<string>(DEGRADATION_KINDS);

/**
 * Structural validator for a degradation trace row.
 *
 * Returns `{ valid: true }` when the row passes all checks, or
 * `{ valid: false, errors: string[] }` listing every violation.
 *
 * Callers may use this before appending a row to the events log, or in
 * telemetry replay to distinguish valid vs malformed rows.
 */
export function validateDegradationRow(
  row: unknown,
): { valid: true } | { valid: false; errors: string[] } {
  const errors: string[] = [];

  if (!row || typeof row !== "object") {
    return { valid: false, errors: ["row must be a non-null object"] };
  }

  const r = row as Record<string, unknown>;

  if (r["schema_version"] !== DEGRADATION_TRACE_SCHEMA) {
    errors.push(
      `schema_version must be "${DEGRADATION_TRACE_SCHEMA}", got ${JSON.stringify(r["schema_version"])}`,
    );
  }
  if (r["event_type"] !== DEGRADATION_EVENT_TYPE) {
    errors.push(
      `event_type must be "${DEGRADATION_EVENT_TYPE}", got ${JSON.stringify(r["event_type"])}`,
    );
  }
  if (typeof r["kind"] !== "string" || !KIND_SET.has(r["kind"])) {
    errors.push(
      `kind must be one of [${DEGRADATION_KINDS.join(", ")}], got ${JSON.stringify(r["kind"])}`,
    );
  }
  if (typeof r["run_id"] !== "string" || r["run_id"] === "") {
    errors.push(`run_id must be a non-empty string`);
  }
  if (typeof r["ts"] !== "string" || r["ts"] === "") {
    errors.push(`ts must be a non-empty RFC-3339 string`);
  }
  if (!r["degradation"] || typeof r["degradation"] !== "object") {
    errors.push(`degradation must be a non-null object`);
  } else {
    const d = r["degradation"] as Record<string, unknown>;
    if (d["kind"] !== r["kind"]) {
      errors.push(`degradation.kind must match the outer kind field`);
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── isValidDegradationRow convenience wrapper ─────────────────────────────────

/** Type-predicate convenience wrapper around `validateDegradationRow`. */
export function isValidDegradationRow(row: unknown): row is DegradationTraceRow {
  return validateDegradationRow(row).valid;
}
