/**
 * lifecycle — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/lifecycle/ may reach a sibling module directly.
 *
 * Folded here (KTD36): lifecycle, documents, initiatives, intake, loops, operations.
 */


// ── from src/modules/lifecycle ──────────────────────────────────────────
// MH-02 host-neutral core (`guild.runtime.contracts.v1`). Exported here because
// this index is the module's stable public entrypoint, and the module-boundary
// checker requires cross-module consumers (MH-03 adapters, MH-04 transports,
// MH-06 observability) to import through it rather than reach into `workflows/`.
// The dependency direction is one-way: these five files import nothing outside
// the declared core, so exporting them cannot pull a host, hook, wrapper,
// launcher, transport, benchmark, or website surface into a consumer.
//
// ORDERING INVARIANT — the neutral block stays FIRST in this file. It is the
// only import-closed region of the module: it has no outward module edges, so
// nothing it requires can re-enter this index. Everything below it does have
// outward edges (config, dispatch, state, host-runtime, …), and host-runtime's
// public entrypoint imports the neutral core back out of here. Re-entering this
// index while a lane export is still initializing must therefore find the
// neutral surface already bound; listing the neutral block last leaves
// `neutralFreeze` and friends undefined on that path.
export * from "./neutral-runtime-contracts";
export * from "./neutral-gate-policy";
export * from "./neutral-lifecycle-machine";
export * from "./neutral-conformance-core";
export * from "./neutral-core-boundary";
// A21-S — the owner-packet assembly spine. Pure, and import-closed against the
// two neutral-core files above; exported here for the same reason they are, so
// the release emitter and the promotion gate reach it through the module's
// public entrypoint rather than into `workflows/`.
export * from "./neutral-conformance-assembly";
// A21-7 — the MH-07 owner evaluator. Exported here for the same reason as the
// spine above, so the conformance assembler reaches this owner through the
// module's public entrypoint rather than into `workflows/`. It consumes the
// neutral files above plus the already-declared `kernel` public contract, so it
// adds no module dependency.
export * from "./module-boundary-conformance-evaluator";
// A21-8 — the MH-08 owner evaluator (module `migrations`). Here beside MH-07, not in
// `state`, because it consumes the neutral files above and state sits below lifecycle.
export * from "./host-cutover-controller";

export * from "./check-lane-liveness";
export * from "./emit-loop-event";
export * from "./mark-lane-dead";
export * from "./resume-lanes";
export * from "./retry-lane";
export * from "./run-binding";
export * from "./run-lifecycle";
export * from "./run-manifest-wiring";
export * from "./runstart-preflight";
export * from "./write-run-manifest";
export * from "./write-task-run";

// KTD40/KTD42 — the class-graph overlay merge + validator. User-facing class
// graphs are YAML data (src/surfaces/graphs/); the lifecycle domain owns
// load / merge / validate, and the layout lint executes this export.
export * from "./workflow-graph-overlay";
// U-TIER (T08 rework-r2): the per-run stable lock. Exported so the dispatch
// instance cap can make "count the run's slots" and "claim one" a single atomic
// step rather than an observation followed by a hopeful write.
export * from "./stable-lock";

// ── T09 work loop (U-LOOP) ───────────────────────────────────────────────────
// The RUNTIME half of the class graphs: load/merge the authored YAML, carry the
// cursor on the run, and route one closed decision per node. The 5-way
// LearningCheckpoint is a domain function here for the same reason — it rides an
// existing phase boundary and is not a skill (KTD57).
export * from "./learning-checkpoint-5";
export * from "./workflow-graph-load";
export * from "./workflow-router";
// T16I (KTD33/KTD43): T0-owned writes (redirect harvest, evolve apply) are enqueued
// by their CLIs and drained only by the lead session's hook.
export * from "./t0-queue";
// T09 (KTD38): the KTD16 JSONL append path. The four additive work-loop kinds
// (harvest / redirect / CAS / curator) ride the EXISTING run log, so the
// knowledge domain reaches the writer through this index — there is no third
// JSONL and no second writer.
export * from "./event-log-schema";
export * from "./event-log-writer";

// ── from src/modules/documents ──────────────────────────────────────────
/**
 * src/modules/documents/index.ts
 *
 * Public entrypoint for the documents module — HTML-native typed document
 * contracts (DC-01..DC-09).
 *
 * Consumers must import from this file only; the `workflows/` files are
 * private. The module depends on no other module and never on host internals
 * (DC-08), so importing it cannot pull a host, hook, wrapper or transport
 * surface into a consumer.
 *
 * The entrypoints machine consumers want:
 *
 *   validateDocumentRecord     untrusted value → validated, normalized record
 *   projectDocumentRecord      record → compact execution projection
 *   resolveDocumentAuthority   sources → who, if anyone, may speak
 *   decideFromDocumentSources  sources → an actionable, fail-closed decision
 *   decideFromReceiptDocument  receipt text → the same decision
 *   renderDocumentHtml         record → deterministic, inert HTML
 *   importLegacyMarkdown       Markdown → explicitly partial legacy record
 *   migrateDocumentRecord      versioned payload → current record or refusal
 */

export * from "./document-safe";
export * from "./document-records";
export * from "./document-hash";
export * from "./document-projection";
export * from "./document-html";
export * from "./document-legacy-import";
export * from "./document-versioning";
export * from "./document-decisions";
export * from "./document-receipts";
export * from "./document-service-boundary";

// ── from src/modules/initiatives ──────────────────────────────────────────
export * from "./classify-proposal";
export * from "./initiative";
export * from "./initiative-activity";
export * from "./initiative-workitems";

// ── from src/modules/intake ──────────────────────────────────────────
export * from "./classify-intake";
// T09: the six-way widening of the binary product classifier (KTD41/R55/R58).
export * from "./work-class";

// ── from src/modules/loops ──────────────────────────────────────────
export * from "./owner-architect-loop";

// ── from src/modules/operations ──────────────────────────────────────────
export * from "./operations-catalog";

// ── consumed outside the domain (T16: every importer goes through this index) ──
export {
  appendSidecarPre,
  buildOrphanedToolCall,
  buildToolCallFromPair,
  buildToolCallFromPostOnly,
  consumeSidecarPre,
  ORPHAN_LATENCY_MS,
  ORPHAN_RESULT_EXCERPT,
  type OrphanSweepResult,
  SIDECAR_MAX_BYTES as EVENT_LOG_SIDECAR_MAX_BYTES,
  type SidecarAppendOptions,
  type SidecarMatchKey,
  type SidecarPreEntry,
  sweepOrphanedSidecar,
  sweepOrphanedSidecarFull,
} from "./event-log-sidecar";
export {
  isCanonicalLaneReceipt,
  RUN_RECORD_FINDING_CODES,
  RUN_RECORD_VALIDATION_SCHEMA,
  type RunRecordFinding,
  type RunRecordFindingCode,
  type RunRecordValidation,
  scanRunsRoot,
  validateRunRecordDir,
} from "./run-record-validate";
export {
  LANE_RESUME_SCHEMA_VERSION,
  type LaneAdjudicationRef,
  type LaneExhaustionSignal,
  type LaneIndependenceRef,
  type LaneModelParams,
  type LanePatch,
  type LaneResumeCheckpoint,
  laneResumeCheckpointPath,
  type LaneState,
  type LaneStatus,
  type LaneTier,
  loadLaneResumeCheckpoint,
  loadRunState,
  markLaneDead,
  markLaneInProgress,
  readResumeEnabled,
  RUN_STATE_SCHEMA_VERSION,
  type RunStateInit,
  runStatePath,
  type RunStateV1,
  upsertLane,
  writeRunStateAtomic,
} from "./run-state";
export {
  genSpanId,
  isLlmCallEvent,
  normalizeTokens,
  payloadRef,
  type PayloadSidecarInput,
  payloadSidecarPath,
  pruneUndefined,
  type ResolveTraceOpts,
  resolveTraceV2Fields,
  SIDECAR_MAX_BYTES as TRACE_V2_SIDECAR_MAX_BYTES,
  TRACE_EVENT_SCHEMA,
  TRACE_PAYLOAD_SCHEMA,
  type TraceTokens,
  type TraceV2Fields,
  writePayloadSidecar,
} from "./trace-v2";
