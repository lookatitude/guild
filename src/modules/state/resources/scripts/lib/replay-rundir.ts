/**
 * scripts/lib/replay-rundir.ts
 *
 * ITEM-30 — Replay-facing run-dir completeness checker.
 *
 * `assembleReplayManifest(runDir, opts?)` inspects a run directory on disk
 * and returns a structured manifest listing the artifacts a replay needs,
 * each annotated with a `present` flag.
 *
 * `isReplayComplete(manifest)` reduces the manifest to a single boolean:
 * true iff all REQUIRED replay artifacts are present.
 *
 * Contract alignment:
 *   - Canonical artifact list from docs/v2/12-observability.md §The run directory
 *     ("shipped layout + the [v2.x] replay completion").
 *   - "events" = logs/v1.4-events.jsonl (primary); events.ndjson is the legacy
 *     mirror only, listed as a secondary.
 *   - "provenance" = provenance.json (guild.provenance.v1).
 *   - "handoffs" = handoffs/ directory existence (individual files are enumerated
 *     when present but the directory absence is the MISSING signal).
 *   - "payloads" = logs/payloads/ directory (optional in shipped v2; listed but
 *     not required for `isReplayComplete`).
 *   - v2.x deferred items (timeline.jsonl, context-refs.json, evidence/,
 *     assumptions.md, decisions.md) are listed with status DEFERRED and never
 *     contribute to `isReplayComplete`.
 *
 * Pure over the on-disk run dir: all I/O goes through the injected `FsSeam`.
 * The real-fs seam wraps `fs.existsSync` / `fs.readdirSync`.
 * The caller supplies the run directory path; this module never resolves it.
 *
 * No Date.now() or Math.random() inside exported functions (ITEM-30 determinism
 * contract). A CLI `if (require.main === module)` block may use Date.now().
 *
 * Owned by tooling-engineer. Default-off: this module is a new surface and does
 * not touch any existing write path — it is inert until callers wire it.
 */

import * as fsNode from "fs";
import * as path from "path";

// ── Injectable filesystem seam ─────────────────────────────────────────────────

/** Minimal fs surface needed by this module. Inject a stub in tests. */
export interface ReplayFsSeam {
  /** True iff the path exists (file or directory). */
  exists(absPath: string): boolean;
  /**
   * List immediate children of a directory.
   * Returns an empty array when the directory is absent or unreadable.
   */
  listDir(absPath: string): string[];
}

/** Default seam: real node fs. */
export function createRealReplayFsSeam(): ReplayFsSeam {
  return {
    exists(absPath: string): boolean {
      return fsNode.existsSync(absPath);
    },
    listDir(absPath: string): string[] {
      try {
        return fsNode.readdirSync(absPath, { withFileTypes: false }) as string[];
      } catch {
        return [];
      }
    },
  };
}

// ── Public types ───────────────────────────────────────────────────────────────

/**
 * Lifecycle status of a replay artifact.
 *
 * - "shipped"  — part of the v2-shipped run directory layout; contributes to
 *                `isReplayComplete` when `required` is true.
 * - "deferred" — [v2.x] — specified but not yet emitted; never required for
 *                replay completeness in the current version.
 */
export type ArtifactStatus = "shipped" | "deferred";

/** Role of each artifact in the replay pipeline. */
export type ArtifactRole =
  | "events"       // canonical trace log
  | "events-legacy" // legacy compatibility mirror (events.ndjson)
  | "provenance"   // close-shape record (guild.provenance.v1)
  | "run-manifest" // start manifest (guild.run.v1)
  | "handoffs"     // handoff receipts directory
  | "payloads"     // payload sidecars (logs/payloads/)
  | "timeline"     // [v2.x] rendered timeline projection
  | "context-refs" // [v2.x] context bundle hashes (guild.context_refs.v1)
  | "evidence"     // [v2.x] evidence directory
  | "assumptions"  // [v2.x] assumptions doc
  | "decisions"    // [v2.x] decisions doc
  | "review"       // review.md (shipped, advisory)
  | "verify"       // verify.md (shipped, advisory)
  | "summary";     // summary.md (shipped, optional)

/** One entry in the replay manifest. */
export interface ReplayArtifactEntry {
  /** Stable role identifier. */
  role: ArtifactRole;
  /**
   * Path relative to the run directory (POSIX separators, no leading slash).
   * e.g. "logs/v1.4-events.jsonl"
   */
  relativePath: string;
  /** Whether the artifact is present on disk. */
  present: boolean;
  /** Whether replay requires this artifact to be present. */
  required: boolean;
  /** Lifecycle status — shipped v2 artifact or deferred v2.x artifact. */
  status: ArtifactStatus;
  /**
   * For directory-type artifacts, the names of files found inside.
   * Undefined for file-type artifacts.
   */
  files?: string[];
}

/** The assembled replay manifest for one run directory. */
export interface ReplayManifest {
  /** Schema identifier (frozen — bind by pointer). */
  schema_version: "guild.replay_manifest.v1";
  /**
   * The absolute run directory that was inspected.
   * This is the value the caller passed; this module never resolves it.
   */
  runDir: string;
  /** Ordered artifact entries. */
  artifacts: ReplayArtifactEntry[];
  /**
   * True iff all REQUIRED artifacts are present.
   * Equivalent to `isReplayComplete(manifest)`.
   */
  complete: boolean;
}

// ── Artifact catalogue (static definition) ────────────────────────────────────

interface ArtifactDef {
  role: ArtifactRole;
  relativePath: string;
  required: boolean;
  status: ArtifactStatus;
  isDir?: boolean;
}

/**
 * Ordered catalogue of replay-relevant artifacts.
 * Derived from docs/v2/12-observability.md §The run directory.
 *
 * Required shipped artifacts for `isReplayComplete`:
 *   events, provenance, run-manifest
 *
 * Present-but-not-required shipped artifacts:
 *   events-legacy, handoffs, payloads, review, verify, summary
 *
 * Deferred [v2.x] artifacts (never required in v2):
 *   timeline, context-refs, evidence, assumptions, decisions
 */
const ARTIFACT_CATALOGUE: readonly ArtifactDef[] = [
  // ── Required shipped ──────────────────────────────────────────────────────
  {
    role: "events",
    relativePath: "logs/v1.4-events.jsonl",
    required: true,
    status: "shipped",
  },
  {
    role: "provenance",
    relativePath: "provenance.json",
    required: true,
    status: "shipped",
  },
  {
    role: "run-manifest",
    relativePath: "run.yaml",
    required: true,
    status: "shipped",
  },
  // ── Shipped — present/missing noted but not required ─────────────────────
  {
    role: "events-legacy",
    relativePath: "events.ndjson",
    required: false,
    status: "shipped",
  },
  {
    role: "handoffs",
    relativePath: "handoffs",
    required: false,
    status: "shipped",
    isDir: true,
  },
  {
    role: "payloads",
    relativePath: "logs/payloads",
    required: false,
    status: "shipped",
    isDir: true,
  },
  {
    role: "review",
    relativePath: "review.md",
    required: false,
    status: "shipped",
  },
  {
    role: "verify",
    relativePath: "verify.md",
    required: false,
    status: "shipped",
  },
  {
    role: "summary",
    relativePath: "summary.md",
    required: false,
    status: "shipped",
  },
  // ── Deferred [v2.x] — never required; listed for completeness reporting ──
  {
    role: "timeline",
    relativePath: "timeline.jsonl",
    required: false,
    status: "deferred",
  },
  {
    role: "context-refs",
    relativePath: "context-refs.json",
    required: false,
    status: "deferred",
  },
  {
    role: "evidence",
    relativePath: "evidence",
    required: false,
    status: "deferred",
    isDir: true,
  },
  {
    role: "assumptions",
    relativePath: "assumptions.md",
    required: false,
    status: "deferred",
  },
  {
    role: "decisions",
    relativePath: "decisions.md",
    required: false,
    status: "deferred",
  },
] as const;

// ── Core API ───────────────────────────────────────────────────────────────────

/** Options for `assembleReplayManifest`. */
export interface AssembleReplayManifestOpts {
  /**
   * Injectable fs seam. Defaults to the real-fs seam when omitted.
   * Supply a stub in tests to keep tests off disk.
   */
  fs?: ReplayFsSeam;
}

/**
 * Inspect `runDir` on disk and return a manifest listing each replay artifact
 * with its `present` + `required` + `status` flags.
 *
 * The caller supplies the absolute run directory. This module does not resolve,
 * expand, or canonicalize the path — it is used verbatim.
 *
 * Pure given the injected fs seam: deterministic output for a given filesystem
 * state; no Date.now() or Math.random() calls.
 *
 * @param runDir  Absolute path to `.guild/runs/<run-id>/`.
 * @param opts    Optional injectable seam (omit for real fs).
 * @returns       A `ReplayManifest` with `complete` pre-computed.
 */
export function assembleReplayManifest(
  runDir: string,
  opts?: AssembleReplayManifestOpts,
): ReplayManifest {
  const fs = opts?.fs ?? createRealReplayFsSeam();

  const artifacts: ReplayArtifactEntry[] = ARTIFACT_CATALOGUE.map((def) => {
    const absPath = path.join(runDir, def.relativePath);
    const present = fs.exists(absPath);

    const entry: ReplayArtifactEntry = {
      role: def.role,
      relativePath: def.relativePath,
      present,
      required: def.required,
      status: def.status,
    };

    if (def.isDir) {
      // List directory contents when present; empty array otherwise.
      entry.files = present ? fs.listDir(absPath) : [];
    }

    return entry;
  });

  const complete = artifacts
    .filter((a) => a.required)
    .every((a) => a.present);

  return {
    schema_version: "guild.replay_manifest.v1",
    runDir,
    artifacts,
    complete,
  };
}

/**
 * Returns true iff all REQUIRED replay artifacts are present in `manifest`.
 *
 * Required artifacts in the current (v2-shipped) contract:
 *   - logs/v1.4-events.jsonl  (canonical trace log)
 *   - provenance.json         (guild.provenance.v1 close record)
 *   - run.yaml                (guild.run.v1 start manifest)
 *
 * Deferred [v2.x] artifacts (timeline.jsonl, context-refs.json, evidence/,
 * assumptions.md, decisions.md) are NEVER required by this check — they are
 * specified but not yet emitted by v2.
 *
 * Pure: only reads `manifest.artifacts`; makes no fs calls.
 *
 * @param manifest  A manifest produced by `assembleReplayManifest`.
 * @returns         `true` iff every `required` artifact is `present`.
 */
export function isReplayComplete(manifest: ReplayManifest): boolean {
  return manifest.complete;
}

/**
 * Return only the entries that are required but missing.
 * Convenience helper for callers that want to surface specific gaps.
 *
 * Pure: no fs calls.
 */
export function missingRequiredArtifacts(manifest: ReplayManifest): ReplayArtifactEntry[] {
  return manifest.artifacts.filter((a) => a.required && !a.present);
}

// ── CLI entrypoint (may use Date.now; never called from lib consumers) ────────

if (require.main === module) {
  const argv = process.argv.slice(2);
  const runDir = argv[0];
  if (!runDir) {
    process.stderr.write("Usage: npx tsx scripts/lib/replay-rundir.ts <runDir>\n");
    process.exit(1);
  }
  const absRunDir = path.resolve(runDir);
  const manifest = assembleReplayManifest(absRunDir);
  // Safe to use Date.now() here — this is the CLI block, not an exported lib fn.
  const ts = new Date(Date.now()).toISOString();
  process.stdout.write(
    JSON.stringify({ ts, ...manifest }, null, 2) + "\n",
  );
  process.exit(manifest.complete ? 0 : 1);
}
