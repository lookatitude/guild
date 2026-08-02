/**
 * src/modules/documents/workflows/document-hash.ts
 *
 * Content hashing for canonical records (DC-09).
 *
 * Hashing always runs *behind* validation: an untrusted value is normalized
 * first and the hash is taken over the normalized record's canonical JSON.
 * That ordering is what guarantees the BF-02 property "nothing reported valid
 * can crash hashing" — there is no code path that hashes unvalidated input.
 */

import {
  DocumentHashResult,
  DocumentIssue,
  hashCanonicalValue,
} from "./document-safe";
import { DocumentRecord, validateDocumentRecord } from "./document-records";

/** Content hash of an already-validated record. */
export function hashDocumentRecord(record: DocumentRecord): string {
  const hashed = hashCanonicalValue(record);
  if (hashed.ok) return hashed.hash;
  // A normalized record is canonicalizable by construction. Should that ever
  // stop holding, fail closed with a sentinel that can never match a real
  // hash, rather than throwing out of a decision path.
  return "sha256:unhashable";
}

/**
 * Content hash of an untrusted value: validate, normalize, then hash.
 * Total — returns explicit errors instead of throwing.
 */
export function documentContentHash(input: unknown): DocumentHashResult {
  const validation = validateDocumentRecord(input);
  if (!validation.valid || validation.record === null) {
    const errors: DocumentIssue[] = validation.errors;
    return { ok: false, errors };
  }
  return hashCanonicalValue(validation.record);
}
