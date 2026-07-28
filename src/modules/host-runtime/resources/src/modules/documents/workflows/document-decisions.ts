/**
 * src/modules/documents/workflows/document-decisions.ts
 *
 * DC-07 — the typed authority flow that machine decisions consume.
 *
 * The rule this file exists to enforce (BF-01):
 *
 *   **Structured shape is not authority.** Only a canonical record that
 *   validates under `validateDocumentRecord` can carry authority. A projection
 *   is a derived, freely recomputable summary; presented on its own it proves
 *   nothing, because its `binding` can be forged as easily as it can be
 *   checked. Without the canonical record there is nothing to bind it back to,
 *   so the resolver fails closed.
 *
 * Gate signals separate "trusted negative" from "untrusted":
 *
 *   advance — trusted authority, disposition succeeded
 *   hold    — trusted authority, disposition not succeeded (a real, believed
 *             failure/blocked/planned/in-review result)
 *   refuse  — no trusted authority: forged, stale, unbound, mismatched,
 *             malformed, legacy-only, prose-only, or absent
 *
 * A refused decision yields no usable outputs: `content_hash` is null and the
 * disposition is `unknown`, so a caller cannot accidentally consume a value
 * that the module declined to vouch for.
 */

import { DocumentIssue, safeGet, sortIssues } from "./document-safe";
import { hashDocumentRecord } from "./document-hash";
import { DocumentRecord, validateDocumentRecord } from "./document-records";
import {
  DocumentDisposition,
  DocumentProjection,
  projectValidatedRecord,
  validateDocumentProjection,
  verifyProjectionAgainstRecord,
} from "./document-projection";

export type DocumentAuthority = "canonical_record" | "none";
export type DocumentGateSignal = "advance" | "hold" | "refuse";

export interface DocumentSources {
  record?: unknown;
  projection?: unknown;
  legacy_record?: unknown;
  html?: unknown;
  markdown?: unknown;
}

export interface DocumentAuthorityResolution {
  authority: DocumentAuthority;
  record: DocumentRecord | null;
  refusals: string[];
  evidence: DocumentIssue[];
}

export interface DocumentDecision {
  authority: DocumentAuthority;
  gate_signal: DocumentGateSignal;
  disposition: DocumentDisposition;
  content_hash: string | null;
  projection: DocumentProjection | null;
  refusals: string[];
  evidence: DocumentIssue[];
}

const SOURCE_KEYS = Object.freeze([
  "record",
  "projection",
  "legacy_record",
  "html",
  "markdown",
]);

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/**
 * Resolve which source — if any — may speak for this document.
 * Total over hostile `sources` objects.
 */
export function resolveDocumentAuthority(sources: unknown): DocumentAuthorityResolution {
  const refusals: string[] = [];
  const evidence: DocumentIssue[] = [];

  try {
    if (sources === null || typeof sources !== "object") {
      return { authority: "none", record: null, refusals: ["sources_not_an_object"], evidence: [] };
    }

    const read: Record<string, unknown> = {};
    let unreadable = false;
    for (const key of SOURCE_KEYS) {
      const value = safeGet(sources, key);
      if (value.ok === false) {
        unreadable = true;
        continue;
      }
      read[key] = value.value;
    }
    if (unreadable) refusals.push("source_unreadable");

    const recordSource = read["record"];
    const projectionSource = read["projection"];

    if (present(recordSource)) {
      const validation = validateDocumentRecord(recordSource);
      if (!validation.valid || validation.record === null) {
        refusals.push("record_invalid");
        evidence.push(...validation.errors);
        return {
          authority: "none",
          record: null,
          refusals: [...new Set(refusals)].sort(),
          evidence: sortIssues(evidence),
        };
      }

      // A projection supplied alongside its record must be a faithful
      // derivation of exactly that record. Any divergence is treated as
      // tampering and refused rather than resolved in the record's favour.
      if (present(projectionSource)) {
        const mismatches = verifyProjectionAgainstRecord(projectionSource, validation.record);
        refusals.push(...mismatches);
      }

      return {
        authority: "canonical_record",
        record: validation.record,
        refusals: [...new Set(refusals)].sort(),
        evidence: sortIssues(evidence),
      };
    }

    // ── No canonical record from here down: nothing else can be authority. ──

    if (present(projectionSource)) {
      // Deliberately unconditional: a *genuine* projection is refused here
      // exactly as a forged one is, because with no record present the two are
      // indistinguishable to any verifier.
      refusals.push("projection_unbound_no_canonical_record");
      const shape = validateDocumentProjection(projectionSource);
      if (!shape.valid) {
        refusals.push("projection_malformed");
        evidence.push(...shape.errors);
      }
    }
    if (present(read["legacy_record"])) refusals.push("legacy_record_is_not_canonical");
    if (present(read["html"])) refusals.push("html_is_not_machine_authority");
    if (present(read["markdown"])) refusals.push("markdown_is_not_machine_authority");
    if (refusals.length === 0) refusals.push("no_document_source");

    return {
      authority: "none",
      record: null,
      refusals: [...new Set(refusals)].sort(),
      evidence: sortIssues(evidence),
    };
  } catch {
    return { authority: "none", record: null, refusals: ["internal_guard"], evidence: [] };
  }
}

const REFUSED: Pick<DocumentDecision, "gate_signal" | "disposition" | "content_hash" | "projection"> = {
  gate_signal: "refuse",
  disposition: "unknown",
  content_hash: null,
  projection: null,
};

/**
 * The single entrypoint machine consumers should use. Returns a decision that
 * is safe to act on directly: `advance` only ever appears for a validated
 * canonical record with no outstanding refusal.
 */
export function decideFromDocumentSources(sources: unknown): DocumentDecision {
  try {
    const resolution = resolveDocumentAuthority(sources);

    if (resolution.authority !== "canonical_record" || resolution.record === null) {
      return { ...REFUSED, authority: resolution.authority, refusals: resolution.refusals, evidence: resolution.evidence };
    }
    if (resolution.refusals.length > 0) {
      // We hold the canonical record, but a co-presented source contradicts
      // it. Contradiction is refused, not silently resolved.
      return {
        ...REFUSED,
        authority: resolution.authority,
        refusals: resolution.refusals,
        evidence: resolution.evidence,
      };
    }

    const projection = projectValidatedRecord(resolution.record);
    return {
      authority: "canonical_record",
      gate_signal: projection.disposition === "succeeded" ? "advance" : "hold",
      disposition: projection.disposition,
      content_hash: hashDocumentRecord(resolution.record),
      projection,
      refusals: [],
      evidence: [],
    };
  } catch {
    return { ...REFUSED, authority: "none", refusals: ["internal_guard"], evidence: [] };
  }
}

/** True only for a decision a caller may act on as a success. */
export function decisionAllowsAdvance(decision: DocumentDecision): boolean {
  return decision.authority === "canonical_record" && decision.gate_signal === "advance";
}

/** True when the decision is trustworthy, whatever its disposition. */
export function decisionIsTrusted(decision: DocumentDecision): boolean {
  return decision.authority === "canonical_record" && decision.gate_signal !== "refuse";
}
