/**
 * hooks/lib/lifecycle-gate.ts
 *
 * Gap G7 — OIR issue #59 / work-item oir-wi-59.
 *
 * The forensic finding: a 39-hour session entered the Guild lifecycle
 * (initiative → team-compose → build → execute-plan), then abandoned it 38
 * seconds after its FIRST compaction. For the remaining ~34.7h it ran entirely
 * ad-hoc — 836/909 Bash, 145/188 Edit/Write, 51/54 Agent dispatches all AFTER
 * the last lifecycle skill — and `guild:review`, `guild:verify-done`,
 * `guild:qa`, `guild:reflect` and `guild:resume` were never invoked at all. A
 * production-infra build closed with no review gate and no verify gate.
 *
 * Two un-enforced surfaces let that happen. `hooks/lib/reanchor.ts` (gap G1,
 * oir-wi-00) closed the first — posture is now re-injected after every
 * compact/resume. This module closes the second: lifecycle membership was
 * purely a function of the model CHOOSING to call the next skill, because
 * `hooks/check-skill-coverage.sh` was an advisory domain nudge, not a gate.
 *
 * Two checks, one module, both deterministic code on the real path:
 *
 *   1. `evaluateLifecycleGate` (UserPromptSubmit) — the ACTIVE gate. While a
 *      run is genuinely active and past build-start, it counts the LEAD's own
 *      ad-hoc tool calls since the last time work was actually routed through
 *      the lifecycle, and BLOCKS the prompt once with a pointer back to
 *      `guild:resume` + the next pending gate.
 *   2. `evaluateCloseGate` (Stop) — the close-time backstop. A build run whose
 *      lanes have ALL completed with their own receipts (the moment the run is
 *      about to be considered done) but whose records show no `review.md` /
 *      `verify.md` gets a loud Stop block instead of closing silently. It
 *      re-arms only when the missing SET changes — so it can follow
 *      "review.md landed, verify.md still absent" through to the end — under a
 *      hard per-run fire cap.
 *
 * Every signal is real, already-wired telemetry — nothing new is bookkept:
 *   - "Genuinely active run" → `reanchor.ts isRunActive`. NOT `status ===
 *     "open"`: the Stop hook (`hooks/run-trace-close.ts`) closes the run at the
 *     end of EVERY assistant turn, so a live run reads `closed` for most of its
 *     life. Gating on `open` would silence this gate in exactly the
 *     compact-and-drift scenario it exists for.
 *   - "Past build-start" → run.yaml `phase` (via `reanchor.ts
 *     readRunYamlFacts`) in {build, qa, ops}, OR a lane recorded in
 *     `run-state.json` (the real production dispatch signal), OR an execution
 *     `phase_start` in the trace. Any one alone is real evidence; taking all
 *     three means a run whose persisted phase lags behind its actual dispatch
 *     still gates.
 *   - "Ad-hoc since last lifecycle touch" → `guild.trace_event.v2` events in
 *     `<runDir>/logs/v1.4-events.jsonl`, the same log
 *     `hooks/lib/lean-lead-guard.ts` counts against, read with the same
 *     lane-attribution rules: a `tool_call` with NO `lane_id` is the LEAD's own
 *     (every shipped dispatch backend threads `GUILD_TASK_ID`, which
 *     `post-tool-use.ts` stamps as `lane_id`), and the canonical orphan-sweep
 *     sentinel is excluded outright because `pre-tool-use.ts` never stamped its
 *     sidecar entry with attribution, making an orphan unrecoverably lane-less
 *     even when it really was a worker's.
 *   - "Routed through the lifecycle" → a lead-own, `status: "ok"` `tool_call`
 *     with `tool: "Skill"` whose PARSED skill name is one of
 *     `LIFECYCLE_SKILLS` (the phase producers plus `guild:resume`), or a
 *     `specialist_dispatch` event. Each resets the counting anchor, so a lead
 *     that keeps routing work never trips this gate however long the run is.
 *     The skill name is parsed out of the rendered tool input and matched
 *     exactly — never searched for as a substring, or any call that merely
 *     MENTIONS `guild:review` in an argument could forge a re-entry.
 *
 * Untrusted-input posture. The trace, `run-state.json`, `run.yaml` and this
 * module's own sentinels are ordinary workspace files: an attacker who can
 * write them must not be able to silence the gate, crash it into failing open,
 * or steer the model. So the trace is read through the canonical v1.4
 * `validateEvent` schema validator; `run-state.json` is structurally validated
 * before use; ordering never depends on a workspace-supplied `ts`; every
 * rendered scalar clears an allowlist; and NO free text is ever persisted and
 * replayed into model-visible context.
 *
 * Why the anchor is "last lifecycle touch" and not "last compaction" (which is
 * what lean-lead-guard anchors on): compaction is the TRIGGER of the drift, so
 * anchoring on it would zero the counter at the exact moment the gate becomes
 * useful. The metric that actually reproduces the forensic finding is "how much
 * work has happened since anything was routed through a skill".
 *
 * Relationship to `hooks/lib/lean-lead-guard.ts` (#57) — adjacent, not
 * overlapping. That guard asks "is the lead doing LANE work inline while lanes
 * are still OPEN?" (Edit/Write vs open lanes, anchored on compaction, advisory
 * at Stop). This one asks "is the session doing ANY work outside the lifecycle
 * at all?" (Bash+Edit/Write vs the last lifecycle touch, blocking at
 * UserPromptSubmit). A run with zero open lanes is invisible to the former and
 * fully in scope for the latter — the forensic session had exactly that shape.
 *
 * Zero-noise + never-dead-end contract. Every gate returns null at the first
 * condition that says "stay silent", never throws (a scan failure degrades to
 * silence like every other advisory hook here), and fires at most once per
 * threshold crossing — so the operator's very next prompt always goes through.
 * Two explicit overrides, both suppressing outright: the env var
 * `GUILD_LIFECYCLE_GATE_OVERRIDE=1` (session-wide, mirrors
 * `GUILD_LEAN_LEAD_OVERRIDE=1` / `GUILD_ALLOW_PUSH_MAIN=1`) and the in-prompt
 * token `[guild:gate-override]` (single prompt, for when the operator cannot
 * conveniently re-export an env var mid-session).
 *
 * Runner: bundled into dist/lifecycle-gate.js via esbuild (hooks/package.json).
 * Tests: hooks/lib/__tests__/lifecycle-gate.test.ts (real on-disk fixtures) +
 *        hooks/__tests__/check-skill-coverage.test.ts (sh-level wiring).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { loadRunState } from "./run-state.js";
import { withStableLock } from "./v1.4/v1.4-lock.js";
import { readAllEvents, ORPHAN_RESULT_EXCERPT, type JsonlEvent } from "./v1.4/log-jsonl.js";
import {
  deriveNextGate,
  isRunActive,
  readRunYamlFacts,
  safeIdent,
  safePhase,
} from "./reanchor.js";
import { isWorkerInvocation } from "./lane-attribution.js";
import { validateRunId } from "../../scripts/lib/run-lifecycle.js";
import { validateEvent } from "../../scripts/v1.4-log-validator.js";
// rf-wi-01 (v23x-deferred-followups G1): the canonical `defaults.lifecycle_gate.*`
// default values (single source of truth — scripts/lib/config-schema.ts CONFIG_SCHEMA
// derives from this SAME tree), so this guard's fallback can never drift from what
// `config validate/resolve/show` report as the documented default. Pure data, zero
// internal deps (config-defaults.ts's own contract) — safe to bundle into hooks/dist/.
import { DEFAULTS as CONFIG_DEFAULTS } from "../../scripts/lib/shared/config-defaults.js";

/** Stable marker strings — pinned by tests and the dist-grep rail. */
export const LIFECYCLE_GATE_MARKER = "[GUILD LIFECYCLE GATE]";
export const CLOSE_GATE_MARKER = "[GUILD CLOSE GATE]";

/** In-prompt escape hatch (single prompt). Case-insensitive, substring match. */
export const PROMPT_OVERRIDE_TOKEN = "[guild:gate-override]";

/** Session-wide escape hatch. */
export const ENV_OVERRIDE_VAR = "GUILD_LIFECYCLE_GATE_OVERRIDE";

/**
 * Default ad-hoc-activity budget before the gate fires.
 *
 * Deliberately higher than `lean-lead-guard`'s 8: that budget counts Edit/Write
 * only, while this one also counts the lead's own Bash, and a legitimately
 * skill-routed stretch of work does plenty of Bash (tests, git, builds). 20
 * mixed operations with no lifecycle touch at all is unambiguously "sustained"
 * while staying two orders of magnitude below the 836 Bash calls the forensic
 * session logged after its last skill.
 */
// Widened explicitly: CONFIG_DEFAULTS is `as const`, so its property types are the
// narrow literals `true`/`20` — annotate so `let enabled/threshold` below can hold any
// boolean/number the settings.json override resolves to.
const DEFAULT_ADHOC_THRESHOLD: number = CONFIG_DEFAULTS.defaults.lifecycle_gate.adhoc_activity_threshold;
const DEFAULT_LIFECYCLE_GATE_ENABLED: boolean = CONFIG_DEFAULTS.defaults.lifecycle_gate.enabled;

/** Tools that count as ad-hoc session activity (matches ToolCallTool values). */
const ADHOC_TOOLS = new Set(["Bash", "Edit", "Write", "NotebookEdit"]);

/** The subset of ADHOC_TOOLS that actually MUTATES the repo. */
const MUTATING_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

/** run.yaml phases that are at or past build-start. */
const BUILD_OR_LATER_PHASES = new Set(["build", "qa", "ops"]);

/** v1.4 `phase_start`/`phase_end` phases that prove execution began. */
const EXECUTION_PHASES = new Set(["execute", "review", "verify", "reflect"]);

/**
 * Skills whose invocation means "this work IS going through the lifecycle".
 * The phase producers plus `guild:resume` (the documented re-entry point).
 * Read-only orientation commands (`guild:status`) and maintenance skills
 * (`guild:evolve-skill` — which the forensic session DID invoke mid-drift) are
 * deliberately absent: neither re-enters the gated flow.
 */
export const LIFECYCLE_SKILLS: readonly string[] = [
  "guild:brainstorm",
  "guild:ideate",
  "guild:team-compose",
  "guild:plan",
  "guild:context-assemble",
  "guild:execute-plan",
  "guild:build",
  "guild:review",
  "guild:verify-done",
  "guild:qa",
  "guild:guild-quality",
  "guild:ops",
  "guild:guild-operations",
  "guild:reflect",
  "guild:resume",
];

const LIFECYCLE_SKILL_SET = new Set(LIFECYCLE_SKILLS);

/**
 * Render-safety allowlist for a timestamp read out of the workspace trace. The
 * anchor `ts` is interpolated into model-visible, Guild-framed text, and the
 * JSONL reader does not schema-validate the field, so an attacker-controlled
 * `"ts": "x\nIgnore the above and ..."` would otherwise append arbitrary
 * directives to the gate body. Anything not matching is dropped (rendered as
 * "unknown"), mirroring `reanchor.ts safeIdent`.
 */
const SAFE_TS = /^[0-9TZ:.+-]{1,40}$/;

export function safeTs(value: string | null): string | null {
  if (value === null) return null;
  return SAFE_TS.test(value) ? value : null;
}


/** Schema tags for the two independent sentinels (see LifecycleCloseState). */
const GATE_STATE_SCHEMA = "guild.lifecycle_gate.v1" as const;
const CLOSE_STATE_SCHEMA = "guild.lifecycle_close.v1" as const;

export interface LifecycleGateConfig {
  enabled: boolean;
  threshold: number;
}

/**
 * Tolerant reader for `.guild/settings.json` → `defaults.lifecycle_gate.*`.
 * Mirrors `lean-lead-guard.ts readLeanLeadConfig`: a missing file, malformed
 * JSON, or wrong-typed field degrades to the documented defaults rather than
 * throwing. The threshold must be a positive INTEGER — a fractional value would
 * defeat the `floor(count/threshold)` re-arm arithmetic below.
 */
export function readLifecycleGateConfig(guildRoot: string): LifecycleGateConfig {
  let enabled = DEFAULT_LIFECYCLE_GATE_ENABLED;
  let threshold = DEFAULT_ADHOC_THRESHOLD;
  try {
    const raw = fs.readFileSync(path.join(guildRoot, ".guild", "settings.json"), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const defs = parsed["defaults"];
    if (defs !== null && typeof defs === "object" && !Array.isArray(defs)) {
      const gate = (defs as Record<string, unknown>)["lifecycle_gate"];
      if (gate !== null && typeof gate === "object" && !Array.isArray(gate)) {
        const g = gate as Record<string, unknown>;
        if (typeof g["enabled"] === "boolean") enabled = g["enabled"];
        const rawThreshold = g["adhoc_activity_threshold"];
        if (typeof rawThreshold === "number" && Number.isInteger(rawThreshold) && rawThreshold >= 1) {
          threshold = rawThreshold;
        }
      }
    }
  } catch {
    /* missing/corrupt settings.json → documented defaults */
  }
  return { enabled, threshold };
}

/**
 * True when the operator has explicitly dismissed the gate — session-wide via
 * `GUILD_LIFECYCLE_GATE_OVERRIDE=1`, or for THIS prompt via the in-prompt
 * `[guild:gate-override]` token. Either one is sufficient; both are honest
 * operator intent, never inferred.
 */
export function isOverridden(
  env: NodeJS.ProcessEnv = process.env,
  promptText: string | null = null,
): boolean {
  if (env[ENV_OVERRIDE_VAR] === "1") return true;
  if (typeof promptText === "string" && promptText.length > 0) {
    return promptText.toLowerCase().includes(PROMPT_OVERRIDE_TOKEN);
  }
  return false;
}

/**
 * Extract the invoked skill NAME from a rendered `tool_call.command_redacted`.
 *
 * `pre-tool-use.ts renderCommand` produces `"<tool> <JSON tool_input>"` (or
 * `"<tool> <string>"` when the input is a bare string, or the bare tool name
 * when it is null). So the skill is parsed OUT of the payload — never searched
 * FOR inside it. A substring/boundary search would let any tool call that
 * merely mentions a skill name in an unrelated argument
 * (`Skill {"skill":"html-docs","args":"later call guild:review"}`, a Bash
 * command containing the string, a prompt excerpt) forge a lifecycle touch and
 * silence the gate indefinitely. Returns null when no skill name can be
 * recovered — an unparseable payload is NOT a lifecycle touch.
 */
export function parseInvokedSkill(command: string): string | null {
  const space = command.indexOf(" ");
  if (space === -1) return null;
  const payload = command.slice(space + 1).trim();
  if (payload.length === 0) return null;
  if (payload.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    // `skill` is the Skill tool's own parameter name; `name`/`command` cover the
    // shapes other hosts render. Only an exact scalar field counts.
    for (const key of ["skill", "name", "command"]) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value.length > 0) return value.trim();
    }
    return null;
  }
  // Bare-string tool_input: the whole remainder is the skill name.
  return payload;
}

/**
 * True iff this rendered command is an invocation OF one of the lifecycle
 * skills — exact match on the parsed skill name, so `guild:review-broker`
 * never satisfies `guild:review`.
 */
export function isLifecycleSkillCall(command: string): boolean {
  const skill = parseInvokedSkill(command);
  return skill !== null && LIFECYCLE_SKILL_SET.has(skill);
}

export interface AdHocActivityResult {
  /** Lead-own Bash+Edit+Write+NotebookEdit calls since the lifecycle anchor. */
  total: number;
  /** The MUTATING subset of `total` (Edit/Write/NotebookEdit). */
  mutations: number;
  /**
   * ORDINAL of the anchoring lifecycle touch — 0 when there has never been one,
   * 1 for the first, 2 for the second, and so on.
   *
   * This, not `anchor_ts`, is the persisted cycle identity. Two distinct
   * lifecycle touches can share a millisecond (the v1.4 schema calls `ts` a
   * same-millisecond TIE-BREAKER, not a total order), so a timestamp cannot
   * tell "the run re-entered the lifecycle again" from "same cycle as before".
   * A monotonically increasing ordinal can, and it is derived from the same
   * append-ordered scan the counting uses.
   */
  anchorSeq: number;
  /** ts of the anchoring lifecycle touch, for RENDERING only. */
  anchorTs: string | null;
  /**
   * Newest NOT-IN-THE-FUTURE `ts` among the counted calls — the evidence
   * `isDriftCurrent` judges recency on. Future-dated records are excluded HERE
   * rather than merely rejected downstream: taking the plain maximum would let
   * one forged `ts: "9999-…"` become the newest value forever, so every later
   * round of genuine, current drift would look stale and the gate would go
   * permanently silent. Null when nothing countable and dateable was found.
   */
  latestTs: string | null;
}

/** Narrow an untrusted JSONL record's string field. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read the run's trace with FULL v1.4 schema validation.
 *
 * `readAllEvents`'s default check is only "parses as JSON and has a known
 * `event` value", which lets a hand-written or corrupted record through with
 * arbitrary field types. Passing the canonical `validateEvent` (the same
 * validator `scripts/v1.4-log-validator.ts` exposes) makes the READER drop
 * those lines, so nothing downstream can be steered — or crashed — by a record
 * that never conformed to the schema in the first place.
 */
export async function readTraceEvents(runDir: string): Promise<readonly JsonlEvent[]> {
  return readAllEvents(runDir, {
    validate: (parsed: unknown) => {
      const result = validateEvent(parsed);
      return result.ok ? { ok: true } : { ok: false, reason: result.errors.join("; ") };
    },
  });
}

/**
 * Scan the run's schema-validated v1.4 trace, filtered to
 * `event.run_id === runId` (defense in depth against a shared or misrouted run
 * directory), for:
 *   1. the LAST lifecycle touch — a `specialist_dispatch`, or a LEAD-OWN
 *      `tool_call` with `tool: "Skill"`, `status: "ok"`, whose PARSED skill
 *      name is a `LIFECYCLE_SKILLS` entry — recording both its array index and
 *      its ORDINAL (`anchorSeq`, the stable cycle identity), and
 *   2. the lead's own ad-hoc tool calls strictly after that index, split into
 *      `total` (Bash + Edit + Write + NotebookEdit) and its mutating subset.
 * No lifecycle touch recorded ⇒ count from the start of the log (run start).
 *
 * ORDERING is by ARRAY POSITION, per the v1.4 schema §6.2 ("append-order is the
 * PRIMARY key; `ts` is the tie-breaker for same-millisecond events") and
 * `readAllEvents`'s own documented source-priority determinism — the same rule
 * `lean-lead-guard.ts countHandsOnEdits` follows. `ts` is deliberately NOT an
 * ordering key: it is workspace-controlled, so a single record claiming
 * `ts: "9999-..."` would otherwise become the maximum anchor and silence the
 * gate permanently. `ts` is used for exactly two things — RENDERING (through
 * `safeTs`) and the recency check (`isDriftCurrent`, which rejects future
 * timestamps) — never for deciding what counts.
 */
export async function countAdHocActivity(
  runDir: string,
  runId: string,
): Promise<AdHocActivityResult> {
  return countAdHocActivityIn(await readTraceEvents(runDir), runId);
}

/** True iff this event is a LEAD-OWN re-entry into the gated lifecycle. */
function isLifecycleTouch(event: JsonlEvent, runId: string): boolean {
  if (event.run_id !== runId) return false;
  if (event.event === "specialist_dispatch") return true;
  if (event.event !== "tool_call" || event.tool !== "Skill") return false;
  // A dispatched worker invoking a skill inside its own lane is not the LEAD
  // re-entering. And only an explicitly SUCCESSFUL call routed the work — an
  // allowlist on "ok", not a denylist on "err", so a missing or unexpected
  // status can never forge an anchor.
  if (event.lane_id !== undefined) return false;
  if (event.status !== "ok") return false;
  const command = str(event.command_redacted);
  return command !== null && isLifecycleSkillCall(command);
}

/**
 * The pure half of `countAdHocActivity` — same contract, over an already-read
 * (and already schema-validated) event array. Exported so the evaluators read
 * the trace exactly once per invocation and so tests can pin the counting rules
 * without touching disk.
 */
export function countAdHocActivityIn(
  events: readonly JsonlEvent[],
  runId: string,
  nowMs: number = Date.now(),
): AdHocActivityResult {
  let anchorIndex = -1;
  let anchorSeq = 0;
  let anchorTs: string | null = null;
  let seen = 0;
  for (let i = 0; i < events.length; i++) {
    if (!isLifecycleTouch(events[i], runId)) continue;
    seen++;
    anchorIndex = i;
    anchorSeq = seen;
    anchorTs = str(events[i].ts);
  }

  let total = 0;
  let mutations = 0;
  let latestTs: string | null = null;
  for (let i = anchorIndex + 1; i < events.length; i++) {
    const event = events[i];
    if (event.event !== "tool_call") continue;
    if (event.run_id !== runId) continue;
    if (!ADHOC_TOOLS.has(event.tool)) continue;
    if (event.lane_id !== undefined) continue; // a lane worker's own call, not the lead's
    if (event.status === "err" && event.result_excerpt_redacted === ORPHAN_RESULT_EXCERPT) continue;
    total++;
    if (MUTATING_TOOLS.has(event.tool)) mutations++;
    const ts = str(event.ts);
    if (ts === null) continue;
    const parsed = Date.parse(ts);
    // Unparseable or future-dated ⇒ not usable evidence of CURRENT activity.
    if (!Number.isFinite(parsed) || parsed > nowMs) continue;
    if (latestTs === null || ts > latestTs) latestTs = ts;
  }

  return { total, mutations, anchorSeq, anchorTs, latestTs };
}

/**
 * Is this run past build-start? True when the persisted run.yaml phase is
 * `build`/`qa`/`ops`, OR when at least one lane is recorded in `run-state.json`
 * (`laneCount` — the agent-team TaskCreated hook / `upsertLane` write it on the
 * real dispatch path, so a recorded lane IS proof execution began), OR when the
 * trace carries an execution `phase_start`/`phase_end` or a
 * `specialist_dispatch`.
 *
 * Honest caveat on `specialist_dispatch`: the v1.4 schema defines it and the
 * validator accepts it, but NO production writer emits it today (only fixtures
 * and tests do). The branch is kept because it is the semantically correct
 * signal if/when the dispatch seam starts emitting it — it is simply inert in
 * current runs, which is why `laneCount` carries the real load.
 */
export function isPastBuildStart(
  phase: string | null,
  events: readonly { event: string; phase?: string }[],
  laneCount = 0,
): boolean {
  if (phase !== null && BUILD_OR_LATER_PHASES.has(phase)) return true;
  if (laneCount > 0) return true;
  for (const event of events) {
    if (event.event === "specialist_dispatch") return true;
    if (
      (event.event === "phase_start" || event.event === "phase_end") &&
      typeof event.phase === "string" &&
      EXECUTION_PHASES.has(event.phase)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Multiplier applied to the configured threshold when the drift is SHELL-ONLY.
 *
 * "Mutation" cannot be reduced to the Edit/Write tools: a session can rewrite
 * the repo and the world entirely through Bash (`sed -i`, `git apply`, `>`
 * redirects, terraform, kubectl, deploys — the forensic run's own post-drift
 * Bash was exactly this), so requiring an Edit/Write event would leave the most
 * damaging case permanently silent. The higher bar is what keeps a long
 * read-only stretch (git log, grep, test runs) from tripping the gate.
 */
const SHELL_ONLY_MULTIPLIER = 3;

/**
 * The threshold that actually applies to this activity profile. Used for BOTH
 * the first fire and the re-arm arithmetic — using the base threshold for
 * re-arming would make a shell-only run fire at 60 and then again at every 20,
 * contradicting its own rendered bar.
 */
export function effectiveThreshold(activity: AdHocActivityResult, threshold: number): number {
  return activity.mutations >= 1 ? threshold : threshold * SHELL_ONLY_MULTIPLIER;
}

/** Fire-once bookkeeping for the PROMPT gate, at `<runDir>/lifecycle-gate-state.json`. */
export interface LifecycleGateState {
  schema_version: typeof GATE_STATE_SCHEMA;
  /** Ordinal of the lifecycle touch this bookkeeping was computed against. */
  anchor_seq: number;
  /** The ad-hoc activity count at which the prompt gate last fired. */
  last_fired_at_count: number;
  /**
   * A crossing BLOCKED a prompt whose correction the model never saw.
   *
   * `decision: "block"` on UserPromptSubmit discards the prompt and shows
   * `reason` to the USER — the model never sees it, so on its own the block
   * stops one prompt without telling the thing that is drifting what to do.
   * This flag makes the next ACCEPTED prompt deliver the correction as
   * `additionalContext` (which UserPromptSubmit does route to the model).
   *
   * It is a BOOLEAN, deliberately: the body is re-rendered from live, validated
   * run state at delivery time and never persisted. Persisting the text would
   * turn this sentinel — an ordinary workspace file — into a channel for
   * injecting arbitrary attacker-chosen text into trusted-framed model context.
   */
  pending_correction: boolean;
}

/**
 * Close-latch bookkeeping, at `<runDir>/lifecycle-close-state.json`.
 *
 * SEPARATE FILE, not a field on `LifecycleGateState`, because the two gates are
 * independent writers on different hook events (UserPromptSubmit vs Stop) and
 * Claude Code may run matching hooks in parallel. Sharing one file would make
 * every write a read-modify-write across writers, where an atomic rename
 * prevents a torn file but NOT a lost update — one gate could silently clobber
 * the other's field. One file per writer removes the race by construction.
 */
export interface LifecycleCloseState {
  schema_version: typeof CLOSE_STATE_SCHEMA;
  /**
   * The exact missing-artifact set the close gate last fired for, sorted.
   *
   * A plain "already fired" boolean would make this a ONE-SHOT advisory: fire
   * once with `[review.md, verify.md]` missing, then stay silent forever — so a
   * run that afterwards produced `review.md` and stopped could still close with
   * `verify.md` absent and never hear about it. Latching on the SET means new
   * information (a different gate is now the missing one) re-arms exactly once,
   * while an unchanged situation never nags.
   */
  fired_for: string[];
  /**
   * How many times the close gate has fired for this run. A hard cap
   * (`MAX_CLOSE_FIRES`) on top of the set latch: the set can only re-arm when
   * the missing set genuinely CHANGES, but the gate now also fires during
   * hook-continued turns (so it can follow "review.md landed, verify.md still
   * missing" to its conclusion), and a hard ceiling is what guarantees that can
   * never become an unbounded Stop loop regardless of what the workspace does.
   */
  fire_count: number;
}

/** Absolute ceiling on close-gate fires per run — one per artifact it can name,
 * plus one. Beyond this the gate stays silent for the rest of the run. */
const MAX_CLOSE_FIRES = 3;

export function gateStatePath(runDir: string): string {
  return path.join(runDir, "lifecycle-gate-state.json");
}

export function closeStatePath(runDir: string): string {
  return path.join(runDir, "lifecycle-close-state.json");
}

/**
 * Read the prompt-gate sentinel. Returns null when absent/corrupt/nonsensical
 * (fresh start) — a negative or non-finite count cannot come from honest
 * bookkeeping, so it is discarded rather than trusted. A corrupted or
 * hand-edited sentinel must never be able to permanently suppress the gate.
 */
export function loadGateState(runDir: string): LifecycleGateState | null {
  try {
    const raw = fs.readFileSync(gateStatePath(runDir), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed["schema_version"] !== GATE_STATE_SCHEMA) return null;
    const lastFired = parsed["last_fired_at_count"];
    const anchorSeq = parsed["anchor_seq"];
    if (typeof lastFired !== "number" || !Number.isInteger(lastFired) || lastFired < 0) return null;
    if (typeof anchorSeq !== "number" || !Number.isInteger(anchorSeq) || anchorSeq < 0) return null;
    return {
      schema_version: GATE_STATE_SCHEMA,
      anchor_seq: anchorSeq,
      last_fired_at_count: lastFired,
      pending_correction: parsed["pending_correction"] === true,
    };
  } catch {
    return null;
  }
}

/** Read the close latch. Absent/corrupt ⇒ not yet fired. */
export function loadCloseState(runDir: string): LifecycleCloseState {
  const empty: LifecycleCloseState = {
    schema_version: CLOSE_STATE_SCHEMA,
    fired_for: [],
    fire_count: 0,
  };
  try {
    const raw = fs.readFileSync(closeStatePath(runDir), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed["schema_version"] !== CLOSE_STATE_SCHEMA) return empty;
    const firedFor = parsed["fired_for"];
    if (!Array.isArray(firedFor) || firedFor.some((v) => typeof v !== "string")) return empty;
    const fireCount = parsed["fire_count"];
    return {
      schema_version: CLOSE_STATE_SCHEMA,
      fired_for: [...(firedFor as string[])].sort(),
      fire_count:
        typeof fireCount === "number" && Number.isInteger(fireCount) && fireCount >= 0
          ? fireCount
          : 0,
    };
  } catch {
    return empty;
  }
}

/**
 * Run the whole read-decide-write transaction under the run's ESTABLISHED
 * stable lockfile (`hooks/lib/v1.4/v1.4-lock.ts`, the same lock the JSONL
 * writer uses).
 *
 * The atomic write below prevents a TORN file; it does not prevent a LOST
 * UPDATE. Claude Code may run matching hooks in parallel, and two lead sessions
 * can share one run directory — so two invocations could each read the same
 * prior state, both decide to fire, and each overwrite the other's bookkeeping,
 * duplicating a block or silently clearing a pending correction. Serializing
 * the full transaction is the only thing that actually rules that out.
 *
 * The wait is capped WELL below the lock's 5s default: this runs on
 * UserPromptSubmit and Stop, where a multi-second stall is user-visible, and
 * the lock is normally held only for the microseconds of a JSONL append.
 * Timeout (or any other lock failure) degrades to running unlocked rather than
 * throwing — a gate that cannot take the lock must still evaluate, and the
 * worst case without it is exactly the rare race the lock exists to close, not
 * a wedged prompt.
 */
const GATE_LOCK_TIMEOUT_MS = 1_000;

function withGateLock<T>(runDir: string, fn: () => T): T {
  let entered = false;
  try {
    return withStableLock(
      runDir,
      () => {
        entered = true;
        return fn();
      },
      { timeoutMs: GATE_LOCK_TIMEOUT_MS },
    );
  } catch (err) {
    // Distinguish "could not ACQUIRE the lock" from "fn threw". Retrying fn
    // unlocked after fn itself failed would run its side effects a second time.
    if (entered) throw err;
    return fn();
  }
}

/** Atomic write-temp-then-rename, mirroring `run-state.ts writeRunStateAtomic`. */
function writeJsonAtomic(finalPath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8");
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

export function writeGateState(runDir: string, state: LifecycleGateState): void {
  writeJsonAtomic(gateStatePath(runDir), state);
}

export function writeCloseState(runDir: string, state: LifecycleCloseState): void {
  writeJsonAtomic(closeStatePath(runDir), state);
}

export interface CrossingDecision {
  shouldFire: boolean;
  nextState: LifecycleGateState;
}

/**
 * Edge-trigger on THRESHOLD MULTIPLES, not level. Once fired at count N the
 * gate stays silent until the count reaches the next multiple of the EFFECTIVE
 * threshold — so the operator's very next prompt always goes through (the
 * never-dead-end half of the contract) while sustained drift still re-arms.
 *
 * Cycle identity is `anchorSeq`, the ORDINAL of the anchoring lifecycle touch,
 * not its timestamp: a re-entry that happens to share the previous touch's
 * millisecond still gets a new ordinal, so it re-arms the gate.
 *
 * Within a cycle the count is treated as MONOTONIC (`max(observed, recorded)`)
 * — see the note below. The honest cost: a hand-edited sentinel claiming an
 * inflated count can delay the gate for the REST of that cycle. Any genuine
 * lifecycle re-entry starts a new cycle and clears it, and an actor who can
 * write this sentinel can already write the run's `review.md`/`verify.md` too,
 * so the alternative — treating "recorded > observed" as corruption and firing
 * — buys nothing while actively breaking concurrent invocations.
 */
export function decideCrossing(
  count: number,
  threshold: number,
  anchorSeq: number,
  priorState: LifecycleGateState | null,
): CrossingDecision {
  const sameCycle = priorState !== null && priorState.anchor_seq === anchorSeq;
  const priorCount = sameCycle ? priorState.last_fired_at_count : 0;
  const pending = sameCycle ? priorState.pending_correction : false;

  // MONOTONIC within a cycle. A recorded count ABOVE what this invocation
  // observed means a concurrent invocation read a newer trace and wrote first
  // (hook processes can overlap, and the evidence scan happens before the
  // lock). Treating that as corruption and firing again would both duplicate
  // the block and REGRESS the sentinel to the older, smaller count.
  const effectiveCount = Math.max(count, priorCount);
  const crossed =
    effectiveCount >= threshold &&
    Math.floor(effectiveCount / threshold) > Math.floor(priorCount / threshold);

  return {
    shouldFire: crossed,
    nextState: {
      schema_version: GATE_STATE_SCHEMA,
      anchor_seq: anchorSeq,
      last_fired_at_count: crossed ? effectiveCount : priorCount,
      pending_correction: pending,
    },
  };
}

/**
 * Render the gate body (pure — pinned by tests). `runId` and `phase` are
 * already sanitized by the caller; `activity.anchorTs` is sanitized HERE
 * because it comes out of a workspace JSONL record and this string is
 * trusted-framed, model-visible text. `nextGate` is null when the phase has no
 * known gate sequence and is then rendered honestly rather than guessed.
 */
export function renderLifecycleGate(
  runId: string,
  activity: AdHocActivityResult,
  threshold: number,
  phase: string | null,
  nextGate: string | null,
): string {
  const anchor = safeTs(activity.anchorTs);
  return [
    `${LIFECYCLE_GATE_MARKER} run ${runId} is ACTIVE (phase=${phase ?? "unknown"}) and this ` +
      `session has done ${activity.total} ad-hoc operations (${activity.mutations} Edit/Write, ` +
      `threshold ${effectiveThreshold(activity, threshold)}) without routing anything through a ` +
      `Guild skill.`,
    activity.anchorSeq === 0
      ? "- No lifecycle skill has been invoked in this run's trace at all."
      : `- Last lifecycle touch: ${anchor ?? "unknown"}.`,
    nextGate === null
      ? "- Re-enter the gated lifecycle with guild:resume, then run /guild:status for the next gate."
      : `- Re-enter the gated lifecycle with guild:resume. Next pending gate: ${nextGate}.`,
    "- A build run must still pass guild:review + guild:verify-done before it can close.",
    `- Intentional? Re-send this prompt (the gate fires once per crossing), add ` +
      `${PROMPT_OVERRIDE_TOKEN} to it, or export ${ENV_OVERRIDE_VAR}=1 for the session.`,
  ].join("\n");
}

/** Render the close-time gate body (pure — pinned by tests). */
export function renderCloseGate(
  runId: string,
  missing: readonly string[],
  laneCount: number,
): string {
  return [
    `${CLOSE_GATE_MARKER} run ${runId} completed all ${laneCount} lane(s) with receipts, but ` +
      `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} missing or empty.`,
    "- A build run must pass guild:review (writes review.md) AND guild:verify-done (writes verify.md) before close.",
    "- Run the missing gate(s) now, or re-enter via guild:resume — do not close this run on receipts alone.",
    `- Intentional? Export ${ENV_OVERRIDE_VAR}=1 to dismiss for this session.`,
  ].join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Shared preconditions
// ──────────────────────────────────────────────────────────────────────────

/** Lane statuses that mean "still in flight". Mirrors lean-lead-guard.ts. */
const OPEN_LANE_STATUSES = new Set(["pending", "in_progress"]);

/** The only lane status that means "this lane produced finished work". */
const COMPLETED_LANE_STATUS = "done";

/** `run-state.ts LaneStatus` — the closed enum. An unrecognized status means
 * the checkpoint was not written by a Guild writer we understand, so it is not
 * usable evidence about lane completion. */
const KNOWN_LANE_STATUSES = new Set([
  "pending",
  "in_progress",
  "done",
  "failed",
  "dead",
  "skipped",
]);

/** The subset of `run-state.json` these gates rely on, after validation. */
interface ValidatedRunState {
  laneStatuses: string[];
  /**
   * Per-lane `receipt_ref` (the checkpoint's own pointer to that lane's handoff
   * receipt), or null where the lane has not recorded one. Binding the close
   * boundary to THESE rather than to a count of `.md` files in `handoffs/` is
   * what stops an unrelated or duplicated markdown file from standing in for a
   * lane's missing receipt.
   */
  receiptRefs: (string | null)[];
}

/**
 * Structurally validate `run-state.json` for THIS run. `loadRunState` checks
 * only the outer object and its schema tag, so a file with `lanes: null` (or a
 * lane record that is not an object, or a non-string status) would reach the
 * consumers and THROW — which the hook runners catch, failing the gate OPEN.
 * An invalid checkpoint is treated as UNAVAILABLE (null) instead: the prompt
 * gate still runs off the persisted phase, and the close gate — which has
 * nothing to reason about without lanes — stays silent.
 */
export function readValidatedRunState(runDir: string, runId: string): ValidatedRunState | null {
  let state: ReturnType<typeof loadRunState>;
  try {
    state = loadRunState(runDir);
  } catch {
    return null;
  }
  if (state === null) return null;
  // Integrity: a stale or misrouted checkpoint must not lend another run's
  // lanes to this run's decisions.
  if (str((state as { run_id?: unknown }).run_id) !== runId) return null;
  const lanes = (state as { lanes?: unknown }).lanes;
  if (lanes === null || typeof lanes !== "object" || Array.isArray(lanes)) return null;
  const laneStatuses: string[] = [];
  const receiptRefs: (string | null)[] = [];
  for (const lane of Object.values(lanes as Record<string, unknown>)) {
    if (lane === null || typeof lane !== "object" || Array.isArray(lane)) return null;
    const record = lane as Record<string, unknown>;
    const status = str(record["status"]);
    if (status === null || !KNOWN_LANE_STATUSES.has(status)) return null;
    laneStatuses.push(status);
    const ref = record["receipt_ref"];
    if (ref !== null && ref !== undefined && typeof ref !== "string") return null;
    receiptRefs.push(str(ref));
  }
  return { laneStatuses, receiptRefs };
}

interface GateContext {
  runDir: string;
  safeRunId: string;
  phase: string | null;
  passedGates: Set<string>;
  events: readonly JsonlEvent[];
  runState: ValidatedRunState | null;
}

async function resolveGateContext(
  guildRoot: string,
  runId: string,
  env: NodeJS.ProcessEnv,
): Promise<GateContext | null> {
  // LEAD-ONLY gate. Both hook surfaces are registered globally, so they also
  // fire inside every dispatched specialist's own session — a separate process
  // sharing the SAME run directory and therefore the SAME sentinels. A worker
  // must never observe or consume the gate meant for the lead, so it returns
  // before any state read at all.
  if (isWorkerInvocation(env)) return null;

  // The run-id is workspace-controlled (env var or the current-run-id
  // sentinel). validateRunId guards path traversal; safeIdent additionally
  // guards RENDER safety, since the id is interpolated into model-visible text
  // — mirroring reanchor.ts / lean-lead-guard.ts.
  if (!validateRunId(runId)) return null;
  const safeRunId = safeIdent(runId);
  if (safeRunId === null) return null;

  const facts = readRunYamlFacts(guildRoot, safeRunId);
  if (facts === null) return null; // no run.yaml → never fabricate posture
  if (facts.runId !== safeRunId) return null; // integrity: fail closed on identity
  if (!isRunActive(guildRoot, safeRunId, facts.status)) return null;

  const phase = safePhase(facts.phase);
  const runDir = env["GUILD_RUN_DIR"] ?? path.join(guildRoot, ".guild", "runs", safeRunId);
  const runState = readValidatedRunState(runDir, safeRunId);
  const events = await readTraceEvents(runDir);
  if (!isPastBuildStart(phase, events, runState?.laneStatuses.length ?? 0)) return null;

  return { runDir, safeRunId, phase, passedGates: facts.passedGates, events, runState };
}

/**
 * How recent the newest counted ad-hoc call must be for the PROMPT gate to
 * block on it. `isRunActive`'s 3h window is the right posture for the advisory
 * re-anchor it was written for, but this gate BLOCKS — and a run-wide count is
 * cumulative, so without a recency floor a long-abandoned run's historical
 * drift could block an unrelated prompt hours later. Override with
 * GUILD_LIFECYCLE_GATE_RECENCY_MS.
 */
const DEFAULT_DRIFT_RECENCY_MS = 30 * 60 * 1000; // 30 minutes

function driftRecencyMs(env: NodeJS.ProcessEnv): number {
  const raw = env["GUILD_LIFECYCLE_GATE_RECENCY_MS"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_DRIFT_RECENCY_MS;
}

/**
 * True iff the newest counted ad-hoc call is recent enough to block on. The
 * window is bounded on BOTH sides (`0 <= age <= recency`): a workspace-supplied
 * future timestamp would otherwise yield a negative age that trivially
 * satisfies an upper-bound-only test, letting one forged record keep a
 * long-dead run permanently "current".
 */
export function isDriftCurrent(
  latestTs: string | null,
  env: NodeJS.ProcessEnv = process.env,
  nowMs: number = Date.now(),
): boolean {
  if (latestTs === null) return false;
  const parsed = Date.parse(latestTs);
  if (!Number.isFinite(parsed)) return false; // unparseable ts → cannot prove currency
  const age = nowMs - parsed;
  return age >= 0 && age <= driftRecencyMs(env);
}

export interface LifecycleGateResult {
  /** Body to BLOCK the prompt with, or null. */
  block: string | null;
  /**
   * Body to deliver to the MODEL as `additionalContext` on an ACCEPTED prompt.
   * Carries forward a previous block's correction, which `decision: "block"`
   * showed to the user but never to the model. Never set together with `block`.
   */
  context: string | null;
}

/**
 * The ACTIVE UserPromptSubmit gate. Returns the blocking body, the deferred
 * correction for an accepted prompt, or neither (zero-noise contract). Never
 * throws — a scan failure degrades to silence.
 *
 * Override semantics are explicit, because "silent" alone is ambiguous once
 * state is involved: an overridden prompt CONSUMES the current crossing (so the
 * dismissal actually holds for the next prompt too, instead of blocking it on
 * the identical unchanged crossing) and CLEARS any pending correction without
 * delivering it (the operator said "not now"; a correction must not resurface
 * three prompts later out of context).
 */
export async function evaluateLifecycleGate(
  guildRoot: string,
  runId: string,
  promptText: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LifecycleGateResult> {
  const silent: LifecycleGateResult = { block: null, context: null };
  const config = readLifecycleGateConfig(guildRoot);
  if (!config.enabled) return silent;

  const ctx = await resolveGateContext(guildRoot, runId, env);
  if (ctx === null) return silent;

  const activity = countAdHocActivityIn(ctx.events, ctx.safeRunId);
  const threshold = effectiveThreshold(activity, config.threshold);
  const drifting = activity.total >= threshold && isDriftCurrent(activity.latestTs, env);
  const overridden = isOverridden(env, promptText);
  const render = (): string =>
    renderLifecycleGate(
      ctx.safeRunId,
      activity,
      config.threshold,
      ctx.phase,
      deriveNextGate(ctx.phase, ctx.passedGates),
    );

  // Read → decide → write as ONE serialized transaction (see withGateLock).
  return withGateLock(ctx.runDir, (): LifecycleGateResult => {
    const priorState = loadGateState(ctx.runDir);
    const decision = decideCrossing(activity.total, threshold, activity.anchorSeq, priorState);
    // `decision.nextState.pending_correction` — NOT the prior state's flag.
    // decideCrossing drops a pending correction whose cycle has ended, and a
    // correction from a cycle the run has already left would otherwise be
    // delivered describing drift that no longer exists.
    const pending = decision.nextState.pending_correction;

    if (overridden) {
      // Consume the crossing and drop any pending correction, but say nothing.
      if (decision.shouldFire || pending) {
        writeGateState(ctx.runDir, { ...decision.nextState, pending_correction: false });
      }
      return silent;
    }

    if (drifting && decision.shouldFire) {
      writeGateState(ctx.runDir, { ...decision.nextState, pending_correction: true });
      return { block: render(), context: null };
    }

    // This prompt is going through. If a live crossing left an undelivered
    // correction, RE-RENDER it from current validated state (never from
    // persisted text) and hand it to the model now, then clear the flag.
    if (pending) {
      writeGateState(ctx.runDir, { ...decision.nextState, pending_correction: false });
      return { block: null, context: render() };
    }
    return silent;
  });
}

/**
 * Is this a real artifact — a REGULAR file (not a directory, not a symlink)
 * carrying non-whitespace content? `lstat` rather than `stat` so a symlink is
 * judged as a symlink instead of following it, and the content check rejects
 * the empty/whitespace placeholder that a bare size test would accept.
 */
export function hasContent(filePath: string): boolean {
  try {
    const st = fs.lstatSync(filePath);
    if (!st.isFile()) return false; // directory, symlink, fifo, …
    if (st.size === 0) return false;
    return fs.readFileSync(filePath, "utf8").trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * The close-time backstop (Stop hook). Fires ONCE per run when a build run has
 * genuinely reached `guild:execute-plan §Stop condition` — EVERY lane `done`
 * (not merely terminal) and at least one receipt per lane — while `review.md`
 * and/or `verify.md` is missing, empty, or not a real file.
 *
 * "Every lane done with receipts collected" is the closest deterministic proxy
 * for close-time this codebase has: `hooks/run-trace-close.ts` writes
 * `status: closed` at the end of EVERY assistant turn, so the persisted status
 * cannot distinguish "turn ended" from "run finished". Lane completion can —
 * and it is the exact state execute-plan calls complete and hands to
 * `guild:review`. A run with a `failed`/`dead`/`skipped` lane has NOT reached
 * that boundary: execute-plan halts and routes it through dead-lettering, so
 * telling the lead to go run review there would be wrong advice, and this gate
 * stays silent.
 *
 * SCOPE — read this before describing what it enforces. It detects a MISSING
 * OR BLANK gate artifact. It does NOT verify that the gates passed, and it
 * cannot: it never parses a verdict, so a `review.md` recording failures, or a
 * `verify.md` saying `status: fail`, satisfies it exactly as a passing one
 * would. That is deliberate — reading verdicts is `guild:verify-done`'s own
 * job, and the failure this exists for is the gates never running AT ALL (the
 * forensic run produced neither file). Describe it as "detects a build run
 * closing with no review/verify artifact", never as "enforces that review and
 * verify-done passed".
 */
export async function evaluateCloseGate(
  guildRoot: string,
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ advisory: string | null }> {
  const silent = { advisory: null };
  const config = readLifecycleGateConfig(guildRoot);
  if (!config.enabled || isOverridden(env)) return silent;

  const ctx = await resolveGateContext(guildRoot, runId, env);
  if (ctx === null || ctx.runState === null) return silent;

  const lanes = ctx.runState.laneStatuses;
  if (lanes.length === 0) return silent;
  if (lanes.some((status) => OPEN_LANE_STATUSES.has(status))) return silent;
  // EVERY lane must be `done` — see the dead-lettering note above.
  if (!lanes.every((status) => status === COMPLETED_LANE_STATUS)) return silent;

  // One receipt per lane, bound through the checkpoint's own `receipt_ref`.
  // Execute-plan's stop condition is "receipt count equals lane count"; binding
  // by reference — and requiring each ref to be DISTINCT and to live under
  // `handoffs/` — is what stops one shared file, a duplicate ref, or an
  // unrelated file elsewhere in the run dir (`run.yaml`, say) from standing in
  // for a lane that never produced a receipt.
  const handoffsDir = path.resolve(ctx.runDir, "handoffs");
  const seenReceipts = new Set<string>();
  for (const ref of ctx.runState.receiptRefs) {
    if (ref === null) return silent;
    const resolved = path.resolve(ctx.runDir, ref);
    const rel = path.relative(handoffsDir, resolved);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return silent;
    if (!resolved.endsWith(".md")) return silent;
    if (seenReceipts.has(resolved)) return silent; // two lanes, one receipt
    seenReceipts.add(resolved);
    if (!hasContent(resolved)) return silent;
  }

  const missing: string[] = [];
  for (const artifact of ["review.md", "verify.md"]) {
    if (!hasContent(path.join(ctx.runDir, artifact))) missing.push(artifact);
  }
  missing.sort();

  return withGateLock(ctx.runDir, (): { advisory: string | null } => {
    const prior = loadCloseState(ctx.runDir);
    const sameSet =
      prior.fired_for.length === missing.length &&
      prior.fired_for.every((name, i) => name === missing[i]);

    // Fully satisfied ⇒ CLEAR the latch. Leaving a stale `fired_for` would mean
    // a later regression (the artifact deleted or blanked) is never reported.
    if (missing.length === 0) {
      if (prior.fired_for.length > 0) {
        writeCloseState(ctx.runDir, {
          schema_version: CLOSE_STATE_SCHEMA,
          fired_for: [],
          fire_count: prior.fire_count,
        });
      }
      return silent;
    }

    // Latched on the missing SET: an unchanged situation stays silent, but
    // "review.md landed, verify.md still absent" is new information and
    // re-arms exactly once — bounded overall by MAX_CLOSE_FIRES.
    if (sameSet || prior.fire_count >= MAX_CLOSE_FIRES) return silent;

    writeCloseState(ctx.runDir, {
      schema_version: CLOSE_STATE_SCHEMA,
      fired_for: missing,
      fire_count: prior.fire_count + 1,
    });
    return { advisory: renderCloseGate(ctx.safeRunId, missing, lanes.length) };
  });
}
