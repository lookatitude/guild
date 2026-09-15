/**
 * src/modules/state/workflows/storage-janitor.ts
 *
 * The scratch janitor and the durable-state sweep behind `/guild:maintain gc`
 * (R54 "scratch janitor 24h", proposal §20).
 *
 * Two jobs, deliberately separate:
 *
 *   1. SCRATCH SWEEP — reclaim Guild temp left behind by a crash, a kill, or a
 *      reboot. `closeRun` is the normal path; this is the backstop, and it is the
 *      only reason a 24h age threshold exists at all.
 *   2. DURABLE SWEEP — REPORT ONLY. It names debris that KTD15 says does not
 *      belong under `.guild/` (caches, sqlite, temp, eager empty dirs) and never
 *      deletes it: user knowledge is not a janitor's decision (R2).
 *
 * CONTRACT: `--apply` is the only thing that removes anything, and only ever under
 * the temp root. The durable side has no delete path at all.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { createGuildStorage, type CreateStorageOptions, type GuildStorage } from "./storage-layout";
import {
  isContainedRealDir,
  lstatSafe,
  readdirSafe,
  removeContainedTree,
} from "./storage-fs";

/** Default scratch age before the janitor reclaims it (R54). */
export const SCRATCH_TTL_HOURS = 24;

export interface SweepEntry {
  path: string;
  /** Hours since last modification, rounded down. */
  ageHours: number;
  reason: string;
}

export interface DurableFinding {
  path: string;
  /** The class KTD15 says this is, which is why it does not belong in `.guild/`. */
  storageClass: "cache" | "runtime" | "temporary" | "empty-dir";
  detail: string;
}

export interface GcReport {
  schema_version: "guild.storage_gc_report.v1";
  root: string;
  rootId: string;
  tempRoot: string;
  applied: boolean;
  ttlHours: number;
  /** Scratch old enough to reclaim. Removed when `applied`. */
  scratch: SweepEntry[];
  /** Scratch still inside its TTL — listed, never touched. */
  scratchRetained: SweepEntry[];
  /** Report-only KTD15 debris under `.guild/`. NEVER deleted by this tool. */
  durable: DurableFinding[];
  /** Bytes of scratch reclaimed (0 on a dry run). */
  reclaimedBytes: number;
}

export interface GcOptions extends CreateStorageOptions {
  /** Delete the swept scratch. Default false (dry run). */
  apply?: boolean;
  ttlHours?: number;
  /** Injected clock for the reboot fixture. */
  now?: number;
}

/** Debris names that are rebuildable derivations, not truth (KTD15). */
const DURABLE_DEBRIS: Array<{ rel: string; storageClass: DurableFinding["storageClass"]; detail: string }> = [
  { rel: "index.sqlite", storageClass: "cache", detail: "BM25 index — rebuildable; belongs in the cache root" },
  { rel: "index.sqlite-wal", storageClass: "cache", detail: "sqlite write-ahead log" },
  { rel: "index.sqlite-shm", storageClass: "cache", detail: "sqlite shared memory" },
  { rel: "tmp", storageClass: "temporary", detail: "scratch under .guild — use GuildStorage.temporary()" },
  { rel: "cache", storageClass: "cache", detail: "cache under .guild — use GuildStorage.cache()" },
  { rel: "raw", storageClass: "temporary", detail: "retired raw tree — ingested blobs are definition(\"sources\", id) (R59)" },
];

function statSafe(p: string): fs.Stats | null {
  try { return fs.statSync(p); } catch { return null; }
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const name of readdirSafe(cur)) {
      const child = path.join(cur, name);
      const st = lstatSafe(child);
      if (!st) continue;
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) stack.push(child);
      else total += st.size;
    }
  }
  return total;
}

/**
 * Newest mtime anywhere in the tree. A run that is still writing scratch has a
 * fresh descendant even when the top directory's own mtime is old, so sweeping on
 * the top mtime alone would delete live work.
 */
function newestMtimeMs(dir: string): number {
  let newest = statSafe(dir)?.mtimeMs ?? 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const name of readdirSafe(cur)) {
      const child = path.join(cur, name);
      const st = lstatSafe(child);
      if (!st) continue;
      if (st.mtimeMs > newest) newest = st.mtimeMs;
      if (st.isDirectory() && !st.isSymbolicLink()) stack.push(child);
    }
  }
  return newest;
}

/**
 * Every scratch directory this root owns: `<temp>/<root-id>/{runs/*,session}`.
 * Symlinked entries are skipped, never swept — see {@link isContainedRealDir}.
 */
function scratchDirs(storage: GuildStorage): string[] {
  const base = path.dirname(storage.temporary(undefined));
  if (!isContainedRealDir(base, storage.root.temp)) return [];
  const out: string[] = [];
  for (const name of readdirSafe(base)) {
    const abs = path.join(base, name);
    if (!isContainedRealDir(abs, base)) continue;
    if (name === "runs") {
      for (const run of readdirSafe(abs)) {
        const runDir = path.join(abs, run);
        if (isContainedRealDir(runDir, abs)) out.push(runDir);
      }
      continue;
    }
    out.push(abs);
  }
  return out;
}

/** Report-only KTD15 scan of the durable tree, plus eager empty dirs (R23). */
export function scanDurableDebris(guildDir: string): DurableFinding[] {
  const findings: DurableFinding[] = [];
  for (const d of DURABLE_DEBRIS) {
    const abs = path.join(guildDir, d.rel);
    if (statSafe(abs)) {
      findings.push({ path: abs, storageClass: d.storageClass, detail: d.detail });
    }
  }
  for (const name of readdirSafe(guildDir)) {
    const abs = path.join(guildDir, name);
    if (!statSafe(abs)?.isDirectory()) continue;
    if (readdirSafe(abs).length === 0) {
      findings.push({
        path: abs,
        storageClass: "empty-dir",
        detail: "eager empty directory — the layout is lazy (R23); it is created at first write",
      });
    }
  }
  return findings;
}

/**
 * Run the sweep. The "simulated reboot" case is exactly this function against a
 * temp root whose entries pre-date `now - ttl`: `closeRun` never ran, so the
 * janitor is what reclaims them.
 */
export function runStorageGc(cwd: string = process.cwd(), opts: GcOptions = {}): GcReport {
  const { apply = false, ttlHours = SCRATCH_TTL_HOURS, now = Date.now(), ...storageOpts } = opts;
  const storage = createGuildStorage(cwd, storageOpts);
  const cutoff = now - ttlHours * 3600_000;

  const scratch: SweepEntry[] = [];
  const scratchRetained: SweepEntry[] = [];
  let reclaimedBytes = 0;

  for (const dir of scratchDirs(storage)) {
    const mtime = newestMtimeMs(dir);
    const ageHours = Math.floor(Math.max(0, now - mtime) / 3600_000);
    if (mtime > cutoff) {
      scratchRetained.push({ path: dir, ageHours, reason: `within the ${ttlHours}h scratch TTL` });
      continue;
    }
    const entry: SweepEntry = { path: dir, ageHours, reason: `scratch older than ${ttlHours}h (no closeRun)` };
    if (apply) {
      // Size FIRST, then resolve-and-remove with nothing in between.
      //
      // Measuring between the containment check and the delete left a window
      // wide enough to swap an ancestor and redirect the removal (codex G-lane
      // r3 P1). Byte accounting is a report field; it must never widen the only
      // unattended delete in Guild. `removeContainedTree` re-resolves and removes
      // the resolved path as one step (storage-fs.ts), and the residual race it
      // cannot close is documented there.
      const measured = dirSizeBytes(dir);
      const real = removeContainedTree(dir, storage.root.temp);
      if (!real) {
        scratchRetained.push({ path: dir, ageHours, reason: "refused: not a real directory inside the scratch root" });
        continue;
      }
      reclaimedBytes += measured;
    }
    scratch.push(entry);
  }

  return {
    schema_version: "guild.storage_gc_report.v1",
    root: storage.activeRoot,
    rootId: storage.rootId,
    tempRoot: storage.root.temp,
    applied: apply,
    ttlHours,
    scratch,
    scratchRetained,
    durable: scanDurableDebris(storage.root.durable),
    reclaimedBytes,
  };
}

/** One compact block for the `maintain gc` chapter to print. */
export function formatGcReport(report: GcReport): string {
  const lines: string[] = [];
  lines.push(`guild storage gc — ${report.root} (${report.applied ? "applied" : "dry run"})`);
  lines.push(`  scratch root: ${report.tempRoot}`);
  lines.push(
    `  scratch: ${report.scratch.length} reclaimable · ${report.scratchRetained.length} within ${report.ttlHours}h TTL` +
      (report.applied ? ` · ${(report.reclaimedBytes / 1024).toFixed(1)} KiB freed` : ""),
  );
  for (const e of report.scratch.slice(0, 10)) lines.push(`    · ${e.path} (${e.ageHours}h) — ${e.reason}`);
  lines.push(`  durable findings (report only, nothing deleted): ${report.durable.length}`);
  for (const d of report.durable.slice(0, 10)) lines.push(`    · ${d.path} [${d.storageClass}] — ${d.detail}`);
  if (!report.applied && report.scratch.length) lines.push("  re-run with --apply to reclaim the scratch above.");
  return lines.join("\n");
}
