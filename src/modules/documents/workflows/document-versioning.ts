/**
 * src/modules/documents/workflows/document-versioning.ts
 *
 * DC-09 — schema evolution.
 *
 * Version handling is a closed decision with four outcomes and no throws:
 *
 *   current     already at the supported version and valid
 *   migrated    deterministically lifted from a known older version
 *   unsupported a version this build does not know how to handle — reported
 *               explicitly rather than guessed at
 *   invalid     the version is known but the payload does not validate
 *
 * Round-trip evidence proves the pipeline is self-consistent: normalization is
 * idempotent, canonical JSON survives a serialize/parse cycle, and the
 * rendered HTML carries the same content hash the record hashes to.
 */

import { DocumentIssue, pushIssue, safeGet, sortIssues } from "./document-safe";
import { documentContentHash, hashDocumentRecord } from "./document-hash";
import { DOCUMENT_SCHEMA_VERSION, DocumentRecord, validateDocumentRecord } from "./document-records";
import { canonicalDocumentJson } from "./document-safe";
import { extractDocumentHtmlBinding, renderValidatedRecordHtml } from "./document-html";
import { projectValidatedRecord, verifyProjectionAgainstRecord } from "./document-projection";

export const SUPPORTED_DOCUMENT_SCHEMA_VERSIONS = Object.freeze([
  DOCUMENT_SCHEMA_VERSION,
] as const);

export const MIGRATABLE_DOCUMENT_SCHEMA_VERSIONS = Object.freeze([
  "guild.document.v0",
] as const);

export type DocumentMigrationStatus = "current" | "migrated" | "unsupported" | "invalid";

export interface DocumentMigrationResult {
  status: DocumentMigrationStatus;
  from_version: string | null;
  record: DocumentRecord | null;
  errors: DocumentIssue[];
}

/**
 * v0 → v1: `type` became `kind`, and the loose `meta` block became the
 * mandatory `provenance` block. The lifted record is stamped
 * `source: "migrated"` so its origin stays visible.
 */
function liftV0(input: unknown, errors: DocumentIssue[]): unknown {
  const type = safeGet(input, "type");
  const id = safeGet(input, "id");
  const title = safeGet(input, "title");
  const meta = safeGet(input, "meta");
  const body = safeGet(input, "body");

  if (!type.ok || !id.ok || !title.ok || !meta.ok || !body.ok) {
    pushIssue(errors, "$", "property_read_threw", "v0 record property read threw");
    return null;
  }

  const author = safeGet(meta.value, "author");
  const family = safeGet(meta.value, "family");
  const host = safeGet(meta.value, "host");
  const timestamp = safeGet(meta.value, "timestamp");
  if (!author.ok || !family.ok || !host.ok || !timestamp.ok) {
    pushIssue(errors, "$.meta", "property_read_threw", "$.meta property read threw");
    return null;
  }

  return {
    schema_version: DOCUMENT_SCHEMA_VERSION,
    kind: type.value,
    id: id.value,
    title: title.value,
    provenance: {
      author_id: author.value,
      author_family: family.value,
      host_id: host.value,
      created_at: timestamp.value,
      source: "migrated",
    },
    body: body.value,
  };
}

/** Deterministic version triage. Total — never throws. */
export function migrateDocumentRecord(input: unknown): DocumentMigrationResult {
  const errors: DocumentIssue[] = [];
  try {
    if (input === null || typeof input !== "object") {
      pushIssue(errors, "$", "not_an_object", "document record must be an object");
      return { status: "invalid", from_version: null, record: null, errors: sortIssues(errors) };
    }

    const versionRead = safeGet(input, "schema_version");
    if (!versionRead.ok) {
      pushIssue(errors, "$.schema_version", "property_read_threw", "$.schema_version: property read threw");
      return { status: "invalid", from_version: null, record: null, errors: sortIssues(errors) };
    }
    const version = versionRead.value;
    if (typeof version !== "string") {
      pushIssue(errors, "$.schema_version", "not_a_string", "$.schema_version must be a string");
      return { status: "invalid", from_version: null, record: null, errors: sortIssues(errors) };
    }

    if ((SUPPORTED_DOCUMENT_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
      const validation = validateDocumentRecord(input);
      if (!validation.valid || validation.record === null) {
        return { status: "invalid", from_version: version, record: null, errors: validation.errors };
      }
      return { status: "current", from_version: version, record: validation.record, errors: [] };
    }

    if ((MIGRATABLE_DOCUMENT_SCHEMA_VERSIONS as readonly string[]).includes(version)) {
      const lifted = liftV0(input, errors);
      if (lifted === null) {
        return { status: "invalid", from_version: version, record: null, errors: sortIssues(errors) };
      }
      const validation = validateDocumentRecord(lifted);
      if (!validation.valid || validation.record === null) {
        return { status: "invalid", from_version: version, record: null, errors: validation.errors };
      }
      return { status: "migrated", from_version: version, record: validation.record, errors: [] };
    }

    pushIssue(
      errors,
      "$.schema_version",
      "unsupported_schema_version",
      `schema version ${version} is not supported by this build`
    );
    return { status: "unsupported", from_version: version, record: null, errors: sortIssues(errors) };
  } catch {
    pushIssue(errors, "$", "internal_guard", "version triage was interrupted");
    return { status: "invalid", from_version: null, record: null, errors: sortIssues(errors) };
  }
}

// ── Round-trip evidence ──────────────────────────────────────────────────────

export interface RoundTripCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface RoundTripEvidence {
  stable: boolean;
  content_hash: string | null;
  checks: RoundTripCheck[];
}

/**
 * Prove the record survives every representation this module produces without
 * its identity moving. Total — an invalid input yields `stable: false`.
 */
export function documentRoundTripEvidence(input: unknown): RoundTripEvidence {
  const checks: RoundTripCheck[] = [];
  const validation = validateDocumentRecord(input);
  if (!validation.valid || validation.record === null) {
    checks.push({ name: "validation", ok: false, detail: "record did not validate" });
    return { stable: false, content_hash: null, checks };
  }
  const record: DocumentRecord = validation.record;
  const hash = hashDocumentRecord(record);
  checks.push({ name: "validation", ok: true, detail: hash });

  // Normalization is idempotent.
  const revalidated = documentContentHash(record);
  checks.push({
    name: "normalization_idempotent",
    ok: revalidated.ok && revalidated.hash === hash,
    detail: revalidated.ok ? revalidated.hash : "revalidation failed",
  });

  // Canonical JSON survives serialize → parse → revalidate.
  const canonical = canonicalDocumentJson(record);
  let jsonOk = false;
  let jsonDetail = "canonicalization failed";
  if (canonical.ok) {
    try {
      const reparsed: unknown = JSON.parse(canonical.json);
      const again = documentContentHash(reparsed);
      jsonOk = again.ok && again.hash === hash;
      jsonDetail = again.ok ? again.hash : "reparsed record did not validate";
    } catch {
      jsonDetail = "canonical JSON did not parse";
    }
  }
  checks.push({ name: "canonical_json_round_trip", ok: jsonOk, detail: jsonDetail });

  // The rendered HTML carries the same identity.
  const rendered = renderValidatedRecordHtml(record);
  let htmlOk = false;
  let htmlDetail = "render failed";
  if (rendered.ok) {
    const extracted = extractDocumentHtmlBinding(rendered.html);
    htmlOk = extracted.ok && extracted.binding.content_hash === hash;
    htmlDetail = extracted.ok ? extracted.binding.content_hash : "binding unreadable";
  }
  checks.push({ name: "html_binding_round_trip", ok: htmlOk, detail: htmlDetail });

  // The projection verifies back against its own record.
  const projection = projectValidatedRecord(record);
  const mismatches = verifyProjectionAgainstRecord(projection, record);
  checks.push({
    name: "projection_round_trip",
    ok: mismatches.length === 0,
    detail: mismatches.length === 0 ? projection.binding : mismatches.join(","),
  });

  return { stable: checks.every((check) => check.ok), content_hash: hash, checks };
}
