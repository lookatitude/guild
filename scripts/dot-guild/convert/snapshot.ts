/**
 * scripts/dot-guild/convert/snapshot.ts — the SC-3 copy-only snapshot (§4.1).
 *
 * COPY-ONLY (never removes src — the W1b extension of migrate.ts's move path,
 * CF-W1b-1). Unique staging path claimed by FAIL-IF-EXISTS mkdir (collision-proof
 * against retries / concurrent SessionStart / per-child). Exclusion set computed
 * BEFORE traversal: the active dest + ALL pre-existing `.backup-v1-*` + the report
 * file (recursion / partial-copy guard, CF-W1b-2). sha256-verified per file;
 * abort-on-mismatch BEFORE any conversion.
 */

import * as path from "path";
import type { Fs, Clock, SnapshotResult } from "./types";

const BACKUP_PREFIX = ".backup-v1-";
const REPORT_PREFIX = ".migration-report-";

/**
 * Walk `.guild/` collecting files, EXCLUDING up front any path under a
 * `.backup-v1-*` dir, the active dest dir, and the report file. Exclusion is by
 * directory name at every level (computed before traversal, not filtered late).
 */
function walkExcluding(fs: Fs, guildDir: string, destAbs: string): string[] {
  const out: string[] = [];
  const recur = (dir: string): void => {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (full === destAbs) continue; // active dest — never ingest
      if (e.isDirectory) {
        if (e.name.startsWith(BACKUP_PREFIX)) continue; // all prior snapshots
        recur(full);
      } else if (e.isFile) {
        if (e.name.startsWith(REPORT_PREFIX) && dir === guildDir) continue; // top-level report file
        out.push(full);
      }
    }
  };
  recur(guildDir);
  return out;
}

/** Build a fresh, exclusively-owned snapshot directory (§4.1 step 1). */
function claimDest(fs: Fs, guildDir: string, stamp: string): string {
  const base = path.join(guildDir, `${BACKUP_PREFIX}${stamp}`);
  let dest = base;
  let n = 1;
  // Fail-if-exists mkdir is the lock. On collision append -N, then a random suffix.
  for (let attempts = 0; attempts < 64; attempts++) {
    try {
      fs.mkdirSync(dest, { recursive: false });
      return dest;
    } catch {
      if (n <= 16) {
        dest = `${base}-${n++}`;
      } else {
        const rand = Math.random().toString(36).slice(2, 8);
        dest = `${base}-${rand}`;
      }
    }
  }
  throw new Error(`snapshot: could not claim a unique backup dir under ${guildDir}`);
}

/**
 * snapshot(guildDir) — copy `.guild/` → a unique `.backup-v1-<stamp>/`, sha256
 * verifying every file. Returns verified=false (with `mismatch`) if any file's
 * post-copy hash differs; the caller MUST then abort conversion.
 */
export function snapshot(fs: Fs, clock: Clock, guildDir: string): SnapshotResult {
  const dest = claimDest(fs, guildDir, clock.stamp());
  const destAbs = dest;
  const destRel = path.basename(dest);

  const files = walkExcluding(fs, guildDir, destAbs);
  let mismatch: string | undefined;
  let copied = 0;

  for (const srcFile of files) {
    const rel = path.relative(guildDir, srcFile);
    const dstFile = path.join(dest, rel);
    const srcHash = fs.sha256(srcFile);
    const bytes = fs.readBytes(srcFile);
    fs.writeBytes(dstFile, bytes);
    const dstHash = fs.sha256(dstFile);
    if (srcHash !== dstHash) {
      mismatch = rel;
      break;
    }
    copied++;
  }

  return {
    dest: destAbs,
    destRel,
    verified: mismatch === undefined,
    fileCount: copied,
    mismatch,
  };
}

export { BACKUP_PREFIX, REPORT_PREFIX };
