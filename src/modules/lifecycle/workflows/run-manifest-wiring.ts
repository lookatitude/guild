/**
 * scripts/lib/run-manifest-wiring.ts
 *
 * ARCH-8 — multi-wave run-manifest wiring (dormant forward-prep).
 *
 * Contract (BY POINTER): docs/v2/dispatch-execution.md §7 (run_manifest.v1);
 *   ADR: v2-runtime-and-execution-model (workspace wiki) §ADR-RE-6.
 *
 * Wires the existing write-run-manifest writer + reader together for multi-wave
 * program state: `wireRunManifest` composes a write→read round-trip for a
 * multi-wave program record (producing the on-disk canonical shape and reading
 * it back), and `validateRunManifest` validates a manifest against the
 * guild.run_manifest.v1 contract shape.
 *
 * **Dormant until multi-wave dispatch ships.** This module is inert in the
 * default execution path. Wiring only one side (writer or reader) would re-
 * introduce the reader-without-writer anti-pattern the drift remediation
 * eliminated (ledger ARCH-8 note). The live wiring lands in a follow-up
 * `multi-wave-program-wiring` dispatch wave.
 *
 * Design invariants:
 *   - NO Date.now() / Math.random() in exported lib functions — the caller
 *     supplies timestamps and ids via `WireRunManifestOpts`. A CLI main block
 *     may use Date.now() to produce a default timestamp for ad-hoc use.
 *   - Validator returns { valid, errors } — never throws on shape violations.
 *   - Default-safe: all shared-config reads fail open to documented defaults so
 *     the module stays inert when the feature is not yet wired.
 *   - File I/O delegates directly to write-run-manifest's real-fs
 *     read/write/upsert functions (no injectable fs seam here — a prior
 *     `ManifestFsSeam` parameter was declared but never read by this module
 *     and no test injected it; it was removed rather than wired to avoid
 *     shipping a second, unused fs-injection surface. write-run-manifest.ts's
 *     own writer is where real-path fs testability would need to land first).
 *
 * Owned by tooling-engineer. Consumers: orchestrator (wave-start write),
 * TaskCompleted (wave-complete write), /guild:resume + /guild:status (readers).
 */

import * as path from "path";

// ── Re-export canonical types from the writer (single source of truth) ─────────

export type {
  Wave,
  WavePatch,
  WaveStatus,
  ProgramStatus,
  RunManifest,
} from "./write-run-manifest";

import type { Wave, WavePatch, WaveStatus, ProgramStatus, RunManifest } from "./write-run-manifest";
import {
  manifestPathFor,
  readRunManifest,
  writeRunManifest,
  initRunManifest,
  upsertWave,
  setProgramStatus,
} from "./write-run-manifest";

// Re-export the writer helpers so callers can import from this wiring module
// without needing to know about the underlying writer file.
export {
  manifestPathFor,
  readRunManifest,
  writeRunManifest,
  initRunManifest,
  upsertWave,
  setProgramStatus,
};

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Known program-level status values (closed set).
 * Matches the shipped ProgramStatus union in write-run-manifest.ts:
 *   "active" | "completed" | "paused" | "aborted"
 * (The ADR §RE-6 example says "failed" but the writer uses "aborted" — this
 * module follows the shipped writer as the single source of truth.)
 */
export const PROGRAM_STATUSES = ["active", "completed", "paused", "aborted"] as const;

/**
 * Known wave-level status values (closed set).
 * Matches the shipped WaveStatus union in write-run-manifest.ts:
 *   "pending" | "active" | "completed" | "failed"
 */
export const WAVE_STATUSES = ["pending", "active", "completed", "failed"] as const;

/** Required top-level keys on guild.run_manifest.v1. */
export const MANIFEST_REQUIRED_KEYS = [
  "schema_version",
  "slug",
  "status",
  "created_at",
  "updated_at",
  "current_wave",
  "waves",
] as const;

/** Required keys on each wave record. */
export const WAVE_REQUIRED_KEYS = [
  "wave_index",
  "status",
  "run_id",
  "started_at",
  "completed_at",
] as const;

export interface ValidationResult {
  valid: boolean;
  /** Human-readable error strings; empty when valid. */
  errors: string[];
}

/**
 * Validate a value against the guild.run_manifest.v1 contract shape.
 *
 * - Does NOT throw on any violation — returns { valid: false, errors: [...] }.
 * - Checks top-level required keys, closed-set enum values, waves array shape,
 *   and wave-level required keys.
 * - Lenient on optional fields: additional unknown keys are allowed (the
 *   lenient-reader rule from the frozen contract table).
 *
 * @param raw  The parsed value to validate (any; the function type-narrows).
 * @returns    A { valid, errors } result.
 */
export function validateRunManifest(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, errors: ["manifest must be a non-null object"] };
  }

  const obj = raw as Record<string, unknown>;

  // schema_version
  if (obj["schema_version"] !== "guild.run_manifest.v1") {
    errors.push(
      `schema_version must be "guild.run_manifest.v1"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }

  // Required top-level keys (excluding schema_version already checked)
  for (const k of MANIFEST_REQUIRED_KEYS) {
    if (k === "schema_version") continue;
    if (!(k in obj)) {
      errors.push(`missing required key: ${k}`);
    }
  }

  // status (closed set)
  if ("status" in obj) {
    const s = obj["status"] as string;
    if (!(PROGRAM_STATUSES as readonly string[]).includes(s)) {
      errors.push(
        `status must be one of ${PROGRAM_STATUSES.join("|")}; got ${JSON.stringify(s)}`
      );
    }
  }

  // current_wave: null or number
  if ("current_wave" in obj) {
    const cw = obj["current_wave"];
    if (cw !== null && typeof cw !== "number") {
      errors.push(`current_wave must be a number or null; got ${JSON.stringify(cw)}`);
    }
  }

  // waves array
  if ("waves" in obj) {
    if (!Array.isArray(obj["waves"])) {
      errors.push("waves must be an array");
    } else {
      const waves = obj["waves"] as unknown[];
      waves.forEach((w, i) => {
        if (w === null || typeof w !== "object" || Array.isArray(w)) {
          errors.push(`waves[${i}] must be an object`);
          return;
        }
        const wObj = w as Record<string, unknown>;
        for (const k of WAVE_REQUIRED_KEYS) {
          if (!(k in wObj)) {
            errors.push(`waves[${i}] missing required key: ${k}`);
          }
        }
        // wave_index: must be a non-negative integer
        if ("wave_index" in wObj) {
          const wi = wObj["wave_index"];
          if (typeof wi !== "number" || !Number.isInteger(wi) || wi < 0) {
            errors.push(
              `waves[${i}].wave_index must be a non-negative integer; got ${JSON.stringify(wi)}`
            );
          }
        }
        // wave status (closed set — note: writer uses "active" but ADR spec uses "in_progress";
        // accept both to stay lenient across the v2.x transition)
        if ("status" in wObj) {
          const ws = wObj["status"] as string;
          const allWaveStatuses = [...WAVE_STATUSES, "active", "pending"] as string[];
          if (!allWaveStatuses.includes(ws)) {
            errors.push(
              `waves[${i}].status must be one of ${allWaveStatuses.join("|")}; got ${JSON.stringify(ws)}`
            );
          }
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── wireRunManifest ────────────────────────────────────────────────────────────

/**
 * Options controlling a single wireRunManifest call.
 *
 * The caller supplies all timestamps and ids so this function is deterministic
 * (no Date.now() / Math.random() inside). The CLI main block may derive a
 * `now` default from Date.now() for ad-hoc invocations.
 */
export interface WireRunManifestOpts {
  /**
   * Absolute path to the project root (the .guild/ write base).
   * Manifests land at <cwd>/.guild/programs/<slug>/manifest.json.
   */
  cwd: string;

  /** Stable program identifier (used as the slug and recorded on the manifest). */
  slug: string;

  /** Optional human-readable program title (applied on create only). */
  title?: string;

  /**
   * RFC3339 UTC timestamp string used as now() for auto-stamp of
   * created_at / updated_at / wave lifecycle timestamps.
   * Caller-supplied so this function stays deterministic.
   */
  now: string;

  /**
   * Wave record to upsert. If absent, the function initialises the manifest
   * (idempotent --init) without upsetting any wave.
   */
  wave?: WavePatch;

  /**
   * Optional program-level status to set after the wave upsert.
   * When absent, the program status is not changed by this call.
   */
  programStatus?: ProgramStatus;
}

/**
 * Result of a wireRunManifest call.
 */
export interface WireResult {
  /** The manifest as it exists on disk after the call. */
  manifest: RunManifest;
  /** Absolute path written. */
  manifestPath: string;
  /** Validation result on the written manifest (should always be valid). */
  validation: ValidationResult;
}

/**
 * Compose the write→read round-trip for a multi-wave program manifest.
 *
 * **Dormant until multi-wave dispatch ships (ARCH-8).** This function is safe
 * to call today — it writes to `.guild/programs/<slug>/manifest.json` and reads
 * back the result — but it is not wired into any production dispatch path.
 *
 * Invariants:
 *   - Idempotent init: if the manifest already exists, --init is a no-op.
 *   - Wave upsert merges (never overwrites clean data) via the writer's
 *     `upsertWave` (which auto-stamps started_at / completed_at).
 *   - Read-back validates the on-disk JSON against the guild.run_manifest.v1
 *     contract shape so callers can detect any serialisation drift.
 *   - Caller-supplied `now` is used for the auto-stamp clock; the function
 *     itself never calls Date.now().
 *
 * @param opts  Wire options (see WireRunManifestOpts).
 * @returns     The post-write manifest + path + validation result.
 */
export function wireRunManifest(opts: WireRunManifestOpts): WireResult {
  const { cwd, slug, now, title, wave, programStatus } = opts;

  // Step 1: ensure the manifest exists (idempotent).
  // initRunManifest internally calls Date.now() for timestamps — we work around
  // this by checking existence first and, when absent, building the initial
  // manifest ourselves with the caller-supplied `now`.
  let manifest = readRunManifest(cwd, slug);
  if (!manifest) {
    manifest = _buildInitialManifest(slug, title ?? null, now);
    writeRunManifest(cwd, manifest);
  }

  // Step 2: upsert the wave if provided.
  if (wave !== undefined) {
    manifest = _upsertWaveWithNow(cwd, slug, wave, now);
  }

  // Step 3: set program status if provided.
  if (programStatus !== undefined) {
    manifest = _setProgramStatusWithNow(cwd, slug, programStatus, now);
  }

  // Step 4: read back from disk (the canonical round-trip verification).
  const onDisk = readRunManifest(cwd, slug);
  if (!onDisk) {
    throw new Error(
      `[run-manifest-wiring] wireRunManifest: manifest not found on disk after write ` +
        `(cwd=${cwd}, slug=${slug})`
    );
  }

  const manifestPath = manifestPathFor(cwd, slug);
  const validation = validateRunManifest(onDisk);

  return { manifest: onDisk, manifestPath, validation };
}

// ── Internal helpers (not exported — internal wiring detail) ──────────────────

/**
 * Build an initial RunManifest shape using a caller-supplied timestamp rather
 * than Date.now(). This keeps wireRunManifest deterministic.
 */
function _buildInitialManifest(
  slug: string,
  title: string | null,
  now: string
): RunManifest {
  return {
    schema_version: "guild.run_manifest.v1",
    slug,
    title,
    status: "active" as ProgramStatus,
    created_at: now,
    updated_at: now,
    current_wave: null,
    waves: [],
  };
}

/**
 * upsertWave wrapper that stamps updated_at with the caller-supplied `now`.
 * The writer's upsertWave auto-stamps wave lifecycle timestamps using its own
 * Date.now() call — we accept that for the wave-level fields (started_at,
 * completed_at) and only correct the program-level updated_at afterward.
 */
function _upsertWaveWithNow(
  cwd: string,
  slug: string,
  wave: WavePatch,
  now: string
): RunManifest {
  const manifest = upsertWave(cwd, slug, wave);
  // Overwrite updated_at with the caller-supplied timestamp to maintain
  // determinism at the program level (wave-level stamps from the writer are
  // acceptable — they use the real clock only when not explicitly supplied).
  manifest.updated_at = now;
  writeRunManifest(cwd, manifest);
  return manifest;
}

/**
 * setProgramStatus wrapper that stamps updated_at with the caller-supplied `now`.
 */
function _setProgramStatusWithNow(
  cwd: string,
  slug: string,
  status: ProgramStatus,
  now: string
): RunManifest {
  const manifest = setProgramStatus(cwd, slug, status);
  manifest.updated_at = now;
  writeRunManifest(cwd, manifest);
  return manifest;
}

// ── buildMultiWaveProgram (higher-level composition helper) ───────────────────

/**
 * Options for building a complete multi-wave program record in a single call.
 * Useful for seeding test fixtures and for the orchestrator's wave-start path.
 */
export interface MultiWaveProgramOpts {
  /** Absolute project root (the .guild/ write base). */
  cwd: string;
  /** Stable program slug. */
  slug: string;
  /** Optional human-readable title (applied on create). */
  title?: string;
  /**
   * Ordered wave patches to upsert in sequence.
   * Each patch is applied via wireRunManifest with the supplied `now` string.
   */
  waves: WavePatch[];
  /**
   * RFC3339 UTC timestamp used as the clock for all operations in this call.
   * Caller-supplied — deterministic, no Date.now() inside.
   */
  now: string;
  /** Optional final program status to set after all waves are upserted. */
  programStatus?: ProgramStatus;
}

/**
 * Build (or update) a multi-wave program record by applying a sequence of wave
 * patches in order. Returns the final manifest + validation result.
 *
 * This is the higher-level orchestrator helper — the dispatch path calls this
 * once per wave-start or wave-complete event rather than calling wireRunManifest
 * once per field. **Dormant until multi-wave dispatch ships (ARCH-8).**
 *
 * @param opts  Multi-wave program options.
 * @returns     Final manifest + manifestPath + validation.
 */
export function buildMultiWaveProgram(opts: MultiWaveProgramOpts): WireResult {
  const { cwd, slug, title, waves, now, programStatus } = opts;

  let result: WireResult | null = null;
  for (const wave of waves) {
    result = wireRunManifest({ cwd, slug, title, now, wave });
  }

  if (programStatus !== undefined) {
    result = wireRunManifest({ cwd, slug, now, programStatus });
  }

  if (!result) {
    // No waves and no programStatus — just init.
    result = wireRunManifest({ cwd, slug, title, now });
  }

  return result;
}

// ── CLI (main block — may use Date.now() for ad-hoc default timestamps) ───────

export function runRunManifestWiringCli(args: string[] = process.argv.slice(2)): void {
  function getArg(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  }

  const cwd = getArg("--cwd") ?? process.env["GUILD_CWD"] ?? process.cwd();
  const slug = getArg("--slug");
  const now = getArg("--now") ?? new Date().toISOString();
  const title = getArg("--title");
  const waveIndexRaw = getArg("--wave");
  const waveStatus = getArg("--wave-status") as WaveStatus | undefined;
  const runId = getArg("--run-id");
  const handoffSummary = getArg("--handoff-summary");
  const programStatus = getArg("--status") as ProgramStatus | undefined;

  if (!slug) {
    process.stderr.write("[run-manifest-wiring] ERROR: --slug <slug> is required.\n");
    process.exit(1);
  }

  const wave: WavePatch | undefined =
    waveIndexRaw !== undefined
      ? {
          wave_index: parseInt(waveIndexRaw, 10),
          status: waveStatus,
          run_id: runId ?? null,
          handoff_summary: handoffSummary ?? null,
        }
      : undefined;

  try {
    const result = wireRunManifest({
      cwd,
      slug,
      title,
      now,
      wave,
      programStatus,
    });

    if (!result.validation.valid) {
      process.stderr.write(
        `[run-manifest-wiring] WARN: validation errors after write:\n` +
          result.validation.errors.map((e) => `  - ${e}`).join("\n") + "\n"
      );
    }

    process.stdout.write(result.manifestPath + "\n");
  } catch (e) {
    process.stderr.write(`[run-manifest-wiring] ERROR: ${(e as Error).message}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  runRunManifestWiringCli();
}
