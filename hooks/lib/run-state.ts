/**
 * hooks/lib/run-state.ts
 *
 * `guild.run_state.v1` — the in-flight DAG execution checkpoint (ADR-RE-1).
 *
 * ── BIND BY POINTER ────────────────────────────────────────────────────────
 * Canonical body + rationale: docs/knowledge/decisions/v2-runtime-and-execution-model.md
 *   §ADR-RE-1 ("Run-state checkpoint schema + resume protocol") and the frozen
 *   `guild.run_state.v1` body in §"New contracts". Registered in the
 *   contract-map (§B-post, post-v2 sibling) by the team lead.
 * This module is the runtime *realization* of that frozen body; it does NOT
 * re-spell the schema's rationale, invariants, or composition rules — read the
 * ADR. The TypeScript interface below mirrors the frozen field set verbatim.
 *
 * What it is (per ADR-RE-1):
 *   - Lives at `<runDir>/run-state.json` (`.guild/runs/<run-id>/run-state.json`).
 *   - Derived / rebuildable speed-cache for `/guild:resume` — NEVER the system
 *     of record (regenerable by scanning handoff receipts; deletable with zero
 *     data loss, mirroring CR-D's `initiatives-registry.yaml` posture).
 *   - Composes with the terminal `guild.provenance.v1` close record along the
 *     same axis as `guild.handoff.v2` → `guild.handoff_receipt.v1`.
 *
 * Write discipline (per ADR-RE-1 + CR-D, REUSED not reinvented):
 *   - Atomic write-temp-then-`rename` (`writeRunStateAtomic`).
 *   - Under the established per-run `.lock` discipline (`withStableLock` from
 *     `v1.4-lock.ts` — the single coordination primitive for ALL per-run shared
 *     state, so run-state writes serialize against counter / JSONL writers).
 *
 * Writer/reader matrix (ADR §"New contracts" table row 1):
 *   - `TaskCompleted` hook (this lib's primary caller) → terminal lane status
 *     (`done` / `failed`) + receipt_ref, after each lane terminates.
 *   - dispatch path (agent-team launcher, scripts/ — tooling-engineer) →
 *     `in_progress` transition + DAG seeding, via `markLaneInProgress` /
 *     `upsertLane`. THIS is the "where dispatch is observable" seam: the
 *     launcher owns the in_progress write; this lib exposes the helper it calls.
 *     (There is no Claude Code "TaskStarted" hook event, so the in_progress
 *     transition cannot be hook-driven — it is dispatch-owned by design.)
 *   - `/guild:resume` + `/guild:status` → readers (skill territory).
 *
 * Runner: imported by hooks/agent-team/task-completed.ts (tsx / esbuild dist).
 * Tests:  hooks/lib/__tests__/run-state.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { withStableLock } from "./v1.4/v1.4-lock.js";

// ── Types (mirror the frozen guild.run_state.v1 body — ADR §"New contracts") ──

/** Lane status enum — frozen body. `dead` = retry budget exhausted (ADR-RE-2). */
export type LaneStatus =
  | "pending"
  | "in_progress"
  | "done"
  | "failed"
  | "dead"
  | "skipped";

/** Resolved model tier (cost ADR §2) — recorded per-lane. */
export type LaneTier = "cheap" | "mid" | "powerful";

/** Per-lane DAG execution state, keyed by task-id in `RunStateV1.lanes`. */
export interface LaneState {
  /** Required. Lane lifecycle status. */
  status: LaneStatus;
  /** Resolved tier (cost ADR §2). Optional — absent until dispatch resolves it. */
  tier?: LaneTier;
  /** Current attempt (ADR-RE-2). Defaults to 1. */
  attempt: number;
  /** Gating mirror of the plan lane. May be empty. */
  depends_on: string[];
  /** Pointer to the handoff receipt; null until the lane is done. */
  receipt_ref: string | null;
  /** ISO-8601 last-update stamp for this lane. */
  updated_at: string;
}

/** `guild.run_state.v1` — in-flight DAG execution checkpoint. */
export interface RunStateV1 {
  schema_version: "guild.run_state.v1";
  /** Required. The run this checkpoint tracks. */
  run_id: string;
  /** Required. Plan / spec slug. */
  plan_slug: string;
  /** Optional. null for one-off (links `guild.run_manifest.v1`). */
  program_id: string | null;
  /** Required. Which wave (0-based). */
  wave_index: number;
  /** Required. DAG lane state keyed by task-id. */
  lanes: Record<string, LaneState>;
  /** Required. Atomic-write stamp (ISO-8601). */
  last_checkpoint_at: string;
}

export const RUN_STATE_SCHEMA_VERSION = "guild.run_state.v1" as const;

// ── Seed / patch shapes ──────────────────────────────────────────────────────

/** Top-level run identity used to initialize a fresh checkpoint. */
export interface RunStateInit {
  /** Required. */
  runId: string;
  /** Plan/spec slug. Defaults to `runId` when omitted (best-effort). */
  planSlug?: string;
  /** Program link. null for one-off (default). */
  programId?: string | null;
  /** Wave index (0-based). Defaults to 0. */
  waveIndex?: number;
}

/** Partial lane update — only the supplied fields are merged. */
export interface LanePatch {
  status?: LaneStatus;
  tier?: LaneTier;
  attempt?: number;
  depends_on?: string[];
  /** Pass `null` to clear; omit to preserve the prior value. */
  receipt_ref?: string | null;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/** `<runDir>/run-state.json` — the checkpoint path for a run directory. */
export function runStatePath(runDir: string): string {
  return path.join(runDir, "run-state.json");
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read + parse `run-state.json`. Returns null if the file is absent or corrupt
 * (the checkpoint is rebuildable, so a corrupt cache is non-fatal — callers
 * re-seed). NEVER throws.
 */
export function loadRunState(runDir: string): RunStateV1 | null {
  let raw: string;
  try {
    raw = fs.readFileSync(runStatePath(runDir), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>)["schema_version"] !== RUN_STATE_SCHEMA_VERSION
  ) {
    return null;
  }
  return parsed as RunStateV1;
}

// ── Atomic write (temp-then-rename) ────────────────────────────────────────────

/**
 * Atomic write of a full run-state object: write to a unique temp sibling, then
 * `rename` over the final path (rename is atomic on a single filesystem). Does
 * NOT take the lock — callers that mutate-then-write MUST hold `withStableLock`
 * (see `upsertLane`). Exposed for the launcher's full-rewrite seeding path.
 */
export function writeRunStateAtomic(runDir: string, state: RunStateV1): void {
  fs.mkdirSync(runDir, { recursive: true });
  const finalPath = runStatePath(runDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    // Clean up the temp file if the rename failed, then re-throw.
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

// ── Locked read-modify-write ───────────────────────────────────────────────────

function newCheckpoint(init: RunStateInit, now: string): RunStateV1 {
  return {
    schema_version: RUN_STATE_SCHEMA_VERSION,
    run_id: init.runId,
    plan_slug: init.planSlug ?? init.runId,
    program_id: init.programId ?? null,
    wave_index: init.waveIndex ?? 0,
    lanes: {},
    last_checkpoint_at: now,
  };
}

/**
 * Upsert a single lane in the run-state checkpoint under the per-run `.lock`.
 *
 * Read-modify-write: loads the current checkpoint (or seeds a fresh one from
 * `init` when absent / corrupt), merges `patch` into `lanes[laneId]` preserving
 * any prior fields the patch does not set, stamps `updated_at` +
 * `last_checkpoint_at`, and writes atomically. Returns the resulting state.
 *
 * Top-level identity (plan_slug / program_id / wave_index) is preserved from an
 * existing checkpoint and only initialized from `init` on first write — so a
 * launcher-seeded slug/program survives later hook-driven terminal writes.
 */
export function upsertLane(
  runDir: string,
  init: RunStateInit,
  laneId: string,
  patch: LanePatch
): RunStateV1 {
  return withStableLock(runDir, () => {
    const now = new Date().toISOString();
    const state = loadRunState(runDir) ?? newCheckpoint(init, now);
    const prev = state.lanes[laneId];

    const merged: LaneState = {
      status: patch.status ?? prev?.status ?? "pending",
      attempt: patch.attempt ?? prev?.attempt ?? 1,
      depends_on: patch.depends_on ?? prev?.depends_on ?? [],
      receipt_ref:
        patch.receipt_ref !== undefined
          ? patch.receipt_ref
          : prev?.receipt_ref ?? null,
      updated_at: now,
    };
    const tier = patch.tier ?? prev?.tier;
    if (tier !== undefined) merged.tier = tier;

    state.lanes[laneId] = merged;
    state.last_checkpoint_at = now;
    writeRunStateAtomic(runDir, state);
    return state;
  });
}

/**
 * Dispatch-time seam (ADR-RE-1: "dispatch writes the in_progress transition").
 *
 * Called by the agent-team launcher (scripts/, tooling-engineer) when a lane is
 * dispatched to a worker — the observable dispatch point. Hooks do NOT call
 * this: there is no "TaskStarted" hook event, so the in_progress transition is
 * dispatch-owned by design. Exposed here so the writer and the schema live in
 * one place.
 */
export function markLaneInProgress(
  runDir: string,
  init: RunStateInit,
  laneId: string,
  opts: { tier?: LaneTier; attempt?: number; depends_on?: string[] } = {}
): RunStateV1 {
  return upsertLane(runDir, init, laneId, {
    status: "in_progress",
    tier: opts.tier,
    attempt: opts.attempt,
    depends_on: opts.depends_on,
  });
}
