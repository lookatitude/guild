/**
 * src/domains/state/snapshot-digest.ts
 *
 * Whole-file integrity binding for a run's `resolved-settings.json` (#146).
 *
 * Run start records `sha256:<hex>` of the exact snapshot bytes on disk in a
 * sidecar next to it. Every reader hashes the SAME bytes it parses and compares.
 * One field (`block_unmarked_lanes`) cannot be bound alone while `agent_mode` in
 * the same file can switch the whole guard off, so the digest covers the file.
 *
 * Verdicts:
 *   - "verified" — sidecar present, well-formed, and equal to the bytes' digest;
 *   - "legacy"   — no sidecar: a run started before #146. Readers keep their
 *                  pre-#146 behaviour (migration path; nothing is rewritten);
 *   - "mismatch" — sidecar present but malformed or different. Readers FAIL
 *                  CLOSED: the snapshot is not authority for anything.
 *
 * Limit: the sidecar is a plain file in the same run directory, so a writer that
 * rewrites both files (or deletes the sidecar) is not detected. It catches an
 * edit to the snapshot alone, which is the drift #146 names.
 *
 * Only `node:crypto` / `node:fs`: imported by `pre-tool-use.js`, the hottest
 * hook bundle, so it must stay dependency-free.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";

/** Sidecar file name, a sibling of `resolved-settings.json` in the run dir. */
export const RESOLVED_SETTINGS_DIGEST_FILE = "resolved-settings.sha256";

const DIGEST_PREFIX = "sha256:";
const HEX64 = /^[0-9a-f]{64}$/;

export type SnapshotDigestVerdict = "verified" | "legacy" | "mismatch";

/** `sha256:<hex>` of the exact snapshot bytes. */
export function resolvedSettingsDigest(raw: string): string {
  return DIGEST_PREFIX + crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

/** The sidecar body for a snapshot's bytes. */
export function resolvedSettingsDigestRecord(raw: string): string {
  return resolvedSettingsDigest(raw) + "\n";
}

/**
 * Compare snapshot bytes with the sidecar body (`null` = no sidecar file).
 * A sidecar that is present but not exactly one `sha256:<64 hex>` is a mismatch,
 * never "legacy": an unreadable binding must not downgrade to "no binding".
 */
export function verifyResolvedSettingsDigest(
  raw: string,
  sidecar: string | null,
): SnapshotDigestVerdict {
  if (sidecar === null) return "legacy";
  const recorded = sidecar.trim();
  if (!recorded.startsWith(DIGEST_PREFIX)) return "mismatch";
  if (!HEX64.test(recorded.slice(DIGEST_PREFIX.length))) return "mismatch";
  return recorded === resolvedSettingsDigest(raw) ? "verified" : "mismatch";
}

/**
 * True unless `lstat` says ENOENT. A file that exists but cannot be read (EACCES,
 * EISDIR, ...) counts as present, so an unreadable binding is never mistaken for
 * a legacy run with no binding.
 */
export function presentOnDisk(absPath: string): boolean {
  try {
    fs.lstatSync(absPath);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code !== "ENOENT";
  }
}
