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
 * hooks/agent-team/task-completed.ts; the strict allowed-key set is imported
 * from the canonical validator):
 *   1. File exists at <runDir>/handoffs/<specialist>-<task-id>.md
 *   2. Contains all five §8.2 required fields (changed_files, opens_for,
 *      assumptions, evidence, followups)
 *   3. OD-4 discriminator: whether the fenced guild.handoff.v2 envelope is
 *      REQUIRED or OPTIONAL depends on the run's policy scope:
 *        - in-scope run (run.yaml started_at >= POLICY_EFFECTIVE_DATE): required,
 *          fail-closed (no valid envelope → invalid receipt).
 *        - grandfathered run (started_at < POLICY_EFFECTIVE_DATE): optional,
 *          §8.2 fields alone are sufficient.
 *        - undeterminable (run.yaml absent or unparseable date): fail-open,
 *          treat as grandfathered + log a warning.
 *      Authority: ADR: communication-format-policy (workspace wiki)
 *      §"OD-4 discriminator" + §"policy_effective_date: 2026-06-03".
 *
 * A receipt satisfying these criteria is the deterministic dismissal
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
import {
  ALLOWED_INJECTION_CLEAN_VALUES,
  ALLOWED_TOP_LEVEL_KEYS,
} from "../../hooks/lib/handoff-v2";
import type { RunFn } from "./team-backend";
import { readRunStartedAt as _readRunStartedAt } from "./run-lifecycle";

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

// ── guild.handoff.v2 envelope validator ──────────────────────────────────────
//
// Full mirror of validateHandoffV2 in hooks/lib/handoff-v2.ts.
// Validation remains local, while the strict allowed-key set is imported from
// the canonical validator so schema additions cannot silently diverge here.
// Canonical source of truth: hooks/lib/handoff-v2.ts:validateHandoffV2.
// If the canonical changes, update this mirror in lockstep (AC-3 consumer parity).

/** Effective allowed-key set, shared with the canonical handoff-v2 validator. */
export const ALLOWED_ENVELOPE_KEYS: ReadonlySet<string> = ALLOWED_TOP_LEVEL_KEYS;

const VALID_ENVELOPE_TIERS = new Set<string>(["cheap", "mid", "powerful"]);
const VALID_ENVELOPE_STATUSES = new Set<string>(["done", "blocked", "escalate"]);

/** ~100-token proxy — mirror of SUMMARY_MAX_CHARS in hooks/lib/handoff-v2.ts. */
const ENVELOPE_SUMMARY_MAX_CHARS = 600;

/** O-4 cap — mirror of NOTES_MAX_CHARS in hooks/lib/handoff-v2.ts. */
const ENVELOPE_NOTES_MAX_CHARS = 200;

/**
 * Full mirror of validateHandoffV2 from hooks/lib/handoff-v2.ts.
 *
 * Validates ALL required fields (task_id, tier, status, summary, artifacts,
 * issues) and conditional fields (escalate_reason when status==="escalate"),
 * rejects unknown top-level keys, and enforces size caps on summary and notes.
 *
 * Returns error strings (empty = valid). Keeps detectDismissible and the hook
 * validator in FULL agreement so a receipt that passes one passes the other —
 * the AC-3 "FULL consumer agreement" requirement.
 *
 * Canonical reference: hooks/lib/handoff-v2.ts validateHandoffV2 (OD-2).
 */
function envelopeShapeErrors(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["envelope must be a non-null object"];
  }
  const obj = value as Record<string, unknown>;
  const errors: string[] = [];

  // Unknown-key rejection — strict guild.handoff.v2 (spec §2)
  for (const k of Object.keys(obj)) {
    if (!ALLOWED_ENVELOPE_KEYS.has(k)) {
      errors.push(
        `unknown key "${k}" — strict guild.handoff.v2 rejects extra/misspelled keys`
      );
    }
  }

  // schema_version
  if (obj["schema_version"] !== "guild.handoff.v2") {
    errors.push(
      `schema_version must be "guild.handoff.v2"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }

  // task_id — required non-empty string
  if (typeof obj["task_id"] !== "string" || obj["task_id"].trim() === "") {
    errors.push("task_id must be a non-empty string");
  }

  // tier — required, one of cheap|mid|powerful
  if (typeof obj["tier"] !== "string" || !VALID_ENVELOPE_TIERS.has(obj["tier"])) {
    errors.push(`tier must be one of cheap|mid|powerful; got ${JSON.stringify(obj["tier"])}`);
  }

  // status — required, one of done|blocked|escalate
  if (typeof obj["status"] !== "string" || !VALID_ENVELOPE_STATUSES.has(obj["status"])) {
    errors.push(
      `status must be one of done|blocked|escalate; got ${JSON.stringify(obj["status"])}`
    );
  }

  // summary — required, non-empty, size-capped
  if (typeof obj["summary"] !== "string") {
    errors.push("summary must be a string");
  } else if (obj["summary"].trim() === "") {
    errors.push("summary must not be empty");
  } else if (obj["summary"].length > ENVELOPE_SUMMARY_MAX_CHARS) {
    errors.push(
      `summary exceeds ${ENVELOPE_SUMMARY_MAX_CHARS} char cap (bloat rejection SC-7): ` +
        `got ${obj["summary"].length} chars`
    );
  }

  // artifacts — required array (may be empty)
  if (!Array.isArray(obj["artifacts"])) {
    errors.push("artifacts must be an array (may be empty)");
  } else {
    for (let i = 0; i < obj["artifacts"].length; i++) {
      if (typeof obj["artifacts"][i] !== "string") {
        errors.push(`artifacts[${i}] must be a string`);
      }
    }
  }

  // issues — required array (may be empty)
  if (!Array.isArray(obj["issues"])) {
    errors.push("issues must be an array (may be empty)");
  } else {
    for (let i = 0; i < obj["issues"].length; i++) {
      if (typeof obj["issues"][i] !== "string") {
        errors.push(`issues[${i}] must be a string`);
      }
    }
  }

  // escalate_reason — required when status === "escalate"
  if (obj["status"] === "escalate") {
    if (
      obj["escalate_reason"] === undefined ||
      obj["escalate_reason"] === null ||
      (typeof obj["escalate_reason"] === "string" && obj["escalate_reason"].trim() === "")
    ) {
      errors.push(
        "escalate_reason is required and must be non-empty when status is 'escalate'"
      );
    }
  }

  // escalate_reason type check (if present)
  if (obj["escalate_reason"] !== undefined && typeof obj["escalate_reason"] !== "string") {
    errors.push("escalate_reason must be a string when provided");
  }

  // learnings — optional array of strings
  if (obj["learnings"] !== undefined) {
    if (!Array.isArray(obj["learnings"])) {
      errors.push("learnings must be an array when provided");
    } else {
      for (let i = 0; i < obj["learnings"].length; i++) {
        if (typeof obj["learnings"][i] !== "string") {
          errors.push(`learnings[${i}] must be a string`);
        }
      }
    }
  }

  // notes — optional, capped at 200 chars (O-4)
  if (obj["notes"] !== undefined) {
    if (typeof obj["notes"] !== "string") {
      errors.push("notes must be a string when provided");
    } else if (obj["notes"].length > ENVELOPE_NOTES_MAX_CHARS) {
      errors.push(
        `notes exceeds ${ENVELOPE_NOTES_MAX_CHARS} char cap (O-4 binding resolution): ` +
          `got ${obj["notes"].length} chars`
      );
    }
  }

  // injection_clean — HK-08 additive-optional; absent ⇒ unverified (no error)
  if (
    obj["injection_clean"] !== undefined &&
    !ALLOWED_INJECTION_CLEAN_VALUES.has(obj["injection_clean"] as string)
  ) {
    errors.push(
      `injection_clean must be one of clean|flagged|unverified; got ${JSON.stringify(obj["injection_clean"])}`
    );
  }

  return errors;
}

// ── OD-4 discriminator ────────────────────────────────────────────────────────
//
// Authority: ADR: communication-format-policy (workspace wiki)
//   §"policy_effective_date" and §"OD-4 discriminator"
//
// A runtime receipt for a run whose `run.yaml.started_at` is >= this date is
// IN-SCOPE for enforcement (envelope required, fail-closed). Everything before
// this date is grandfathered (envelope optional for legacy receipts).
//
// NOTE: this constant is the single citable boundary shared by U3 (this file,
// task-completed.ts, teammate-idle.ts) and U5 (lint).  If the date changes,
// amend the policy doc heading AND this one constant — nowhere else.
// Coordination note: task-completed.ts (hook-engineer lane) must also apply this
// same discriminator so both the writer (hook) and the reader (reaping/dismissal)
// enforce the same boundary.  A shared helper was considered; because scripts/
// is intentionally self-contained (no hooks/ import), the constant is mirrored
// here by declaration.  See handoff notes for the hook-engineer coordination item.

export const POLICY_EFFECTIVE_DATE = "2026-06-03";

/**
 * Adapt a FsLike stub (used throughout scripts/) to the `(p) => string | null`
 * interface that `readRunStartedAt` from run-lifecycle.ts expects.  Returns null
 * on ENOENT / read error rather than throwing, matching run-lifecycle's seam.
 */
function fsLikeReader(fsMod: FsLike): (p: string) => string | null {
  return (p: string): string | null => {
    if (!fsMod.existsSync(p)) return null;
    try {
      return fsMod.readFileSync(p, "utf8");
    } catch {
      return null;
    }
  };
}

/**
 * OD-4 discriminator: returns true when the run identified by `runDir` is
 * in-scope for envelope-required enforcement (started_at >= POLICY_EFFECTIVE_DATE).
 *
 * Delegates run.yaml reading to `readRunStartedAt` from scripts/lib/run-lifecycle.ts
 * (OD-3: reuses the existing reader, zero new hand-rolled YAML regex in reaping).
 *
 * Fail-open contract: when the date is undeterminable (missing run.yaml, absent
 * or unparseable started_at), returns false (treat as grandfathered) and logs a
 * warning to stderr so the issue is visible without blocking dismissal.
 *
 * Exported for unit-testing; not part of the public API surface otherwise.
 */
export function isRunInScope(runDir: string, fsMod: FsLike = realFs()): boolean {
  const raw = _readRunStartedAt(runDir, fsLikeReader(fsMod));
  if (raw === null) {
    process.stderr.write(
      `[reaping] WARN: could not read run.yaml started_at from "${runDir}" — ` +
        `treating as grandfathered (fail-open per OD-4 discriminator).\n`
    );
    return false;
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    process.stderr.write(
      `[reaping] WARN: unparseable started_at "${raw}" in "${runDir}/run.yaml" — ` +
        `treating as grandfathered (fail-open per OD-4 discriminator).\n`
    );
    return false;
  }
  // Effective-date parsed as UTC midnight: 2026-06-03T00:00:00.000Z.
  // Using lexicographic comparison of ISO strings works for well-formed ISO-8601.
  const effectiveMs = new Date(POLICY_EFFECTIVE_DATE + "T00:00:00.000Z").getTime();
  return d.getTime() >= effectiveMs;
}

// ── Public type: receipt check result ─────────────────────────────────────────

export interface ReceiptCheckResult {
  /** True when the file exists at the expected path. */
  exists: boolean;
  /** True when all five §8.2 required fields are present. */
  hasRequiredFields: boolean;
  /**
   * true  — fenced guild.handoff.v2 block present and shape-valid.
   * false — block present but shape-invalid (unknown key, wrong schema_version).
   * null  — block absent; always treated as invalid per spec §2 condition 3.
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
  if (envelope === null) {
    // Spec §2 condition 3: a valid receipt MUST contain a fenced guild.handoff.v2 block
    // parseable as JSON. No parseable block → always invalid, matching the hook validator.
    const blockTagPresent = /```guild\.handoff\.v2/.test(content);
    errors.push(
      blockTagPresent
        ? "guild.handoff.v2 fenced block is not valid JSON — strict v2 requires parseable JSON"
        : "no guild.handoff.v2 fenced block — strict v2 requires it"
    );
  } else {
    const envErrors = envelopeShapeErrors(envelope);
    envelopeValid = envErrors.length === 0;
    errors.push(...envErrors);
  }

  return {
    exists: true,
    hasRequiredFields: missing.length === 0,
    envelopeValid,
    errors,
  };
}

/**
 * A receipt is "valid" (= safe to dismiss on) per the OD-4 discriminator:
 *
 * In-scope run (inScope === true, default — fail-closed):
 *   - it exists
 *   - it has all §8.2 required fields
 *   - a valid fenced guild.handoff.v2 block is present (envelopeValid === true)
 *   Fail-closed: null (no block) or false (invalid block) → invalid.
 *
 * Grandfathered run (inScope === false — fail-open for missing envelope):
 *   - it exists
 *   - it has all §8.2 required fields
 *   - envelopeValid is true (block present and valid) OR null (no block found —
 *     grandfathered: §8.2 fields alone are sufficient for pre-effective-date runs)
 *   - NOTE: a PRESENT but shape-invalid envelope (envelopeValid === false) is
 *     still rejected even for grandfathered runs — a malformed embedded envelope
 *     is a clear bug, not a legacy shape.
 *
 * Authority: ADR: communication-format-policy (workspace wiki) §"OD-4 discriminator"
 */
function isValid(r: ReceiptCheckResult, inScope: boolean = true): boolean {
  if (!r.exists || !r.hasRequiredFields) return false;
  if (r.envelopeValid === true) return true; // envelope present and valid: always OK
  if (r.envelopeValid === false) return false; // envelope present but malformed: always reject
  // envelopeValid === null: no block found.
  // in-scope: fail-closed (envelope required) → invalid.
  // grandfathered: §8.2 alone is enough → valid.
  return !inScope;
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
 * Receipt validity is gated by the OD-4 discriminator (isRunInScope): for
 * in-scope runs (started_at >= POLICY_EFFECTIVE_DATE) the fenced guild.handoff.v2
 * envelope is required; for grandfathered runs §8.2 fields alone are sufficient.
 * When the run date is undeterminable the check is fail-open (lenient).
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

  // OD-4: compute the run's scope once — same answer for every receipt in the run.
  const inScope = isRunInScope(runDir, fsMod);

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

    // Check each receipt; return on the first valid one (OD-4 scope applied).
    for (const filename of matches) {
      const rPath = path.join(handoffsDir, filename);
      const taskId = filename.slice(prefix.length, -".md".length);
      const check = checkReceipt(rPath, fsMod);
      if (isValid(check, inScope)) {
        return {
          specialist,
          dismissible: true,
          receiptPath: rPath,
          taskId,
          errors: [],
        };
      }
    }

    // All receipts invalid — report the last one's errors.
    // For grandfathered runs with no envelope, suppress the envelope-absent error
    // so the caller sees a clean "valid" without a misleading envelope error.
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
  backend?: "tmux" | "cmux";
  session_name?: string;
  teammate_panes: Array<{
    specialist: string;
    task_id?: string;
    dispatch_key?: string;
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
  const livePaneIds = getLivePaneIds(run, manifest);
  const tmuxAvailable = livePaneIds !== null;

  const reaped: string[] = [];
  const live: string[] = [];
  const skipped: string[] = [];
  const deadPaneIds = new Set<string>();

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
      deadPaneIds.add(id);
    }
  }

  if (reaped.length === 0) {
    return { reaped, live, skipped, updated: false };
  }

  // Prune dead panes and write back atomically via temp-then-rename.
  const updated: SessionManifest = {
    ...manifest,
    // One specialist may own several concrete task lanes. Prune by the surface
    // identity proven dead, never by the non-unique specialist role label.
    teammate_panes: panes.filter((p) => !deadPaneIds.has((p.pane_id ?? "").trim())),
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
function getLivePaneIds(run: RunFn, manifest: SessionManifest): Set<string> | null {
  if (manifest.backend === "cmux") {
    const workspace = typeof manifest.session_name === "string" ? manifest.session_name : "";
    const args = ["list-pane-surfaces", ...(workspace ? ["--workspace", workspace] : []), "--json"];
    const r = run("cmux", args);
    if (r.status !== 0) return null;
    return new Set(r.stdout.match(/surface:[A-Za-z0-9_.-]+/g) ?? []);
  }
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
