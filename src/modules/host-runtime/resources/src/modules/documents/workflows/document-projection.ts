/**
 * src/modules/documents/workflows/document-projection.ts
 *
 * DC-03 — compact execution projections.
 *
 * A projection is derived ONLY from a validated canonical record. Nothing here
 * reads rendered HTML or Markdown prose, so a projection can never inherit a
 * claim that only exists in presentation.
 *
 * Two properties matter downstream:
 *
 *   - Evidence outranks claim. A record whose declared verdict/outcome/status
 *     contradicts its own itemised evidence is demoted, and the demotion is
 *     reported as a signal rather than silently applied.
 *   - The `binding` is an INTEGRITY tag, not an authentication token. Anyone
 *     can recompute it, which is precisely why a projection presented without
 *     its canonical record is never authority (see document-decisions.ts).
 */

import {
  DocumentIssue,
  deepFreeze,
  hashCanonicalValue,
  isObjectLike,
  pushIssue,
  sortIssues,
} from "./document-safe";
import { hashDocumentRecord } from "./document-hash";
import {
  DOCUMENT_KINDS,
  DOCUMENT_SCHEMA_VERSION,
  DocumentKind,
  DocumentRecord,
  validateDocumentRecord,
} from "./document-records";

export const DOCUMENT_PROJECTION_SCHEMA_VERSION = "guild.document_projection.v1" as const;

export const DOCUMENT_DISPOSITIONS = Object.freeze([
  "succeeded",
  "failed",
  "blocked",
  "in_review",
  "planned",
  "unknown",
] as const);
export type DocumentDisposition = (typeof DOCUMENT_DISPOSITIONS)[number];

export interface DocumentProjection {
  schema_version: typeof DOCUMENT_PROJECTION_SCHEMA_VERSION;
  record_id: string;
  record_kind: DocumentKind;
  record_schema_version: typeof DOCUMENT_SCHEMA_VERSION;
  content_hash: string;
  disposition: DocumentDisposition;
  signals: string[];
  binding: string;
}

export type DocumentProjectionResult =
  | { ok: true; projection: DocumentProjection }
  | { ok: false; errors: DocumentIssue[] };

interface DispositionDerivation {
  disposition: DocumentDisposition;
  signals: string[];
}

/**
 * Derive disposition + signals from the record body alone, demoting any
 * declared status that its own evidence contradicts.
 */
function deriveDisposition(record: DocumentRecord): DispositionDerivation {
  if (record.kind === "verify") {
    const failed = record.body.checks.filter((check) => check.result === "fail").map((check) => check.id);
    if (record.body.outcome === "pass" && failed.length > 0) {
      return {
        disposition: "failed",
        signals: ["outcome_demoted_by_failed_check", ...failed],
      };
    }
    if (record.body.outcome === "pass") return { disposition: "succeeded", signals: [] };
    if (record.body.outcome === "fail") return { disposition: "failed", signals: failed };
    return { disposition: "unknown", signals: failed };
  }

  if (record.kind === "review") {
    const blocking = record.body.findings
      .filter((finding) => finding.severity === "blocking")
      .map((finding) => finding.id);
    if (record.body.verdict === "approved" && blocking.length > 0) {
      return {
        disposition: "in_review",
        signals: ["verdict_demoted_by_blocking_findings", ...blocking],
      };
    }
    if (record.body.verdict === "approved") return { disposition: "succeeded", signals: [] };
    if (record.body.verdict === "rejected") return { disposition: "failed", signals: blocking };
    return { disposition: "in_review", signals: blocking };
  }

  if (record.kind === "handoff") {
    const openIssues = record.body.issues;
    if (record.body.status === "completed" && openIssues.length > 0) {
      return {
        disposition: "in_review",
        signals: ["status_demoted_by_open_issues"],
      };
    }
    if (record.body.status === "completed") return { disposition: "succeeded", signals: [] };
    if (record.body.status === "failed") return { disposition: "failed", signals: [] };
    if (record.body.status === "blocked") return { disposition: "blocked", signals: [] };
    return { disposition: "in_review", signals: [] };
  }

  if (record.kind === "plan") {
    const blocked = record.body.steps.filter((step) => step.status === "blocked").map((step) => step.id);
    if (blocked.length > 0) return { disposition: "blocked", signals: blocked };
    const allDone = record.body.steps.every((step) => step.status === "done");
    return { disposition: allDone ? "succeeded" : "planned", signals: [] };
  }

  // spec
  const musts = record.body.requirements
    .filter((requirement) => requirement.priority === "must")
    .map((requirement) => requirement.id);
  return { disposition: "planned", signals: musts };
}

/** The binding covers every projection field except the binding itself. */
function bindingFor(core: Omit<DocumentProjection, "binding">): string {
  const hashed = hashCanonicalValue(core);
  return hashed.ok ? hashed.hash : "sha256:unbindable";
}

/** Build a projection from an already-validated record. */
export function projectValidatedRecord(record: DocumentRecord): DocumentProjection {
  const derived = deriveDisposition(record);
  const core: Omit<DocumentProjection, "binding"> = {
    schema_version: DOCUMENT_PROJECTION_SCHEMA_VERSION,
    record_id: record.id,
    record_kind: record.kind,
    record_schema_version: DOCUMENT_SCHEMA_VERSION,
    content_hash: hashDocumentRecord(record),
    disposition: derived.disposition,
    signals: derived.signals,
  };
  return deepFreeze({ ...core, binding: bindingFor(core) });
}

/**
 * Project an untrusted value: validate and normalize first, then derive.
 * Total — hostile input yields explicit errors, never a throw.
 */
export function projectDocumentRecord(input: unknown): DocumentProjectionResult {
  const validation = validateDocumentRecord(input);
  if (!validation.valid || validation.record === null) {
    return { ok: false, errors: validation.errors };
  }
  return { ok: true, projection: projectValidatedRecord(validation.record) };
}

// ── Projection shape validation ──────────────────────────────────────────────

const PROJECTION_KEYS = Object.freeze([
  "schema_version",
  "record_id",
  "record_kind",
  "record_schema_version",
  "content_hash",
  "disposition",
  "signals",
  "binding",
]);

export interface ProjectionValidationResult {
  valid: boolean;
  errors: DocumentIssue[];
}

/**
 * Structural check for a claimed projection. Passing this says only "this is
 * shaped like a projection" — it deliberately says nothing about authority.
 */
export function validateDocumentProjection(input: unknown): ProjectionValidationResult {
  const errors: DocumentIssue[] = [];
  try {
    if (!isObjectLike(input)) {
      pushIssue(errors, "$", "not_an_object", "projection must be an object");
      return { valid: false, errors: sortIssues(errors) };
    }
    // Reuse the record validator's discipline via a small local read, so this
    // stays total over hostile accessors too.
    const asRecord = input as Record<string, unknown>;
    for (const key of PROJECTION_KEYS) {
      let value: unknown;
      try {
        value = asRecord[key];
      } catch {
        pushIssue(errors, `$.${key}`, "property_read_threw", `$.${key}: property read threw`);
        continue;
      }
      if (value === undefined) {
        pushIssue(errors, `$.${key}`, "missing_field", `$.${key} is required`);
      }
    }
    return { valid: errors.length === 0, errors: sortIssues(errors) };
  } catch {
    pushIssue(errors, "$", "internal_guard", "projection validation was interrupted");
    return { valid: false, errors: sortIssues(errors) };
  }
}

/**
 * Compare a claimed projection against the canonical record it names.
 * Returns the list of mismatch codes — empty means the projection is a
 * faithful derivation of that exact record.
 */
export function verifyProjectionAgainstRecord(
  claimed: unknown,
  record: DocumentRecord
): string[] {
  const mismatches: string[] = [];
  const expected = projectValidatedRecord(record);
  const shape = validateDocumentProjection(claimed);
  if (!shape.valid) return ["projection_malformed"];

  const claimedRecord = claimed as Record<string, unknown>;
  const read = (key: string): unknown => {
    try {
      return claimedRecord[key];
    } catch {
      return undefined;
    }
  };

  if (read("schema_version") !== DOCUMENT_PROJECTION_SCHEMA_VERSION) {
    mismatches.push("projection_schema_version_mismatch");
  }
  if (read("record_id") !== expected.record_id) mismatches.push("projection_record_id_mismatch");
  if (read("record_kind") !== expected.record_kind) mismatches.push("projection_record_kind_mismatch");
  if (read("record_schema_version") !== expected.record_schema_version) {
    mismatches.push("projection_record_schema_version_mismatch");
  }
  if (read("content_hash") !== expected.content_hash) mismatches.push("projection_stale");
  if (read("disposition") !== expected.disposition) mismatches.push("projection_disposition_mismatch");

  const claimedSignals = read("signals");
  const signalsHash = hashCanonicalValue(claimedSignals);
  const expectedSignalsHash = hashCanonicalValue(expected.signals);
  if (!signalsHash.ok || !expectedSignalsHash.ok || signalsHash.hash !== expectedSignalsHash.hash) {
    mismatches.push("projection_signals_mismatch");
  }
  if (read("binding") !== expected.binding) mismatches.push("projection_binding_mismatch");

  // Deterministic, de-duplicated ordering.
  return [...new Set(mismatches)].sort();
}

/** Kinds re-exported for consumers building projection-aware switches. */
export const PROJECTABLE_DOCUMENT_KINDS = DOCUMENT_KINDS;
