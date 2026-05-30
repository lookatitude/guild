/**
 * scripts/dot-guild/convert/types.ts — shared types + injectable seams for the
 * v1→v2 `.guild` converter pipeline.
 *
 * Implements the W1a mapping contract
 * (.guild/initiatives/active/cleanup-consolidation/artifacts/v1-to-v2-mapping.md).
 * Design-only types here; behavior lives in detect.ts / snapshot.ts / keymap.ts /
 * convert.ts / report.ts.
 *
 * SEAMS (W1d test injection — mirrors scrub.ts seam discipline; NO Date.now()
 * hardcoding so snapshot timestamps are deterministic in tests):
 *   - Fs      : injectable filesystem (default = real node:fs/crypto)
 *   - nowUtc  : injectable clock → "YYYYMMDDTHHMMSSZ" (snapshot dir) + ISO (stamps)
 */

/** The 5 classification states (§1.1). `corrupt` is the 5th, dominating state. */
export type Classification = "v2" | "v1" | "mixed" | "corrupt" | "none";

/** Per-key outcome from the §2.0a 4-case rule. */
export type KeyCase = "C1" | "C2" | "C3" | "C4";

/** Artifact disposition vocabulary (§2 disposition vocab). */
export type Disposition =
  | "convert"
  | "rename"
  | "carry-forward-as-is"
  | "preserve+flag"
  | "unparseable";

/** Reason an entry was relocated to `.unmigrated-v1.json` (§2.0). */
export type RelocateReason = "unmapped" | "non-lossless";

/**
 * Minimal injectable filesystem seam. The real implementation wraps node:fs +
 * node:crypto (see realFs). Tests pass an in-memory implementation so the probe,
 * snapshot, and convert are fully deterministic without touching disk.
 */
export interface Fs {
  existsSync(p: string): boolean;
  /** Read a file as a utf8 string. Throws if absent or unreadable. */
  readFileSync(p: string): string;
  /** Read a file as raw bytes (used for sha256 + binary-safe copy). */
  readBytes(p: string): Buffer;
  writeFileSync(p: string, data: string): void;
  /** Write raw bytes (binary-safe copy). */
  writeBytes(p: string, data: Buffer): void;
  /**
   * Create a directory. When opts.exclusive is true the call MUST fail with an
   * EEXIST-style error if the leaf already exists (the §4.1 snapshot lock) —
   * i.e. NON-recursive mkdir. When false, behaves like mkdir -p.
   */
  mkdirSync(p: string, opts: { recursive: boolean }): void;
  /** Remove a file (used to remove a fully-migrated v1 source from the live tree). */
  rmFileSync(p: string): void;
  /** List directory entries (name + isDirectory/isFile). */
  readdirSync(p: string): Array<{ name: string; isDirectory: boolean; isFile: boolean }>;
  /** sha256 hex of a file's bytes. */
  sha256(p: string): string;
}

/** Injectable clock. Returns BOTH the snapshot-dir stamp and an ISO timestamp. */
export interface Clock {
  /** "YYYYMMDDTHHMMSSZ" — the §4.1 snapshot directory suffix. */
  stamp(): string;
  /** Full ISO-8601 UTC — `created_at` fields in written artifacts. */
  iso(): string;
}

/** One probed-artifact evidence record (feeds the report + tests). */
export interface Evidence {
  path: string;
  /** Which probe/marker produced this evidence (e.g. "P1", "P10", "M1:config.yml"). */
  marker: string;
  /** Did it contribute to M1 (v1), M2 (v2), or neither (informational)? */
  contributes: "M1" | "M2" | "none";
  note?: string;
}

/** Per-artifact plan/result line (one row in the report). */
export interface ArtifactRecord {
  /** Live-tree relative path (relative to `.guild/`). */
  rel: string;
  disposition: Disposition;
  /** v2 target path when converted/renamed (relative to `.guild/`). */
  target?: string;
  /** Human note (e.g. "agent_team → agent_mode (D5)"). */
  note?: string;
  /** Per-key outcomes when this artifact is a config surface. */
  keys?: KeyOutcome[];
  /** True once the live v1 source was (or would be) removed. */
  removed?: boolean;
}

/** Per-key §2.0a outcome record. */
export interface KeyOutcome {
  key: string;
  case: KeyCase;
  /** v2 form for C1 (where it landed), verbatim value for C2/C3/C4. */
  detail: string;
}

/** A relocated (C2) entry destined for `.unmigrated-v1.json`. */
export interface UnmigratedEntry {
  source: string;
  key: string;
  value: unknown;
  reason: RelocateReason;
}

/** Result of detect() — the §1.3 classification + evidence. */
export interface DetectResult {
  classification: Classification;
  m1: boolean;
  m2: boolean;
  /** True iff an AUTHORITATIVE artifact failed to parse (forces `corrupt`). */
  hasUnparseable: boolean;
  evidence: Evidence[];
  /** Per-artifact unparseable paths (authoritative + non-authoritative). */
  unparseable: Array<{ path: string; authoritative: boolean }>;
}

/** Result of snapshot(). */
export interface SnapshotResult {
  /** Absolute snapshot directory chosen (the §4.1 unique fail-if-exists path). */
  dest: string;
  /** `.guild`-relative dest (for report + restore line). */
  destRel: string;
  verified: boolean;
  fileCount: number;
  /** On verify failure, the first mismatching relative path. */
  mismatch?: string;
}

/** Top-level pipeline result returned by runMigration() (the W1c entry point). */
export interface MigrationResult {
  /** Per-child results. A single-repo run has exactly one entry. */
  children: ChildResult[];
  /** True iff this looked like a workspace (>1 unit, or workspace.json present). */
  workspace: boolean;
}

export interface ChildResult {
  /** Absolute repo root whose `.guild/` this entry describes. */
  root: string;
  /** Absolute `.guild/` path. */
  guildDir: string;
  detect: DetectResult;
  /** "migrate" | "dry-run" | "skip" | "none" | "v2-noop" | "corrupt-blocked". */
  action: string;
  snapshot?: SnapshotResult;
  artifacts: ArtifactRecord[];
  relocated: UnmigratedEntry[];
  /** Unresolved C4 conflicts (re-surfaced every open). */
  conflicts: KeyOutcome[];
  /** Absolute path of the report written (or that would be written). */
  reportPath: string;
  reportBody: string;
  /** Documented one-line restore command (when a snapshot was taken). */
  restoreCommand?: string;
  /** Any pipeline-level error message (snapshot abort, corrupt block, etc.). */
  error?: string;
}

export type Mode = "migrate" | "dry-run" | "skip";
