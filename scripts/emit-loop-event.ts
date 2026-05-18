#!/usr/bin/env -S npx tsx
/**
 * scripts/emit-loop-event.ts
 *
 * Appends a loop_round_start, loop_round_end, or codex_review_round event
 * to the run's v1.4 audit log at
 * `.guild/runs/<run-id>/logs/v1.4-events.jsonl`.
 *
 * Designed to be called from loop skill instruction blocks via the Bash tool:
 *
 *   npx tsx scripts/emit-loop-event.ts \
 *     --event loop_round_start \
 *     --layer L1 \
 *     --lane phase:brainstorm \
 *     --round 1 \
 *     --cap 16 \
 *     [--run-id <id>] \
 *     [--cwd <path>]
 *
 *   npx tsx scripts/emit-loop-event.ts \
 *     --event loop_round_end \
 *     --layer L1 \
 *     --lane phase:brainstorm \
 *     --round 1 \
 *     --terminated satisfied \
 *     --terminator researcher \
 *     [--run-id <id>] \
 *     [--cwd <path>]
 *
 * Run-id resolution order (first wins):
 *   1. --run-id flag
 *   2. non-empty GUILD_RUN_ID env var
 *   3. .guild/runs/current-run-id sentinel file
 *   4. fallback: "run-session-<date>"
 *
 * Stdout:  Silent.
 * Stderr:  Errors only.
 * Exit:    0 always — telemetry failures must not block loop execution.
 */

import * as fs from "fs";
import * as path from "path";

import {
  appendEvent,
  isSafeLaneId,
  isSafeRunId,
  type CodexReviewRoundEvent,
  type JsonlEvent,
  type LoopLayer,
  type LoopRoundEndEvent,
  type LoopRoundStartEvent,
} from "../benchmark/src/log-jsonl.js";

const VALID_EVENTS = new Set(["loop_round_start", "loop_round_end", "codex_review_round"]);
const VALID_LAYERS = new Set(["L1", "L2", "L3", "L4", "security-review"]);
const VALID_TERMINATED = new Set([
  "satisfied",
  "malformed_termination",
  "cap_hit",
  "escalation",
  "error",
]);

function parseArgs(argv: string[]): {
  event?: string;
  layer?: string;
  lane?: string;
  round?: number;
  cap?: number;
  gate?: string;
  terminated?: string;
  terminator?: string;
  runId?: string;
  cwd?: string;
} {
  const result: ReturnType<typeof parseArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--event" && argv[i + 1]) result.event = argv[++i];
    else if (arg === "--layer" && argv[i + 1]) result.layer = argv[++i];
    else if (arg === "--lane" && argv[i + 1]) result.lane = argv[++i];
    else if (arg === "--round" && argv[i + 1]) result.round = parseInt(argv[++i], 10);
    else if (arg === "--cap" && argv[i + 1]) result.cap = parseInt(argv[++i], 10);
    else if (arg === "--gate" && argv[i + 1]) result.gate = argv[++i];
    else if (arg === "--terminated" && argv[i + 1]) result.terminated = argv[++i];
    else if (arg === "--terminator" && argv[i + 1]) result.terminator = argv[++i];
    else if (arg === "--run-id" && argv[i + 1]) result.runId = argv[++i];
    else if (arg === "--cwd" && argv[i + 1]) result.cwd = argv[++i];
  }
  return result;
}

function readSentinel(cwd: string): string | undefined {
  const sentinelPath = path.join(cwd, ".guild", "runs", "current-run-id");
  try {
    const value = fs.readFileSync(sentinelPath, "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.cwd ?? process.env["GUILD_CWD"] ?? process.cwd();

  if (!args.event || !VALID_EVENTS.has(args.event)) {
    process.stderr.write(
      `[emit-loop-event] ERROR: --event must be one of: ${[...VALID_EVENTS].join(", ")}\n`,
    );
    process.exit(0);
  }

  const envRunId = process.env["GUILD_RUN_ID"];
  const runId =
    args.runId ??
    (typeof envRunId === "string" && envRunId.length > 0 ? envRunId : undefined) ??
    readSentinel(cwd) ??
    `run-session-${new Date().toISOString().slice(0, 10)}`;

  if (!isSafeRunId(runId)) {
    process.stderr.write("[emit-loop-event] ERROR: resolved run id is invalid\n");
    process.exit(0);
  }

  const ts = new Date().toISOString();
  let event: JsonlEvent;

  if (args.event === "loop_round_start" || args.event === "loop_round_end") {
    if (!args.layer || !VALID_LAYERS.has(args.layer)) {
      process.stderr.write("[emit-loop-event] ERROR: --layer is required for loop round events\n");
      process.exit(0);
    }
    if (!args.lane || !isSafeLaneId(args.lane)) {
      process.stderr.write("[emit-loop-event] ERROR: --lane is required and must be safe\n");
      process.exit(0);
    }
    if (typeof args.round !== "number" || !Number.isInteger(args.round) || args.round < 1) {
      process.stderr.write("[emit-loop-event] ERROR: --round must be a positive integer\n");
      process.exit(0);
    }

    if (args.event === "loop_round_start") {
      if (typeof args.cap !== "number" || !Number.isInteger(args.cap) || args.cap < 1) {
        process.stderr.write(
          "[emit-loop-event] ERROR: --cap must be a positive integer for loop_round_start\n",
        );
        process.exit(0);
      }
      event = {
        ts,
        event: "loop_round_start",
        run_id: runId,
        lane_id: args.lane,
        loop_layer: args.layer as LoopLayer,
        round_number: args.round,
        cap: args.cap,
      } satisfies LoopRoundStartEvent;
    } else {
      if (!args.terminated || !VALID_TERMINATED.has(args.terminated)) {
        process.stderr.write(
          `[emit-loop-event] ERROR: --terminated must be one of: ${[...VALID_TERMINATED].join(", ")}\n`,
        );
        process.exit(0);
      }
      event = {
        ts,
        event: "loop_round_end",
        run_id: runId,
        lane_id: args.lane,
        loop_layer: args.layer as LoopLayer,
        round_number: args.round,
        terminated: args.terminated as LoopRoundEndEvent["terminated"],
        terminator: args.terminator ?? "",
      } satisfies LoopRoundEndEvent;
    }
  } else {
    if (!args.gate) {
      process.stderr.write("[emit-loop-event] ERROR: --gate is required for codex_review_round\n");
      process.exit(0);
    }
    if (typeof args.round !== "number" || !Number.isInteger(args.round) || args.round < 1) {
      process.stderr.write("[emit-loop-event] ERROR: --round must be a positive integer\n");
      process.exit(0);
    }
    event = {
      ts,
      event: "codex_review_round",
      run_id: runId,
      gate: args.gate,
      round_number: args.round,
      terminated_by_satisfied: args.terminated === "satisfied" || args.terminated === "true",
    } satisfies CodexReviewRoundEvent;
  }

  try {
    appendEvent(path.join(cwd, ".guild", "runs", runId), event);
  } catch (err) {
    process.stderr.write(
      `[emit-loop-event] ERROR: could not write event: ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
  }
}

main();
