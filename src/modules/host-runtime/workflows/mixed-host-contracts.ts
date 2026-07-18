/**
 * src/modules/host-runtime/workflows/mixed-host-contracts.ts
 *
 * Mixed-host tmux sibling coordination contracts — ITEM 19 (`[v2-contract-only]`).
 *
 * Contract (BY POINTER): docs/v2/dispatch-execution.html §Mixed-host teams
 *   DI-5 (decided); registered in contract-map.md §B rows 3 and 4.
 *   Canonical schema bodies: target-architecture.md §TmuxTeam / §LaneStatus.
 *
 * Ships the two frozen sibling contracts for mixed Claude+Codex tmux teams:
 *
 *   `guild.tmux_team.v1` — the mixed-host pane-team descriptor written at
 *     `.guild/runs/<run-id>/tmux-team.yaml` when a team has any pane whose
 *     `host_kind` differs from the orchestrator host. Per-pane `host:` plus
 *     additive `host_kind` and `adapter_version`. Neither artifact is written in
 *     v2.0 (the shipped pane-team descriptor is `agent-team/session.json`); this
 *     module is contract-only / dormant until the mixed-host pane-team descriptor
 *     path ships (deferred item 19).
 *
 *   `guild.lane_status.v1` — per-pane heartbeat / current-state written at
 *     `status/<lane>.yaml` relative to the run directory. Carries the lane's
 *     current status, an RFC-3339 heartbeat timestamp, an optional human-readable
 *     step label, and an optional percent-complete estimate. Also contract-only /
 *     dormant until the structured per-pane status path ships (deferred item 19).
 *
 * **Status: `[v2-contract-only]`** — shapes + validators are fully defined here;
 * no production call-site writes these artifacts in v2.0. Wire the writers when
 * the mixed-host pane-team path ships (deferred item 19). Default behavior is
 * unchanged (dormant surfaces).
 *
 * **Determinism contract:** all exported validator functions are pure — NO
 * Date.now(), Math.random(), or I/O. The CALLER supplies timestamps and ids.
 * A `if (require.main === module)` CLI block at the bottom may use Date.now()
 * for ad-hoc inspection only.
 *
 * **Lenient-reader rule:** both contracts are self-versioned siblings; unknown
 * additive fields are silently ignored by validators (they do not fail).
 * `host_kind` and `adapter_version` on each pane are additive optional per-pane
 * fields — absent implies the orchestrator host (claude) and version "1".
 *
 * Owned by tooling-engineer.
 */

import type { HostKind } from "./host-types";

// ── Schema version constants ──────────────────────────────────────────────────

/** Schema version for the `guild.tmux_team.v1` pane-team descriptor. */
export const TMUX_TEAM_SCHEMA_VERSION = "guild.tmux_team.v1" as const;

/** Schema version for the `guild.lane_status.v1` per-pane heartbeat. */
export const LANE_STATUS_SCHEMA_VERSION = "guild.lane_status.v1" as const;

// ── guild.tmux_team.v1 ────────────────────────────────────────────────────────

/**
 * Per-pane descriptor within a `guild.tmux_team.v1` artifact.
 *
 * `host_kind` and `adapter_version` are additive optional fields (lenient-reader
 * rule; no `schema_version` bump). Absent `host_kind` implies the orchestrator
 * host (claude); absent `adapter_version` implies "1".
 */
export interface TmuxTeamPane {
  /** Specialist name (one of the 14 or a custom project specialist). */
  specialist: string;
  /**
   * Tmux pane id in `%NNN` format (e.g. "%3"). "(dry-run: not spawned)" in dry runs.
   * In v2.0 the shipped session.json uses this same field shape.
   */
  pane_id: string;
  /**
   * Host brand for this pane (additive optional). Absent implies "claude" (the
   * orchestrator host — pure-claude teams omit this field entirely under the
   * lenient-reader rule; existing readers that pre-date CH-1 see only known fields).
   */
  host_kind?: HostKind;
  /**
   * PaneAdapter version string for this pane (additive optional). Absent implies "1".
   * Incremented when the adapter's command generation changes in a breaking way.
   */
  adapter_version?: string;
  /**
   * Per-pane tool allow-list (additive optional; from `capability_scope:` in
   * team.yaml). Absent implies no restrictions (default-open).
   */
  capability_scope?: string[];
}

/**
 * `guild.tmux_team.v1` — mixed-host pane-team descriptor.
 *
 * Path: `.guild/runs/<run-id>/tmux-team.yaml`
 *
 * Written by the launcher for any team where at least one pane has a `host_kind`
 * that differs from the orchestrator host. Pure-claude teams continue to use the
 * existing `agent-team/session.json` shape; this artifact is the v2.x upgrade
 * path that adds first-class per-pane host metadata.
 *
 * Status: `[v2-contract-only]` — no production writer in v2.0.
 *
 * References (by pointer): target-architecture.md §TmuxTeam;
 *   docs/v2/dispatch-execution.html §Mixed-host teams (DI-5 decision record).
 */
export interface TmuxTeam {
  /** Always "guild.tmux_team.v1". */
  schema_version: typeof TMUX_TEAM_SCHEMA_VERSION;
  /** Run id that owns this team descriptor (e.g. "run-2026-05-17-001"). */
  run_id: string;
  /**
   * The session or window name within tmux (mode-dependent):
   *   - new-session mode: the tmux session name (e.g. "guild-<slug>-<ts>").
   *   - in-session mode: the window name created in the current session (e.g. "guild-<slug>").
   */
  session_name: string;
  /**
   * Launch mode. "new-session" = fresh detached session; "in-session" = new window
   * in the current tmux session.
   */
  mode: "new-session" | "in-session";
  /**
   * RFC-3339 UTC timestamp at which this descriptor was written. Supplied by the
   * caller (never Date.now() inside this module).
   */
  created_at: string;
  /**
   * Pane id of the orchestrator (lead) pane. "(dry-run: not spawned)" in dry runs.
   */
  orchestrator_pane_id: string;
  /** Per-specialist pane descriptors (one per specialist, in launch order). */
  panes: TmuxTeamPane[];
  /**
   * Whether this team has at least one non-orchestrator-host pane. Computed from
   * `panes[].host_kind` — true when any pane carries a non-"claude" `host_kind`.
   * Stored to let readers quickly short-circuit the pure-claude fast path.
   */
  mixed_host: boolean;
}

// ── guild.lane_status.v1 ──────────────────────────────────────────────────────

/**
 * Closed enum of lane status values for `guild.lane_status.v1`.
 *
 * Maps onto the `guild.run_state.v1` lane status enum
 * (`pending|in_progress|done|failed|dead|skipped`) plus the operational
 * "heartbeat-only" states the pane emits between run-state transitions.
 *
 * Note: "errored" is a `guild.agent_bus_event.v1` event kind, NOT a run-state
 * status — it is not included here (dispatch-execution.md §6).
 */
export const LANE_STATUS_VALUES = [
  /** Lane has been dispatched but has not yet started executing. */
  "pending",
  /** Lane is actively executing (heartbeat / tool calls in flight). */
  "in_progress",
  /** Lane completed successfully and its receipt is valid. */
  "done",
  /** Lane execution failed; subject to retry. */
  "failed",
  /** Lane exhausted its retry budget and was dead-lettered. */
  "dead",
  /** Lane was skipped (upstream dependency failed or user-overridden). */
  "skipped",
] as const;

export type LaneStatusValue = (typeof LANE_STATUS_VALUES)[number];

/**
 * `guild.lane_status.v1` — per-pane heartbeat / current-state.
 *
 * Path: `.guild/runs/<run-id>/status/<lane>.yaml`
 *   where `<lane>` is the task-id (e.g. "backend-api-001").
 *
 * Written by the pane's PostToolUse hook on every tool call (structured
 * heartbeat); read by the liveness sweep (`check-lane-liveness.ts`) and the
 * `guild:resume` / `guild:status` paths. The mutable, time-varying complement to
 * the immutable `guild.task_run.v1` descriptor written before dispatch.
 *
 * In v2.0 per-pane state lives in `run-state.json` + the `in-progress/*.json`
 * heartbeats. This contract is the v2.x upgrade: a per-lane YAML that merges
 * both concerns into a single versioned artifact.
 *
 * Status: `[v2-contract-only]` — no production writer in v2.0.
 *
 * References (by pointer): target-architecture.md §LaneStatus;
 *   docs/v2/dispatch-execution.html §6 (structured heartbeat + run-state checkpoint).
 */
export interface LaneStatus {
  /** Always "guild.lane_status.v1". */
  schema_version: typeof LANE_STATUS_SCHEMA_VERSION;
  /** Run id that owns this lane (e.g. "run-2026-05-17-001"). */
  run_id: string;
  /**
   * Task id (lane id) — the key in `guild.run_state.v1.lanes` and the filename
   * stem of this file (e.g. "backend-api-001" → `status/backend-api-001.yaml`).
   */
  lane_id: string;
  /**
   * Specialist name (the 14-specialist vocab or custom; matches `task_run.specialist`).
   */
  specialist: string;
  /**
   * Host brand for this lane's executing pane (additive optional; absent implies
   * "claude"). Stored here so the liveness sweep can attribute a stall to its host
   * without re-reading the pane-team descriptor.
   */
  host_kind?: HostKind;
  /**
   * Current lane status. Maps onto the `guild.run_state.v1` lane status enum.
   * Updated on every run-state transition.
   */
  status: LaneStatusValue;
  /**
   * RFC-3339 UTC timestamp of the most recent heartbeat write. Supplied by the
   * caller (never Date.now() in this module). Used by the tier-scaled stall
   * detector (`cheap` 3 min / `mid` 10 min / `powerful` 20 min thresholds).
   */
  heartbeat_at: string;
  /**
   * Human-readable label for the current execution step (optional). Emitted by
   * the PostToolUse hook's step-tracker. Used in `guild:status` progress display.
   * Example: "Implementing POST /auth endpoint".
   */
  current_step?: string | null;
  /**
   * Estimated percent-complete (0–100, optional). Advisory — the hook fills this
   * when the agent emits a structured progress marker. Absent implies unknown.
   */
  pct_complete?: number | null;
  /**
   * Retry attempt counter (1-based; absent implies first attempt). Matches the
   * `attempt` field in `guild.run_state.v1.lanes[lane_id]`.
   */
  attempt?: number | null;
}

// ── Validator return type ─────────────────────────────────────────────────────

/**
 * Validation result returned by `validateTmuxTeam` and `validateLaneStatus`.
 * Follows the `{valid, errors}` pattern used across scripts/lib.
 */
export interface ValidationResult {
  valid: boolean;
  /** Human-readable error strings (empty when valid). */
  errors: string[];
}

// ── validateTmuxTeam ──────────────────────────────────────────────────────────

/**
 * Validate a `guild.tmux_team.v1` artifact.
 *
 * **Rules:**
 *   1. `schema_version` must equal `guild.tmux_team.v1`.
 *   2. `run_id`, `session_name`, and `orchestrator_pane_id` must be non-empty strings.
 *   3. `mode` must be "new-session" or "in-session".
 *   4. `created_at` must be a non-empty string (RFC-3339 format; content not
 *      parsed — callers supply it, out-of-range dates fail their own validation).
 *   5. `panes` must be an array (may be empty — the launcher checks for zero
 *      specialists before writing, but the contract itself allows an empty array
 *      for forward-compat with partial-team descriptors).
 *   6. Each pane entry must have a non-empty string `specialist` and `pane_id`.
 *   7. `mixed_host` must be a boolean.
 *   8. Extra/unknown top-level fields are silently accepted (lenient-reader rule).
 *
 * @param artifact - The raw (possibly untrusted) parsed YAML/JSON object.
 * @returns `{valid: true, errors: []}` on success, `{valid: false, errors: [...]}` on failure.
 */
export function validateTmuxTeam(artifact: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
    return { valid: false, errors: ["artifact must be a non-null object"] };
  }

  const obj = artifact as Record<string, unknown>;

  // Rule 1: schema_version
  if (obj["schema_version"] !== TMUX_TEAM_SCHEMA_VERSION) {
    errors.push(
      `schema_version must be "${TMUX_TEAM_SCHEMA_VERSION}"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }

  // Rule 2: required string scalars
  for (const key of ["run_id", "session_name", "orchestrator_pane_id"] as const) {
    if (typeof obj[key] !== "string" || (obj[key] as string).length === 0) {
      errors.push(`"${key}" must be a non-empty string`);
    }
  }

  // Rule 3: mode
  if (obj["mode"] !== "new-session" && obj["mode"] !== "in-session") {
    errors.push(`"mode" must be "new-session" or "in-session"; got ${JSON.stringify(obj["mode"])}`);
  }

  // Rule 4: created_at
  if (typeof obj["created_at"] !== "string" || (obj["created_at"] as string).length === 0) {
    errors.push('"created_at" must be a non-empty string (RFC-3339)');
  }

  // Rule 5: panes array
  if (!Array.isArray(obj["panes"])) {
    errors.push('"panes" must be an array');
  } else {
    // Rule 6: each pane entry
    const panes = obj["panes"] as unknown[];
    for (let i = 0; i < panes.length; i++) {
      const pane = panes[i];
      if (typeof pane !== "object" || pane === null || Array.isArray(pane)) {
        errors.push(`panes[${i}] must be a non-null object`);
        continue;
      }
      const p = pane as Record<string, unknown>;
      if (typeof p["specialist"] !== "string" || (p["specialist"] as string).length === 0) {
        errors.push(`panes[${i}].specialist must be a non-empty string`);
      }
      if (typeof p["pane_id"] !== "string" || (p["pane_id"] as string).length === 0) {
        errors.push(`panes[${i}].pane_id must be a non-empty string`);
      }
    }
  }

  // Rule 7: mixed_host
  if (typeof obj["mixed_host"] !== "boolean") {
    errors.push(`"mixed_host" must be a boolean; got ${JSON.stringify(obj["mixed_host"])}`);
  }

  return { valid: errors.length === 0, errors };
}

// ── validateLaneStatus ────────────────────────────────────────────────────────

/**
 * Validate a `guild.lane_status.v1` artifact.
 *
 * **Rules:**
 *   1. `schema_version` must equal `guild.lane_status.v1`.
 *   2. `run_id`, `lane_id`, and `specialist` must be non-empty strings.
 *   3. `status` must be one of the `LANE_STATUS_VALUES` closed enum values.
 *   4. `heartbeat_at` must be a non-empty string (RFC-3339; content not parsed).
 *   5. `pct_complete`, when present and non-null, must be a number in [0, 100].
 *   6. `attempt`, when present and non-null, must be a positive integer (≥1).
 *   7. Extra/unknown top-level fields are silently accepted (lenient-reader rule).
 *
 * @param artifact - The raw (possibly untrusted) parsed YAML/JSON object.
 * @returns `{valid: true, errors: []}` on success, `{valid: false, errors: [...]}` on failure.
 */
export function validateLaneStatus(artifact: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof artifact !== "object" || artifact === null || Array.isArray(artifact)) {
    return { valid: false, errors: ["artifact must be a non-null object"] };
  }

  const obj = artifact as Record<string, unknown>;

  // Rule 1: schema_version
  if (obj["schema_version"] !== LANE_STATUS_SCHEMA_VERSION) {
    errors.push(
      `schema_version must be "${LANE_STATUS_SCHEMA_VERSION}"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }

  // Rule 2: required string scalars
  for (const key of ["run_id", "lane_id", "specialist"] as const) {
    if (typeof obj[key] !== "string" || (obj[key] as string).length === 0) {
      errors.push(`"${key}" must be a non-empty string`);
    }
  }

  // Rule 3: status enum
  if (!LANE_STATUS_VALUES.includes(obj["status"] as LaneStatusValue)) {
    errors.push(
      `"status" must be one of [${LANE_STATUS_VALUES.join(", ")}]; got ${JSON.stringify(obj["status"])}`
    );
  }

  // Rule 4: heartbeat_at
  if (typeof obj["heartbeat_at"] !== "string" || (obj["heartbeat_at"] as string).length === 0) {
    errors.push('"heartbeat_at" must be a non-empty string (RFC-3339)');
  }

  // Rule 5: pct_complete — optional, but when present+non-null must be [0,100]
  if (obj["pct_complete"] !== undefined && obj["pct_complete"] !== null) {
    const pct = obj["pct_complete"];
    if (typeof pct !== "number" || pct < 0 || pct > 100) {
      errors.push(`"pct_complete" must be a number in [0, 100]; got ${JSON.stringify(pct)}`);
    }
  }

  // Rule 6: attempt — optional, but when present+non-null must be a positive integer
  if (obj["attempt"] !== undefined && obj["attempt"] !== null) {
    const att = obj["attempt"];
    if (typeof att !== "number" || !Number.isInteger(att) || att < 1) {
      errors.push(`"attempt" must be a positive integer (≥1); got ${JSON.stringify(att)}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── Type predicates ───────────────────────────────────────────────────────────

/**
 * Type predicate: returns `true` when `artifact` passes `validateTmuxTeam`.
 * Safe to use as a narrowing guard: `if (isTmuxTeam(raw)) { ... }`.
 */
export function isTmuxTeam(artifact: unknown): artifact is TmuxTeam {
  return validateTmuxTeam(artifact).valid;
}

/**
 * Type predicate: returns `true` when `artifact` passes `validateLaneStatus`.
 * Safe to use as a narrowing guard: `if (isLaneStatus(raw)) { ... }`.
 */
export function isLaneStatus(artifact: unknown): artifact is LaneStatus {
  return validateLaneStatus(artifact).valid;
}

// ── CLI harness (ad-hoc inspection only; never imported) ─────────────────────

/* istanbul ignore next */
if (require.main === module) {
  const ts = new Date().toISOString();
  const runId = `run-${ts.replace(/[:.]/g, "-")}`;

  const sampleTeam: TmuxTeam = {
    schema_version: TMUX_TEAM_SCHEMA_VERSION,
    run_id: runId,
    session_name: `guild-example-${ts.replace(/[:.]/g, "-")}`,
    mode: "new-session",
    created_at: ts,
    orchestrator_pane_id: "%0",
    mixed_host: true,
    panes: [
      { specialist: "architect", pane_id: "%1", host_kind: "claude", adapter_version: "1" },
      { specialist: "backend", pane_id: "%2", host_kind: "codex", adapter_version: "1" },
    ],
  };

  const sampleLane: LaneStatus = {
    schema_version: LANE_STATUS_SCHEMA_VERSION,
    run_id: runId,
    lane_id: "backend-api-001",
    specialist: "backend",
    host_kind: "codex",
    status: "in_progress",
    heartbeat_at: ts,
    current_step: "Implementing POST /auth endpoint",
    pct_complete: 40,
    attempt: 1,
  };

  process.stdout.write("guild.tmux_team.v1 sample:\n");
  process.stdout.write(JSON.stringify(sampleTeam, null, 2) + "\n");
  process.stdout.write("\nvalidation: " + JSON.stringify(validateTmuxTeam(sampleTeam)) + "\n\n");

  process.stdout.write("guild.lane_status.v1 sample:\n");
  process.stdout.write(JSON.stringify(sampleLane, null, 2) + "\n");
  process.stdout.write("\nvalidation: " + JSON.stringify(validateLaneStatus(sampleLane)) + "\n");
}
