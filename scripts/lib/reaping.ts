/**
 * scripts/lib/reaping.ts
 *
 * A2a — detectDismissible: given a run dir and a list of teammate names, report
 * which lanes have a **valid handoff receipt** present and are therefore safe to
 * dismiss immediately — no idle babysitting required.
 *
 * A2b — reapDeadMembers: given a session.json path, identify teammate panes
 * whose tmux pane_id is no longer alive and prune them from the registry so
 * TeamDelete is never wedged on a dead-but-still-registered member.
 *
 * Both functions inject their fs and subprocess dependencies for testability,
 * consistent with the RunFn/injection pattern in scripts/lib/team-backend.ts.
 *
 * Receipt validity definition (mirrors hooks/lib/handoff-v2.ts +
 * hooks/agent-team/task-completed.ts — not re-imported to keep scripts/
 * self-contained):
 *   1. File exists at <runDir>/handoffs/<specialist>-<task-id>.md
 *   2. Contains all five §8.2 required fields (changed_files, opens_for,
 *      assumptions, evidence, followups)
 *   3. If a ```guild.handoff.v2 fence block is present, its schema_version
 *      must be "guild.handoff.v2" (lightweight shape check)
 *
 * A receipt satisfying these three criteria is the deterministic dismissal
 * signal that P1-2 documents; the orchestrator can safely dismiss a teammate
 * as soon as its receipt lands.
 *
 * Usage:
 *   import { detectDismissible, reapDeadMembers } from "./lib/reaping";
 *   // CLI: node scripts/agent-team-launcher.ts --reap --cwd <path> [--run-id <id>]
 */

import * as fsNode from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import type { RunFn } from "./team-backend";

// ── Injectable filesystem seam ────────────────────────────────────────────────
//
// A minimal subset of `fs` used by this module.  The default is the real
// `fs` module; tests inject an in-memory stub.

export interface FsLike {
  existsSync(p: string): boolean;
  /** Returns an array of filenames (not Dirent) — callers always pass no options. */
  readdirSync(dir: string): string[];
  readFileSync(p: string, enc: "utf8"): string;
  writeFileSync(p: string, content: string, enc: "utf8"): void;
  renameSync(oldPath: string, newPath: string): void;
}

/** Default: real `fs` module, coerced to the interface. */
function realFs(): FsLike {
  return {
    existsSync: (p) => fsNode.existsSync(p),
    readdirSync: (dir) => fsNode.readdirSync(dir) as string[],
    readFileSync: (p, enc) => fsNode.readFileSync(p, enc) as string,
    writeFileSync: (p, content, enc) => fsNode.writeFileSync(p, content, enc),
    renameSync: (o, n) => fsNode.renameSync(o, n),
  };
}

/** Default: real subprocess runner. */
const defaultRun: RunFn = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts } as never);
  return {
    status: r.status,
    stdout: (r.stdout as string | null) ?? "",
    stderr: (r.stderr as string | null) ?? "",
  };
};

// ── Receipt validation ────────────────────────────────────────────────────────
//
// §8.2 required fields every handoff receipt markdown must contain.
// Mirror of `REQUIRED_FIELDS` in hooks/agent-team/task-completed.ts.

const REQUIRED_RECEIPT_FIELDS: ReadonlyArray<string> = [
  "changed_files",
  "opens_for",
  "assumptions",
  "evidence",
  "followups",
];

/** True when a markdown receipt contains all required §8.2 sections. */
function hasRequiredFields(content: string): boolean {
  return REQUIRED_RECEIPT_FIELDS.every((field) => {
    const pattern = new RegExp(`(?:^##?\\s+${field}\\b|^${field}\\s*:)`, "im");
    return pattern.test(content);
  });
}

/** Returns the names of any §8.2 fields that are missing from the content. */
function missingFieldNames(content: string): string[] {
  return REQUIRED_RECEIPT_FIELDS.filter((field) => {
    const pattern = new RegExp(`(?:^##?\\s+${field}\\b|^${field}\\s*:)`, "im");
    return !pattern.test(content);
  });
}

/**
 * Extract a ```guild.handoff.v2 fence block from a markdown receipt.
 * Returns the raw parsed JSON value, or null when absent / unparseable.
 * Mirror of extractHandoffEnvelope() in task-completed.ts.
 */
function extractEnvelope(content: string): unknown | null {
  const match = /```guild\.handoff\.v2\s*\n([\s\S]*?)```/.exec(content);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

/**
 * Lightweight shape-check for an extracted guild.handoff.v2 envelope.
 * Validates only the discriminant (`schema_version`) so the dismissal signal
 * is robust to optional field additions without needing the full validator
 * from hooks/lib/handoff-v2.ts.
 */
function isEnvelopeShapeValid(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return obj["schema_version"] === "guild.handoff.v2";
}

// ── Public type: receipt check result ─────────────────────────────────────────

export interface ReceiptCheckResult {
  /** True when the file exists at the expected path. */
  exists: boolean;
  /** True when all five §8.2 required fields are present. */
  hasRequiredFields: boolean;
  /**
   * True/false when a guild.handoff.v2 block was found; null when absent.
   * null is NOT a failure — envelopes are optional for the dismissal signal
   * (the file + §8.2 fields are the primary gate).
   */
  envelopeValid: boolean | null;
  /** Human-readable reasons why the receipt is invalid (empty when valid). */
  errors: string[];
}

/**
 * Validate a single handoff receipt at `receiptPath`.
 * Does NOT throw; all results are returned in `errors`.
 */
export function checkReceipt(
  receiptPath: string,
  fsMod: FsLike = realFs()
): ReceiptCheckResult {
  if (!fsMod.existsSync(receiptPath)) {
    return {
      exists: false,
      hasRequiredFields: false,
      envelopeValid: null,
      errors: ["receipt file not found"],
    };
  }

  const content = fsMod.readFileSync(receiptPath, "utf8");
  const missing = missingFieldNames(content);
  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(`missing §8.2 fields: ${missing.join(", ")}`);
  }

  const envelope = extractEnvelope(content);
  let envelopeValid: boolean | null = null;
  if (envelope !== null) {
    envelopeValid = isEnvelopeShapeValid(envelope);
    if (!envelopeValid) {
      errors.push("guild.handoff.v2 block present but schema_version mismatch");
    }
  }

  return {
    exists: true,
    hasRequiredFields: missing.length === 0,
    envelopeValid,
    errors,
  };
}

/**
 * A receipt is "valid" (= safe to dismiss on) when:
 *   - it exists
 *   - it has all §8.2 required fields
 *   - if an envelope block is present, its shape is valid (envelopeValid !== false)
 */
function isValid(r: ReceiptCheckResult): boolean {
  return r.exists && r.hasRequiredFields && r.envelopeValid !== false;
}

// ── A2a: Dismissible detection ─────────────────────────────────────────────────

export interface DismissibleEntry {
  /** Specialist / teammate name. */
  specialist: string;
  /**
   * True when at least one valid receipt is present — the orchestrator should
   * dismiss this lane immediately (no idle babysitting).
   */
  dismissible: boolean;
  /**
   * Absolute path to the receipt that triggered dismissal (or the last checked
   * receipt path when dismissible=false).  null when no receipt file exists at all.
   */
  receiptPath: string | null;
  /**
   * Task ID extracted from the receipt filename `<specialist>-<task-id>.md`.
   * null when no receipt file was found.
   */
  taskId: string | null;
  /** Non-empty when dismissible=false, describing why the receipt is invalid. */
  errors: string[];
}

/**
 * A2a — detectDismissible
 *
 * Given a run directory and a list of teammate names, scan
 * `<runDir>/handoffs/` and report which lanes have a valid receipt —
 * indicating they are safe to dismiss immediately.
 *
 * A lane is **dismissible** as soon as ANY valid receipt for that specialist
 * is found; multiple task receipts for the same specialist are all checked
 * (first valid one wins).
 *
 * Pure-ish: all filesystem operations go through `fsMod` (inject a stub for
 * tests).  No subprocess calls.
 *
 * @param runDir    Absolute path to `.guild/runs/<run-id>/`
 * @param teammates List of specialist names to check
 * @param fsMod     Injectable fs dependency (default: real fs)
 */
export function detectDismissible(
  runDir: string,
  teammates: string[],
  fsMod: FsLike = realFs()
): DismissibleEntry[] {
  const handoffsDir = path.join(runDir, "handoffs");

  const handoffsExist = fsMod.existsSync(handoffsDir);
  let allFiles: string[] = [];
  if (handoffsExist) {
    try {
      allFiles = fsMod.readdirSync(handoffsDir);
    } catch {
      // Directory exists but read failed — treat as empty
    }
  }

  return teammates.map((specialist): DismissibleEntry => {
    if (!handoffsExist) {
      return {
        specialist,
        dismissible: false,
        receiptPath: null,
        taskId: null,
        errors: ["handoffs directory not present in run dir"],
      };
    }

    const prefix = `${specialist}-`;
    const matches = allFiles.filter(
      (f) => f.startsWith(prefix) && f.endsWith(".md")
    );

    if (matches.length === 0) {
      return {
        specialist,
        dismissible: false,
        receiptPath: null,
        taskId: null,
        errors: ["no receipt file found for specialist"],
      };
    }

    // Check each receipt; return on the first valid one.
    for (const filename of matches) {
      const rPath = path.join(handoffsDir, filename);
      const taskId = filename.slice(prefix.length, -".md".length);
      const check = checkReceipt(rPath, fsMod);
      if (isValid(check)) {
        return {
          specialist,
          dismissible: true,
          receiptPath: rPath,
          taskId,
          errors: [],
        };
      }
    }

    // All receipts invalid — report the last one's errors
    const lastFile = matches[matches.length - 1];
    const rPath = path.join(handoffsDir, lastFile);
    const taskId = lastFile.slice(prefix.length, -".md".length);
    const check = checkReceipt(rPath, fsMod);
    return {
      specialist,
      dismissible: false,
      receiptPath: rPath,
      taskId,
      errors: check.errors,
    };
  });
}

// ── A2b: Force-reap dead members ──────────────────────────────────────────────

/**
 * The shape of our session.json manifest (mirrors `Manifest` in
 * scripts/agent-team-launcher.ts). Only the fields needed for reaping are
 * required here; unknown fields are preserved via spread.
 */
export interface SessionManifest {
  run_id: string;
  teammate_panes: Array<{
    specialist: string;
    pane_id: string;
    host_kind: string;
    adapter_version: string;
  }>;
  [key: string]: unknown;
}

export interface ReapResult {
  /** Specialist names whose dead panes were pruned from the session registry. */
  reaped: string[];
  /** Specialist names with panes still alive in tmux. */
  live: string[];
  /**
   * Specialist names skipped because pane_id was a dry-run placeholder or
   * otherwise unverifiable (starts with "(" or is empty).
   */
  skipped: string[];
  /** True when session.json was updated (reaped.length > 0). */
  updated: boolean;
}

/**
 * A2b — reapDeadMembers
 *
 * Read `sessionJsonPath`, check each teammate_pane's pane_id against the live
 * tmux panes (`tmux list-panes -a`), and prune any pane whose process is gone
 * from the session registry.  Write the updated manifest back atomically via
 * a temp-then-rename swap.
 *
 * **Conservative contract:**
 *   - Only reaps members with NO live pane (pane_id not in `tmux list-panes -a`).
 *   - Dry-run / placeholder pane_ids (those starting with "(" or empty) are
 *     always skipped, never reaped.
 *   - If tmux is unavailable or returns an error, all panes are treated as
 *     "skipped" (fail-safe: no data is lost).
 *   - Never touches .guild/wiki/ (tooling-engineer scope boundary).
 *
 * @param sessionJsonPath  Absolute path to the session.json manifest.
 * @param opts.run         Injectable subprocess runner (default: real spawnSync).
 * @param opts.fsMod       Injectable fs dependency (default: real fs).
 */
export function reapDeadMembers(
  sessionJsonPath: string,
  opts: { run?: RunFn; fsMod?: FsLike } = {}
): ReapResult {
  const fsMod = opts.fsMod ?? realFs();
  const run = opts.run ?? defaultRun;

  const empty: ReapResult = { reaped: [], live: [], skipped: [], updated: false };

  if (!fsMod.existsSync(sessionJsonPath)) {
    return empty;
  }

  let manifest: SessionManifest;
  try {
    manifest = JSON.parse(fsMod.readFileSync(sessionJsonPath, "utf8")) as SessionManifest;
  } catch {
    // Unparseable session.json — nothing to reap
    return empty;
  }

  const panes = manifest.teammate_panes ?? [];
  if (panes.length === 0) {
    return empty;
  }

  // Fetch the set of live pane IDs from tmux (best-effort).
  // If tmux is unavailable or fails, the safe default is to skip all (no data loss).
  const livePaneIds = getLivePaneIds(run);
  const tmuxAvailable = livePaneIds !== null;

  const reaped: string[] = [];
  const live: string[] = [];
  const skipped: string[] = [];

  for (const pane of panes) {
    const id = (pane.pane_id ?? "").trim();
    // Dry-run placeholder values start with "(" — always skip
    if (!id || id.startsWith("(")) {
      skipped.push(pane.specialist);
      continue;
    }
    if (!tmuxAvailable) {
      // Can't verify — conservatively skip
      skipped.push(pane.specialist);
      continue;
    }
    if (livePaneIds!.has(id)) {
      live.push(pane.specialist);
    } else {
      reaped.push(pane.specialist);
    }
  }

  if (reaped.length === 0) {
    return { reaped, live, skipped, updated: false };
  }

  // Prune dead panes and write back atomically via temp-then-rename.
  const reapedSet = new Set(reaped);
  const updated: SessionManifest = {
    ...manifest,
    teammate_panes: panes.filter((p) => !reapedSet.has(p.specialist)),
  };
  const tmp = sessionJsonPath + ".reap.tmp";
  try {
    fsMod.writeFileSync(tmp, JSON.stringify(updated, null, 2) + "\n", "utf8");
    fsMod.renameSync(tmp, sessionJsonPath);
  } catch (err) {
    // Write failed — return the reap plan without claiming updated=true.
    process.stderr.write(
      `[reaping] WARN: could not update session.json: ` +
        `${err instanceof Error ? err.message : String(err)}\n`
    );
    return { reaped, live, skipped, updated: false };
  }

  return { reaped, live, skipped, updated: true };
}

/**
 * Returns the set of live tmux pane IDs via `tmux list-panes -a`, or null if
 * tmux is unavailable / returns a non-zero exit code.
 */
function getLivePaneIds(run: RunFn): Set<string> | null {
  const r = run("tmux", ["list-panes", "-a", "-F", "#{pane_id}"]);
  if (r.status !== 0) return null;
  const ids = r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(ids);
}

// ── Convenience: locate session.json for a run ─────────────────────────────────

/**
 * Returns the absolute path to `session.json` for a given consuming-repo root
 * and run ID.  Does NOT check for existence.
 */
export function sessionJsonPath(cwd: string, runId: string): string {
  return path.join(cwd, ".guild", "runs", runId, "agent-team", "session.json");
}

/**
 * Best-effort: list run IDs under `<cwd>/.guild/runs/` that have a
 * `agent-team/session.json`.  Returns them sorted (newest last by
 * lexicographic order, since run IDs are ISO-timestamp-derived).
 * Returns [] on any error.
 */
export function listRunnableRunIds(
  cwd: string,
  fsMod: FsLike = realFs()
): string[] {
  const runsDir = path.join(cwd, ".guild", "runs");
  if (!fsMod.existsSync(runsDir)) return [];
  let ids: string[];
  try {
    ids = fsMod.readdirSync(runsDir);
  } catch {
    return [];
  }
  return ids
    .filter((id) => {
      const p = sessionJsonPath(cwd, id);
      try {
        return fsMod.existsSync(p);
      } catch {
        return false;
      }
    })
    .sort();
}
