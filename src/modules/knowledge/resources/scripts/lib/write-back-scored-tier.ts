/**
 * scripts/lib/write-back-scored-tier.ts
 *
 * W2-A3 — concurrent-safe atomic writeback of a scored `tier:` field into a
 * resolved team.yaml. Called by guild:execute-plan step 6 (post-lane scoring)
 * to persist the cost-auto-scorer's tier decision back to disk so subsequent
 * runs read the scored tier instead of the authoring-time `default_tier:`.
 *
 * Concurrent-safety contract (§W2-A3):
 *   - Lock: exclusive create of `<teamYamlPath>.scoring.lock` (O_EXCL,
 *     POSIX-atomic) so two specialists completing at the same instant
 *     serialize their writes rather than clobbering each other.
 *   - Write: temp file in the same directory + fs.renameSync (POSIX-atomic
 *     within-filesystem) so readers never see a partial write.
 *   - Lock release: ALWAYS released (try-finally) even on errors.
 *   - Never throws: all errors are caught and returned as { ok: false }.
 *
 * Usage:
 *   import { writeBackScoredTier } from './lib/write-back-scored-tier'
 *   const result = writeBackScoredTier(teamYamlPath, 'architect', 'powerful')
 *   if (!result.ok) console.warn(result.message)
 *
 * Called by: skills/meta/execute-plan (step 6) after each lane completes.
 * Signature is intentionally self-contained so the skills lane imports only
 * this file — no launcher deps.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type ScoredTier = "cheap" | "mid" | "powerful";

export interface WriteBackResult {
  ok: boolean;
  message?: string;
}

// ── Lock helpers ──────────────────────────────────────────────────────────────

const LOCK_SUFFIX = ".scoring.lock";
const DEFAULT_RETRIES = 12;
const DEFAULT_RETRY_DELAY_MS = 50;

/** Synchronous sleep using Atomics.wait (works in Node.js main thread). */
function syncSleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Try to acquire the lock file for `teamYamlPath`. Returns true on success.
 * Retries up to `retries` times with `delayMs` sleep between attempts.
 * Lock file: `<teamYamlPath>.scoring.lock`.
 *
 * Uses O_EXCL (atomic exclusive create on POSIX) to ensure two concurrent
 * callers cannot both acquire the lock.
 */
function acquireLock(
  lockPath: string,
  retries: number,
  delayMs: number,
): boolean {
  for (let i = 0; i <= retries; i++) {
    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
      fs.closeSync(fd);
      return true; // acquired
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") {
        // Unexpected error (e.g. EACCES) — fail immediately.
        return false;
      }
      // Lock exists — wait and retry.
      if (i < retries) syncSleepMs(delayMs);
    }
  }
  return false;
}

/** Release the lock file. Silently ignores errors (lock may be stale). */
function releaseLock(lockPath: string): void {
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* ignore — lock may already be released or never created */
  }
}

// ── Team YAML line-level editor ───────────────────────────────────────────────
//
// Team.yaml has a fixed narrow schema (agent-team-launcher.ts parseYaml):
//   - `specialists:` list of block maps with at least `name:` and `scope:`
//   - `tier:` is optional per-specialist; this function adds or replaces it.
//
// We edit at the line level to preserve all other content (comments stripped by
// the launcher's parser are fine to lose here — this is a write path). The
// format is: add `    tier: <value>` immediately after the `  - name: ...` line
// for the target specialist (or replace an existing `tier:` line within the block).

/**
 * Parse team.yaml text and return a new string with the `tier:` field
 * for the named specialist set to `tier`. Returns null if the specialist
 * is not found (caller treats as ok:false).
 *
 * Editing rules:
 *  1. Find the list-item line that contains `name: <specialistName>`.
 *  2. Scan the subsequent indented lines for `tier:`.
 *     a. If found: replace the line in-place.
 *     b. If not found: insert `    tier: <value>` immediately after the
 *        `name:` line.
 *  3. Return the modified text (all other lines preserved byte-for-byte).
 */
function patchTeamYaml(
  content: string,
  specialistName: string,
  tier: ScoredTier,
): string | null {
  const lines = content.split("\n");
  let specialistLineIdx = -1;

  // Find the specialist's list-item line.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: "  - name: architect" or "  - name: 'architect'"
    const m = /^(\s*-\s+name:\s*)(['"]?)(\S+)\2\s*$/.exec(line);
    if (m && m[3] === specialistName) {
      specialistLineIdx = i;
      break;
    }
    // Also match: "  - name: architect # comment"
    const m2 = /^(\s*-\s+name:\s*)(['"]?)(\S+)\2/.exec(line);
    if (m2 && m2[3] === specialistName) {
      specialistLineIdx = i;
      break;
    }
  }

  if (specialistLineIdx === -1) return null;

  // Determine the indentation of the specialist block (always 4 spaces for Guild team.yaml).
  const tierIndent = "    ";
  const tierLine = `${tierIndent}tier: ${tier}`;

  // Scan lines after the specialist's `name:` entry for an existing `tier:` key
  // or the end of this specialist's block.
  let tierLineIdx = -1;
  let blockEndIdx = lines.length; // index of first line NOT in this specialist's block

  for (let i = specialistLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    // Empty line → still in the block (YAML allows blank lines within a block).
    if (line.trim() === "") continue;
    // Another list item or top-level key → block ended.
    if (/^\s*-\s+/.test(line) || (line.length > 0 && !/^\s/.test(line))) {
      blockEndIdx = i;
      break;
    }
    // Check if this is the tier key within the block.
    if (/^\s+tier:\s*/.test(line)) {
      tierLineIdx = i;
      break;
    }
  }

  const result = [...lines];

  if (tierLineIdx !== -1) {
    // Replace the existing tier line.
    result[tierLineIdx] = tierLine;
  } else {
    // Insert immediately after the specialist's name line.
    result.splice(specialistLineIdx + 1, 0, tierLine);
  }

  return result.join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Atomically write the re-scored `tier:` into the specialist's entry in
 * `teamYamlPath`. Thread-safe within a single Node.js process via O_EXCL
 * lockfile; safe across concurrent processes on the same filesystem.
 *
 * @param teamYamlPath  Absolute path to the resolved team.yaml to patch.
 * @param specialistName  The specialist's `name:` field value.
 * @param tier  The scored tier to write (`cheap` | `mid` | `powerful`).
 * @param opts  Optional tuning: `retries` (default 12), `lockTimeoutMs` (default 50ms/retry).
 */
export function writeBackScoredTier(
  teamYamlPath: string,
  specialistName: string,
  tier: ScoredTier,
  opts?: { retries?: number; lockTimeoutMs?: number },
): WriteBackResult {
  const retries = opts?.retries ?? DEFAULT_RETRIES;
  const delayMs = opts?.lockTimeoutMs ?? DEFAULT_RETRY_DELAY_MS;
  const lockPath = teamYamlPath + LOCK_SUFFIX;

  // Acquire the lock before any read-modify-write.
  const locked = acquireLock(lockPath, retries, delayMs);
  if (!locked) {
    return {
      ok: false,
      message: `writeBackScoredTier: could not acquire lock for ${teamYamlPath} after ${retries} retries`,
    };
  }

  try {
    // Read the current team.yaml.
    let content: string;
    try {
      content = fs.readFileSync(teamYamlPath, "utf8");
    } catch (err) {
      return {
        ok: false,
        message: `writeBackScoredTier: could not read ${teamYamlPath}: ${(err as Error).message}`,
      };
    }

    // Patch the YAML in memory (line-level, preserves structure).
    const patched = patchTeamYaml(content, specialistName, tier);
    if (patched === null) {
      return {
        ok: false,
        message: `writeBackScoredTier: specialist '${specialistName}' not found in ${teamYamlPath}`,
      };
    }

    // If nothing changed (idempotent), skip the write to avoid unnecessary mtime churn.
    if (patched === content) {
      return { ok: true };
    }

    // Atomic write: temp file in the same directory + rename.
    const dir = path.dirname(teamYamlPath);
    const tmpPath = path.join(
      dir,
      `.~guild-wbst-${process.pid}-${Date.now()}.tmp`,
    );
    try {
      fs.writeFileSync(tmpPath, patched, "utf8");
      fs.renameSync(tmpPath, teamYamlPath);
    } catch (err) {
      // Clean up temp file if rename failed.
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        message: `writeBackScoredTier: atomic write failed: ${(err as Error).message}`,
      };
    }

    return { ok: true };
  } finally {
    // ALWAYS release the lock — even on errors.
    releaseLock(lockPath);
  }
}
