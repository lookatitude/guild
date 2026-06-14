/**
 * scripts/lib/init-resume-repair.ts
 *
 * Init Resume-Repair Station (v2.x deferred — item 1).
 *
 * Implements the brownfield validate-and-repair path that the `guild:init` skill
 * invokes when `.guild/project.yaml` already exists.  The station runs BEFORE any
 * write touches the user's `.guild/` tree and emits a deterministic repair plan
 * that the caller may execute.
 *
 * Contract (BY POINTER):
 *   docs/v2/03-lifecycle.md §Resume-repair
 *   docs/v2/03-lifecycle.md §Phase contracts (Init MUST-exist table)
 *
 * Two exports:
 *
 *   validateGuildDir(guildDir) → ValidateResult
 *     Walks the on-disk tree and emits every structural issue it finds.
 *     Pure read — never writes, never auto-deletes.
 *     Returns { issues, repairable } where:
 *       - issues  : IssueReport[] describing every detected gap
 *       - repairable: true iff ALL issues have a safe automated repair action
 *         (i.e. no issue has severity "manual" — those require human intervention)
 *
 *   planRepairs(issues) → RepairAction[]
 *     Converts the validated issue list into a deterministic, ordered repair plan.
 *     Pure — no I/O; caller executes the returned actions.
 *     Actions:
 *       create-missing-dir     — mkdirp the absent directory
 *       regenerate-derived-index — signal caller to regenerate an index artifact
 *       flag-manual            — emit a human-facing warning (nothing is written)
 *
 * Safety invariants:
 *   - Never auto-deletes any file or directory.
 *   - Never overwrites user-authored wiki or initiative files.
 *   - Does not call Date.now() or Math.random() — all timestamps are caller-supplied
 *     (the caller passes them through opts or they are absent from this module).
 *   - Default-off / inert on an unrecognised .guild/ layout — unknown keys are ignored.
 *   - Lenient: a missing .guild/ directory is itself reported as an issue rather
 *     than throwing.
 *
 * Style: JSDoc header, const-tuple enums, validators returning {valid, errors}.
 * Owned by tooling-engineer.
 */

import * as fs from "fs";
import * as path from "path";

// ── Severity ──────────────────────────────────────────────────────────────────

/**
 * Three-level severity for a detected issue.
 *
 *   error   — the .guild/ directory cannot be used safely until resolved.
 *   warning — degraded behaviour; the station continues but surfaces the gap.
 *   manual  — cannot be safely auto-repaired; human action required.
 */
export const SEVERITY_LEVELS = ["error", "warning", "manual"] as const;
export type Severity = (typeof SEVERITY_LEVELS)[number];

// ── Issue kinds ───────────────────────────────────────────────────────────────

/**
 * Machine-readable kind tag for each structural issue detected.
 *
 *   missing-dir          — a required directory is absent.
 *   missing-file         — a required file is absent.
 *   malformed-file       — a required file is present but unparseable / has a
 *                          bad schema (e.g. settings.json is not valid JSON).
 *   stale-derived-index  — a derived index artifact exists but its source has
 *                          changed (content hash mismatch, or format version bump).
 *   schema-version-mismatch — a file's schema_version field does not match the
 *                             expected version.
 *   unknown-layout       — the .guild/ tree has an unexpected top-level shape
 *                          (informational; never blocks).
 */
export const ISSUE_KINDS = [
  "missing-dir",
  "missing-file",
  "malformed-file",
  "stale-derived-index",
  "schema-version-mismatch",
  "unknown-layout",
] as const;
export type IssueKind = (typeof ISSUE_KINDS)[number];

// ── Issue report ──────────────────────────────────────────────────────────────

/** A single structural issue detected by validateGuildDir. */
export interface IssueReport {
  /** .guild-relative path (e.g. "wiki/index.md") for display / sorting. */
  path: string;
  /** Machine-readable kind. */
  kind: IssueKind;
  /** Severity level. */
  severity: Severity;
  /** Human-readable description of the issue. */
  message: string;
}

// ── Validate result ───────────────────────────────────────────────────────────

/** Return value of validateGuildDir. */
export interface ValidateResult {
  /** All issues detected; empty when the directory is clean. */
  issues: IssueReport[];
  /**
   * True iff every issue has a safe automated repair action — i.e. no issue
   * has severity "manual".  When false the caller MUST prompt for human review
   * before executing any repair plan.
   */
  repairable: boolean;
}

// ── Repair action kinds ───────────────────────────────────────────────────────

/**
 * Machine-readable kind tag for each repair step.
 *
 *   create-missing-dir       — mkdirp the absent directory.
 *   regenerate-derived-index — the caller must regenerate the derived index
 *                              at the indicated path (e.g. re-run the indexer).
 *   flag-manual              — no automated action; emit a human-facing warning.
 */
export const REPAIR_ACTION_KINDS = [
  "create-missing-dir",
  "regenerate-derived-index",
  "flag-manual",
] as const;
export type RepairActionKind = (typeof REPAIR_ACTION_KINDS)[number];

/** A single step in a repair plan produced by planRepairs. */
export interface RepairAction {
  /** The action to take. */
  action: RepairActionKind;
  /**
   * .guild-relative path this action targets (same as IssueReport.path for
   * easy correlation).
   */
  path: string;
  /** Human-readable rationale. */
  rationale: string;
  /** The originating issue kind (for traceability). */
  issueKind: IssueKind;
}

// ── Internal fs surface (injectable for tests) ────────────────────────────────

/**
 * Minimal fs surface consumed by validateGuildDir.
 * Injected so the library is deterministic + testable without disk.
 */
export interface ValidationFsSeam {
  exists(absPath: string): boolean;
  isDirectory(absPath: string): boolean;
  isFile(absPath: string): boolean;
  readFile(absPath: string): string | null;
}

/** Real-fs implementation (default when no seam is injected). */
function realFsSeam(): ValidationFsSeam {
  return {
    exists(absPath: string): boolean {
      return fs.existsSync(absPath);
    },
    isDirectory(absPath: string): boolean {
      try {
        return fs.statSync(absPath).isDirectory();
      } catch {
        return false;
      }
    },
    isFile(absPath: string): boolean {
      try {
        return fs.statSync(absPath).isFile();
      } catch {
        return false;
      }
    },
    readFile(absPath: string): string | null {
      try {
        return fs.readFileSync(absPath, "utf8");
      } catch {
        return null;
      }
    },
  };
}

// ── Expected .guild/ structure ────────────────────────────────────────────────

/**
 * Required directories under .guild/.
 * Absence is an error for the first group and a warning for derived/optional ones.
 */
const REQUIRED_DIRS: ReadonlyArray<{ rel: string; severity: Severity; reason: string }> = [
  {
    rel: "wiki",
    severity: "error",
    reason: "wiki/ is the durable knowledge base — absent → all recall paths degrade",
  },
  {
    rel: "runs",
    severity: "error",
    reason: "runs/ holds run-state + provenance — absent → lifecycle tracking is broken",
  },
  {
    rel: "indexes",
    severity: "warning",
    reason: "indexes/ holds derived artifacts (codebase-map, etc.) — absent → brownfield signals unavailable; regeneratable",
  },
  {
    rel: "raw",
    severity: "warning",
    reason: "raw/ is the Init staging area — absent → Init brownfield scan cannot deposit candidates",
  },
];

/**
 * Required files under .guild/.
 * Each entry also carries an optional JSON-shape validator.
 */
interface ExpectedFile {
  rel: string;
  severity: Severity;
  reason: string;
  /** When true, the file contents are parsed as JSON and shape-checked. */
  validateJson?: boolean;
  /** When set, the parsed JSON must carry this schema_version value. */
  expectedSchemaVersion?: string;
}

const REQUIRED_FILES: ReadonlyArray<ExpectedFile> = [
  {
    rel: "settings.json",
    severity: "error",
    reason: "settings.json is the config anchor — absent → every settings resolver degrades to built-in defaults",
    validateJson: true,
  },
  {
    rel: "wiki/index.md",
    severity: "warning",
    reason: "wiki/index.md is the navigation scaffold — absent → wiki discovery is degraded",
  },
];

/**
 * Derived index files: present + parseable indicates clean; present but malformed
 * or present with a stale schema_version indicates stale-derived-index.
 * Absent is fine (they are regeneratable).
 */
const DERIVED_INDEX_FILES: ReadonlyArray<{ rel: string; expectedSchemaVersion?: string }> = [
  {
    rel: "indexes/codebase-map.json",
    expectedSchemaVersion: "guild.codebase_map.v1",
  },
];

// ── Validators ────────────────────────────────────────────────────────────────

/** Check that raw is valid JSON. Returns { valid, errors }. */
function validateJson(raw: string): { valid: boolean; errors: string[] } {
  try {
    JSON.parse(raw);
    return { valid: true, errors: [] };
  } catch (e) {
    return { valid: false, errors: [String(e)] };
  }
}

/** Check that a parsed JSON object carries the expected schema_version field. */
function validateSchemaVersion(
  parsed: unknown,
  expectedVersion: string
): { valid: boolean; errors: string[] } {
  if (!parsed || typeof parsed !== "object") {
    return { valid: false, errors: ["not a JSON object"] };
  }
  const obj = parsed as Record<string, unknown>;
  const actual = obj["schema_version"];
  if (actual === expectedVersion) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: [
      `expected schema_version "${expectedVersion}", found "${String(actual ?? "<absent>")}"`,
    ],
  };
}

// ── Core: validateGuildDir ────────────────────────────────────────────────────

/**
 * Validate an EXISTING .guild/ directory and return a full issue report.
 *
 * @param guildDir  Absolute path to the `.guild/` directory to inspect.
 * @param fsSeam    Optional injected fs surface (defaults to real node fs).
 *
 * Pure read — never writes, never deletes.  Safe to call at any time.
 */
export function validateGuildDir(
  guildDir: string,
  fsSeam?: ValidationFsSeam
): ValidateResult {
  const vfs = fsSeam ?? realFsSeam();
  const issues: IssueReport[] = [];

  // ── 0. The .guild/ directory itself must exist ─────────────────────────────
  if (!vfs.exists(guildDir) || !vfs.isDirectory(guildDir)) {
    issues.push({
      path: ".",
      kind: "missing-dir",
      severity: "error",
      message: `The .guild/ directory does not exist at "${guildDir}". Cannot validate or repair.`,
    });
    return { issues, repairable: false };
  }

  // ── 1. Required directories ────────────────────────────────────────────────
  for (const entry of REQUIRED_DIRS) {
    const abs = path.join(guildDir, entry.rel);
    if (!vfs.exists(abs) || !vfs.isDirectory(abs)) {
      issues.push({
        path: entry.rel,
        kind: "missing-dir",
        severity: entry.severity,
        message: `Required directory ".guild/${entry.rel}" is absent. ${entry.reason}`,
      });
    }
  }

  // ── 2. Required files ──────────────────────────────────────────────────────
  for (const entry of REQUIRED_FILES) {
    const abs = path.join(guildDir, entry.rel);

    if (!vfs.exists(abs) || !vfs.isFile(abs)) {
      issues.push({
        path: entry.rel,
        kind: "missing-file",
        severity: entry.severity,
        message: `Required file ".guild/${entry.rel}" is absent. ${entry.reason}`,
      });
      continue;
    }

    if (entry.validateJson) {
      const raw = vfs.readFile(abs);
      if (raw === null) {
        issues.push({
          path: entry.rel,
          kind: "malformed-file",
          severity: entry.severity,
          message: `Could not read ".guild/${entry.rel}" — file exists but is unreadable.`,
        });
        continue;
      }

      const jsonCheck = validateJson(raw);
      if (!jsonCheck.valid) {
        issues.push({
          path: entry.rel,
          kind: "malformed-file",
          severity: entry.severity,
          message: `".guild/${entry.rel}" is not valid JSON: ${jsonCheck.errors.join("; ")}`,
        });
        continue;
      }

      if (entry.expectedSchemaVersion) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
        const sv = validateSchemaVersion(parsed, entry.expectedSchemaVersion);
        if (!sv.valid) {
          issues.push({
            path: entry.rel,
            kind: "schema-version-mismatch",
            severity: "warning",
            message: `".guild/${entry.rel}" schema_version mismatch — ${sv.errors.join("; ")}`,
          });
        }
      }
    }
  }

  // ── 3. Derived index files (present-but-malformed → stale-derived-index) ──
  for (const entry of DERIVED_INDEX_FILES) {
    const abs = path.join(guildDir, entry.rel);

    if (!vfs.exists(abs)) {
      // Absent derived index is fine — it's regeneratable.  Not an issue.
      continue;
    }

    if (!vfs.isFile(abs)) {
      issues.push({
        path: entry.rel,
        kind: "malformed-file",
        severity: "warning",
        message: `".guild/${entry.rel}" exists but is not a file — unexpected layout.`,
      });
      continue;
    }

    const raw = vfs.readFile(abs);
    if (raw === null) {
      issues.push({
        path: entry.rel,
        kind: "stale-derived-index",
        severity: "warning",
        message: `".guild/${entry.rel}" exists but could not be read — regeneration recommended.`,
      });
      continue;
    }

    const jsonCheck = validateJson(raw);
    if (!jsonCheck.valid) {
      issues.push({
        path: entry.rel,
        kind: "stale-derived-index",
        severity: "warning",
        message: `".guild/${entry.rel}" is malformed JSON — regeneration recommended.`,
      });
      continue;
    }

    if (entry.expectedSchemaVersion) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const sv = validateSchemaVersion(parsed, entry.expectedSchemaVersion);
      if (!sv.valid) {
        issues.push({
          path: entry.rel,
          kind: "stale-derived-index",
          severity: "warning",
          message: `".guild/${entry.rel}" has stale schema_version — ${sv.errors.join("; ")}. Regeneration recommended.`,
        });
      }
    }
  }

  const repairable = issues.every((i) => i.severity !== "manual");
  return { issues, repairable };
}

// ── Core: planRepairs ─────────────────────────────────────────────────────────

/**
 * Convert an issue list from validateGuildDir into a deterministic, ordered
 * repair plan.
 *
 * Rules:
 *   missing-dir        → create-missing-dir
 *   missing-file       → flag-manual  (files are never auto-created; could be
 *                        user-authored content — safer to surface than overwrite)
 *   malformed-file     → flag-manual  (caller must inspect + remediate)
 *   stale-derived-index → regenerate-derived-index
 *   schema-version-mismatch → flag-manual  (schema migrations are never silent)
 *   unknown-layout     → flag-manual
 *
 * Order: create-missing-dir actions come FIRST (prerequisites for any
 * regeneration); regenerate-derived-index follows; flag-manual last.
 *
 * Pure — no I/O.
 */
export function planRepairs(issues: IssueReport[]): RepairAction[] {
  const createActions: RepairAction[] = [];
  const regenActions: RepairAction[] = [];
  const manualActions: RepairAction[] = [];

  for (const issue of issues) {
    switch (issue.kind) {
      case "missing-dir":
        createActions.push({
          action: "create-missing-dir",
          path: issue.path,
          rationale: `Create the missing directory ".guild/${issue.path}" to restore required layout.`,
          issueKind: issue.kind,
        });
        break;

      case "stale-derived-index":
        regenActions.push({
          action: "regenerate-derived-index",
          path: issue.path,
          rationale: `Re-run the indexer to regenerate ".guild/${issue.path}" from current source.`,
          issueKind: issue.kind,
        });
        break;

      case "missing-file":
        manualActions.push({
          action: "flag-manual",
          path: issue.path,
          rationale: `".guild/${issue.path}" is absent and cannot be auto-created (may be user-authored). Human action required.`,
          issueKind: issue.kind,
        });
        break;

      case "malformed-file":
        manualActions.push({
          action: "flag-manual",
          path: issue.path,
          rationale: `".guild/${issue.path}" is malformed. Inspect + remediate manually to avoid data loss.`,
          issueKind: issue.kind,
        });
        break;

      case "schema-version-mismatch":
        manualActions.push({
          action: "flag-manual",
          path: issue.path,
          rationale: `".guild/${issue.path}" has a schema_version mismatch. Run the migration tool or update manually.`,
          issueKind: issue.kind,
        });
        break;

      case "unknown-layout":
        manualActions.push({
          action: "flag-manual",
          path: issue.path,
          rationale: `".guild/${issue.path}" has an unexpected layout. No automated action — human review needed.`,
          issueKind: issue.kind,
        });
        break;

      default: {
        // Exhaustiveness guard — a future IssueKind addition is flagged manual.
        const _exhaustive: never = issue.kind;
        void _exhaustive;
        manualActions.push({
          action: "flag-manual",
          path: issue.path,
          rationale: `Unrecognised issue kind — no automated action available.`,
          issueKind: issue.kind,
        });
      }
    }
  }

  return [...createActions, ...regenActions, ...manualActions];
}
