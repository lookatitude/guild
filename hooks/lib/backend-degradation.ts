/**
 * hooks/lib/backend-degradation.ts
 *
 * Issue #56 — the team-mode BACKEND-DEGRADATION detector.
 *
 * Background: `skills/meta/execute-plan/dispatch.md §Backend choice` states
 * "refuse-don't-fallback" — when the run's resolved backend cannot be honored,
 * the skill must surface a blocker rather than silently downgrade, "because
 * falling back would change execution semantics out from under the plan". That
 * was PROSE the orchestrator LLM had to self-enforce, with no runtime check that
 * a lane was actually spawned on the resolved backend. The forensic
 * `new-infra-migration` run is what unenforced prose costs: with `agent_mode`
 * resolved to `team` and tmux confirmed available, ~26h of lane work silently
 * ran as in-session `Agent(subagent_type: "general-purpose")` calls — no panes,
 * no named specialists, no record that the downgrade ever happened.
 *
 * This module converts that prose into code. It is the #56 sibling of
 * `dispatch-attribution.ts` (#58) and deliberately mirrors its posture:
 *   - a PURE decision function over already-extracted facts, so the matrix is
 *     unit-testable without a run directory or a live tmux;
 *   - PRODUCER-SPECIFIC signatures, never loose keyword heuristics, so an
 *     ordinary non-Guild `Agent` call is never caught in the net;
 *   - fail-CLOSED on the degradation, with ONE explicit, auditable operator
 *     override (`GUILD_ALLOW_BACKEND_DEGRADE`) that itself emits the receipt.
 *
 * It EXTENDS `dispatch-attribution.ts` rather than duplicating it: lane identity
 * comes from `resolveDispatchAttribution`, and the only new signal here is the
 * handoff-protocol brief signature (below), which catches the drift shape #58's
 * carriers cannot — a fully hand-rolled `Agent()` call with every GUILD_* env
 * carrier absent.
 *
 * ── Two things this deliberately does NOT do ─────────────────────────────────
 *   - It does not block outside what the plugin can PROVE. A DENY needs the
 *     backend to resolve to team, a team substrate to be available, AND
 *     STRUCTURED lane evidence (a producer-set dispatch carrier — see
 *     `LaneEvidence`). Every other observable downgrade, including one
 *     recognised from prompt text alone, is RECORDED rather than blocked.
 *   - It does not write into a validated frozen channel. The receipt goes to its
 *     own `<runDir>/logs/backend-degradation.jsonl` sink with its own
 *     `schema_version`; `logs/v1.4-events.jsonl` accepts only the frozen v1.4
 *     `EVENT_TYPES`, the hook-name mirror family, and `guild.trace.*.v1`, so
 *     appending a novel `event` there would make `scripts/v1.4-log-validator.ts`
 *     reject an otherwise-healthy run log (adversarial review round 1).
 *
 * Bundle-weight note: `pre-tool-use.js` runs on EVERY tool call in every
 * session, so this module deliberately reads `resolved-settings.json` with
 * `fs` + `JSON.parse` instead of importing `scripts/lib/run-lifecycle.ts`'s
 * `readResolvedSettingsSnapshot` (which `reanchor.ts` can afford — its bundles
 * are 275-285 KB; pre-tool-use's is 54 KB). Same file, same field, same
 * read-never-re-resolve contract. `probeTmuxAvailable` and reanchor's
 * `newestRunSignalMs` are restated for the same reason, exactly as
 * `dispatch-attribution.ts` restates `GENERIC_SUBAGENT_TYPE`.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import type { DispatchAttribution } from "./dispatch-attribution.js";
// #93: the ONE canonical default for the strict rung. Imported from the same
// DEFAULTS tree `CONFIG_SCHEMA` derives from, exactly as `lean-lead-guard.ts` /
// `lifecycle-gate.ts` do for their keys (PR #87 deliberately replaced their
// duplicated literals with this import) — so the guard's fallback and the
// registered schema default can never drift into a silent disagreement.
//
// Bundle cost, measured: this import adds ~12 KB to `pre-tool-use.js`
// (110,813 → 123,178 bytes). Paid deliberately. Importing the settings RESOLVER
// here instead — the obvious way to read the key — was measured at 923,345
// bytes, an 8x regression on the hottest hook Guild ships, which is why
// `readSnapshotBlockUnmarkedLanes` below reads the frozen run snapshot instead.
import { DEFAULTS as CONFIG_DEFAULTS } from "../../scripts/lib/shared/config-defaults.js";

/** The env var an operator sets to consciously accept a backend downgrade. */
export const OVERRIDE_ENV = "GUILD_ALLOW_BACKEND_DEGRADE";

/**
 * The env var that OVERRIDES the registered strict-mode config key for one
 * session (see `resolveBlockUnmarkedLanes` for the precedence).
 *
 * History: rf-wi-03 (G3, PR #85) shipped strict mode as this env flag ALONE,
 * deliberately deferring schema registration to avoid colliding with rf-wi-01's
 * in-flight closed-schema work. That left the rung undiscoverable and
 * unvalidated. Issue #93 registered it as `defaults.dispatch.block_unmarked_lanes`;
 * the env var survives as the per-session override on top of the resolved value.
 */
export const BLOCK_UNMARKED_ENV = "GUILD_BLOCK_UNMARKED_LANES";

/**
 * The registered config key that engages strict mode (#93). Named alongside the
 * env var in every operator-visible deny/allow message: after #93 strict mode is
 * usually reached through CONFIG, so a message that named only the env var would
 * send an operator hunting for an export nobody made.
 */
export const BLOCK_UNMARKED_CONFIG_KEY = "defaults.dispatch.block_unmarked_lanes";

/**
 * The registered default for `defaults.dispatch.block_unmarked_lanes` — OFF.
 *
 * Load-bearing, not timidity: `classifyLaneEvidence` grades a fully-substituted
 * lane brief that was merely QUOTED in a prompt as `prompt_only` too, so strict
 * mode trades the no-false-positive-on-a-quoted-brief invariant for tighter
 * drift coverage. That is an operator's call, never a shipped default.
 */
export const DEFAULT_BLOCK_UNMARKED_LANES: boolean =
  CONFIG_DEFAULTS.defaults.dispatch.block_unmarked_lanes;

/** The receipt's self-versioned schema token and its `event` value. */
export const BACKEND_DEGRADATION_EVENT = "backend_degradation";
export const BACKEND_DEGRADATION_SCHEMA = "guild.backend_degradation.v1" as const;

/** The receipt sink, relative to the run dir. */
export const RECEIPT_RELATIVE_PATH = "logs/backend-degradation.jsonl";

/** Resolved agent_mode values that mean "this run committed to the team backend". */
export const TEAM_AGENT_MODE = "team";
/** Resolved agent_mode that DELEGATES the choice to the D5 ladder at dispatch. */
export const AUTO_AGENT_MODE = "auto";

// ── Lane-brief signature ─────────────────────────────────────────────────────
//
// #58's `DispatchAttribution` identifies a lane from its env carriers
// (GUILD_SPECIALIST / GUILD_TASK_ID / GUILD_AGENT_DEFINITION) and the
// definition-adoption prompt. Those are all set by Guild's own dispatch
// producers (`composeInProcessDispatch` / `buildPrompt`) — which is exactly what
// the drifted orchestrator BYPASSED: it hand-wrote `Agent({subagent_type:
// "general-purpose", prompt: "<brief>"})` with no env map at all, so every #58
// carrier was absent and `isSpecialistLane` reads false.
//
// The one thing a hand-rolled lane brief still carries is the handoff protocol:
// `dispatch.md §Handoff protocol` R5 mandates the canonical block be injected
// VERBATIM into every brief on EVERY backend, and the drifted dispatches were
// still lane briefs. So the block's own producer-owned wording is the signature.
//
// THREE conditions must hold together — the two producer-owned anchors AND a
// receipt path naming THIS run:
//
//   1. the block header, 2. the "final action is writing your receipt"
//   instruction, and 3. `.guild/runs/<the active run id>/handoffs/`.
//
// (3) narrows the gap between an injected brief and QUOTED material.
// `dispatch.md §"Orchestrator injection mechanics"` has the orchestrator
// substitute `<RECEIPT_PATH>` with
// `.guild/runs/<run-id>/handoffs/<specialist>-<task-id>.md` for the run it is
// actually dispatching into, so a live brief always names the live run, while a
// prompt pasting the canonical block as a FIXTURE typically carries a
// placeholder or another run's id.
//
// It does NOT close the gap, and this signature is therefore NEVER on its own
// sufficient to BLOCK. A prompt that quotes a fully substituted brief from the
// ACTIVE run matches all three conditions and is indistinguishable from the real
// thing by text (adversarial review round 3, finding 1). That is exactly why
// `classifyLaneEvidence` grades this as "prompt_only" — recorded, not denied.
// Only a producer-set dispatch carrier, which no quoted prose can forge, is
// blockable.
//
// Known, accepted limit: a brief that PARAPHRASES the block away, or one that
// rewrites the receipt path, carries no anchor and is invisible here. That gap
// is covered by the other half of this wave — the re-anchor engine
// (`reanchor.ts`) restores the "dispatch via the launcher" posture after every
// compact, so the lead is far less likely to hand-roll a brief in the first
// place. A structured producer marker on every dispatch is the durable fix and
// is queued behind the same descriptor work that owns `composeInProcessDispatch`.

/** The canonical block's own header line (dispatch.md §"Canonical prompt injection block (R5)"). */
const HANDOFF_PROTOCOL_HEADER_RE =
  /^HANDOFF PROTOCOL \(mandatory\s*[—–-]\s*single channel/im;

/** The canonical block's opening instruction, verbatim from the same source. */
const HANDOFF_FINAL_ACTION_RE =
  /Your final action is writing your handoff receipt to the receipt file\./i;

/** Escape a run id for literal use inside a RegExp (ids are `[A-Za-z0-9._-]`, but be exact). */
function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True iff the prompt carries the canonical handoff-protocol injection block
 * ADDRESSED TO THIS RUN — i.e. this `Agent` call is a Guild LANE brief even when
 * every #58 env carrier was stripped by a hand-rolled dispatch.
 */
export function hasHandoffProtocolBlock(prompt: string, runId: string): boolean {
  if (!HANDOFF_PROTOCOL_HEADER_RE.test(prompt)) return false;
  if (!HANDOFF_FINAL_ACTION_RE.test(prompt)) return false;
  const receiptPathRe = new RegExp(`\\.guild/runs/${escapeRe(runId)}/handoffs/`);
  return receiptPathRe.test(prompt);
}

/**
 * How strong the evidence is that this `Agent` dispatch is a Guild specialist
 * LANE. The STRENGTH decides whether the detector may BLOCK:
 *
 *   - "structured" — the dispatch carries a producer-set carrier in its OWN
 *     `env` MAP (`GUILD_SPECIALIST` / `GUILD_TASK_ID` / `GUILD_AGENT_DEFINITION`,
 *     set by `composeInProcessDispatch`). An env map is composed by whoever
 *     issues the dispatch; it is structurally out of reach of any text a prompt
 *     merely QUOTES. Blockable.
 *
 *   - "prompt_only" — every remaining signal, ALL of which are read out of the
 *     prompt body: the handoff-protocol block, and #58's prompt-derived
 *     attribution (the adoption marker line, the "role definition is at
 *     .guild/agents/<role>.md" anchor, the "dispatched as the Guild <role>
 *     specialist" prose, "teammate for run-id"). Each is genuine drift evidence
 *     for a hand-rolled brief — and each is ALSO exactly what an audit/review
 *     prompt looks like when it quotes a live brief. Text cannot distinguish the
 *     two (adversarial review rounds 3 + 4, finding 1), so this tier is
 *     RECORDED, never blocked: a receipt on a quoted fixture is noise, but a
 *     DENY on one would break a legitimate call.
 *
 *   - "none" — a learn-lane generic fan-out, an Explore sweep, any non-Guild
 *     `Agent` call. Untouched.
 */
export type LaneEvidence = "structured" | "prompt_only" | "none";

/**
 * The universal structured producer marker key (rf-wi-03 / G3). Set on EVERY
 * producer-composed dispatch env (`composeInProcessDispatch` /
 * `paneCommand`); restated here (same doctrine as GENERIC_SUBAGENT_TYPE — the
 * hooks bundle is separate). Its presence is the unforgeable "a Guild producer
 * built this dispatch" signal that lets the prompt-only rung block a lane which
 * carries no marker (drift).
 */
export const PRODUCER_MARKER_ENV = "GUILD_DISPATCH_PRODUCER";

/**
 * The marker's valid value shape: `guild.dispatch.v<N>` EXACTLY (versioned —
 * v1, future v2, …). Anything else (`guild.dispatch.junk`, `guild.dispatch.v1x`,
 * a bare prefix, a hand-set junk value) is NOT a producer marker, so it cannot
 * forge structured evidence (adversarial review rounds 1 + 2, finding 3).
 */
const PRODUCER_MARKER_VALUE_RE = /^guild\.dispatch\.v\d+$/;

/** The producer-set env keys `composeInProcessDispatch` puts on a lane dispatch. */
const STRUCTURED_CARRIER_KEYS = [
  "GUILD_SPECIALIST",
  "GUILD_TASK_ID",
  "GUILD_AGENT_DEFINITION",
] as const;

/**
 * Does the dispatch's own `env` map carry a producer-set lane carrier?
 *
 * Read straight off `tool_input.env` rather than through
 * `DispatchAttribution`'s flags: those deliberately fold PROMPT-derived signals
 * into `isSpecialistLane` / `hasLaneSignature` (correct for #58's purpose,
 * wrong as a blocking predicate here), and `hasLaneSignature` omits
 * `GUILD_AGENT_DEFINITION`, so a dispatch carrying only that structured carrier
 * would have graded "none" and passed silently (adversarial review round 4,
 * finding 1).
 */
export function hasStructuredCarrier(toolInput: unknown): boolean {
  if (toolInput === null || typeof toolInput !== "object") return false;
  const env = (toolInput as Record<string, unknown>)["env"];
  if (env === null || typeof env !== "object" || Array.isArray(env)) return false;
  const map = env as Record<string, unknown>;
  const composedCarrier = STRUCTURED_CARRIER_KEYS.some((k) => {
    const v = map[k];
    return typeof v === "string" && v.trim().length > 0;
  });
  // G3 — the universal producer marker is also a structured carrier: a dispatch
  // carrying ONLY a VALID `GUILD_DISPATCH_PRODUCER` is still producer-composed
  // (out of reach of quoted prose). Routed through the validated
  // `hasProducerMarker` so a bogus value is NOT counted as structured.
  return composedCarrier || hasProducerMarker(toolInput);
}

/**
 * Does the dispatch's own `env` map carry the universal producer marker
 * (`GUILD_DISPATCH_PRODUCER`)? The narrow twin of `hasStructuredCarrier`: it
 * asks specifically "did a Guild producer stamp this dispatch?", which the
 * blockable prompt-only rung reads (G3-3). A dispatch with lane-shaped PROSE but
 * no marker is not producer-composed — drift, blockable when the operator opts
 * into `blockUnmarked`.
 */
export function hasProducerMarker(toolInput: unknown): boolean {
  if (toolInput === null || typeof toolInput !== "object") return false;
  const env = (toolInput as Record<string, unknown>)["env"];
  if (env === null || typeof env !== "object" || Array.isArray(env)) return false;
  const v = (env as Record<string, unknown>)[PRODUCER_MARKER_ENV];
  // Require the EXACT versioned Guild dispatch token, not just any non-empty
  // value — a stale/bogus marker must not forge structured evidence.
  return typeof v === "string" && PRODUCER_MARKER_VALUE_RE.test(v.trim());
}

/** Classify the lane evidence carried by this dispatch. */
export function classifyLaneEvidence(
  toolInput: unknown,
  attr: DispatchAttribution,
  prompt: string,
  runId: string,
): LaneEvidence {
  if (hasStructuredCarrier(toolInput)) return "structured";
  if (hasHandoffProtocolBlock(prompt, runId)) return "prompt_only";
  // #58's remaining signals are all parsed out of the prompt — observable, but
  // never blockable on their own.
  if (attr.isSpecialistLane || attr.hasLaneSignature) return "prompt_only";
  return "none";
}

/** Convenience predicate: any lane evidence at all. */
export function isGuildLaneDispatch(
  toolInput: unknown,
  attr: DispatchAttribution,
  prompt: string,
  runId: string,
): boolean {
  return classifyLaneEvidence(toolInput, attr, prompt, runId) !== "none";
}

// ── Lead-vs-lane process detection ───────────────────────────────────────────

/**
 * Env keys Guild sets on a DISPATCHED agent's own process (a tmux/cmux pane, an
 * in-process Agent, a subagent). Their presence in the CURRENT process env means
 * this hook is running inside a lane, not in the lead session.
 */
const LANE_PROCESS_ENV_KEYS = ["GUILD_LANE_ID", "GUILD_TASK_ID", "GUILD_SPECIALIST"] as const;

/**
 * Is the process issuing this dispatch the run LEAD?
 *
 * #56 is specifically about the LEAD bypassing the launcher. A specialist
 * already running inside a pane that spawns a helper agent is not degrading the
 * backend — its own pane was honored — so gating it would be a pure false
 * positive (adversarial review round 1, finding 5e). Fail-open by design: an
 * env-carrying process is treated as a lane and left alone.
 */
export function isLeadProcess(env: NodeJS.ProcessEnv): boolean {
  return !LANE_PROCESS_ENV_KEYS.some((k) => {
    const v = env[k];
    return typeof v === "string" && v.trim().length > 0;
  });
}

// ── Resolved-settings snapshot (read, never re-resolve) ──────────────────────

/**
 * Read `effective.agent_mode` from the run's U6 resolved-settings snapshot.
 * Returns null when the snapshot is absent, unreadable, malformed, or carries no
 * string agent_mode — i.e. the guard has no PROOF of what the run resolved to
 * and therefore does nothing. Fail-open here is the correct posture: blocking a
 * dispatch because a file could not be read would brick every run that predates
 * the snapshot.
 *
 * `runId` MUST already be validated as a safe single path component by the
 * caller (`isSafeRunId`) — this function does not re-derive path safety.
 */
export function readSnapshotAgentMode(guildRoot: string, runId: string): string | null {
  const file = path.join(guildRoot, ".guild", "runs", runId, "resolved-settings.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const effective = (doc as Record<string, unknown>)["effective"];
  if (effective === null || typeof effective !== "object" || Array.isArray(effective)) {
    return null;
  }
  const mode = (effective as Record<string, unknown>)["agent_mode"];
  return typeof mode === "string" && mode.length > 0 ? mode : null;
}

// ── Run freshness ────────────────────────────────────────────────────────────
//
// `resolveRunId` falls back to the `.guild/runs/current-run-id` sentinel, and
// `closeRun` does NOT clear that sentinel — so months after a team run finished,
// the sentinel still names it. Without a freshness test, an unrelated `Agent`
// call in a brand-new session would be evaluated against that dead run's
// snapshot and could be denied (adversarial review round 1, finding 4).
//
// The invariant is NOT "no hook writes these" — `post-tool-use.ts` writes the
// lane heartbeat. It is "no LEAD-side hook activity can write these", which is
// what breaks the resurrection loop.
//
// This adapts `reanchor.ts`'s `newestRunSignalMs` / DEFAULT_REANCHOR_GRACE_MS
// reasoning — recent activity is the liveness signal, and `status: closed` is
// NOT, because the Stop hook closes a live run every assistant turn.
//
// TWO refinements over reanchor's version, both from adversarial review
// (round 2 finding 4, round 3 finding 2):
//
//   - The freshness test applies ONLY to a SENTINEL-derived run id. An explicit
//     `GUILD_RUN_ID` is session-bound identity supplied by the orchestrator, not
//     a leftover file — applying a time window to it would let a genuinely
//     active run's first dispatch after a long quiet period escape the guard.
//
//   - The signal set excludes everything a HOOK writes, which is stricter than
//     "excludes telemetry": see `newestRunSignalMs` for why `run.yaml` had to go
//     too. Otherwise merely operating in a session with a stale sentinel
//     resurrects the dead run it names.

/** Default freshness window for the sentinel-named run. */
export const DEFAULT_BACKEND_GUARD_GRACE_MS = 3 * 60 * 60 * 1000; // 3 hours

export function backendGuardGraceMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["GUILD_BACKEND_GUARD_GRACE_MS"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_BACKEND_GUARD_GRACE_MS;
}

/** Where the run id came from — decides whether the freshness test applies. */
export type RunIdSource = "env" | "sentinel";

/**
 * Does the DISPATCH ITSELF assert this run id (`tool_input.env.GUILD_RUN_ID`)?
 *
 * `/guild:build` runs the lead through the `current-run-id` sentinel without
 * exporting `GUILD_RUN_ID` into the lead process, so provenance read from the
 * lead's own env under-reports how live the run is. But a lane dispatch the lead
 * is composing RIGHT NOW carries `GUILD_RUN_ID` in its descriptor env — the lead
 * naming this run as current, in the very call being gated. That is at least as
 * strong as an exported env var and cannot come from a stale file
 * (adversarial review round 4, finding 2).
 */
export function dispatchAssertsRunId(toolInput: unknown, runId: string): boolean {
  if (toolInput === null || typeof toolInput !== "object") return false;
  const env = (toolInput as Record<string, unknown>)["env"];
  if (env === null || typeof env !== "object" || Array.isArray(env)) return false;
  const v = (env as Record<string, unknown>)["GUILD_RUN_ID"];
  return typeof v === "string" && v.trim() === runId;
}

/**
 * Newest mtime (ms) among the run's LEAD-INDEPENDENT lifecycle artifacts; 0 when
 * nothing reads.
 *
 * Excludes `logs/**` and `events.ndjson` (written by this hook family for ANY
 * tool call) AND `run.yaml` — the Stop hook (`run-trace-close.ts`) re-closes
 * whatever run the sentinel names at the end of EVERY assistant turn, rewriting
 * `run.yaml`. Counting it left an indirect feedback loop: one unrelated tool
 * call in a fresh session drives PostToolUse telemetry → Stop → `run.yaml`
 * rewrite → the dead run reads "fresh" again (adversarial review round 3,
 * finding 2). What survives is only what a hook never writes:
 *
 *   - `resolved-settings.json` — stamped once by `startRun`;
 *   - `handoffs/*` — written by the run's own lanes.
 *
 * The cost is a narrower window (a sentinel-resolved run older than the grace
 * period with no handoffs yet stands down). That is the correct direction to
 * err for a blocking gate, and it does not affect an explicit `GUILD_RUN_ID`,
 * which is trusted unconditionally.
 */
export function newestRunSignalMs(guildRoot: string, runId: string): number {
  const dir = path.join(guildRoot, ".guild", "runs", runId);
  const candidates = [path.join(dir, "resolved-settings.json")];
  // `handoffs/*` — written by the run's own lanes on completion.
  // `in-progress/*` — the per-lane heartbeat. It IS written by a hook
  // (`post-tool-use.ts` → `writeHeartbeatFromEnv`), but only from a process that
  // has BOTH GUILD_RUN_ID and GUILD_SPECIALIST set — i.e. from inside a lane,
  // never from unrelated LEAD hook activity. That narrower invariant is what
  // matters here: the feedback loop this exclusion set defends against is
  // lead-side, and a live lane heartbeat is exactly the signal that keeps a
  // long-running sentinel-scoped run (one whose first completed handoff is still
  // hours away) from aging out (adversarial review rounds 4 + 5, finding 2).
  for (const sub of ["handoffs", "in-progress"]) {
    try {
      for (const name of fs.readdirSync(path.join(dir, sub))) {
        candidates.push(path.join(dir, sub, name));
      }
    } catch {
      /* absent subdir — skip */
    }
  }
  let newest = 0;
  for (const p of candidates) {
    try {
      newest = Math.max(newest, fs.statSync(p).mtimeMs);
    } catch {
      /* absent file — skip */
    }
  }
  return newest;
}

/**
 * Is this run identity trustworthy enough to gate on?
 *
 * An `env`-sourced id always is. A `sentinel`-sourced id must additionally show
 * recent orchestrator activity, so a long-finished run whose `current-run-id`
 * sentinel was never cleared (`closeRun` does not clear it) can never gate a
 * later, unrelated session.
 */
export function isRunFresh(
  guildRoot: string,
  runId: string,
  source: RunIdSource,
  nowMs: number = Date.now(),
  graceMs: number = backendGuardGraceMs(),
): boolean {
  if (source === "env") return true;
  const newest = newestRunSignalMs(guildRoot, runId);
  if (newest === 0) return false;
  return nowMs - newest <= graceMs;
}

// ── Team-substrate availability ──────────────────────────────────────────────

/** Injectable probe seam so the matrix is testable without a real tmux. */
export type TmuxProbe = () => boolean;

/**
 * Restatement of `scripts/lib/host/tmux-backend.ts probeTmuxAvailable` —
 * `tmux -V` exiting 0. Restated rather than imported for the bundle-weight
 * reason in the module header (that file's import graph pulls the host registry,
 * the prompt builder, and the permission-policy machinery into a hook that runs
 * on every tool call). Semantics are identical; keep them that way.
 */
export function probeTmuxAvailable(): boolean {
  try {
    return spawnSync("tmux", ["-V"], { stdio: "ignore", timeout: 2000 }).status === 0;
  } catch {
    return false;
  }
}

/** Which team substrate this host can actually offer. */
export type SubstrateKind = "cmux" | "tmux" | "none";

/**
 * Which TEAM substrate is available on this host, for the given agent_mode?
 *
 * Mirrors the two AUTHORITIES that between them decide the team substrate — a
 * detector that disagrees with what actually runs is worse than none:
 *
 *   - cmux first, for BOTH modes. Rung 0 of `team` is a visible cmux surface
 *     keyed on `CMUX_WORKSPACE_ID`. This rung is NOT in the launcher — it is
 *     the skill-driven path in `execute-plan/SKILL.md §"Backend + routing
 *     (summary)"`, which explicitly BYPASSES `agent-team-launcher.ts` and has
 *     the lead assume the launcher-owned obligations. Probing only tmux would
 *     let `team` + cmux-present + tmux-absent through as if no team substrate
 *     existed (round 1, finding 2).
 *
 *   The tmux rungs below come from `scripts/agent-team-launcher.ts
 *   resolveBackend`, which has no cmux handling at all (round 5, finding 3):
 *
 *   - `auto` honors `$TMUX` BEFORE probing: the launcher's step 1 is
 *     "$TMUX set → team in-session", which never reaches `probeTmuxAvailable`.
 *     Ignoring it let `auto` + inside-a-tmux-session + a failing `tmux -V` pass
 *     as "no substrate" while the real resolver picked team (round 3, finding 3).
 *
 *   - explicit `team` does NOT honor `$TMUX`: for a pinned team the launcher
 *     gates on the PROBE alone and falls back to subagent when it fails, so
 *     treating `$TMUX` as substrate here would contradict that fallback.
 *
 * The KIND matters, not just the boolean: the two substrates have different
 * remedies — tmux goes through `agent-team-launcher.ts`, while cmux dispatch
 * explicitly BYPASSES that launcher and is driven by the lead through visible
 * cmux surfaces. Telling a cmux operator to run the tmux launcher is an
 * unusable instruction (round 2, finding 5).
 */
export function resolveTeamSubstrate(
  agentMode: string | null,
  env: NodeJS.ProcessEnv = process.env,
  probe: TmuxProbe = probeTmuxAvailable,
): SubstrateKind {
  const cmux = env["CMUX_WORKSPACE_ID"];
  if (typeof cmux === "string" && cmux.trim().length > 0) return "cmux";
  if (agentMode === AUTO_AGENT_MODE) {
    const tmuxEnv = env["TMUX"];
    if (typeof tmuxEnv === "string" && tmuxEnv.trim().length > 0) return "tmux";
  }
  return probe() ? "tmux" : "none";
}

// ── Override ─────────────────────────────────────────────────────────────────

/**
 * Is the conscious-fallback override engaged? Deliberately an ALLOWLIST of
 * affirmative tokens: an unset, empty, "0", "false", or otherwise unrecognized
 * value leaves the guard armed. An operator must opt in explicitly — and the
 * override still emits the degradation receipt (that is its whole point:
 * conscious, auditable fallback instead of a silent one).
 */
export function isOverrideEngaged(env: NodeJS.ProcessEnv): boolean {
  const raw = env[OVERRIDE_ENV];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Is STRICT unmarked-lane blocking engaged by the ENV VAR ALONE? Same
 * affirmative-allowlist doctrine as the override — unset / "0" / "false" reads
 * false.
 *
 * Kept as the narrow env-only predicate it always was (#93 did not widen it).
 * Call `resolveBlockUnmarkedLanes` for the ACTUAL runtime posture: this function
 * cannot see the registered `defaults.dispatch.block_unmarked_lanes` config key
 * and therefore under-reports whenever an operator configured strict mode
 * instead of exporting the env var.
 */
export function isBlockUnmarkedEngaged(env: NodeJS.ProcessEnv): boolean {
  const raw = env[BLOCK_UNMARKED_ENV];
  if (typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Parse `GUILD_BLOCK_UNMARKED_LANES` as a TRISTATE: true / false / "not stated".
 *
 * Strict mode is now a config key, so the env var's job changed from "the only
 * switch" to "the per-session OVERRIDE". An override that can only force a value
 * ON is not an override — an operator who configured
 * `block_unmarked_lanes: true` and hits a false positive on a quoted brief needs
 * a one-session escape hatch that does NOT require editing (and remembering to
 * revert) `.guild/settings.json`. So the negative tokens are honored too.
 *
 * Anything unrecognized (including the empty string) returns null and falls
 * through to config — a typo must never silently disarm a guard the operator
 * deliberately turned on.
 */
function parseBlockUnmarkedEnv(env: NodeJS.ProcessEnv): boolean | null {
  const raw = env[BLOCK_UNMARKED_ENV];
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return null;
}

/**
 * Read the RESOLVED `defaults.dispatch.block_unmarked_lanes` from the run's U6
 * resolved-settings snapshot. Returns null when the snapshot is absent,
 * unreadable, malformed, or carries no BOOLEAN for the field — i.e. "the run
 * never stated a value", which the caller turns into the registered default.
 *
 * ── WHY THE SNAPSHOT AND NOT `resolveSettings()` ────────────────────────────
 * `lean-lead-guard.ts` / `lifecycle-gate.ts` / `update-check.ts` read their keys
 * by lazily requiring the canonical resolver, and that is right FOR THEM — they
 * run once per session-ish event and their bundles are already 800-900 KB. This
 * module lives in `pre-tool-use.js`, which runs on EVERY tool call in every
 * session; wiring the resolver in here was measured at 110 KB → 923 KB for that
 * bundle, an 8x parse-cost regression on the hottest hook Guild ships. That is
 * precisely the tradeoff this file's header already calls out for
 * `readResolvedSettingsSnapshot`.
 *
 * The snapshot loses NOTHING in fidelity. `runstart-preflight.ts` computes
 * `effective.block_unmarked_lanes` from `resolveSettings()` itself, so the value
 * frozen here has already been through the full 5-layer chain — builtin <
 * workspace settings.json < workspace settings.local.json < project
 * settings.json < project settings.local.json. Workspace inheritance and the
 * local layer (PR #87's codex round-2 P1 finding) are honored by construction.
 *
 * What it changes is WHEN: the value is the one the run committed to at start,
 * exactly like `agent_mode` two functions up. Editing settings.json mid-run does
 * not re-arm the guard — `GUILD_BLOCK_UNMARKED_LANES` is the in-session lever,
 * which is the whole reason #93 kept it as an override rather than deleting it.
 *
 * The snapshot is always THERE when this matters: `pre-tool-use.ts` bails out
 * before ever calling the guard unless `readSnapshotAgentMode` returned "team"
 * or "auto" from this same file, so a run with no readable snapshot never
 * reaches strict-mode evaluation at all.
 *
 * `runId` MUST already be validated as a safe single path component by the
 * caller (`isSafeRunId`) — this function does not re-derive path safety.
 */
export function readSnapshotBlockUnmarkedLanes(
  guildRoot: string,
  runId: string,
): boolean | null {
  const file = path.join(guildRoot, ".guild", "runs", runId, "resolved-settings.json");
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return null;
  const effective = (doc as Record<string, unknown>)["effective"];
  if (effective === null || typeof effective !== "object" || Array.isArray(effective)) {
    return null;
  }
  const v = (effective as Record<string, unknown>)["block_unmarked_lanes"];
  // A non-boolean is IGNORED, never coerced: the string "false" is truthy, and
  // reading it as "on" would engage a BLOCKING gate nobody asked for.
  return typeof v === "boolean" ? v : null;
}

/**
 * The runtime posture for strict unmarked-lane blocking.
 *
 * Precedence, highest first:
 *   1. `GUILD_BLOCK_UNMARKED_LANES`, when it states a recognized boolean — the
 *      per-session operator override, in BOTH directions;
 *   2. the run's resolved `defaults.dispatch.block_unmarked_lanes`;
 *   3. `DEFAULT_BLOCK_UNMARKED_LANES` (OFF).
 */
export function resolveBlockUnmarkedLanes(
  guildRoot: string,
  runId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const fromEnv = parseBlockUnmarkedEnv(env);
  if (fromEnv !== null) return fromEnv;
  const fromSnapshot = readSnapshotBlockUnmarkedLanes(guildRoot, runId);
  if (fromSnapshot !== null) return fromSnapshot;
  return DEFAULT_BLOCK_UNMARKED_LANES;
}

// ── Display sanitization ─────────────────────────────────────────────────────

/**
 * `subagent_type` arrives verbatim from the dispatch and is rendered into a
 * TRUSTED, model-visible deny message and stored in the receipt. An unbounded
 * value could carry newlines or instruction-shaped text and restructure that
 * trusted frame (adversarial review round 1, finding 7). Same doctrine as
 * `reanchor.ts`'s `safeIdent`: allowlist or drop.
 *
 * The bound matches the host's own agent-type vocabulary (`general-purpose`,
 * `codex:codex-rescue`, `guild:developer`, `Explore`, …).
 */
const SAFE_SUBAGENT_TYPE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

/** Bound a subagent_type for rendering/telemetry; anything else ⇒ "<unsafe>". */
export function safeSubagentType(value: string): string {
  if (value.length === 0) return "<absent>";
  return SAFE_SUBAGENT_TYPE_RE.test(value) ? value : "<unsafe>";
}

// ── The decision ─────────────────────────────────────────────────────────────

/** What the detector decided for this dispatch. */
export type BackendDegradationDecision =
  /** Not a degradation (or not enough proof) — the dispatch is untouched. */
  | "pass"
  /** A degradation with a HONORABLE team substrate present — blocked fail-closed. */
  | "deny"
  /** The same case, consciously accepted by the operator via the override env. */
  | "allow_override"
  /** A degradation the plugin can observe but must not block — receipt only. */
  | "allow_recorded";

/** Why the detector decided what it did — carried on the receipt. */
export type BackendDegradationReason =
  /**
   * agent_mode="team" AND a team substrate (tmux or cmux) IS available: the run
   * committed to panes, panes are possible, and the lane went in-session anyway.
   * The exact #56 forensic shape.
   */
  | "team_substrate_available"
  /**
   * agent_mode="auto" AND a team substrate IS available. The snapshot stores the
   * CONFIGURED value verbatim (`runstart-preflight.ts` does not ladder-resolve
   * it), and the D5 ladder then resolves `auto` + tmux to `team`
   * (`agent-team-launcher.ts`: "$TMUX set → team in-session" / "tmux installed →
   * team new-session"). So the effective backend here IS team and an in-session
   * lane is the same degradation — blocked identically. "auto is the default" is
   * NOT an exemption: the detector only ever fires on a Guild LANE dispatch, and
   * under auto+tmux that dispatch is going through the wrong mechanism no matter
   * how the mode was reached (adversarial review round 2, finding 1).
   */
  | "auto_resolves_to_team"
  /**
   * agent_mode="team" but NO team substrate is available. `agent-team-launcher.ts`
   * itself downgrades this case to subagent with a stderr warning, so blocking it
   * would contradict the shipping ladder. Recorded, not blocked — which is still
   * the fix for the silence: the downgrade now leaves a durable receipt.
   */
  | "team_substrate_unavailable";

export interface BackendDegradationFacts {
  /** The raw `Agent` tool_input — the structured-carrier source. */
  toolInput: unknown;
  /** #58 attribution for this dispatch. */
  attr: DispatchAttribution;
  /** The dispatch's prompt (lane-brief signature source). */
  prompt: string;
  /** The active run id — binds the lane-brief receipt-path signature to THIS run. */
  runId: string;
  /** `effective.agent_mode` from the run's resolved-settings snapshot; null when unknown. */
  agentMode: string | null;
  /** Which team substrate this host offers (cmux > tmux > none). */
  substrate: SubstrateKind;
  /** Whether the operator engaged the conscious-fallback override. */
  overrideEngaged: boolean;
  /** Whether the dispatching process is the run LEAD (not a lane spawning a helper). */
  isLead: boolean;
  /** Whether the run identity is trustworthy enough to gate on (stale sentinel guard). */
  runFresh: boolean;
  /**
   * G3 — the operator opted into blocking a lane that carries NO structured
   * producer marker. Supplied by `resolveBlockUnmarkedLanes` (#93): the resolved
   * `defaults.dispatch.block_unmarked_lanes` config key, with
   * `GUILD_BLOCK_UNMARKED_LANES` as a per-session override. When engaged, a prompt-only
   * degradation (which is by construction unmarked) becomes blockable instead of
   * merely recorded. Default false ⇒ the pre-G3 record-not-block behaviour, so
   * the no-false-positive invariant on a quoted live brief holds unless the
   * operator turns strict mode on. Absent on hand-built facts ⇒ treated false.
   */
  blockUnmarked?: boolean;
}

export interface BackendDegradationResult {
  decision: BackendDegradationDecision;
  /** How strong the lane evidence was — decides whether a DENY was permissible. */
  evidence: LaneEvidence;
  /** Absent on "pass". */
  reason?: BackendDegradationReason;
  /**
   * The backend the D5 ladder actually resolves for this (agent_mode × substrate)
   * pair — "team" when panes/surfaces are what SHOULD have been used. Absent on
   * "pass". Distinct from the snapshot's configured `agent_mode`, which may be
   * the unresolved "auto".
   */
  effectiveBackend?: "team";
  /** The specialist role this lane claims, when determinable (already #58-bounded). */
  specialist?: string;
  /** subagent_type as dispatched, bounded for display/telemetry. */
  subagentType: string;
}

/**
 * The #56 predicate.
 *
 * Preconditions common to every non-pass outcome — all must hold:
 *   - the dispatch is a Guild specialist LANE (`isGuildLaneDispatch`);
 *   - the dispatching process is the run LEAD (a pane-local helper is exempt);
 *   - the run identity is trustworthy (a stale `current-run-id` sentinel never
 *     gates).
 *
 * Then the outcome is driven by (agent_mode × substrate) — see
 * `BackendDegradationReason` for the per-row rationale:
 *
 *   team + substrate (tmux|cmux) → deny  (allow_override with the override env)
 *   auto + substrate (tmux|cmux) → deny  (the ladder resolves auto+substrate→team)
 *   team + no substrate          → allow_recorded
 *   auto + no substrate          → pass   (the ladder resolves to agent/subagent)
 *   agent | subagent | unknown   → pass   (Agent dispatch is the DESIGNED path)
 *
 * A DENY additionally requires STRUCTURED lane evidence. With prompt-only
 * evidence the same row yields `allow_recorded` — see `LaneEvidence`.
 *
 * Note the deny does NOT require `subagent_type === "general-purpose"`. The pane
 * backend does not route through the `Agent` tool at all (panes are spawned by
 * `agent-team-launcher.ts` over tmux, and teammate work arrives on TaskCreated),
 * so ANY in-session `Agent` lane dispatch under a resolved team backend is the
 * degradation — whichever subagent_type it wears. Gating on the generic type
 * would leave the `Explore`-typed variant seen in the same forensic run
 * (3 of 54 dispatches) undetected.
 */
export function resolveBackendDegradation(
  facts: BackendDegradationFacts,
): BackendDegradationResult {
  const evidence = classifyLaneEvidence(
    facts.toolInput,
    facts.attr,
    facts.prompt,
    facts.runId,
  );
  const base: BackendDegradationResult = {
    decision: "pass",
    evidence,
    subagentType: safeSubagentType(facts.attr.subagentType),
  };
  if (facts.attr.specialist !== undefined) base.specialist = facts.attr.specialist;

  if (!facts.isLead) return base;
  if (!facts.runFresh) return base;
  if (evidence === "none") return base;

  const hasSubstrate = facts.substrate !== "none";

  if (facts.agentMode === TEAM_AGENT_MODE && !hasSubstrate) {
    return { ...base, decision: "allow_recorded", reason: "team_substrate_unavailable" };
  }

  if (hasSubstrate) {
    const reason: BackendDegradationReason | null =
      facts.agentMode === TEAM_AGENT_MODE
        ? "team_substrate_available"
        : facts.agentMode === AUTO_AGENT_MODE
          ? "auto_resolves_to_team"
          : null;
    if (reason !== null) {
      // Only STRUCTURED evidence may block by default. Prompt-only evidence
      // cannot be told apart from an audit prompt quoting a live brief, so it is
      // recorded instead — the degradation stays visible without a
      // false-positive DENY.
      //
      // G3 — once the structured producer marker is UNIVERSAL, a genuine lane
      // always carries it, so a prompt-only (⇒ unmarked, by construction — the
      // marker is a structured carrier) lane is drift the guard CAN block when
      // the operator opts into `blockUnmarked`. The residual quoted-live-brief
      // false positive is the conscious cost of strict mode, and the override
      // (`GUILD_ALLOW_BACKEND_DEGRADE`) is its documented escape — so the
      // override still only applies to a case that WOULD have been denied.
      const blockUnmarked = facts.blockUnmarked === true;
      const blockable =
        evidence === "structured" ||
        (blockUnmarked && evidence === "prompt_only" && !hasProducerMarker(facts.toolInput));
      return {
        ...base,
        decision: !blockable
          ? "allow_recorded"
          : facts.overrideEngaged
            ? "allow_override"
            : "deny",
        reason,
        effectiveBackend: "team",
      };
    }
  }

  return base;
}

// ── Operator-facing messages ─────────────────────────────────────────────────

const LAUNCHER_HINT =
  "npx tsx ${GUILD_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/scripts/agent-team-launcher.ts " +
  "--team <resolved-team-path> --cwd <repo-root> --run-id <run-id>";

/**
 * The substrate-specific remedy. cmux dispatch explicitly BYPASSES the tmux
 * launcher — the lead drives visible cmux surfaces itself and assumes the
 * launcher-owned obligations (`execute-plan/SKILL.md §"Backend + routing
 * (summary)"`), so pointing a cmux operator at `agent-team-launcher.ts` names a
 * tool that cannot honor the substrate it actually has (adversarial review
 * round 2, finding 5).
 */
export function remedyForSubstrate(substrate: SubstrateKind): string {
  if (substrate === "cmux") {
    return (
      `CMUX_WORKSPACE_ID is set, so the team substrate here is cmux (rung 0 of team, ` +
      `checked BEFORE tmux): dispatch each lane as its own VISIBLE cmux surface ` +
      `(cmux new-pane / new-surface --focus false, never a focus-stealing verb), arm a ` +
      `per-lane handoff watcher, and reap each surface on receipt — the lead assumes the ` +
      `launcher-owned obligations. Full mechanics: skills/meta/execute-plan/SKILL.md ` +
      `§"Backend + routing (summary)". Do NOT route this through agent-team-launcher.ts; ` +
      `the cmux rung bypasses it.`
    );
  }
  return (
    `Dispatch through the launcher instead: ${LAUNCHER_HINT} (it owns the D5 ladder, the ` +
    `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS gate, and the tmux strategy).`
  );
}

/** How the resolved backend came to be "team" — for the operator-facing message. */
function backendClause(reason: BackendDegradationReason): string {
  return reason === "auto_resolves_to_team"
    ? `this run's agent_mode is "auto" and a team substrate IS available, which the D5 ` +
        `ladder resolves to the TEAM backend`
    : `this run's resolved agent_mode is "team" and a team substrate IS available`;
}

/**
 * The loud, actionable deny message. Mirrors `dispatch-attribution.ts`'s
 * fail-closed style: name the invariant, name the concrete substrate-appropriate
 * remedy, and name the explicit override so an operator who really does need to
 * fall back has a documented, auditable door instead of quietly re-rolling the
 * same drifted dispatch.
 *
 * Both interpolated identity values are pre-bounded: `role` by #58's
 * SAFE_ROLE_RE, `subagentType` by `safeSubagentType`.
 */
export function buildDenyMessage(
  reason: BackendDegradationReason,
  role: string,
  subagentType: string,
  substrate: SubstrateKind,
  evidence: LaneEvidence = "structured",
): string {
  // G3 — a prompt-only DENY only happens under strict mode (`blockUnmarked`):
  // the lane carries no structured producer marker, so it was not composed by a
  // Guild producer (drift). Name that explicitly so the operator understands why
  // an unmarked lane is now blocked, and how to make it legitimate.
  const unmarkedClause =
    evidence === "prompt_only"
      ? `This lane carries NO structured producer marker (${PRODUCER_MARKER_ENV}) — it was ` +
        `not composed by a Guild dispatch producer, which is the drift signature strict ` +
        `mode (${BLOCK_UNMARKED_CONFIG_KEY} / ${BLOCK_UNMARKED_ENV}) blocks. Dispatch it ` +
        `through the producer path so it ` +
        `carries the marker, or `
      : "";
  return (
    `Guild backend integrity (#56): ${backendClause(reason)}, but the "${role}" lane is ` +
    `being dispatched through the in-session Agent tool ` +
    `(subagent_type="${subagentType}") instead of a visible pane/surface. That is a ` +
    `silent BACKEND DEGRADATION: no pane, no named specialist, and lane execution ` +
    `semantics change out from under the approved plan. guild:execute-plan's contract is ` +
    `refuse-don't-fallback (skills/meta/execute-plan/dispatch.md §"Backend choice"). ` +
    `${unmarkedClause}${remedyForSubstrate(substrate)} ` +
    `If the team backend genuinely cannot be honored, downgrade CONSCIOUSLY: re-run with ` +
    `${OVERRIDE_ENV}=1 — the fallback is then allowed and a ` +
    `${BACKEND_DEGRADATION_EVENT} receipt is written to the run record either way. ` +
    `Blocking this dispatch.`
  );
}

/**
 * The message for a degradation that is allowed rather than blocked. Also the
 * receipt's durable `detail`, so it must be accurate for EVERY allowed row:
 * branch on the REASON first (an unavailable substrate must never be described
 * as available), then on the evidence tier (adversarial review round 5,
 * finding 1).
 */
export function buildAllowMessage(
  reason: BackendDegradationReason,
  role: string,
  subagentType: string,
  substrate: SubstrateKind,
  evidence: LaneEvidence,
  decision: BackendDegradationDecision = "allow_recorded",
): string {
  const head =
    `Guild backend integrity (#56): the "${role}" lane was dispatched through the ` +
    `in-session Agent tool (subagent_type="${subagentType}"). `;
  const tail =
    `Recording a ${BACKEND_DEGRADATION_EVENT} receipt at ` +
    `.guild/runs/<run-id>/${RECEIPT_RELATIVE_PATH} so the downgrade is auditable ` +
    `post-hoc.`;
  // Named generically: prompt-only evidence is ANY signal read out of the prompt
  // body — the handoff-protocol block, or #58's adoption marker / role anchor /
  // dispatch prose. Naming only the handoff block would misreport the others.
  const promptOnlyClause =
    `The lane was identified from PROMPT TEXT alone (the handoff-protocol block, ` +
    `or the #58 adoption marker / role anchor / dispatch prose) — the dispatch env ` +
    `carries no GUILD_SPECIALIST / GUILD_TASK_ID / GUILD_AGENT_DEFINITION carrier. ` +
    `Quoted text is indistinguishable from a real brief, so this is recorded, not ` +
    `blocked.`;

  if (reason === "team_substrate_unavailable") {
    return (
      head +
      `agent_mode="team" but NO team substrate (tmux/cmux) is available, so the resolved ` +
      `backend cannot be honored — agent-team-launcher.ts downgrades this case itself, ` +
      `so it is not blocked here. ` +
      (evidence === "prompt_only" ? `${promptOnlyClause} ` : "") +
      tail
    );
  }
  // G3 — a conscious OVERRIDE wins over the evidence tier. Under strict mode
  // (`blockUnmarked`) a prompt-only lane CAN be denied, so an allow_override can
  // now carry prompt_only evidence; describing it as merely "recorded, not
  // blocked" would misreport that the override opened a door that WAS shut.
  if (decision === "allow_override") {
    return (
      head +
      `OVERRIDDEN: ${backendClause(reason)}` +
      (evidence === "prompt_only"
        ? ` and this lane carries NO structured producer marker (${PRODUCER_MARKER_ENV}) — ` +
          `strict mode (${BLOCK_UNMARKED_CONFIG_KEY} / ${BLOCK_UNMARKED_ENV}) would block it, ` +
          `but the in-session fallback ` +
          `was allowed because ${OVERRIDE_ENV} is set`
        : `, and the in-session fallback was allowed because ${OVERRIDE_ENV} is set`) +
      `. To honor the backend instead: ${remedyForSubstrate(substrate)} ${tail}`
    );
  }
  if (evidence === "prompt_only") {
    return (
      head +
      `${backendClause(reason)}. ${promptOnlyClause} If it IS a lane, honor the ` +
      `backend: ${remedyForSubstrate(substrate)} ${tail}`
    );
  }
  return (
    head +
    `OVERRIDDEN: ${backendClause(reason)}, and the in-session fallback was allowed ` +
    `because ${OVERRIDE_ENV} is set. To honor the backend instead: ` +
    `${remedyForSubstrate(substrate)} ${tail}`
  );
}

// ── Receipt ──────────────────────────────────────────────────────────────────

/**
 * The `backend_degradation` receipt.
 *
 * Written to its OWN sink (`RECEIPT_RELATIVE_PATH`) with its own
 * `schema_version` — never into `logs/v1.4-events.jsonl`, whose validator
 * accepts only the frozen v1.4 `EVENT_TYPES`, the hook-name mirror family, and
 * `guild.trace.*.v1` (adversarial review round 1, finding 1).
 *
 * Field shape still follows the telemetry convention (ts / event / tool /
 * specialist / ok / ms) plus the v2 `span_id` from `trace-v2.ts genSpanId`, so a
 * consumer that already parses Guild trace lines parses these unchanged.
 */
export interface BackendDegradationEvent {
  schema_version: typeof BACKEND_DEGRADATION_SCHEMA;
  ts: string;
  event: typeof BACKEND_DEGRADATION_EVENT;
  tool: "Agent";
  specialist: string;
  ok: boolean;
  ms: 0;
  run_id: string;
  /** "deny" | "allow_override" | "allow_recorded" — a "pass" never produces a receipt. */
  decision: Exclude<BackendDegradationDecision, "pass">;
  /** Which row of the matrix fired. */
  reason: BackendDegradationReason;
  /**
   * The snapshot's CONFIGURED agent_mode, verbatim ("team" | "auto"). Named for
   * what it is: `runstart-preflight.ts` stores the configured value without
   * ladder-resolving it, so calling this the "resolved backend" was wrong
   * (adversarial review round 2, finding 1).
   */
  snapshot_agent_mode: string;
  /**
   * The backend the D5 ladder resolves for (snapshot_agent_mode × substrate) —
   * i.e. what SHOULD have run. Absent on `team_substrate_unavailable`, where no
   * team backend was actually reachable.
   */
  effective_backend?: "team";
  /** Which team substrate the host offered at decision time. */
  substrate: SubstrateKind;
  /**
   * How the dispatch was identified as a lane. "prompt_only" receipts are
   * lower-confidence by construction (they can also be an audit prompt quoting
   * a live brief) and are never blocked — a consumer triaging these should
   * weight "structured" far more heavily.
   */
  lane_evidence: LaneEvidence;
  /** subagent_type the degraded dispatch wore (bounded by safeSubagentType). */
  attempted_subagent_type: string;
  /** Present only on an overridden allow — names the env var that opened the door. */
  override_env?: string;
  detail: string;
  span_id: string;
  lane_id?: string;
}

export interface BuildReceiptInput {
  runId: string;
  ts: string;
  spanId: string;
  decision: Exclude<BackendDegradationDecision, "pass">;
  reason: BackendDegradationReason;
  specialist: string;
  subagentType: string;
  /** The snapshot's configured agent_mode, verbatim. */
  agentMode: string;
  /** The ladder-resolved backend, when one was reachable. */
  effectiveBackend?: "team";
  substrate: SubstrateKind;
  evidence: LaneEvidence;
  detail: string;
  laneId?: string;
}

/** Pure builder — the file write is the caller's (see `appendBackendDegradationEvent`). */
export function buildBackendDegradationEvent(
  input: BuildReceiptInput,
): BackendDegradationEvent {
  const evt: BackendDegradationEvent = {
    schema_version: BACKEND_DEGRADATION_SCHEMA,
    ts: input.ts,
    event: BACKEND_DEGRADATION_EVENT,
    tool: "Agent",
    specialist: input.specialist,
    // A degradation is never an "ok" dispatch, whether or not it was allowed —
    // an allowed downgrade is still a downgrade the run record must flag.
    ok: false,
    ms: 0,
    run_id: input.runId,
    decision: input.decision,
    reason: input.reason,
    snapshot_agent_mode: input.agentMode,
    substrate: input.substrate,
    lane_evidence: input.evidence,
    attempted_subagent_type: safeSubagentType(input.subagentType),
    detail: input.detail,
    span_id: input.spanId,
  };
  if (input.effectiveBackend !== undefined) evt.effective_backend = input.effectiveBackend;
  if (input.decision === "allow_override") evt.override_env = OVERRIDE_ENV;
  if (input.laneId !== undefined) evt.lane_id = input.laneId;
  return evt;
}

/**
 * Append the receipt to the run record at `<runDir>/logs/backend-degradation.jsonl`.
 *
 * Best-effort and non-throwing: a telemetry failure must NEVER change the gate
 * decision the caller already made. Returns true on a successful write.
 */
export function appendBackendDegradationEvent(
  runDir: string,
  event: BackendDegradationEvent,
): boolean {
  try {
    const file = path.join(runDir, RECEIPT_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(event) + "\n", "utf8");
    return true;
  } catch (err) {
    process.stderr.write(
      `warn: [backend-degradation] receipt write failed: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    return false;
  }
}
