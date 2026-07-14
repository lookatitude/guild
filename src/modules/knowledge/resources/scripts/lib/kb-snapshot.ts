/**
 * scripts/lib/kb-snapshot.ts
 *
 * KB Snapshot & Rollback — defense Layer 5 (docs/v2/11-security.md
 * §"KB snapshot & rollback").
 *
 * Layer 5 is the *restorative* tier: given a content-hash manifest of a
 * known-clean `.guild/wiki/` state, it can:
 *   1. Detect unexpected mutations (verifyAgainstSnapshot)
 *   2. Produce a diff/restore plan listing which files were added, removed,
 *      or tampered (rollbackKB — plan-only by default; caller drives the
 *      actual restore, e.g. via git or a copy loop)
 *   3. Capture a new snapshot (snapshotKB)
 *
 * This complements the four preventive controls (D-RECALL / D-PROBE /
 * D-INGEST-GATE / D-HANDOFF) — it does NOT replace them.
 *
 * Design constraints:
 *   - Deterministic: the caller supplies any timestamp or run-id; nothing
 *     inside the exported functions calls Date.now() or Math.random().
 *   - Real fs: uses node:fs synchronously throughout — no injected seam.
 *   - Never throws: all exported functions return a typed result; errors
 *     surface in the result, never as exceptions.
 *   - Opt-in: wired (plugin-audit-remediation G5a, 2026-07) as an OPTIONAL
 *     step in skills/meta/ops-rollback/SKILL.md §"KB integrity check" — invoked
 *     only when a rollback runbook targets `.guild/wiki/` state itself, never
 *     for a plain deploy/release rollback. No hook or the default rollback
 *     path calls it automatically; the CLI below (require.main===module) is
 *     the invocation surface.
 *
 * Spec pointer: docs/v2/11-security.md §"KB snapshot & rollback (defense Layer 5)"
 * and docs/knowledge/security/prompt-injection-defenses.md §"Layer 5 —
 * KB Snapshot and Rollback".
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Public types ──────────────────────────────────────────────────────────────

/** A single file entry in the manifest. */
export interface KBManifestEntry {
  /** Path relative to the wikiDir root (e.g. "decisions/security.md"). */
  relPath: string;
  /** SHA-256 hex digest of the file's byte content at snapshot time. */
  sha256: string;
  /** File size in bytes at snapshot time. */
  sizeBytes: number;
}

/**
 * A content-hash manifest of a `.guild/wiki/` tree at a given point in time.
 *
 * The manifest is the canonical artifact for Layer 5: it captures a
 * known-clean KB state so that future calls to verifyAgainstSnapshot() and
 * rollbackKB() can detect and describe mutations.
 */
export interface KBManifest {
  /** Schema version tag — future readers may migrate on this. */
  schema: "guild.kb_manifest.v1";
  /**
   * ISO-8601 timestamp string supplied by the CALLER — never Date.now()
   * inside this lib. E.g. new Date().toISOString() at the call site.
   */
  snapshotAt: string;
  /**
   * Opaque caller-supplied identifier for the snapshot (e.g. a run-id or
   * a short slug). Used for traceability only; never interpreted by this lib.
   */
  snapshotId: string;
  /** Absolute path to the wikiDir that was snapshotted. */
  wikiDir: string;
  /** Sorted list of manifest entries. Sorted by relPath for determinism. */
  entries: KBManifestEntry[];
  /** Total file count at snapshot time. */
  totalFiles: number;
}

/** Result returned by snapshotKB(). */
export interface SnapshotResult {
  ok: boolean;
  manifest: KBManifest | null;
  /** Human-readable error message when ok === false. */
  error?: string;
  /** Absolute path where the manifest was written (when destDir was supplied). */
  writtenTo?: string;
}

/** A single-file diff item produced by verifyAgainstSnapshot / rollbackKB. */
export interface KBDiffItem {
  relPath: string;
  status: "tampered" | "added" | "removed";
  /** Present for "tampered": the hash at snapshot time. */
  expectedSha256?: string;
  /** Present for "tampered": the hash of the current file. */
  actualSha256?: string;
}

/** Result returned by verifyAgainstSnapshot(). */
export interface VerifyResult {
  ok: boolean;
  /** true when the wiki state matches the manifest exactly. */
  clean: boolean;
  /** Files that differ from the manifest (empty when clean === true). */
  tampered: KBDiffItem[];
  /** Error message when ok === false (I/O or manifest issue). */
  error?: string;
}

/** Result returned by rollbackKB() — a PLAN, not an execution. */
export interface RollbackPlan {
  ok: boolean;
  /**
   * Files that need attention, grouped by status.
   * Callers must drive the actual restoration (e.g. `git checkout` on the
   * affected paths, or a copy loop from a backup dir).
   */
  diff: KBDiffItem[];
  /** true when no mutations were detected (the KB is already clean). */
  alreadyClean: boolean;
  /** Human-readable summary. */
  summary: string;
  /** Error message when ok === false. */
  error?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a file's byte content.
 * Returns null on any I/O error.
 */
function hashFile(absPath: string): string | null {
  try {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

/**
 * Walk all files under `dir` recursively.
 * Paths are returned as sorted relative paths (relative to `dir`).
 * Never throws; returns [] on any I/O error.
 */
function walkRelative(dir: string): string[] {
  const results: string[] = [];
  function walk(cur: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      if (e.isDirectory()) {
        walk(abs);
      } else if (e.isFile()) {
        results.push(path.relative(dir, abs));
      }
    }
  }
  walk(dir);
  results.sort();
  return results;
}

// ── Exported functions ────────────────────────────────────────────────────────

/**
 * Snapshot the current state of `wikiDir` into a content-hash manifest.
 *
 * All `.guild/wiki/` files (recursively) are hashed; the result is a
 * `KBManifest` capturing a known-clean state. The caller supplies
 * `snapshotAt` (ISO-8601 string) and `snapshotId` so the function remains
 * deterministic.
 *
 * When `destDir` is provided the manifest is also written to
 * `destDir/<snapshotId>.json` on disk. If the write fails the function
 * returns ok=false but still returns the in-memory manifest so the caller
 * can handle the write error independently.
 *
 * @param wikiDir    Absolute path to the wiki root (e.g. `/repo/.guild/wiki`).
 * @param destDir    Optional absolute path to write the manifest file into.
 * @param snapshotAt ISO-8601 timestamp string supplied by the caller.
 * @param snapshotId Opaque identifier for traceability (e.g. a run-id).
 */
export function snapshotKB(
  wikiDir: string,
  destDir: string | null,
  snapshotAt: string,
  snapshotId: string,
): SnapshotResult {
  // Verify wikiDir exists and is a directory.
  try {
    const stat = fs.statSync(wikiDir);
    if (!stat.isDirectory()) {
      return { ok: false, manifest: null, error: `wikiDir is not a directory: ${wikiDir}` };
    }
  } catch (e) {
    return { ok: false, manifest: null, error: `wikiDir not accessible: ${String(e)}` };
  }

  const relPaths = walkRelative(wikiDir);
  const entries: KBManifestEntry[] = [];

  for (const rel of relPaths) {
    const abs = path.join(wikiDir, rel);
    const hash = hashFile(abs);
    if (hash === null) {
      return {
        ok: false,
        manifest: null,
        error: `Failed to hash file during snapshot: ${rel}`,
      };
    }
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(abs).size;
    } catch {
      // non-fatal: size is informational only
    }
    entries.push({ relPath: rel, sha256: hash, sizeBytes });
  }

  const manifest: KBManifest = {
    schema: "guild.kb_manifest.v1",
    snapshotAt,
    snapshotId,
    wikiDir,
    entries,
    totalFiles: entries.length,
  };

  // Optional on-disk write.
  if (destDir !== null) {
    try {
      fs.mkdirSync(destDir, { recursive: true });
      const outPath = path.join(destDir, `${snapshotId}.json`);
      fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2), "utf8");
      return { ok: true, manifest, writtenTo: outPath };
    } catch (e) {
      return { ok: false, manifest, error: `Failed to write manifest to destDir: ${String(e)}` };
    }
  }

  return { ok: true, manifest };
}

/**
 * Verify the current state of `wikiDir` against a previously-captured manifest.
 *
 * Returns a list of files that have been added, removed, or tampered with
 * since the snapshot was taken. An empty `tampered` list means the KB state
 * is identical to the snapshot.
 *
 * This is the *detection* half of Layer 5; the restoration half is
 * `rollbackKB()`.
 *
 * @param manifest The known-clean snapshot to compare against.
 * @param wikiDir  Absolute path to the wiki root to verify. When null, uses
 *                 manifest.wikiDir (the path recorded at snapshot time).
 */
export function verifyAgainstSnapshot(
  manifest: KBManifest,
  wikiDir: string | null,
): VerifyResult {
  const targetDir = wikiDir ?? manifest.wikiDir;

  // Verify targetDir is accessible.
  try {
    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      return {
        ok: false,
        clean: false,
        tampered: [],
        error: `wikiDir is not a directory: ${targetDir}`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      clean: false,
      tampered: [],
      error: `wikiDir not accessible: ${String(e)}`,
    };
  }

  // Build a lookup from the manifest entries.
  const manifestMap = new Map<string, KBManifestEntry>();
  for (const entry of manifest.entries) {
    manifestMap.set(entry.relPath, entry);
  }

  // Walk the current state.
  const currentRelPaths = new Set(walkRelative(targetDir));
  const diffs: KBDiffItem[] = [];

  // Check for tampered or removed files.
  for (const [relPath, entry] of manifestMap.entries()) {
    if (!currentRelPaths.has(relPath)) {
      diffs.push({ relPath, status: "removed", expectedSha256: entry.sha256 });
    } else {
      const currentHash = hashFile(path.join(targetDir, relPath));
      if (currentHash === null) {
        return {
          ok: false,
          clean: false,
          tampered: diffs,
          error: `Failed to hash current file during verify: ${relPath}`,
        };
      }
      if (currentHash !== entry.sha256) {
        diffs.push({
          relPath,
          status: "tampered",
          expectedSha256: entry.sha256,
          actualSha256: currentHash,
        });
      }
    }
  }

  // Check for added files (present now but not in manifest).
  for (const relPath of currentRelPaths) {
    if (!manifestMap.has(relPath)) {
      diffs.push({ relPath, status: "added" });
    }
  }

  // Sort diffs for determinism.
  diffs.sort((a, b) => a.relPath.localeCompare(b.relPath));

  return { ok: true, clean: diffs.length === 0, tampered: diffs };
}

/**
 * Produce a restore plan describing what needs to be done to return `wikiDir`
 * to the state captured in `manifest`.
 *
 * This function is PLAN-ONLY: it does not modify any files. The caller is
 * responsible for driving the actual restoration (e.g. via `git checkout`,
 * a copy loop from a backup, or `guild:ops-rollback`).
 *
 * Ties into the `guild:ops-rollback` runbook class per
 * docs/v2/11-security.md §"KB snapshot & rollback (defense Layer 5)".
 *
 * @param manifest The known-clean snapshot to restore toward.
 * @param wikiDir  Absolute path to the wiki root to inspect. When null, uses
 *                 manifest.wikiDir.
 */
export function rollbackKB(
  manifest: KBManifest,
  wikiDir: string | null,
): RollbackPlan {
  const verifyResult = verifyAgainstSnapshot(manifest, wikiDir);

  if (!verifyResult.ok) {
    return {
      ok: false,
      diff: [],
      alreadyClean: false,
      summary: "",
      error: verifyResult.error,
    };
  }

  const diff = verifyResult.tampered; // KBDiffItem[] — all mutation categories
  const alreadyClean = diff.length === 0;

  if (alreadyClean) {
    return {
      ok: true,
      diff: [],
      alreadyClean: true,
      summary: `KB is clean — ${manifest.totalFiles} file(s) match snapshot ${manifest.snapshotId} (taken ${manifest.snapshotAt}).`,
    };
  }

  const tampered = diff.filter((d) => d.status === "tampered").length;
  const added = diff.filter((d) => d.status === "added").length;
  const removed = diff.filter((d) => d.status === "removed").length;

  const parts: string[] = [];
  if (tampered > 0) parts.push(`${tampered} tampered`);
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);

  const summary =
    `KB drift detected vs snapshot ${manifest.snapshotId} (taken ${manifest.snapshotAt}): ` +
    `${parts.join(", ")}. ` +
    `Restore plan has ${diff.length} file(s) to reconcile. ` +
    `Caller must drive restoration (git checkout / copy from backup).`;

  return { ok: true, diff, alreadyClean: false, summary };
}

// ── CLI entry (uses Date.now() — only here, never in the lib exports) ────────
//
// Usage:
//   npx tsx scripts/lib/kb-snapshot.ts snapshot \
//     --wiki-dir <abs-path> [--dest-dir <abs-path>] [--id <snapshot-id>]
//   npx tsx scripts/lib/kb-snapshot.ts verify \
//     --manifest <path-to-manifest.json> [--wiki-dir <abs-path>]
//   npx tsx scripts/lib/kb-snapshot.ts rollback \
//     --manifest <path-to-manifest.json> [--wiki-dir <abs-path>]
//
// Prints JSON to stdout. Exits 0 on success, 1 on error.

if (require.main === module) {
  const argv = process.argv.slice(2);
  const subcommand = argv[0];

  let wikiDirArg: string | null = null;
  let destDirArg: string | null = null;
  let manifestArg: string | null = null;
  let idArg: string | null = null;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--wiki-dir" && argv[i + 1]) { wikiDirArg = argv[++i]!; }
    else if (arg.startsWith("--wiki-dir=")) { wikiDirArg = arg.slice("--wiki-dir=".length); }
    else if (arg === "--dest-dir" && argv[i + 1]) { destDirArg = argv[++i]!; }
    else if (arg.startsWith("--dest-dir=")) { destDirArg = arg.slice("--dest-dir=".length); }
    else if (arg === "--manifest" && argv[i + 1]) { manifestArg = argv[++i]!; }
    else if (arg.startsWith("--manifest=")) { manifestArg = arg.slice("--manifest=".length); }
    else if (arg === "--id" && argv[i + 1]) { idArg = argv[++i]!; }
    else if (arg.startsWith("--id=")) { idArg = arg.slice("--id=".length); }
  }

  if (subcommand === "snapshot") {
    if (!wikiDirArg) {
      process.stderr.write("[kb-snapshot] ERROR: --wiki-dir is required for 'snapshot'\n");
      process.exit(1);
    }
    const snapshotId = idArg ?? `kb-snap-${Date.now()}`;
    const snapshotAt = new Date().toISOString();
    const result = snapshotKB(wikiDirArg, destDirArg, snapshotAt, snapshotId);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exit(result.ok ? 0 : 1);

  } else if (subcommand === "verify" || subcommand === "rollback") {
    if (!manifestArg) {
      process.stderr.write(`[kb-snapshot] ERROR: --manifest is required for '${subcommand}'\n`);
      process.exit(1);
    }
    let manifest: KBManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestArg, "utf8")) as KBManifest;
    } catch (e) {
      process.stderr.write(`[kb-snapshot] ERROR: cannot read manifest '${manifestArg}': ${String(e)}\n`);
      process.exit(1);
    }
    if (subcommand === "verify") {
      const result = verifyAgainstSnapshot(manifest, wikiDirArg);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exit(result.ok ? 0 : 1);
    } else {
      const result = rollbackKB(manifest, wikiDirArg);
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exit(result.ok ? 0 : 1);
    }

  } else {
    process.stderr.write(
      "[kb-snapshot] ERROR: subcommand must be 'snapshot', 'verify', or 'rollback'\n",
    );
    process.exit(1);
  }
}
