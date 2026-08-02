/**
 * src/modules/telemetry/workflows/guild-trace-events.ts
 *
 * R-TRACE (Wave 6 observability) — 6 structured trace event schemas.
 *
 * Defines typed interfaces + lightweight validator functions for the 6
 * structured events that Guild emits at key hot-path boundaries:
 *
 *   guild.trace.dispatch.v1         — specialist/lane dispatch
 *   guild.trace.recall.v1           — recall() invocation result
 *   guild.trace.config_resolution.v1 — resolveSettings() completion
 *   guild.trace.security_decision.v1 — PreToolUse scope enforcement decision
 *   guild.trace.degradation.v1      — host-capability degradation / fallback
 *   guild.trace.recall_decision.v1  — recall-quality decision for G10 tuning
 *
 * Design principles:
 * - ADDITIVE only: emitting an event MUST NOT change existing return values.
 *   Callers emit in a try/catch; a trace failure NEVER breaks the real path.
 * - Versioned schemas: the `schema_version` field pins the shape contract.
 *   A schema bump requires a new v2 type, not mutation of the v1 type.
 * - Validators are pure functions (no I/O, no Date.now(), no side effects).
 *   They return { ok: true } or { ok: false, reason: string }.
 * - The emit path uses appendEvent from hooks/lib/v1.4/log-jsonl-writer
 *   (or a side-channel write when the log writer is not available).
 *
 * Usage (emit-point wrapper):
 *   import { makeDispatchEvent, validateGuildTraceEvent } from './guild-trace-events';
 *   const evt = makeDispatchEvent({ ... });
 *   // validate(evt) → { ok: true } before appending
 *
 * Owned by: tooling-engineer (scripts/ scope per AGENTS.md)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared base
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fields present on every guild.trace.*.v1 event.
 * `ts` is an ISO-8601 timestamp string (caller supplies — no Date.now() here).
 */
export interface GuildTraceEventBase {
  /** Versioned schema token — one of the 5 event types. */
  schema_version: string;
  /** ISO-8601 wall-clock timestamp supplied by the caller. */
  ts: string;
  /** Run ID this event belongs to. */
  run_id: string;
  /** Lane / specialist that emitted the event (empty string for lead session). */
  lane_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. guild.trace.dispatch.v1 — specialist/lane dispatch
// ─────────────────────────────────────────────────────────────────────────────

/** How the dispatch was executed. */
export type DispatchBackend =
  | "agent"       // in-process Agent tool call
  | "tmux"        // tmux pane send-keys
  | "remote"      // remote worktree
  | "unknown";    // backend not determinable at emit time

export interface GuildTraceDispatchV1 extends GuildTraceEventBase {
  schema_version: "guild.trace.dispatch.v1";
  /** Specialist agent name being dispatched (e.g. "guild:backend"). */
  specialist: string;
  /** Phase this dispatch belongs to (e.g. "execute", "review"). */
  phase: string;
  /** Task / lane identifier within the plan. */
  task_id: string;
  /** Backend used for dispatch. */
  backend: DispatchBackend;
  /** Host-capability backend rung (1=full, 4=degraded). 0 if unknown. */
  backend_rung: number;
  /** ISO-8601 timestamp when dispatch was initiated (same as ts or caller start). */
  dispatched_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. guild.trace.recall.v1 — recall() invocation
// ─────────────────────────────────────────────────────────────────────────────

/** Which recall branch won in the A→B→C→D waterfall. */
export type RecallBranch =
  | "sqlite"      // branch A — SQLite FTS cache
  | "file-bm25"   // branch B — in-process BM25
  | "fs-scan"     // branch C — last-resort fs scan
  | "kg-query"    // branch D — knowledge-graph 2-hop
  | "structural"  // branch E (G7) — model-free graph-query structural channel
  | "combined"    // wiki + KG (+ structural) both contributed
  | "empty";      // no results from any branch

export interface GuildTraceRecallV1 extends GuildTraceEventBase {
  schema_version: "guild.trace.recall.v1";
  /** The query string passed to recall(). */
  query: string;
  /** Recall branch that returned results (or 'empty'). */
  branch: RecallBranch;
  /** Number of ProtectedChunks returned. */
  chunk_count: number;
  /** Elapsed wall-clock ms for this recall invocation. */
  duration_ms: number;
  /**
   * Whether a QUARANTINED chunk was produced (recall-protect.ts fired).
   * true → at least one chunk wrapped in [QUARANTINED].
   */
  had_quarantine: boolean;
  /** Optional wiki root path (redacted at caller if it contains operator path). */
  cwd_redacted: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2b. guild.trace.recall_decision.v1 — recall-quality decision (G10)
// ─────────────────────────────────────────────────────────────────────────────

/** Downstream outcome of the lane that consumed this recall (if resolvable). */
export type LaneOutcome = "success" | "failure" | "unknown";

/**
 * A recall-QUALITY decision event (distinct from guild.trace.recall.v1, which is
 * the operational recall trace). Carries the signal needed to tune the
 * `recallScoreThreshold` empirically: the top relevance score the winning
 * branch produced, the threshold in effect, and whether the recall was strong
 * enough that an agent could skip a full file read (`read_skip_fired`).
 *
 * Privacy: the raw query is NEVER logged. `query_hash` is a sha256[:16] of the
 * full query (stable grouping key); `query_preview` is a short truncation for
 * human-readable reports (≤ 60 chars, may be empty).
 */
export interface GuildTraceRecallDecisionV1 extends GuildTraceEventBase {
  schema_version: "guild.trace.recall_decision.v1";
  /** sha256[:16] of the full query — stable grouping key, no raw content. */
  query_hash: string;
  /** Truncated query preview (≤ 60 chars) for report readability; may be "". */
  query_preview: string;
  /** Recall branch that won the waterfall (or 'empty'). */
  branch: RecallBranch;
  /** Top raw relevance score of the winning branch (branch-native scale, ≥ 0). */
  top_score: number;
  /** The recallScoreThreshold in effect at recall time (≥ 0). */
  threshold: number;
  /**
   * Whether recall was strong enough to skip a full read:
   * chunk_count > 0 AND top_score >= threshold.
   */
  read_skip_fired: boolean;
  /** Number of ProtectedChunks returned. */
  chunk_count: number;
  /**
   * G10 parity: whether `top_score` is a comparable, threshold-meaningful score.
   * The SQLite (branch A) and fs-scan (branch C) wiki paths expose NO comparable
   * score, so a recall they win is `scored: false` and `top_score` is a
   * placeholder 0 — it MUST NOT be compared against a threshold. Only the
   * file-BM25 (B) and kg-query (D) branches produce a real score (`scored: true`).
   * recall-stats EXCLUDES `scored: false` events from skip-rate + threshold
   * simulation so the SQLite-on vs SQLite-off (BM25) skip behavior cannot diverge
   * via a coerced-0 (the off==on invariant). See recall.ts §combine.
   */
  scored: boolean;
  /** Downstream lane outcome hook ('unknown' at emit time; resolved by a join). */
  lane_outcome: LaneOutcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. guild.trace.config_resolution.v1 — resolveSettings() completion
// ─────────────────────────────────────────────────────────────────────────────

/** Which settings layers were found / contributed. */
export interface ConfigResolutionLayers {
  workspace: boolean;
  workspace_local: boolean;
  project: boolean;
  project_local: boolean;
  rigor: string | null;   // rigor profile name or null
  cli: boolean;
}

export interface GuildTraceConfigResolutionV1 extends GuildTraceEventBase {
  schema_version: "guild.trace.config_resolution.v1";
  /** Effective rigor value after resolution. */
  rigor: string;
  /** Agent mode after resolution. */
  agent_mode: string;
  /** Which layers contributed to the resolution. */
  layers: ConfigResolutionLayers;
  /** Elapsed wall-clock ms for resolveSettings(). */
  duration_ms: number;
  /**
   * Fingerprint of the resolved config — sha256[:8] of JSON.stringify(config).
   * Stable across multiple reads of the same effective config. No raw config
   * content is emitted (could contain operator settings).
   */
  config_fingerprint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. guild.trace.security_decision.v1 — PreToolUse scope enforcement
// ─────────────────────────────────────────────────────────────────────────────

/** Enforcement outcome for this tool call. */
export type SecurityDecisionOutcome =
  | "allow"         // tool call is in scope — permitted
  | "ask"           // out of scope, not under bypass → gate via always-ask
  | "deny"          // out of scope, bypass + deny policy → hard block
  | "audit"         // out of scope but bypass + audit → proceed + log
  | "pass-through"; // no GUILD_CAPABILITY_SCOPE set → fall-through

export interface GuildTraceSecurityDecisionV1 extends GuildTraceEventBase {
  schema_version: "guild.trace.security_decision.v1";
  /** Tool name being gated (e.g. "Bash", "Write"). */
  tool_name: string;
  /** Outcome of the enforcement decision. */
  decision: SecurityDecisionOutcome;
  /** Whether the session is in bypassPermissions mode. */
  bypass_mode: boolean;
  /** Whether the autonomy policy was forced (deny forced by auto_approve). */
  policy_forced: boolean;
  /** The autonomy mode at decision time. */
  autonomy_mode: string;
  /**
   * Whether the capability scope was loaded from env vs file fallback.
   * "env" = GUILD_CAPABILITY_SCOPE; "file" = capability scope file read.
   */
  scope_source: "env" | "file" | "none";
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. guild.trace.degradation.v1 — host-capability degradation / fallback
// ─────────────────────────────────────────────────────────────────────────────

/** Surface where degradation was detected. */
export type DegradationSurface =
  | "dispatch"        // dispatch fell back (e.g. agent → serial)
  | "recall"          // recall fell back (e.g. sqlite → fs-scan)
  | "config"          // config resolution fell back (e.g. no settings.json)
  | "hook"            // hook startup / execution degraded
  | "host-capability" // host capability below required rung
  | "other";

export interface GuildTraceDegradationV1 extends GuildTraceEventBase {
  schema_version: "guild.trace.degradation.v1";
  /** Where degradation was detected. */
  surface: DegradationSurface;
  /** Human-readable reason for degradation (no secrets/paths). */
  reason: string;
  /** What was attempted before fallback. */
  attempted: string;
  /** What was used instead (the fallback). */
  fallback: string;
  /** Severity — "warn" for handled fallbacks, "error" for unrecoverable. */
  severity: "warn" | "error";
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. guild.trace.model_inspection.v1 — M0 read-only routing inspection (lane T6)
// ─────────────────────────────────────────────────────────────────────────────

export interface GuildTraceModelInspectionV1 extends GuildTraceEventBase {
  schema_version: "guild.trace.model_inspection.v1";
  /** Session host family as inspected ("unknown" when unbound). */
  host_family: string;
  /** Session host surface as inspected ("unknown" when unbound). */
  host_surface: string;
  /** Identity trust surfaced by the inspection ("asserted" | "verified"). */
  identity_trust: string;
  /** Catalog state surfaced ("ok" | "absent" | "discovery_disabled" | "inspect_disabled"). */
  catalog_state: string;
  /** Frozen-receipt selected model, or null when no receipt was inspected. */
  selection_model: string | null;
  /** Finalized-receipt served model, or the literal "unknown" (never the requested model). */
  actual_model: string;
  /** "strong" | "weak" from a WRITTEN adjudication block, else "none_written" (§7a). */
  independence: string;
  /** Count of honest-unknown fields the report surfaced. */
  unknowns_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Union type
// ─────────────────────────────────────────────────────────────────────────────

export type GuildTraceEvent =
  | GuildTraceModelInspectionV1
  | GuildTraceDispatchV1
  | GuildTraceRecallV1
  | GuildTraceRecallDecisionV1
  | GuildTraceConfigResolutionV1
  | GuildTraceSecurityDecisionV1
  | GuildTraceDegradationV1;

/** All valid schema_version tokens. */
export const GUILD_TRACE_SCHEMA_VERSIONS = [
  "guild.trace.dispatch.v1",
  "guild.trace.recall.v1",
  "guild.trace.recall_decision.v1",
  "guild.trace.config_resolution.v1",
  "guild.trace.security_decision.v1",
  "guild.trace.degradation.v1",
  "guild.trace.model_inspection.v1",
] as const;

export type GuildTraceSchemaVersion = (typeof GUILD_TRACE_SCHEMA_VERSIONS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Validators — pure, no I/O
// ─────────────────────────────────────────────────────────────────────────────

type ValidationResult = { ok: true } | { ok: false; reason: string };

/** Validate the shared base fields present on every guild.trace.*.v1 event. */
function validateBase(ev: unknown): ValidationResult {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const e = ev as Record<string, unknown>;

  if (typeof e["schema_version"] !== "string" || e["schema_version"] === "") {
    return { ok: false, reason: "schema_version must be a non-empty string" };
  }
  if (!(GUILD_TRACE_SCHEMA_VERSIONS as readonly string[]).includes(e["schema_version"] as string)) {
    return { ok: false, reason: `unknown schema_version: ${e["schema_version"]}` };
  }
  if (typeof e["ts"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["ts"] as string)) {
    return { ok: false, reason: "ts must be an ISO-8601 timestamp string" };
  }
  if (typeof e["run_id"] !== "string" || e["run_id"] === "") {
    return { ok: false, reason: "run_id must be a non-empty string" };
  }
  if (typeof e["lane_id"] !== "string") {
    return { ok: false, reason: "lane_id must be a string (empty string for lead session)" };
  }
  return { ok: true };
}

const DISPATCH_BACKENDS: DispatchBackend[] = ["agent", "tmux", "remote", "unknown"];
const RECALL_BRANCHES: RecallBranch[] = ["sqlite", "file-bm25", "fs-scan", "kg-query", "structural", "combined", "empty"];
const SECURITY_OUTCOMES: SecurityDecisionOutcome[] = ["allow", "ask", "deny", "audit", "pass-through"];
const DEGRADATION_SURFACES: DegradationSurface[] = ["dispatch", "recall", "config", "hook", "host-capability", "other"];

/** Validate a guild.trace.dispatch.v1 event. */
export function validateDispatchEvent(ev: unknown): ValidationResult {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev as Record<string, unknown>;

  if (e["schema_version"] !== "guild.trace.dispatch.v1") {
    return { ok: false, reason: `wrong schema_version for dispatch: ${e["schema_version"]}` };
  }
  if (typeof e["specialist"] !== "string" || e["specialist"] === "") {
    return { ok: false, reason: "specialist must be a non-empty string" };
  }
  if (typeof e["phase"] !== "string" || e["phase"] === "") {
    return { ok: false, reason: "phase must be a non-empty string" };
  }
  if (typeof e["task_id"] !== "string" || e["task_id"] === "") {
    return { ok: false, reason: "task_id must be a non-empty string" };
  }
  if (!DISPATCH_BACKENDS.includes(e["backend"] as DispatchBackend)) {
    return { ok: false, reason: `backend must be one of: ${DISPATCH_BACKENDS.join(", ")}` };
  }
  if (typeof e["backend_rung"] !== "number" || e["backend_rung"] < 0 || e["backend_rung"] > 4) {
    return { ok: false, reason: "backend_rung must be a number 0-4" };
  }
  if (typeof e["dispatched_at"] !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(e["dispatched_at"] as string)) {
    return { ok: false, reason: "dispatched_at must be an ISO-8601 timestamp string" };
  }
  return { ok: true };
}

/** Validate a guild.trace.recall.v1 event. */
export function validateRecallEvent(ev: unknown): ValidationResult {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev as Record<string, unknown>;

  if (e["schema_version"] !== "guild.trace.recall.v1") {
    return { ok: false, reason: `wrong schema_version for recall: ${e["schema_version"]}` };
  }
  if (typeof e["query"] !== "string" || e["query"] === "") {
    return { ok: false, reason: "query must be a non-empty string" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"] as RecallBranch)) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["had_quarantine"] !== "boolean") {
    return { ok: false, reason: "had_quarantine must be a boolean" };
  }
  if (typeof e["cwd_redacted"] !== "string") {
    return { ok: false, reason: "cwd_redacted must be a string" };
  }
  return { ok: true };
}

const LANE_OUTCOMES: LaneOutcome[] = ["success", "failure", "unknown"];

/** Validate a guild.trace.recall_decision.v1 event. */
export function validateRecallDecisionEvent(ev: unknown): ValidationResult {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev as Record<string, unknown>;

  if (e["schema_version"] !== "guild.trace.recall_decision.v1") {
    return { ok: false, reason: `wrong schema_version for recall_decision: ${e["schema_version"]}` };
  }
  // Privacy: query_hash MUST be exactly sha256[:16] — 16 lowercase hex chars.
  // A raw query, an upper-case hash, or a wrong-length digest is rejected so a
  // full query can never masquerade as a "hash" and be written to the log.
  if (typeof e["query_hash"] !== "string" || !/^[0-9a-f]{16}$/.test(e["query_hash"] as string)) {
    return { ok: false, reason: "query_hash must be exactly 16 lowercase hex chars (sha256[:16])" };
  }
  // Privacy: query_preview is a SHORT truncation (≤ 60 chars). A raw-query-length
  // string is rejected so the preview cannot become a full-query side-channel.
  if (typeof e["query_preview"] !== "string") {
    return { ok: false, reason: "query_preview must be a string (may be empty)" };
  }
  if ((e["query_preview"] as string).length > 60) {
    return { ok: false, reason: "query_preview must be <= 60 chars (no raw-query leak)" };
  }
  if (!RECALL_BRANCHES.includes(e["branch"] as RecallBranch)) {
    return { ok: false, reason: `branch must be one of: ${RECALL_BRANCHES.join(", ")}` };
  }
  if (typeof e["top_score"] !== "number" || e["top_score"] < 0 || !isFinite(e["top_score"] as number)) {
    return { ok: false, reason: "top_score must be a finite number >= 0" };
  }
  if (typeof e["threshold"] !== "number" || e["threshold"] < 0 || !isFinite(e["threshold"] as number)) {
    return { ok: false, reason: "threshold must be a finite number >= 0" };
  }
  if (typeof e["read_skip_fired"] !== "boolean") {
    return { ok: false, reason: "read_skip_fired must be a boolean" };
  }
  if (typeof e["chunk_count"] !== "number" || e["chunk_count"] < 0) {
    return { ok: false, reason: "chunk_count must be a non-negative number" };
  }
  if (typeof e["scored"] !== "boolean") {
    return { ok: false, reason: "scored must be a boolean" };
  }
  if (!LANE_OUTCOMES.includes(e["lane_outcome"] as LaneOutcome)) {
    return { ok: false, reason: `lane_outcome must be one of: ${LANE_OUTCOMES.join(", ")}` };
  }
  return { ok: true };
}

/** Validate a guild.trace.config_resolution.v1 event. */
export function validateConfigResolutionEvent(ev: unknown): ValidationResult {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev as Record<string, unknown>;

  if (e["schema_version"] !== "guild.trace.config_resolution.v1") {
    return { ok: false, reason: `wrong schema_version for config_resolution: ${e["schema_version"]}` };
  }
  if (typeof e["rigor"] !== "string" || e["rigor"] === "") {
    return { ok: false, reason: "rigor must be a non-empty string" };
  }
  if (typeof e["agent_mode"] !== "string" || e["agent_mode"] === "") {
    return { ok: false, reason: "agent_mode must be a non-empty string" };
  }
  if (typeof e["layers"] !== "object" || e["layers"] === null) {
    return { ok: false, reason: "layers must be an object" };
  }
  const layers = e["layers"] as Record<string, unknown>;
  for (const boolKey of ["workspace", "workspace_local", "project", "project_local", "cli"]) {
    if (typeof layers[boolKey] !== "boolean") {
      return { ok: false, reason: `layers.${boolKey} must be a boolean` };
    }
  }
  if (layers["rigor"] !== null && typeof layers["rigor"] !== "string") {
    return { ok: false, reason: "layers.rigor must be a string or null" };
  }
  if (typeof e["duration_ms"] !== "number" || e["duration_ms"] < 0) {
    return { ok: false, reason: "duration_ms must be a non-negative number" };
  }
  if (typeof e["config_fingerprint"] !== "string" || e["config_fingerprint"] === "") {
    return { ok: false, reason: "config_fingerprint must be a non-empty string" };
  }
  return { ok: true };
}

/** Validate a guild.trace.security_decision.v1 event. */
export function validateSecurityDecisionEvent(ev: unknown): ValidationResult {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev as Record<string, unknown>;

  if (e["schema_version"] !== "guild.trace.security_decision.v1") {
    return { ok: false, reason: `wrong schema_version for security_decision: ${e["schema_version"]}` };
  }
  if (typeof e["tool_name"] !== "string" || e["tool_name"] === "") {
    return { ok: false, reason: "tool_name must be a non-empty string" };
  }
  if (!SECURITY_OUTCOMES.includes(e["decision"] as SecurityDecisionOutcome)) {
    return { ok: false, reason: `decision must be one of: ${SECURITY_OUTCOMES.join(", ")}` };
  }
  if (typeof e["bypass_mode"] !== "boolean") {
    return { ok: false, reason: "bypass_mode must be a boolean" };
  }
  if (typeof e["policy_forced"] !== "boolean") {
    return { ok: false, reason: "policy_forced must be a boolean" };
  }
  if (typeof e["autonomy_mode"] !== "string" || e["autonomy_mode"] === "") {
    return { ok: false, reason: "autonomy_mode must be a non-empty string" };
  }
  if (!["env", "file", "none"].includes(e["scope_source"] as string)) {
    return { ok: false, reason: "scope_source must be 'env', 'file', or 'none'" };
  }
  return { ok: true };
}

/** Validate a guild.trace.degradation.v1 event. */
export function validateDegradationEvent(ev: unknown): ValidationResult {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev as Record<string, unknown>;

  if (e["schema_version"] !== "guild.trace.degradation.v1") {
    return { ok: false, reason: `wrong schema_version for degradation: ${e["schema_version"]}` };
  }
  if (!DEGRADATION_SURFACES.includes(e["surface"] as DegradationSurface)) {
    return { ok: false, reason: `surface must be one of: ${DEGRADATION_SURFACES.join(", ")}` };
  }
  if (typeof e["reason"] !== "string" || e["reason"] === "") {
    return { ok: false, reason: "reason must be a non-empty string" };
  }
  if (typeof e["attempted"] !== "string" || e["attempted"] === "") {
    return { ok: false, reason: "attempted must be a non-empty string" };
  }
  if (typeof e["fallback"] !== "string" || e["fallback"] === "") {
    return { ok: false, reason: "fallback must be a non-empty string" };
  }
  if (!["warn", "error"].includes(e["severity"] as string)) {
    return { ok: false, reason: "severity must be 'warn' or 'error'" };
  }
  return { ok: true };
}

/** Validate a guild.trace.model_inspection.v1 event (lane T6 — M0 inspection). */
export function validateModelInspectionEvent(ev: unknown): ValidationResult {
  const base = validateBase(ev);
  if (!base.ok) return base;
  const e = ev as Record<string, unknown>;

  if (e["schema_version"] !== "guild.trace.model_inspection.v1") {
    return { ok: false, reason: `wrong schema_version for model_inspection: ${e["schema_version"]}` };
  }
  for (const key of ["host_family", "host_surface", "identity_trust", "catalog_state", "actual_model", "independence"]) {
    if (typeof e[key] !== "string" || e[key] === "") {
      return { ok: false, reason: `${key} must be a non-empty string` };
    }
  }
  if (e["selection_model"] !== null && (typeof e["selection_model"] !== "string" || e["selection_model"] === "")) {
    return { ok: false, reason: "selection_model must be a non-empty string or null" };
  }
  if (typeof e["unknowns_count"] !== "number" || e["unknowns_count"] < 0 || !Number.isInteger(e["unknowns_count"])) {
    return { ok: false, reason: "unknowns_count must be a non-negative integer" };
  }
  return { ok: true };
}

/** Validate any guild.trace.*.v1 event — dispatches to the appropriate typed validator. */
export function validateGuildTraceEvent(ev: unknown): ValidationResult {
  if (typeof ev !== "object" || ev === null) {
    return { ok: false, reason: "event must be a non-null object" };
  }
  const sv = (ev as Record<string, unknown>)["schema_version"];
  switch (sv) {
    case "guild.trace.model_inspection.v1":
      return validateModelInspectionEvent(ev);
    case "guild.trace.dispatch.v1":
      return validateDispatchEvent(ev);
    case "guild.trace.recall.v1":
      return validateRecallEvent(ev);
    case "guild.trace.recall_decision.v1":
      return validateRecallDecisionEvent(ev);
    case "guild.trace.config_resolution.v1":
      return validateConfigResolutionEvent(ev);
    case "guild.trace.security_decision.v1":
      return validateSecurityDecisionEvent(ev);
    case "guild.trace.degradation.v1":
      return validateDegradationEvent(ev);
    default:
      return { ok: false, reason: `unknown schema_version: ${sv}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factories — pure builders (no I/O, no Date.now())
// ─────────────────────────────────────────────────────────────────────────────

/** Build a guild.trace.dispatch.v1 event. Caller supplies ts (ISO-8601 string). */
export function makeDispatchEvent(
  fields: Omit<GuildTraceDispatchV1, "schema_version">,
): GuildTraceDispatchV1 {
  return { schema_version: "guild.trace.dispatch.v1", ...fields };
}

/** Build a guild.trace.recall.v1 event. */
export function makeRecallEvent(
  fields: Omit<GuildTraceRecallV1, "schema_version">,
): GuildTraceRecallV1 {
  return { schema_version: "guild.trace.recall.v1", ...fields };
}

/** Build a guild.trace.recall_decision.v1 event (G10). */
export function makeRecallDecisionEvent(
  fields: Omit<GuildTraceRecallDecisionV1, "schema_version">,
): GuildTraceRecallDecisionV1 {
  return { schema_version: "guild.trace.recall_decision.v1", ...fields };
}

/** Build a guild.trace.config_resolution.v1 event. */
export function makeConfigResolutionEvent(
  fields: Omit<GuildTraceConfigResolutionV1, "schema_version">,
): GuildTraceConfigResolutionV1 {
  return { schema_version: "guild.trace.config_resolution.v1", ...fields };
}

/** Build a guild.trace.security_decision.v1 event. */
export function makeSecurityDecisionEvent(
  fields: Omit<GuildTraceSecurityDecisionV1, "schema_version">,
): GuildTraceSecurityDecisionV1 {
  return { schema_version: "guild.trace.security_decision.v1", ...fields };
}

/** Build a guild.trace.degradation.v1 event. */
export function makeDegradationEvent(
  fields: Omit<GuildTraceDegradationV1, "schema_version">,
): GuildTraceDegradationV1 {
  return { schema_version: "guild.trace.degradation.v1", ...fields };
}

/** Build a guild.trace.model_inspection.v1 event (lane T6 — M0 inspection). */
export function makeModelInspectionEvent(
  fields: Omit<GuildTraceModelInspectionV1, "schema_version">,
): GuildTraceModelInspectionV1 {
  return { schema_version: "guild.trace.model_inspection.v1", ...fields };
}
