// v1.4.0 F-7 — adversarial-loops harness orchestration (qa-owned).
//
// This module is a thin orchestrator that layers on top of the existing
// loop drivers (`loop-drivers.ts`) and shipped configuration parsers
// (`v1.4-config.ts`). It is the qa-lane harness for the synthetic
// adversarial-loops case (`benchmark/cases/v1.4-synthetic-model-family.yaml`).
//
// PURPOSE — three injection paths, each producing a deterministic event
// shape we can assert against:
//
//   1. forced-security-fail — qa's first terminating handoff (security-review
//      layer) emits a `## Findings` heading with `severity: high` +
//      `addressed_by_owner: false` BEFORE the `## NO MORE QUESTIONS`
//      sentinel, forcing the F-3 restart chain (dev → tester → qa →
//      security → re-dev). The harness asserts:
//        - restart_count increments;
//        - superseded receipts are recorded;
//        - the JSONL trail emits ≥ 1 escalation event when restart_cap_hit
//          fires, OR ≥ 1 layer reset when a non-cap restart fires.
//
//   2. cap-hit — `--loop-cap=2` paired with handoffs that always emit
//      malformed-termination (so no clean termination reaches by round 2).
//      The harness asserts:
//        - the cap_hit escalation event surfaces with the verbatim
//          three-tuple `["force-pass", "extend-cap", "rework"]`;
//        - the chosen escalation label is recorded.
//
//   3. auto-approve-all — `--auto-approve=all` with the same cap-hit
//      shape as (2). The harness asserts:
//        - the user-gate is short-circuited (no actual prompt fires);
//        - the resolved escalation maps to `force-pass` automatically;
//        - the resolved auto_approve config is sourced from the resolver
//          (NOT a free-text fallback).
//
// PURITY — the harness does not spawn `claude`, does not hit the network,
// does not call AskUserQuestion, and does not write outside the supplied
// `runDir` (which tests provide as a tmpdir). Every external surface is
// dependency-injected: the round dispatcher (`roundFn`), the user-choice
// supplier (`escalationFn`), and the JSONL appender (`jsonl`) all flow
// through the same boundaries the loop drivers expose.
//
// "Equivalent" CLI invocation (per success criterion "via `npm run
// benchmark -- run --case v14-synthetic-model-family` or equivalent"):
//
//   npx tsx benchmark/src/v1.4-harness.ts \
//     --injection forced-security-fail|cap-hit|auto-approve-all \
//     [--cap N] [--lane lane-id]
//
// Library callers use `runV14Harness({ injection, cap, ... })` directly.

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initStableLockfile } from "./v1.4-lock.js";
import {
  runLoopImplement,
  type EscalationFn,
  type LoopImplementOutput,
  type RoundFn,
} from "./loop-drivers.js";
import { ESCALATION_LABELS, type EscalationLabel } from "./loop-escalation.js";
import { InMemoryLoopJsonlAppender, type LoopEvent } from "./loop-jsonl-stub.js";
import { parseAutoApprove, parseLoopCap } from "./v1.4-config.js";

// ──────────────────────────────────────────────────────────────────────────
// Public types
// ──────────────────────────────────────────────────────────────────────────

/** Three injection modes — one per success-criterion path. */
export type V14Injection =
  | "forced-security-fail"
  | "cap-hit"
  | "auto-approve-all";

export const V14_INJECTIONS: readonly V14Injection[] = [
  "forced-security-fail",
  "cap-hit",
  "auto-approve-all",
] as const;

/** Inputs to `runV14Harness`. Every field has a defaulted fallback for the
 * CLI entrypoint; tests override individually. */
export interface V14HarnessInput {
  injection: V14Injection;
  /** Defaults: 16 for forced-security-fail / auto-approve-all; 2 for cap-hit. */
  cap?: number;
  /** Lane id — synthetic identity for counter isolation. Default: `lane-T-qa`. */
  laneId?: string;
  /** Run id — defaults to `harness-<injection>-<timestamp>`. */
  runId?: string;
  /** Run directory — defaults to a fresh tmpdir under os.tmpdir(). */
  runDir?: string;
  /** Auto-approve config — auto-derived from `injection`. Override for tests. */
  autoApprove?: "none" | "spec-and-plan" | "implementation" | "all";
  /** Restart cap — default 3 per architect contract. */
  restartCap?: number;
  /** Override the JSONL appender (tests substitute their own). */
  jsonl?: InMemoryLoopJsonlAppender;
}

/** Output of `runV14Harness` — shape-only, no free-text bodies. */
export interface V14HarnessOutput {
  injection: V14Injection;
  loop: LoopImplementOutput;
  /** Event-type counts in the order they were emitted. */
  eventCounts: Record<LoopEvent["event"], number>;
  /** Ordered list of event types as emitted (audit trail for tests). */
  eventOrder: LoopEvent["event"][];
  /** True iff ≥ 1 escalation event surfaced during the run. */
  sawEscalation: boolean;
  /** True iff the `auto-approve-all` short-circuit fired (no prompt called). */
  autoApprovedAll: boolean;
  /** Resolved cap value the harness ran with. */
  resolvedCap: number;
  /** Resolved auto-approve value the harness ran with. */
  resolvedAutoApprove: "none" | "spec-and-plan" | "implementation" | "all";
}

// ──────────────────────────────────────────────────────────────────────────
// Defaults
// ──────────────────────────────────────────────────────────────────────────

/** Auto-resolve cap default by injection mode. */
function defaultCapFor(injection: V14Injection): number {
  switch (injection) {
    case "cap-hit":
      return 2;
    case "auto-approve-all":
      return 2; // small cap so we hit it quickly under canned-malformed handoffs
    case "forced-security-fail":
      return 16;
  }
}

/** Auto-resolve auto-approve default by injection mode. */
function defaultAutoApproveFor(
  injection: V14Injection,
): "none" | "spec-and-plan" | "implementation" | "all" {
  return injection === "auto-approve-all" ? "all" : "none";
}

// ──────────────────────────────────────────────────────────────────────────
// Canned roundFn factories — deterministic, injection-specific responses.
// ──────────────────────────────────────────────────────────────────────────

/** L3 (dev↔tester) clean-terminator. The dev/tester pair completes cleanly. */
function cleanRound(terminator: string): RoundFn {
  return () => ({
    body: `Implementation complete. Tests pass.\n\n## NO MORE QUESTIONS\n`,
    terminator,
  });
}

/** Always-malformed responder — used for cap-hit injection.
 *  Body has the sentinel but trailing `?` line in the post-sentinel region,
 *  triggering POST_SENTINEL_PATTERN_1. After 2 such rounds, the loop
 *  escalates with `malformed_termination_x2`; with cap=2, the loop also
 *  hits `cap_hit` if the second round still didn't terminate cleanly.
 *  We pick the malformed shape so cap_hit surfaces deterministically. */
function alwaysMalformedRound(terminator: string): RoundFn {
  return (roundNumber) => ({
    body:
      `Round ${roundNumber} progress.\n\n## NO MORE QUESTIONS\n\n` +
      `Are you sure about the contract?\n`,
    terminator,
  });
}

/** Security-review responder that ALWAYS emits a high+unaddressed finding.
 *  This forces `shouldRestartFromSecurity` to fire, driving the F-3 restart
 *  chain. After `restartCap` restarts, `restart_cap_hit` escalates. */
function forceFailSecurityRound(terminator: string): RoundFn {
  return () => ({
    body:
      `## Findings\n\n` +
      `- severity: high\n` +
      `  addressed_by_owner: false\n` +
      `  description: synthetic high-severity finding for harness restart proof\n\n` +
      `## NO MORE QUESTIONS\n`,
    terminator,
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Escalation handlers — auto-approve-all short-circuits; others record.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build an escalationFn that respects the auto-approve config.
 *
 * - `all` → every reason auto-resolves to `force-pass` WITHOUT calling any
 *           prompt. The harness records `autoApprovedAll = true`.
 * - `none` / `spec-and-plan` / `implementation` → the harness uses the
 *   recorded `userChoiceFn` if supplied, else defaults to `force-pass` for
 *   `cap_hit` and `restart_cap_hit`, and `rework` for `malformed_termination_x2`.
 */
function buildEscalationFn(args: {
  autoApprove: "none" | "spec-and-plan" | "implementation" | "all";
  // mutable container so the harness can flip `autoApprovedAll` from inside the closure
  autoApproveSink: { fired: boolean };
}): EscalationFn {
  return (reason) => {
    if (args.autoApprove === "all") {
      args.autoApproveSink.fired = true;
      // Verbatim escalation label per architect contract — must match the
      // exported tuple. Selecting `force-pass` proceeds past the gate.
      return "force-pass";
    }
    // Default per-reason fallback. This is deterministic; no prompt fires.
    if (reason === "cap_hit") return "force-pass";
    if (reason === "restart_cap_hit") return "force-pass";
    return "rework"; // malformed_termination_x2 → rework
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Harness entrypoint
// ──────────────────────────────────────────────────────────────────────────

/**
 * Execute one harness scenario. Returns a shape-only result.
 *
 * Pure: no `claude` spawn, no network, no AskUserQuestion. The only
 * filesystem mutation is under `runDir` (default = fresh tmpdir).
 */
export async function runV14Harness(
  input: V14HarnessInput,
): Promise<V14HarnessOutput> {
  // Resolve config via shipped parsers (NOT free-text fallback). This is
  // the contract the success criterion references: the harness uses the
  // same resolution path the production runner does.
  const resolvedCap =
    input.cap ?? parseLoopCap(String(defaultCapFor(input.injection)));
  const resolvedAutoApprove =
    input.autoApprove ?? parseAutoApprove(defaultAutoApproveFor(input.injection));

  const runId =
    input.runId ?? `harness-${input.injection}-${Date.now().toString(36)}`;
  const runDir =
    input.runDir ??
    (() => {
      const d = join(
        tmpdir(),
        `guild-v14-harness-${runId}-${Math.random().toString(36).slice(2, 8)}`,
      );
      mkdirSync(d, { recursive: true });
      return d;
    })();

  // Counter-store + JSONL share a stable lockfile inode under <runDir>/logs.
  // Initialise it before the drivers run so any counter increment can
  // serialise on the same lock.
  mkdirSync(join(runDir, "logs"), { recursive: true });
  initStableLockfile(runDir);

  const jsonl = input.jsonl ?? new InMemoryLoopJsonlAppender();
  const autoApproveSink = { fired: false };
  const escalationFn = buildEscalationFn({
    autoApprove: resolvedAutoApprove,
    autoApproveSink,
  });

  // Build the per-layer roundFns based on the injection.
  let l3: RoundFn;
  let l4: RoundFn;
  let security: RoundFn;
  switch (input.injection) {
    case "forced-security-fail":
      // L3/L4 terminate cleanly so the loop reaches security-review,
      // which always returns the high-severity finding → restart fires.
      l3 = cleanRound("tester");
      l4 = cleanRound("qa");
      security = forceFailSecurityRound("security");
      break;
    case "cap-hit":
      // L3 always returns malformed; with cap=2 the loop hits cap_hit
      // (or malformed_termination_x2 if escalation triggers first).
      l3 = alwaysMalformedRound("tester");
      l4 = cleanRound("qa");
      security = cleanRound("security");
      break;
    case "auto-approve-all":
      // Same cap-hit shape as above, but auto-approve=all should make
      // every escalation auto-resolve to `force-pass` without a prompt.
      l3 = alwaysMalformedRound("tester");
      l4 = cleanRound("qa");
      security = cleanRound("security");
      break;
  }

  const loop = await runLoopImplement({
    lane_id: input.laneId ?? "lane-T-qa",
    owner: "qa",
    loops_applicable: "full",
    loops_mode: "implementation",
    cap: resolvedCap,
    restart_cap: input.restartCap ?? 3,
    run_id: runId,
    task_id: "T-harness",
    runDir,
    roundFns: { L3: l3, L4: l4, "security-review": security },
    escalationFn,
    jsonl,
  });

  // Build the deterministic projection.
  const eventOrder: LoopEvent["event"][] = jsonl.events.map((e) => e.event);
  const eventCounts: Record<string, number> = {};
  for (const t of eventOrder) eventCounts[t] = (eventCounts[t] ?? 0) + 1;
  const sawEscalation = (eventCounts["escalation"] ?? 0) > 0;

  return {
    injection: input.injection,
    loop,
    eventCounts: eventCounts as V14HarnessOutput["eventCounts"],
    eventOrder,
    sawEscalation,
    autoApprovedAll: autoApproveSink.fired,
    resolvedCap,
    resolvedAutoApprove,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI entrypoint — invoked via `tsx benchmark/src/v1.4-harness.ts`.
// ──────────────────────────────────────────────────────────────────────────

function isMainModule(): boolean {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return /v1\.4-harness\.[tj]s$/.test(arg1);
}

function parseFlag(argv: string[], name: string): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

async function cliMain(argv: string[]): Promise<number> {
  const injectionArg = parseFlag(argv, "injection");
  if (!injectionArg) {
    process.stderr.write(
      `v1.4-harness: --injection <${V14_INJECTIONS.join("|")}> is required\n`,
    );
    return 2;
  }
  if (!(V14_INJECTIONS as readonly string[]).includes(injectionArg)) {
    process.stderr.write(
      `v1.4-harness: invalid --injection ${JSON.stringify(injectionArg)}; expected one of ${JSON.stringify(V14_INJECTIONS)}\n`,
    );
    return 2;
  }
  const capArg = parseFlag(argv, "cap");
  const laneArg = parseFlag(argv, "lane");
  const out = await runV14Harness({
    injection: injectionArg as V14Injection,
    ...(capArg ? { cap: Number(capArg) } : {}),
    ...(laneArg ? { laneId: laneArg } : {}),
  });
  process.stdout.write(
    `v1.4-harness: injection=${out.injection} cap=${out.resolvedCap} auto-approve=${out.resolvedAutoApprove} loop_status=${out.loop.status} restart_count=${out.loop.restart_count} escalations=${out.eventCounts["escalation"] ?? 0} events=${out.eventOrder.length}\n`,
  );
  return 0;
}

if (isMainModule()) {
  cliMain(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`v1.4-harness: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    },
  );
}

// Re-exports for tests (so they don't need to import the loop driver
// types separately).
export { ESCALATION_LABELS };
export type { EscalationLabel };
