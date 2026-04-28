// v1.4.0 adversarial-loops — F-1 / F-2 / F-3 loop drivers.
//
// Three drivers, one shared termination contract:
//
//   guild:loop-clarify     — F-1 architect ↔ researcher (pre-spec).
//   guild:loop-plan-review — F-2 architect ↔ security  (pre-Gate-3).
//   guild:loop-implement   — F-3 dev ↔ tester / dev ↔ qa / dev ↔ security
//                            with security restart (per-lane).
//
// These drivers are PURE STATE MACHINES — they do not spawn agents
// themselves. The orchestrator (or test) supplies a `roundFn` callback
// that returns the next handoff body (the architect's brief, the
// researcher's response, the security finding, etc.). The driver:
//
//   1. Calls `roundFn` to get the challenger's response for round N.
//   2. Runs the sentinel detector on the response body.
//   3. Updates per-loop counters (counter-store) + emits JSONL events.
//   4. Decides: continue / terminate-clean / malformed / cap-hit / escalate.
//   5. Returns the typed output shape per the architect contract.
//
// This separation lets us:
//   - Test the state machine deterministically (no agent dispatch).
//   - Share the cap/escalation/restart semantics across all 3 layers.
//   - Stub T3c's JSONL writer cleanly.

import {
  getLaneCounter,
  incrementL1,
  incrementL2,
  incrementLaneCounter,
  resetLaneCounters,
} from "./counter-store.js";
import {
  ESCALATION_LABELS,
  buildEscalationEvent,
  type EscalationLabel,
} from "./loop-escalation.js";
import {
  type FindingsParseResult,
  isRestartCapHit,
  malformedFindingAssumptionText,
  parseSecurityFindings,
  RESTART_CAP_DEFAULT,
  shouldRestartFromSecurity,
  supersedePriorReceipts,
} from "./loop-implement-restart.js";
import type { LoopJsonlAppender } from "./loop-jsonl-stub.js";
import {
  detectSentinel,
  MalformedRunCounter,
  type SentinelOutcome,
} from "./loop-sentinel.js";

// ──────────────────────────────────────────────────────────────────────────
// Shared types
// ──────────────────────────────────────────────────────────────────────────

/**
 * Layer identifier used for counter keys + JSONL event field.
 *   L1   → loop-clarify
 *   L2   → loop-plan-review
 *   L3   → loop-implement (dev ↔ tester)
 *   L4   → loop-implement (dev ↔ qa)
 *   security-review → loop-implement (dev ↔ security; can trigger restart)
 */
export type LoopLayer = "L1" | "L2" | "L3" | "L4" | "security-review";

/**
 * Result of one round: the challenger's handoff body. The driver
 * inspects this for the sentinel + post-sentinel regex matches.
 *
 * `terminator` is the specialist that emitted this round's response —
 * stamped onto the `loop_round_end.terminator` field.
 */
export interface RoundResponse {
  body: string;
  terminator: string;
}

/**
 * Per-round callback: the orchestrator/test supplies one. Receives the
 * round number (1-indexed) and the prior body (if any) and returns the
 * next challenger response.
 *
 * The callback is responsible for actually invoking the producer +
 * challenger agents in production; in tests it returns canned bodies.
 */
export type RoundFn = (
  roundNumber: number,
  priorBody: string | null,
) => RoundResponse | Promise<RoundResponse>;

/**
 * User-decision callback: dispatched on cap-hit / malformed-x2 /
 * restart-cap-hit. Returns one of the three escalation labels.
 *
 * In production this wraps `AskUserQuestion` (or the stdin fallback);
 * in tests it returns a canned choice.
 */
export type EscalationFn = (reason: EscalationReason) =>
  | EscalationLabel
  | Promise<EscalationLabel>;

export type EscalationReason =
  | "cap_hit"
  | "malformed_termination_x2"
  | "restart_cap_hit";

/** Common output status across all three drivers. */
export type LoopStatus =
  | "satisfied"
  | "cap_hit"
  | "escalated"
  | "rework"
  | "restart_cap_hit";

// ──────────────────────────────────────────────────────────────────────────
// guild:loop-clarify — F-1 (L1: architect ↔ researcher)
// ──────────────────────────────────────────────────────────────────────────

export interface LoopClarifyInput {
  brief: string;
  loops_mode: "spec" | "all";
  cap: number;
  run_id: string;
  /** Per-test/orchestrator round dispatcher. */
  roundFn: RoundFn;
  /** Cap-hit / malformed-x2 escalation user choice provider. */
  escalationFn: EscalationFn;
  /** JSONL writer (T3c stub or in-memory test impl). */
  jsonl: LoopJsonlAppender;
  /**
   * Run dir for counter-store. The L1 counter `L1` lives in
   * `<runDir>/counters.json`.
   */
  runDir: string;
  /** Clock for ts fields; defaults to ISO string of current Date. */
  now?: () => string;
}

export interface LoopClarifyOutput {
  status: LoopStatus;
  rounds: number;
  unresolved_questions: string[];
  assumptions: string[];
  next: "guild:brainstorm" | "abort";
}

const SYNTHETIC_LANE_L1 = "phase:brainstorm";

export async function runLoopClarify(
  input: LoopClarifyInput,
): Promise<LoopClarifyOutput> {
  const now = input.now ?? defaultNow;
  const malformed = new MalformedRunCounter();
  let priorBody: string | null = null;
  let cap = input.cap;
  const baseRun = {
    runDir: input.runDir,
    runId: input.run_id,
    laneId: SYNTHETIC_LANE_L1,
    layer: "L1" as const,
    counterKey: "l1_round",
  };

  for (let roundNumber = 1; roundNumber <= cap; roundNumber++) {
    incrementL1(baseRun.runDir, baseRun.runId);
    input.jsonl.append({
      ts: now(),
      event: "loop_round_start",
      run_id: input.run_id,
      lane_id: SYNTHETIC_LANE_L1,
      loop_layer: "L1",
      round_number: roundNumber,
      cap,
    });

    const resp = await input.roundFn(roundNumber, priorBody);
    const outcome = detectSentinel(resp.body);
    const tag = malformedTagFromOutcome(outcome);
    input.jsonl.append({
      ts: now(),
      event: "loop_round_end",
      run_id: input.run_id,
      lane_id: SYNTHETIC_LANE_L1,
      loop_layer: "L1",
      round_number: roundNumber,
      terminated: tag,
      terminator: resp.terminator,
    });

    if (outcome.kind === "clean") {
      return {
        status: "satisfied",
        rounds: roundNumber,
        unresolved_questions: [],
        assumptions: [],
        next: "guild:brainstorm",
      };
    }

    const malformedState = malformed.record(outcome);
    if (malformedState.shouldEscalate) {
      const out = await escalateAndRoute({
        reason: "malformed_termination_x2",
        roundNumber,
        ...baseRun,
        runId: input.run_id,
        jsonl: input.jsonl,
        escalationFn: input.escalationFn,
        unresolved_questions: extractQuestions(resp.body),
        next_on_force_pass: "guild:brainstorm",
        next_on_rework: "abort",
        now,
      });
      return {
        status: out.status,
        rounds: out.rounds,
        unresolved_questions: out.unresolved_questions,
        assumptions: out.assumptions,
        next: out.next as "guild:brainstorm" | "abort",
      };
    }
    priorBody = resp.body;
  }

  // Cap exhausted without a clean termination.
  const out = await escalateAndRoute({
    reason: "cap_hit",
    roundNumber: cap,
    ...baseRun,
    runId: input.run_id,
    jsonl: input.jsonl,
    escalationFn: input.escalationFn,
    unresolved_questions: priorBody ? extractQuestions(priorBody) : [],
    next_on_force_pass: "guild:brainstorm",
    next_on_rework: "abort",
    now,
  });
  return {
    status: out.status,
    rounds: out.rounds,
    unresolved_questions: out.unresolved_questions,
    assumptions: out.assumptions,
    next: out.next as "guild:brainstorm" | "abort",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// guild:loop-plan-review — F-2 (L2: architect ↔ security)
// ──────────────────────────────────────────────────────────────────────────

export interface LoopPlanReviewInput {
  plan_path: string;
  spec_path: string;
  loops_mode: "plan" | "all";
  cap: number;
  run_id: string;
  roundFn: RoundFn;
  escalationFn: EscalationFn;
  jsonl: LoopJsonlAppender;
  runDir: string;
  now?: () => string;
}

export interface LoopPlanReviewOutput {
  status: LoopStatus;
  rounds: number;
  unresolved_questions: string[];
  next: "gate-3-plan-approval" | "abort";
}

const SYNTHETIC_LANE_L2 = "phase:plan";

export async function runLoopPlanReview(
  input: LoopPlanReviewInput,
): Promise<LoopPlanReviewOutput> {
  const now = input.now ?? defaultNow;
  const malformed = new MalformedRunCounter();
  let priorBody: string | null = null;
  const cap = input.cap;
  const baseRun = {
    runDir: input.runDir,
    runId: input.run_id,
    laneId: SYNTHETIC_LANE_L2,
    layer: "L2" as const,
    counterKey: "l2_round",
  };

  for (let roundNumber = 1; roundNumber <= cap; roundNumber++) {
    incrementL2(baseRun.runDir, baseRun.runId);
    input.jsonl.append({
      ts: now(),
      event: "loop_round_start",
      run_id: input.run_id,
      lane_id: SYNTHETIC_LANE_L2,
      loop_layer: "L2",
      round_number: roundNumber,
      cap,
    });

    const resp = await input.roundFn(roundNumber, priorBody);
    const outcome = detectSentinel(resp.body);
    const tag = malformedTagFromOutcome(outcome);
    input.jsonl.append({
      ts: now(),
      event: "loop_round_end",
      run_id: input.run_id,
      lane_id: SYNTHETIC_LANE_L2,
      loop_layer: "L2",
      round_number: roundNumber,
      terminated: tag,
      terminator: resp.terminator,
    });

    if (outcome.kind === "clean") {
      return {
        status: "satisfied",
        rounds: roundNumber,
        unresolved_questions: [],
        next: "gate-3-plan-approval",
      };
    }

    const malformedState = malformed.record(outcome);
    if (malformedState.shouldEscalate) {
      const out = await escalateAndRoute({
        reason: "malformed_termination_x2",
        roundNumber,
        ...baseRun,
        runId: input.run_id,
        jsonl: input.jsonl,
        escalationFn: input.escalationFn,
        unresolved_questions: extractQuestions(resp.body),
        next_on_force_pass: "gate-3-plan-approval",
        next_on_rework: "abort",
        now,
      });
      return {
        status: out.status,
        rounds: out.rounds,
        unresolved_questions: out.unresolved_questions,
        next: out.next as "gate-3-plan-approval" | "abort",
      };
    }
    priorBody = resp.body;
  }

  const out = await escalateAndRoute({
    reason: "cap_hit",
    roundNumber: cap,
    ...baseRun,
    runId: input.run_id,
    jsonl: input.jsonl,
    escalationFn: input.escalationFn,
    unresolved_questions: priorBody ? extractQuestions(priorBody) : [],
    next_on_force_pass: "gate-3-plan-approval",
    next_on_rework: "abort",
    now,
  });
  return {
    status: out.status,
    rounds: out.rounds,
    unresolved_questions: out.unresolved_questions,
    next: out.next as "gate-3-plan-approval" | "abort",
  };
}

// ──────────────────────────────────────────────────────────────────────────
// guild:loop-implement — F-3 (L3 + L4 + security-review with restart)
// ──────────────────────────────────────────────────────────────────────────

export interface LoopImplementInput {
  lane_id: string;
  owner: string;
  loops_applicable: "none" | "l3-only" | "l4-only" | "both" | "full";
  loops_mode: "implementation" | "all";
  cap: number;
  /** Default RESTART_CAP_DEFAULT (cap = 3) per architect. */
  restart_cap?: number;
  run_id: string;
  task_id: string;
  runDir: string;
  /** Map from layer → roundFn dispatcher. Test/orchestrator supplies one per active layer. */
  roundFns: {
    L3?: RoundFn;
    L4?: RoundFn;
    "security-review"?: RoundFn;
  };
  escalationFn: EscalationFn;
  jsonl: LoopJsonlAppender;
  now?: () => string;
  /**
   * Path to the new (post-restart) receipt; used to write the
   * `superseded_by:` cross-references when restart fires. Caller-supplied
   * because the orchestrator owns the new receipt path.
   */
  newReceiptRelPath?: string;
}

export interface LoopImplementOutput {
  status: LoopStatus;
  layers_run: ImplLayer[];
  rounds_per_layer: { L3?: number; L4?: number; "security-review"?: number };
  restart_count: number;
  superseded_receipts: string[];
  unresolved_questions: string[];
  assumptions: string[];
  next: "next-lane" | "abort";
}

export async function runLoopImplement(
  input: LoopImplementInput,
): Promise<LoopImplementOutput> {
  const now = input.now ?? defaultNow;
  const restartCap = input.restart_cap ?? RESTART_CAP_DEFAULT;
  const layersToRun = activeLayersFor(input.loops_applicable);
  const layers_run: ImplLayer[] = [];
  const rounds_per_layer: LoopImplementOutput["rounds_per_layer"] = {};
  // Architect contract: "Restart cap = 3 per lane per task". The counter
  // MUST come from the persistent counter-store so resume across crashes
  // preserves the cap correctly. Read the persisted value at start.
  let restart_count = getLaneCounter(
    input.runDir,
    input.run_id,
    input.lane_id,
    "restart_count",
  );
  const superseded_receipts: string[] = [];
  const assumptions: string[] = [];

  // Map a layer to its counter-store field. `security-review` → `security_round`
  // per the architect contract's per-lane block field naming.
  const counterFieldFor = (layer: ImplLayer): "L3_round" | "L4_round" | "security_round" => {
    if (layer === "L3") return "L3_round";
    if (layer === "L4") return "L4_round";
    return "security_round";
  };

  // Outer loop drives the restart-from-security control flow. We run
  // each active layer in order; if security-review finds a high+unaddressed
  // finding, we move receipts, increment restart counter, and re-run from
  // L3 (per architect: "restart resets all three layers' counters for
  // this lane and re-runs L3 → L4 → security-review").
  for (let attempt = 0; attempt <= restartCap; attempt++) {
    let restartFired = false;

    for (const layer of layersToRun) {
      layers_run.push(layer);
      const counterField = counterFieldFor(layer);
      const roundFn = input.roundFns[layer];
      if (!roundFn) {
        // Plan declared the layer but no dispatcher registered — fall
        // through. In production this is the orchestrator's bug; we
        // log an assumption and skip rather than crash.
        assumptions.push(
          `loop-implement: no roundFn for active layer ${layer} on lane ${input.lane_id}`,
        );
        continue;
      }

      const malformed = new MalformedRunCounter();
      let priorBody: string | null = null;
      let cleanLayerOutcome: SentinelOutcome | null = null;
      let layerRounds = 0;
      let layerEscalated = false;
      let layerEscalationStatus: LoopStatus | null = null;

      for (let roundNumber = 1; roundNumber <= input.cap; roundNumber++) {
        layerRounds = roundNumber;
        incrementLaneCounter(
          input.runDir,
          input.run_id,
          input.lane_id,
          counterField,
        );
        input.jsonl.append({
          ts: now(),
          event: "loop_round_start",
          run_id: input.run_id,
          lane_id: input.lane_id,
          loop_layer: layer,
          round_number: roundNumber,
          cap: input.cap,
        });

        const resp = await roundFn(roundNumber, priorBody);
        const outcome = detectSentinel(resp.body);
        const tag = malformedTagFromOutcome(outcome);
        input.jsonl.append({
          ts: now(),
          event: "loop_round_end",
          run_id: input.run_id,
          lane_id: input.lane_id,
          loop_layer: layer,
          round_number: roundNumber,
          terminated: tag,
          terminator: resp.terminator,
        });

        if (outcome.kind === "clean") {
          cleanLayerOutcome = outcome;
          break;
        }

        const ms = malformed.record(outcome);
        if (ms.shouldEscalate) {
          const choice = await input.escalationFn("malformed_termination_x2");
          input.jsonl.append(
            buildEscalationEvent({
              ts: now(),
              run_id: input.run_id,
              lane_id: input.lane_id,
              reason: "malformed_termination_x2",
              user_choice: choice,
            }),
          );
          layerEscalated = true;
          layerEscalationStatus = mapChoiceToStatus(choice);
          if (choice === "force-pass") {
            assumptions.push(
              `loop-implement: ${layer} force-pass on malformed_termination_x2 (lane ${input.lane_id})`,
            );
          }
          break;
        }
        priorBody = resp.body;
      }

      rounds_per_layer[layer] = layerRounds;

      if (layerEscalated) {
        if (layerEscalationStatus === "rework") {
          return {
            status: "rework",
            layers_run,
            rounds_per_layer,
            restart_count,
            superseded_receipts,
            unresolved_questions: [],
            assumptions,
            next: "abort",
          };
        }
        // force-pass on this layer → carry on to the next active layer.
        // (extend-cap path is orchestrator-side; this driver treats it
        // as a continuation by extending input.cap externally before
        // re-entry. For test simplicity we collapse extend-cap onto
        // satisfied-with-assumption.)
        continue;
      }

      if (cleanLayerOutcome === null) {
        // Cap exhausted on this layer.
        const choice = await input.escalationFn("cap_hit");
        input.jsonl.append(
          buildEscalationEvent({
            ts: now(),
            run_id: input.run_id,
            lane_id: input.lane_id,
            reason: "cap_hit",
            user_choice: choice,
          }),
        );
        const status = mapChoiceToStatus(choice);
        if (status === "rework") {
          return {
            status: "rework",
            layers_run,
            rounds_per_layer,
            restart_count,
            superseded_receipts,
            unresolved_questions: [],
            assumptions,
            next: "abort",
          };
        }
        if (status === "escalated") {
          assumptions.push(
            `loop-implement: ${layer} force-pass on cap_hit (lane ${input.lane_id})`,
          );
        }
        // force-pass / extend-cap → continue to the next layer.
        continue;
      }

      // Layer terminated cleanly. If this is the security-review layer,
      // parse findings + decide whether to restart from L3.
      if (layer === "security-review") {
        const parse = parseSecurityFindings(cleanLayerOutcome.bodyBeforeSentinel);
        if (parse.kind === "malformed_bullet") {
          input.jsonl.append({
            ts: now(),
            event: "assumption_logged",
            run_id: input.run_id,
            lane_id: input.lane_id,
            specialist: input.owner,
            assumption_text: malformedFindingAssumptionText(
              input.lane_id,
              layerRounds,
            ),
          });
          assumptions.push(
            malformedFindingAssumptionText(input.lane_id, layerRounds),
          );
          // No restart on malformed bullet — proceed.
        } else if (shouldRestartFromSecurity(parse)) {
          // Restart fires.
          if (isRestartCapHit(restart_count, restartCap)) {
            // 4th attempt — escalate.
            const choice = await input.escalationFn("restart_cap_hit");
            input.jsonl.append(
              buildEscalationEvent({
                ts: now(),
                run_id: input.run_id,
                lane_id: input.lane_id,
                reason: "restart_cap_hit",
                user_choice: choice,
              }),
            );
            const status = mapChoiceToStatus(choice);
            return {
              status:
                status === "rework"
                  ? "rework"
                  : status === "satisfied"
                    ? "restart_cap_hit"
                    : "restart_cap_hit",
              layers_run,
              rounds_per_layer,
              restart_count,
              superseded_receipts,
              unresolved_questions: [],
              assumptions,
              next: status === "rework" ? "abort" : "next-lane",
            };
          }
          // Move receipts + increment restart counter + reset L3/L4/security.
          //
          // Order matters per architect contract: increment the persisted
          // `restart_count` FIRST so that the value the next loop pass
          // reads (and the cap-check uses) reflects the new attempt;
          // resetLaneCounters preserves `restart_count` by design (per
          // T3a counter-store contract), so the order also serializes
          // cleanly under the shared lock — the increment writes a full
          // `LaneCounters` block; the reset rewrites only the L3/L4/
          // security fields without touching restart_count.
          restart_count = incrementLaneCounter(
            input.runDir,
            input.run_id,
            input.lane_id,
            "restart_count",
          );
          const sup = supersedePriorReceipts({
            runDir: input.runDir,
            laneId: input.lane_id,
            restartCount: restart_count,
            newReceiptRelPath:
              input.newReceiptRelPath ??
              `.guild/runs/${input.run_id}/handoffs/${input.owner}-${input.task_id}.md`,
          });
          for (const m of sup.movedFromTo) {
            superseded_receipts.push(m.to);
          }
          resetLaneCounters(input.runDir, input.run_id, input.lane_id);
          restartFired = true;
          break; // Out of the layers loop — restart from L3.
        } else if (parse.kind === "ok" && parse.findings.length > 0) {
          // Findings logged, no restart (medium/low or already-addressed).
          for (const f of parse.findings) {
            input.jsonl.append({
              ts: now(),
              event: "assumption_logged",
              run_id: input.run_id,
              lane_id: input.lane_id,
              specialist: input.owner,
              assumption_text: `Security finding (no-restart): severity=${f.severity}, addressed=${f.addressed_by_owner}, ${f.description}`,
            });
            assumptions.push(
              `Security finding logged: severity=${f.severity}, addressed=${f.addressed_by_owner}, ${f.description}`,
            );
          }
        }
      }
    }

    if (!restartFired) {
      // All active layers terminated cleanly (or with force-pass).
      return {
        status: "satisfied",
        layers_run,
        rounds_per_layer,
        restart_count,
        superseded_receipts,
        unresolved_questions: [],
        assumptions,
        next: "next-lane",
      };
    }
    // Otherwise fall back to the outer loop and replay from L3.
  }

  // Outer loop exhausted — should not happen because the inner cap-hit
  // path returns first; defensive only.
  return {
    status: "restart_cap_hit",
    layers_run,
    rounds_per_layer,
    restart_count,
    superseded_receipts,
    unresolved_questions: [],
    assumptions,
    next: "abort",
  };
}

/** Implementation-phase layers (subset of LoopLayer). */
export type ImplLayer = "L3" | "L4" | "security-review";

/** Map active `loops_applicable` value → ordered layer-list. */
export function activeLayersFor(
  loops_applicable: "none" | "l3-only" | "l4-only" | "both" | "full",
): ImplLayer[] {
  switch (loops_applicable) {
    case "none":
      return [];
    case "l3-only":
      return ["L3"];
    case "l4-only":
      return ["L4"];
    case "both":
      return ["L3", "L4"];
    case "full":
      return ["L3", "L4", "security-review"];
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

function defaultNow(): string {
  return new Date().toISOString();
}

function malformedTagFromOutcome(
  outcome: SentinelOutcome,
): "satisfied" | "malformed_termination" | "error" {
  if (outcome.kind === "clean") return "satisfied";
  if (outcome.kind === "malformed_termination") return "malformed_termination";
  // `no_sentinel` — round was non-terminal. From the JSONL contract's
  // perspective this is still a `loop_round_end` event; we tag it as
  // `satisfied` only when the sentinel matched. For a non-terminal
  // round the loop itself continues on to the next iteration; the
  // event's `terminated` field uses `malformed_termination` only when
  // the regex set caught something, and `error` is reserved for true
  // errors. Architect schema also accepts `cap_hit` and `escalation`
  // tags, but those come from the orchestrator — not from a
  // mid-round non-termination. We emit `error` here to make missing
  // sentinels visible without conflating with real malformed rounds.
  return "error";
}

function extractQuestions(body: string): string[] {
  // Lines ending in `?` capture residual unresolved questions for the
  // assumptions log + escalation context. Best-effort.
  const out: string[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.endsWith("?")) out.push(trimmed);
  }
  return out;
}

function mapChoiceToStatus(choice: EscalationLabel): LoopStatus {
  switch (choice) {
    case "force-pass":
      return "escalated"; // Force-passed; assumptions logged.
    case "extend-cap":
      return "escalated"; // Cap extended; loop would resume in production.
    case "rework":
      return "rework";
  }
}

interface EscalateAndRouteArgs {
  reason: EscalationReason;
  roundNumber: number;
  runDir: string;
  runId: string;
  laneId: string;
  layer: LoopLayer;
  counterKey: string;
  jsonl: LoopJsonlAppender;
  escalationFn: EscalationFn;
  unresolved_questions: string[];
  next_on_force_pass: string;
  next_on_rework: string;
  now: () => string;
}

interface EscalateAndRouteOutput {
  status: LoopStatus;
  rounds: number;
  unresolved_questions: string[];
  assumptions: string[];
  next: string;
}

async function escalateAndRoute(
  args: EscalateAndRouteArgs,
): Promise<EscalateAndRouteOutput> {
  const choice = await args.escalationFn(args.reason);
  args.jsonl.append(
    buildEscalationEvent({
      ts: args.now(),
      run_id: args.runId,
      lane_id: args.laneId === "phase:brainstorm" || args.laneId === "phase:plan"
        ? undefined
        : args.laneId,
      reason: args.reason,
      user_choice: choice,
    }),
  );
  if (choice === "force-pass") {
    return {
      status: "escalated",
      rounds: args.roundNumber,
      unresolved_questions: args.unresolved_questions,
      assumptions: args.unresolved_questions.map(
        (q) => `Unresolved question (force-pass): ${q}`,
      ),
      next: args.next_on_force_pass,
    };
  }
  if (choice === "extend-cap") {
    // Test stub: extend-cap collapses to "escalated" with the
    // unresolved questions returned. Real orchestrator would re-enter
    // the loop with a larger cap.
    return {
      status: "escalated",
      rounds: args.roundNumber,
      unresolved_questions: args.unresolved_questions,
      assumptions: [],
      next: args.next_on_force_pass,
    };
  }
  return {
    status: "rework",
    rounds: args.roundNumber,
    unresolved_questions: args.unresolved_questions,
    assumptions: [],
    next: args.next_on_rework,
  };
}

/** Re-export for tests + callers. */
export { ESCALATION_LABELS };
export type { EscalationLabel } from "./loop-escalation.js";
export type { FindingsParseResult, SentinelOutcome };
