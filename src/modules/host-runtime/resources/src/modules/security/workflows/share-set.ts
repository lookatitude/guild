/**
 * src/modules/security/workflows/share-set.ts
 *
 * CANONICAL, single-source share-set membership for share-dot-guild (re-arch
 * WAVE 1, M9 single-source floor). Defines which per-run files are in scope for
 * sharing / redaction. The ONE place this set lives — the former "keep in sync"
 * duplicate in scripts/dot-guild/audit.ts (SCRUB_SHARED_NAMES + inScrubShareSet)
 * is deleted; both scrub.ts and audit.ts now import from here.
 *
 * Decision E / H: handoffs/*.md + a fixed set of summary artifacts are always
 * shared-scrubbed; payload files (events.ndjson, logs/payloads/**) are shared
 * ONLY when the per-run share-payloads.flag is present (the `hasFlag` arg).
 *
 * Path matching uses path.sep so behaviour is identical to the prior inline
 * copies on every platform.
 */

import * as path from "path";

/** Per-run summary artifacts that are always shared-scrubbed (matched by basename). */
export const SHARED_SCRUBBED_NAMES = new Set([
  "verify.md",
  "review.md",
  "provenance.json",
  "summary.md",
  "run.yaml",
  "run-state.json",
]);

/** A handoff receipt: handoffs/<...>.md (run-relative path). */
export function isHandoffFile(rel: string): boolean {
  return rel.startsWith("handoffs" + path.sep) && rel.endsWith(".md");
}

/** A payload file: events.ndjson (any dir) or logs/payloads/** (run-relative path). */
export function isPayloadFile(rel: string): boolean {
  return path.basename(rel) === "events.ndjson"
    || rel.startsWith("logs" + path.sep + "payloads" + path.sep);
}

/**
 * Is this run-relative file in the share-set?
 *   - summary artifacts (SHARED_SCRUBBED_NAMES) and handoffs/*.md → always true
 *   - payload files → true ONLY when hasFlag (share-payloads.flag present)
 *   - everything else → false
 */
export function inShareSet(rel: string, hasFlag: boolean): boolean {
  if (SHARED_SCRUBBED_NAMES.has(path.basename(rel)) || isHandoffFile(rel)) return true;
  if (isPayloadFile(rel)) return hasFlag;
  return false;
}
