/**
 * hooks/lib/heartbeat.ts
 *
 * Structured liveness heartbeat (ADR-RE-3) — the replacement for the `mtime`
 * stall heuristic in `teammate-idle.ts`.
 *
 * ── BIND BY POINTER ────────────────────────────────────────────────────────
 * Canonical decision + rationale: ADR: v2-runtime-and-execution-model (workspace wiki)
 *   §ADR-RE-3 ("Structured heartbeat protocol"). This module realizes that
 *   decision; it does NOT re-spell the rationale.
 *
 * What it is (per ADR-RE-3):
 *   - The agent writes `<runDir>/in-progress/<specialist>.json` on each
 *     significant action: `{ timestamp, step, pct_complete, last_action }`.
 *   - `teammate-idle.ts` parses that record's `timestamp` (vs now) instead of
 *     the legacy `.log` file's `mtime`.
 *   - Stale threshold is configurable via `defaults.heartbeat_timeout_ms`
 *     (default 600000 = 10 min — preserves today's threshold; closed-key
 *     `settings.json`, validator owned by config-surface).
 *   - Backward-compat: fall back to the legacy `<specialist>.log` `mtime` when
 *     the JSON record is absent (no hard cutover).
 *
 * ── SCOPE BOUNDARY (do not conflate with O-3) ───────────────────────────────
 * This heartbeat governs LIVENESS / STALL detection ONLY ("am I alive?"). It is
 * NOT the deferred "anomalously short output" QUALITY-escalation heuristic
 * (cost-aware-tiering-and-lean-context.md O-3 → DEFER). Liveness and
 * output-quality escalation are distinct signals; this module resolves the
 * first and leaves O-3 deferred exactly as locked. Nothing here reads or scores
 * output length.
 *
 * OQ-4: the heartbeat record is an UNVERSIONED operational artifact for now
 * (simplicity-first); promote to a `guild.heartbeat.v1` sibling only if a
 * cross-host / telemetry consumer needs a stable contract.
 *
 * Tests: hooks/lib/__tests__/heartbeat.test.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolveGuildRoot } from "./guild-root.js";
import { loadRunState, type LaneTier } from "./run-state.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Default stall threshold — 10 min. Preserves the pre-RE-3 behavior. */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * G-10 (SC-5): tier-scaled idle-timeout defaults. A cheap lane that goes
 * quiet for 3 minutes is probably stalled; a powerful lane legitimately
 * thinks for far longer. `mid` deliberately equals
 * DEFAULT_HEARTBEAT_TIMEOUT_MS so the fallback path is byte-identical to
 * the pre-G-10 behavior.
 *
 * Precedence (resolveHeartbeatTimeoutMs): an EXPLICIT
 * `defaults.heartbeat_timeout_ms` in settings.json WINS over this map.
 */
export const TIER_HEARTBEAT_TIMEOUTS_MS: Record<LaneTier, number> = {
  cheap: 180_000, // 3 min
  mid: 600_000, // 10 min — equals DEFAULT_HEARTBEAT_TIMEOUT_MS
  powerful: 1_200_000, // 20 min
};

/** True iff `t` is a valid lane tier token. */
function isLaneTier(t: unknown): t is LaneTier {
  return t === "cheap" || t === "mid" || t === "powerful";
}

// ── Types ──────────────────────────────────────────────────────────────────

/** Structured heartbeat record (unversioned operational artifact, OQ-4). */
export interface Heartbeat {
  /** Required. ISO-8601 last-progress timestamp. */
  timestamp: string;
  /** Phase / step label (e.g. "writing tests", "implementing"). */
  step?: string;
  /** Coarse progress 0–100. */
  pct_complete?: number;
  /** Short free-text description of the most recent action. */
  last_action?: string;
}

/** Source the liveness verdict was derived from. */
export type LivenessSource = "heartbeat" | "mtime" | "none";

/** Structured liveness verdict for the orchestrator nudge. */
export interface Liveness {
  /** Which signal produced the verdict. */
  source: LivenessSource;
  /** True when the agent looks alive (signal age < timeout). */
  fresh: boolean;
  /** Age of the freshest signal in ms; null when no signal exists. */
  ageMs: number | null;
  /** Phase from the structured heartbeat, when available. */
  step?: string;
  /** pct_complete from the structured heartbeat, when available. */
  pctComplete?: number;
}

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Structured heartbeat path: `<runDir>/in-progress/<specialist>.json`. */
export function heartbeatPath(runDir: string, specialist: string): string {
  return path.join(runDir, "in-progress", `${specialist}.json`);
}

/** Legacy `mtime` fallback path: `<runDir>/in-progress/<specialist>.log`. */
export function legacyLogPath(runDir: string, specialist: string): string {
  return path.join(runDir, "in-progress", `${specialist}.log`);
}

// ── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read + parse the structured heartbeat. Returns null when absent, corrupt, or
 * missing a usable `timestamp` (callers then fall back to `mtime`). Never
 * throws.
 */
export function readHeartbeat(runDir: string, specialist: string): Heartbeat | null {
  let raw: string;
  try {
    raw = fs.readFileSync(heartbeatPath(runDir, specialist), "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj["timestamp"] !== "string" || obj["timestamp"].trim() === "") {
    return null;
  }
  const hb: Heartbeat = { timestamp: obj["timestamp"] };
  if (typeof obj["step"] === "string") hb.step = obj["step"];
  if (typeof obj["pct_complete"] === "number") hb.pct_complete = obj["pct_complete"];
  if (typeof obj["last_action"] === "string") hb.last_action = obj["last_action"];
  return hb;
}

// ── Config ─────────────────────────────────────────────────────────────────────

/**
 * Read `defaults.heartbeat_timeout_ms` from `<root>/.guild/settings.json`
 * (root via resolveGuildRoot). Tolerant runtime reader: returns the documented
 * default on any failure or a non-positive / non-numeric value. The closed-key
 * validator is owned by config-surface; this is NOT it.
 */
export function readHeartbeatTimeoutMs(cwd: string): number {
  return readExplicitHeartbeatTimeoutMs(cwd) ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
}

/**
 * G-10: read the EXPLICIT `defaults.heartbeat_timeout_ms` from
 * `<root>/.guild/settings.json`, or null when absent / unreadable / invalid.
 * The null case is what lets the tier-scaled map apply — an explicitly-set
 * value always wins over the tier defaults (resolveHeartbeatTimeoutMs).
 */
export function readExplicitHeartbeatTimeoutMs(cwd: string): number | null {
  const settingsPath = path.join(resolveGuildRoot(cwd), ".guild", "settings.json");
  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const defaults = (parsed as Record<string, unknown>)["defaults"];
  if (typeof defaults !== "object" || defaults === null || Array.isArray(defaults)) {
    return null;
  }
  const val = (defaults as Record<string, unknown>)["heartbeat_timeout_ms"];
  if (typeof val === "number" && Number.isFinite(val) && val > 0) {
    return val;
  }
  return null;
}

/**
 * G-10: resolve a lane's tier from the run-state checkpoint
 * (`<runDir>/run-state.json`, read via the existing loadRunState reader).
 *
 * Lookup order (first hit wins):
 *   1. `lanes[<taskId>].tier` for each assigned task id, in order — lanes are
 *      keyed by task-id (guild.run_state.v1).
 *   2. `lanes[<specialist>].tier` — covers dispatchers that key lanes by the
 *      specialist/teammate name.
 *
 * Returns null when run-state is absent/corrupt or no lane carries a tier —
 * callers then fall back to `mid` (resolveHeartbeatTimeoutMs). Never throws.
 */
export function resolveLaneTier(
  runDir: string,
  specialist: string,
  assignedTaskIds: readonly string[] = []
): LaneTier | null {
  try {
    const state = loadRunState(runDir);
    if (state === null) return null;
    for (const taskId of assignedTaskIds) {
      const tier = state.lanes[taskId]?.tier;
      if (isLaneTier(tier)) return tier;
    }
    const ownTier = state.lanes[specialist]?.tier;
    if (isLaneTier(ownTier)) return ownTier;
    return null;
  } catch {
    return null;
  }
}

/**
 * G-10 (SC-5): resolve the effective heartbeat/idle timeout.
 *
 * Precedence:
 *   1. EXPLICIT `defaults.heartbeat_timeout_ms` in settings.json — always
 *      wins when present (keeps behavior byte-identical for configs that
 *      already set it).
 *   2. Built-in tier map (TIER_HEARTBEAT_TIMEOUTS_MS) for the lane's tier.
 *   3. Fallback `mid` (600000 ms — identical to the pre-G-10 default) when
 *      the tier is unknown/unresolvable.
 */
export function resolveHeartbeatTimeoutMs(cwd: string, tier?: string | null): number {
  const explicit = readExplicitHeartbeatTimeoutMs(cwd);
  if (explicit !== null) return explicit;
  return TIER_HEARTBEAT_TIMEOUTS_MS[isLaneTier(tier) ? tier : "mid"];
}

// ── Liveness assessment ──────────────────────────────────────────────────────

/**
 * Assess a teammate's liveness from the structured heartbeat, falling back to
 * the legacy `.log` `mtime` when the JSON record is absent (ADR-RE-3
 * backward-compat). `now` is injectable for deterministic tests.
 *
 * - source "heartbeat": parsed JSON `timestamp` drove the verdict.
 * - source "mtime":     JSON absent/corrupt → legacy `.log` mtime drove it.
 * - source "none":      neither signal exists (treated as NOT fresh).
 *
 * `fresh` is `ageMs < timeoutMs`. A future-dated / unparseable heartbeat
 * timestamp clamps `ageMs` to 0 (treated as fresh — a malformed stamp is not
 * proof of a stall).
 */
export function assessLiveness(
  runDir: string,
  specialist: string,
  timeoutMs: number,
  now: number = Date.now()
): Liveness {
  const hb = readHeartbeat(runDir, specialist);
  if (hb) {
    const parsedMs = Date.parse(hb.timestamp);
    const ageMs = Number.isNaN(parsedMs) ? 0 : Math.max(0, now - parsedMs);
    const out: Liveness = {
      source: "heartbeat",
      fresh: ageMs < timeoutMs,
      ageMs,
    };
    if (hb.step !== undefined) out.step = hb.step;
    if (hb.pct_complete !== undefined) out.pctComplete = hb.pct_complete;
    return out;
  }

  // Backward-compat: fall back to the legacy `.log` mtime.
  const logPath = legacyLogPath(runDir, specialist);
  try {
    const stat = fs.statSync(logPath);
    const ageMs = Math.max(0, now - stat.mtimeMs);
    return { source: "mtime", fresh: ageMs < timeoutMs, ageMs };
  } catch {
    return { source: "none", fresh: false, ageMs: null };
  }
}
