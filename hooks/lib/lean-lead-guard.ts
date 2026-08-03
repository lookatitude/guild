/**
 * hooks/lib/lean-lead-guard.ts
 *
 * Advisory guard — OIR issue #57 / work-item oir-wi-57.
 *
 * Codifies the EXPIRY half of `skills/meta/execute-plan/SKILL.md
 * §"Inline shortcut under high autonomy"` in code: the inline shortcut
 * (lead does context-assemble → dispatch → review itself instead of formal
 * sub-skill invocation) lapses after `N` direct lead Edit/Write operations OR
 * at any compaction boundary. This module is the DETECTION half. The Stop
 * hook (`hooks/lean-lead-guard.ts`) that calls it surfaces a dismissible
 * advisory when the budget is exceeded WHILE the active run still has open
 * (dispatched-but-not-terminal) lanes. "Advisory" means it never denies a
 * tool call and never demands a specific corrective action — but see the
 * note below on what the Stop `additionalContext` primitive actually does.
 *
 * Every signal here is real, already-wired telemetry — nothing new is
 * bookkept:
 *   - "Open lanes"    → `guild.run_state.v1` (`./run-state.js`, ADR-RE-1).
 *     `lanes[*].status` is written by the real dispatch path (agent-team
 *     launcher / TaskCreated hook seeds `in_progress`; TaskCompleted /
 *     `markLaneDead` terminate it `done|failed|dead|skipped`). A run with no
 *     run-state.json (no lane ever dispatched under this run) has zero open
 *     lanes by construction — the guard is then silent (zero-noise, nothing
 *     to protect).
 *   - "Lead hands-on edits" → `guild.trace_event.v2` `tool_call` events in
 *     `<runDir>/logs/v1.4-events.jsonl` (`post-tool-use.ts`, unconditional —
 *     runs regardless of backend). A `tool_call` carries `lane_id` when
 *     either `GUILD_LANE_ID` OR (the real, actually-threaded env var on every
 *     shipped dispatch backend — inprocess-backend.ts, tmux-backend.ts,
 *     pane-adapter.ts) `GUILD_TASK_ID` was set in the emitting process's
 *     environment (`post-tool-use.ts`, oir-wi-57 fix — `GUILD_LANE_ID` alone
 *     has zero producers anywhere in this codebase and would make `lane_id`
 *     permanently absent on every real tool_call, lead or lane alike). The
 *     LEAD's own session has neither set, so a `tool_call` with `tool` in
 *     {Edit, Write} and no `lane_id` is, by construction, the lead editing
 *     directly rather than a dispatched lane's own work.
 *   - "Compaction boundary" → the `hook_event` `PreCompact` line
 *     `hooks/pre-compact.ts` appends unconditionally for every compaction of
 *     an active run. `pre-compact.ts` is ALSO globally registered, so it
 *     fires inside every dispatched specialist's own session too; it stamps
 *     the SAME `lane_id` attribution as `post-tool-use.ts` (oir-wi-57 round-3
 *     fix), and only a LANE-LESS PreCompact (the lead's own) anchors the
 *     counting window — an unrelated worker's own compaction has no bearing
 *     on the lead's budget.
 *   - The orphan-sweep sentinel (`status: "err"` +
 *     `result_excerpt_redacted === ORPHAN_RESULT_EXCERPT`, emitted by
 *     `post-tool-use.ts`'s stale-sidecar sweep) is EXCLUDED from the
 *     hands-on-edit count outright. `pre-tool-use.ts` (out of scope here)
 *     never stamps its sidecar "pre" entry with attribution, so an orphaned
 *     entry — one whose PostToolUse never arrived within the sweep window —
 *     is unrecoverably lane-less even when it really was a dispatched
 *     worker's stalled call; excluding it trades a rare missed lead edit for
 *     never mis-attributing a stale lane worker's orphan to the lead.
 *
 * Compaction semantics (NOT a fresh N-edit allowance). The SKILL.md contract
 * is "N edits OR any compaction boundary" — a disjunction, not "the budget
 * resets to N after each compaction." `hooks/session-reanchor.ts` already
 * re-injects the lean-lead/dispatch-by-pointer contract into the very next
 * post-compaction context, so continuing to edit inline afterward is already
 * a fresh violation on its own, independent of N. `decideCrossing` therefore
 * fires on the FIRST hands-on edit of a new post-compaction cycle, then falls
 * back to the ordinary every-N-edits cadence for the rest of that cycle (so
 * it still does not nag on every single subsequent turn). The very first
 * cycle of a run that has never compacted is not a "boundary" and keeps the
 * plain N-edit budget throughout.
 *
 * Fire-once discipline: edge-triggered on THRESHOLD MULTIPLES (or on the
 * immediate post-compaction edit, see above), not level-triggered — it does
 * not re-fire every Stop turn once the count is over threshold with no new
 * lead edits, but DOES re-arm on the next crossing. A prior state whose
 * `anchor_ts` differs from the current one belongs to a discarded cycle; a
 * prior state whose recorded count EXCEEDS the current count is internally
 * inconsistent (impossible under honest monotonic counting within one cycle)
 * and is likewise discarded rather than trusted — a corrupted or hand-edited
 * sentinel must never be able to permanently suppress the guard.
 *
 * Run-id handling: the caller-supplied `runId` is validated (`validateRunId`
 * — path-traversal safety — AND `safeIdent` — render safety, since the id is
 * interpolated into the advisory the model reads) before it touches the
 * filesystem or the rendered text, mirroring `hooks/lib/reanchor.ts`'s
 * untrusted-workspace-state discipline. `GUILD_RUN_DIR` is honored when set
 * (matching `post-tool-use.ts`'s own resolution), and every trace event is
 * additionally filtered to `event.run_id === runId` — defense in depth
 * against a misconfigured/shared run directory ever mixing another run's
 * edits or compaction anchor into this one's count.
 *
 * LEAD-ONLY invocation gate (oir-wi-57 round-2 fix). The Stop hook that calls
 * this is registered globally in hooks.json, so it ALSO fires inside every
 * dispatched specialist's own pane/subagent session — a completely separate
 * Claude Code process that shares the SAME run directory (and therefore the
 * SAME `lean-lead-advisory-state.json` fire-once sentinel) as the lead. Left
 * unguarded, a specialist pane's own Stop hook would evaluate the identical
 * shared state, could fire (or silently consume) the ONE advisory meant for
 * the lead, and would never be seen by the actual lead at all. This function
 * therefore first checks THIS INVOCATION's own environment — if `GUILD_TASK_ID`
 * or `GUILD_LANE_ID` is set, the calling process IS a dispatched lane worker,
 * not the lead, and the guard is silent AND makes no state read/write at all
 * (not even a read of `run-state.json`), so a lane worker's own Stop hook can
 * never observe or perturb the lead's fire-once bookkeeping.
 *
 * Explicit override: `GUILD_LEAN_LEAD_OVERRIDE=1` (checked by the caller,
 * mirrors the existing `GUILD_ALLOW_PUSH_MAIN=1`-style escape-hatch
 * convention in this repo) suppresses the guard outright for the session.
 *
 * Runner: bundled into dist/lean-lead-guard.js via esbuild (hooks/package.json).
 * Tests: hooks/lib/__tests__/lean-lead-guard.test.ts (real on-disk fixtures).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { loadRunState } from "./run-state.js";
import { readAllEvents, ORPHAN_RESULT_EXCERPT } from "./v1.4/log-jsonl.js";
import { safeIdent } from "./reanchor.js";
import { isWorkerInvocation } from "./lane-attribution.js";
import { validateRunId } from "../../scripts/lib/run-lifecycle.js";
// rf-wi-01 (v23x-deferred-followups G1): the canonical `defaults.lean_lead.*` default
// values (single source of truth — scripts/lib/config-schema.ts CONFIG_SCHEMA derives
// from this SAME tree), so this guard's fallback can never drift from what
// `config validate/resolve/show` report as the documented default. Pure data, zero
// internal deps (config-defaults.ts's own contract) — safe to bundle into hooks/dist/.
import { DEFAULTS as CONFIG_DEFAULTS } from "../../scripts/lib/shared/config-defaults.js";

/** Stable marker string — pinned by tests and the dist-grep rail. */
export const LEAN_LEAD_MARKER = "[GUILD LEAN-LEAD]";

/** Sane default: after 8 direct lead Edit/Write ops, surface the advisory (schema SoT). */
// Widened explicitly: CONFIG_DEFAULTS is `as const`, so its property types are the
// narrow literals `true`/`8` — annotate so `let enabled/threshold` below can hold any
// boolean/number the settings.json override resolves to.
const DEFAULT_THRESHOLD: number = CONFIG_DEFAULTS.defaults.lean_lead.hands_on_edit_threshold;
const DEFAULT_ENABLED: boolean = CONFIG_DEFAULTS.defaults.lean_lead.enabled;

/** Lane statuses that count as "open" — dispatched or seeded, not yet terminal. */
const OPEN_LANE_STATUSES = new Set(["pending", "in_progress"]);

/** Tools that count as "hands-on" lead work (matches ToolCallTool values). */
const HANDS_ON_TOOLS = new Set(["Edit", "Write"]);

/** Schema tag for the advisory-state sentinel (fire-once bookkeeping). */
const ADVISORY_STATE_SCHEMA = "guild.lean_lead_advisory.v1" as const;

export interface LeanLeadConfig {
  enabled: boolean;
  threshold: number;
}

/**
 * Reader for `defaults.lean_lead.*` — degrades to the documented default
 * (enabled, threshold=8) on ANY failure, never throws. The threshold must be a
 * positive INTEGER — a fractional value (e.g. `0.5`) would floor to 0 and
 * defeat every downstream `count >= threshold` / `count / threshold` check, so
 * it is rejected rather than silently coerced.
 *
 * rf-wi-01 (G1 codex-review round-2 fix, P1): delegates to the canonical
 * `resolveSettings()` — the SAME 5-layer resolver `config show`/`config resolve`
 * use (builtin < workspace settings.json < workspace settings.local.json <
 * project settings.json < project settings.local.json < CLI flags) — rather
 * than a hand-rolled project-file-only read. The round-1 fix (settings.json +
 * settings.local.json, applied in order) still missed WORKSPACE-level
 * inheritance: a workspace child's `defaults.lean_lead` override in the
 * PARENT workspace's settings.json was invisible to this guard even though
 * `resolveSettings()` (and therefore `config show`) sees it. Mirrors the
 * established precedent in hooks/update-check.ts's `readUpdateConfig` (itself
 * fixing an identical prior "workspace default not honored" finding) — a
 * lazy `require()` (not a static import) so a require failure degrades
 * gracefully inside the same try/catch, matching that file's style.
 */
export function readLeanLeadConfig(guildRoot: string): LeanLeadConfig {
  try {
    const { resolveSettings } = require("../../src/modules/config/workflows/settings-resolver") as {
      resolveSettings: (o: { cwd: string }) => { config: Record<string, unknown> };
    };
    const parsed = resolveSettings({ cwd: guildRoot }).config as {
      defaults?: { lean_lead?: { enabled?: unknown; hands_on_edit_threshold?: unknown } };
    };
    const ll = parsed.defaults?.lean_lead ?? {};
    const enabled = typeof ll.enabled === "boolean" ? ll.enabled : DEFAULT_ENABLED;
    const threshold =
      typeof ll.hands_on_edit_threshold === "number" &&
      Number.isInteger(ll.hands_on_edit_threshold) &&
      ll.hands_on_edit_threshold >= 1
        ? ll.hands_on_edit_threshold
        : DEFAULT_THRESHOLD;
    return { enabled, threshold };
  } catch {
    return { enabled: DEFAULT_ENABLED, threshold: DEFAULT_THRESHOLD };
  }
}

/** True when the operator has explicitly dismissed the guard for this session. */
export function isOverridden(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["GUILD_LEAN_LEAD_OVERRIDE"] === "1";
}

/**
 * Count lanes recorded in `run-state.json` that are neither dispatched-yet
 * nor terminal. Returns 0 when run-state.json is absent/corrupt (rebuildable
 * cache — see `hooks/lib/run-state.ts`) — a run with no lane checkpoint has
 * nothing this guard needs to protect.
 */
export function countOpenLanes(runDir: string): number {
  const state = loadRunState(runDir);
  if (state === null) return 0;
  let count = 0;
  for (const lane of Object.values(state.lanes)) {
    if (OPEN_LANE_STATUSES.has(lane.status)) count++;
  }
  return count;
}

export interface HandsOnEditResult {
  /** Direct lead Edit/Write tool_call count since `anchorTs` (exclusive). */
  count: number;
  /** ts of the most recent PreCompact hook_event, or null if none recorded. */
  anchorTs: string | null;
}

/**
 * Scan the run's v1.4 JSONL trace (live + archives, via `readAllEvents`),
 * filtered to `event.run_id === runId` (defense in depth against a shared or
 * misrouted run directory), for:
 *   1. the most recent LEAD-OWN compaction boundary (`hook_event` /
 *      `PreCompact` with NO `lane_id`) — `hooks/pre-compact.ts` is ALSO a
 *      globally-registered hook, so it fires inside every dispatched
 *      specialist's own session too; a worker's own compaction has no
 *      bearing on the lead's budget and is skipped via its `lane_id` stamp
 *      (oir-wi-57 round-3 fix), and
 *   2. the count of `tool_call` events with `tool` in {Edit, Write} and no
 *      `lane_id` (the lead's own direct mutations) strictly after that
 *      boundary — EXCLUDING the canonical orphan-sweep sentinel (`status:
 *      "err"` + `result_excerpt_redacted === ORPHAN_RESULT_EXCERPT`). An
 *      orphaned entry can only ever be a DEGRADED signal (pre-tool-use.ts,
 *      out of scope here, never stamped it with attribution in the first
 *      place, so it is unrecoverably lane-less by construction) — excluding
 *      it trades a rare missed lead edit for never mis-attributing a stale
 *      lane worker's orphaned entry to the lead.
 * No boundary recorded yet ⇒ count from the start of the log (run start).
 *
 * Ordering is by ARRAY POSITION (append order) in the array `readAllEvents`
 * returns, NEVER by comparing `ts` values. The v1.4 schema's own §6.2
 * contract: "Append-order is the PRIMARY key; ts is the tie-breaker for
 * same-millisecond events from parallel processes" — i.e. ts is not even a
 * valid ordering key on its own. A millisecond-comparison anchor (`ms <=
 * anchorMs`) would wrongly discard a same-millisecond post-compaction edit;
 * comparing array indices instead sidesteps timestamp precision entirely.
 */
export async function countHandsOnEdits(runDir: string, runId: string): Promise<HandsOnEditResult> {
  const events = await readAllEvents(runDir);

  // Iterating forward and unconditionally overwriting on every match keeps
  // the LAST (append-order-latest) LEAD-OWN PreCompact for this run — no ts
  // compare, and a worker's own (lane_id-stamped) compaction never anchors.
  let anchorIndex = -1;
  let anchorTs: string | null = null;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.event !== "hook_event" || event.hook_name !== "PreCompact") continue;
    if (event.run_id !== runId) continue;
    if (event.lane_id !== undefined) continue; // a dispatched worker's own compaction, not the lead's
    anchorIndex = i;
    anchorTs = event.ts;
  }

  let count = 0;
  for (let i = anchorIndex + 1; i < events.length; i++) {
    const event = events[i];
    if (event.event !== "tool_call") continue;
    if (event.run_id !== runId) continue;
    if (!HANDS_ON_TOOLS.has(event.tool)) continue;
    if (event.lane_id !== undefined) continue; // a lane worker's own edit, not the lead's
    if (event.status === "err" && event.result_excerpt_redacted === ORPHAN_RESULT_EXCERPT) continue;
    count++;
  }

  return { count, anchorTs };
}

/** Fire-once bookkeeping persisted at `<runDir>/lean-lead-advisory-state.json`. */
export interface LeanLeadAdvisoryState {
  schema_version: typeof ADVISORY_STATE_SCHEMA;
  /** The compaction-boundary anchor this bookkeeping was computed against. */
  anchor_ts: string | null;
  /** The hands-on-edit count at which the advisory last fired. */
  last_fired_at_count: number;
}

function advisoryStatePath(runDir: string): string {
  return path.join(runDir, "lean-lead-advisory-state.json");
}

/**
 * Read the fire-once sentinel. Returns null when absent/corrupt/nonsensical
 * (fresh start) — a negative or non-finite `last_fired_at_count` cannot come
 * from honest bookkeeping (see `writeAdvisoryState`), so it is discarded
 * rather than trusted.
 */
export function loadAdvisoryState(runDir: string): LeanLeadAdvisoryState | null {
  try {
    const raw = fs.readFileSync(advisoryStatePath(runDir), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed["schema_version"] !== ADVISORY_STATE_SCHEMA) return null;
    const anchorTs = parsed["anchor_ts"];
    const lastFired = parsed["last_fired_at_count"];
    if (typeof lastFired !== "number" || !Number.isFinite(lastFired) || lastFired < 0) return null;
    return {
      schema_version: ADVISORY_STATE_SCHEMA,
      anchor_ts: typeof anchorTs === "string" ? anchorTs : null,
      last_fired_at_count: lastFired,
    };
  } catch {
    return null;
  }
}

/** Atomic write-temp-then-rename, mirroring `run-state.ts writeRunStateAtomic`. */
export function writeAdvisoryState(runDir: string, state: LeanLeadAdvisoryState): void {
  fs.mkdirSync(runDir, { recursive: true });
  const finalPath = advisoryStatePath(runDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  try {
    fs.renameSync(tmpPath, finalPath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* best-effort */
    }
    throw err;
  }
}

export interface CrossingDecision {
  shouldFire: boolean;
  nextState: LeanLeadAdvisoryState;
}

/**
 * Edge-trigger the advisory. Two regimes:
 *
 *   - A FRESH post-compaction cycle (this run has compacted before AND the
 *     anchor just changed) fires on the FIRST hands-on edit (count >= 1) —
 *     the compaction boundary is itself already the violation ("N edits OR
 *     any compaction boundary"; no fresh N-edit grace period is owed).
 *   - Every other case (the run's pre-compaction genesis cycle, or a later
 *     check within an already-fired post-compaction cycle) uses the ordinary
 *     every-N-edits cadence (`floor(count/threshold) > floor(priorCount/threshold)`).
 *
 * A prior state is trusted as "same cycle" only when its `anchor_ts` matches
 * AND its recorded count does not exceed the current count — a persisted
 * count greater than what is actually observed now is internally impossible
 * under honest monotonic counting and is treated as corrupt/stale rather
 * than as a reason to stay silent forever.
 */
export function decideCrossing(
  count: number,
  threshold: number,
  anchorTs: string | null,
  priorState: LeanLeadAdvisoryState | null,
): CrossingDecision {
  const sameCycle =
    priorState !== null &&
    priorState.anchor_ts === anchorTs &&
    priorState.last_fired_at_count <= count;
  const priorCount = sameCycle ? priorState.last_fired_at_count : 0;
  const isFreshPostCompactionCycle = anchorTs !== null && !sameCycle;

  const crossed = isFreshPostCompactionCycle
    ? count >= 1
    : count >= threshold && Math.floor(count / threshold) > Math.floor(priorCount / threshold);

  if (!crossed) {
    return {
      shouldFire: false,
      nextState: sameCycle
        ? (priorState as LeanLeadAdvisoryState)
        : { schema_version: ADVISORY_STATE_SCHEMA, anchor_ts: anchorTs, last_fired_at_count: priorCount },
    };
  }
  return {
    shouldFire: true,
    nextState: { schema_version: ADVISORY_STATE_SCHEMA, anchor_ts: anchorTs, last_fired_at_count: count },
  };
}

/** Render the advisory body (pure — pinned by tests). `runId` must already be sanitized. */
export function renderLeanLeadAdvisory(
  runId: string,
  count: number,
  threshold: number,
  openLanes: number,
): string {
  return [
    `${LEAN_LEAD_MARKER} inline shortcut expired on run ${runId} — ${count} direct lead ` +
      `Edit/Write ops (threshold ${threshold}) while ${openLanes} lane(s) are still open.`,
    "- Re-enter formal dispatch: invoke guild:execute-plan (or guild:resume) instead of continuing inline.",
    "- Intentional? Dismiss for this session with GUILD_LEAN_LEAD_OVERRIDE=1.",
  ].join("\n");
}

/**
 * Full evaluation: run-id validation → config → override → open-lanes gate →
 * threshold gate → fire-once gate. Returns `{ advisory: null }` at the first
 * gate that says "stay silent" (zero-noise contract) and never throws — a
 * scan failure degrades to silence, mirroring every other advisory hook in
 * this repo.
 */
export async function evaluateLeanLeadGuard(
  guildRoot: string,
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ advisory: string | null }> {
  // LEAD-ONLY gate — see the header note. A Stop hook firing inside a
  // dispatched lane worker's own session (identified by ITS OWN env, never
  // the lead's) must not read or write the shared per-run fire-once state.
  if (isWorkerInvocation(env)) return { advisory: null };

  // The run-id is workspace-controlled (env var or a sentinel file) — never
  // trust it into a path or into model-visible text unvalidated. validateRunId
  // guards path-traversal; safeIdent additionally guards render safety (no
  // newlines/control chars a malicious sentinel could use to inject
  // instructions into the advisory), mirroring hooks/lib/reanchor.ts.
  if (!validateRunId(runId)) return { advisory: null };
  const safeRunId = safeIdent(runId);
  if (safeRunId === null) return { advisory: null };

  const config = readLeanLeadConfig(guildRoot);
  if (!config.enabled || isOverridden(env)) return { advisory: null };

  const runDir = env["GUILD_RUN_DIR"] ?? path.join(guildRoot, ".guild", "runs", safeRunId);
  const openLanes = countOpenLanes(runDir);
  if (openLanes === 0) return { advisory: null };

  const { count, anchorTs } = await countHandsOnEdits(runDir, safeRunId);
  if (count === 0) return { advisory: null };

  const priorState = loadAdvisoryState(runDir);
  const decision = decideCrossing(count, config.threshold, anchorTs, priorState);
  if (!decision.shouldFire) return { advisory: null };

  writeAdvisoryState(runDir, decision.nextState);
  return { advisory: renderLeanLeadAdvisory(safeRunId, count, config.threshold, openLanes) };
}
