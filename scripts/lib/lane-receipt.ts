/**
 * scripts/lib/lane-receipt.ts
 *
 * The lead's deterministic view of one lane's handoff receipt (#138, #237).
 *
 * A lane is finished only when its receipt exists at
 * `handoffs/<specialist>-<task-id>.md` and embeds a valid `guild.handoff.v2`
 * envelope for the same task. Host signals such as an idle notification are
 * never a result. `waitForLaneReceipt` polls with a hard timeout and always
 * returns an explicit `done | failed | missing` status; `recordLaneReceipt`
 * writes that status into the run-state lane checkpoint so the Stop backstop
 * sees fallback-dispatched lanes exactly like launcher lanes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { extractHandoffEnvelope, validateHandoffV2 } from "../../hooks/lib/handoff-v2";
import { upsertLane, type LaneStatus } from "../../src/domains/lifecycle/index";

export const LANE_RECEIPT_WAIT_SCHEMA = "guild.lane_receipt_wait.v1";

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** `pending` = not finished yet; only a wait can turn it into `missing`. */
export type LaneReceiptState = "done" | "failed" | "pending";
export type LaneReceiptStatus = "done" | "failed" | "missing";

export interface LaneReceiptInspection {
  state: LaneReceiptState;
  receipt_ref: string | null;
  reason: string;
}

export interface LaneReceiptWaitResult {
  schema_version: typeof LANE_RECEIPT_WAIT_SCHEMA;
  run_id: string;
  specialist: string;
  task_id: string;
  status: LaneReceiptStatus;
  receipt_ref: string | null;
  reason: string;
  waited_ms: number;
}

function assertSafeId(kind: string, value: string): void {
  if (!SAFE_ID.test(value) || value === "." || value === "..") {
    throw new Error(`lane-receipt: unsafe ${kind} ${JSON.stringify(value)}`);
  }
}

export function laneReceiptRef(specialist: string, taskId: string): string {
  assertSafeId("specialist", specialist);
  assertSafeId("task id", taskId);
  return path.join("handoffs", `${specialist}-${taskId}.md`);
}

/** One non-blocking look at the receipt. Never throws on file state. */
export function inspectLaneReceipt(
  runDir: string,
  specialist: string,
  taskId: string,
): LaneReceiptInspection {
  const ref = laneReceiptRef(specialist, taskId);
  let text: string;
  try {
    const st = fs.lstatSync(path.join(runDir, ref));
    if (!st.isFile()) {
      return { state: "failed", receipt_ref: null, reason: "receipt path is not a regular file" };
    }
    text = fs.readFileSync(path.join(runDir, ref), "utf8");
  } catch {
    return { state: "pending", receipt_ref: null, reason: "receipt not written yet" };
  }
  const envelope = extractHandoffEnvelope(text);
  if (envelope === null || !validateHandoffV2(envelope).valid) {
    // A receipt may be mid-write; it stays pending until the wait times out.
    return { state: "pending", receipt_ref: null, reason: "receipt has no valid guild.handoff.v2 envelope" };
  }
  const env = envelope as { task_id: string; status: string };
  if (env.task_id !== taskId) {
    return {
      state: "failed",
      receipt_ref: null,
      reason: `receipt envelope task_id ${JSON.stringify(env.task_id)} does not match ${taskId}`,
    };
  }
  if (env.status === "done") return { state: "done", receipt_ref: ref, reason: "receipt status done" };
  return { state: "failed", receipt_ref: ref, reason: `receipt status ${env.status}` };
}

const LANE_STATUS: Record<LaneReceiptState | LaneReceiptStatus, LaneStatus> = {
  done: "done",
  failed: "failed",
  missing: "failed",
  pending: "in_progress",
};

/** Persist the lane's receipt state as its run-state checkpoint. */
export function recordLaneReceipt(
  runDir: string,
  runId: string,
  taskId: string,
  state: LaneReceiptState | LaneReceiptStatus,
  receiptRef: string | null,
): void {
  assertSafeId("task id", taskId);
  upsertLane(runDir, { runId }, taskId, {
    status: LANE_STATUS[state],
    receipt_ref: receiptRef,
  });
}

export interface WaitForLaneReceiptOptions {
  runDir: string;
  runId: string;
  specialist: string;
  taskId: string;
  timeoutMs: number;
  pollMs?: number;
  /** Write the outcome into run-state (default true). */
  record?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a lane receipt. Resolves `done` or `failed` as soon as the receipt
 * says so, and `missing` once `timeoutMs` passes without a valid receipt.
 */
export async function waitForLaneReceipt(opts: WaitForLaneReceiptOptions): Promise<LaneReceiptWaitResult> {
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 0) {
    throw new Error("lane-receipt: timeoutMs must be a non-negative number");
  }
  laneReceiptRef(opts.specialist, opts.taskId);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const pollMs = Math.max(1, opts.pollMs ?? 2000);
  const started = now();
  let seen = inspectLaneReceipt(opts.runDir, opts.specialist, opts.taskId);
  while (seen.state === "pending" && now() - started < opts.timeoutMs) {
    await sleep(Math.min(pollMs, Math.max(1, opts.timeoutMs - (now() - started))));
    seen = inspectLaneReceipt(opts.runDir, opts.specialist, opts.taskId);
  }
  const status: LaneReceiptStatus = seen.state === "pending" ? "missing" : seen.state;
  const reason =
    status === "missing" ? `no valid receipt within ${opts.timeoutMs}ms (${seen.reason})` : seen.reason;
  if (opts.record !== false) {
    recordLaneReceipt(opts.runDir, opts.runId, opts.taskId, status, seen.receipt_ref);
  }
  return {
    schema_version: LANE_RECEIPT_WAIT_SCHEMA,
    run_id: opts.runId,
    specialist: opts.specialist,
    task_id: opts.taskId,
    status,
    receipt_ref: seen.receipt_ref,
    reason,
    waited_ms: now() - started,
  };
}
