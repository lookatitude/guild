/**
 * TaskCell cleanup verification leaf (CD24/CD25 closeout). Shared by the
 * controller (lifecycle-event presence) and the closed artifact-join audit, so
 * neither imports the other. Every fact is re-derived from the actual files,
 * bus and lifecycle telemetry; no boolean in cleanup.json is trusted on its own.
 */
import * as fs from "fs";
import * as path from "path";

import { sha256 } from "./artifact-bus";
import { durableGuildDir } from "../state";
import { readTaskCellLifecycleEvents } from "../telemetry";

/** Same literal as the controller's TASK_CELL_CLEANUP_SCHEMA (guild.task_cell_cleanup.v1). */
const CLEANUP_SCHEMA = "guild.task_cell_cleanup.v1";

export function taskCellCleanupPath(runId: string, instanceId: string): string {
  return path.join(".guild", "runs", runId, "controller", "cleanup", instanceId, "cleanup.json");
}

function finalEvidencePath(runId: string, instanceId: string): string {
  return path.join(".guild", "runs", runId, "controller", "acceptance-evidence", instanceId, "final.json");
}

function regularBytes(abs: string): Buffer | null {
  try {
    const stat = fs.lstatSync(abs);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

/** The named lifecycle event for this instance has its events.jsonl line AND its event-ids marker. */
export function lifecycleEventPresent(cwd: string, ids: { run_id: string; instance_id: string }, eventName: string): boolean {
  const telemetryDir = path.join(durableGuildDir(cwd), "runs", ids.run_id, "task-cell-telemetry");
  if (!fs.existsSync(path.join(telemetryDir, "events.jsonl"))) return false;
  try {
    const event = readTaskCellLifecycleEvents({ cwd, runId: ids.run_id })
      .find((e) => e.instance_id === ids.instance_id && e.event_name === eventName);
    return !!event && fs.existsSync(path.join(telemetryDir, "event-ids", event.event_id));
  } catch {
    return false;
  }
}

/**
 * Closed-audit check of one E00 instance's cleanup. Returns missing/invalid
 * findings; empty means cleanup is verifiably complete against the actual
 * terminal record, its latest bus hash, the terminal lifecycle event and any
 * final.json / terminal-reconciliation refs.
 */
export function verifyClosedCleanup(input: {
  cwd: string;
  runId: string;
  instanceId: string;
  terminalPath: string;
  attemptTerminalState: string | null;
  /** sha256 of the latest bus event for the terminal path, or null when absent. */
  terminalBusSha256: string | null;
}): { missing: string[]; invalid: string[] } {
  const missing: string[] = [];
  const invalid: string[] = [];
  const iid = input.instanceId;
  const rel = taskCellCleanupPath(input.runId, iid);
  const bytes = regularBytes(path.resolve(input.cwd, rel));
  if (bytes === null) {
    if (fs.existsSync(path.resolve(input.cwd, rel))) invalid.push(`cleanup:${rel} unreadable`);
    else missing.push(`cleanup:${rel}`);
    return { missing, invalid };
  }
  let record: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) record = parsed as Record<string, unknown>;
  } catch {
    record = null;
  }
  if (record === null || record["schema_version"] !== CLEANUP_SCHEMA) {
    invalid.push(`cleanup:${rel} malformed or not ${CLEANUP_SCHEMA}`);
    return { missing, invalid };
  }
  if (record["instance_id"] !== iid) invalid.push(`cleanup for ${iid} names another instance`);
  if (record["cleanup_state"] !== "complete") invalid.push(`cleanup for ${iid} is ${String(record["cleanup_state"])}, not complete`);

  const terminalState = input.attemptTerminalState;
  if (terminalState === null || record["terminal_state"] !== terminalState) {
    invalid.push(`cleanup terminal_state for ${iid} does not match the immutable attempt`);
  }
  const terminalBytes = regularBytes(path.resolve(input.cwd, input.terminalPath));
  const terminalSha = terminalBytes === null ? null : sha256(terminalBytes);
  if (terminalSha === null || record["terminal_sha256"] !== terminalSha) {
    invalid.push(`cleanup terminal_sha256 for ${iid} does not match the actual terminal record`);
  }
  if (terminalSha === null || input.terminalBusSha256 !== terminalSha) {
    invalid.push(`terminal record for ${iid} is not the current bus publication`);
  }
  if (record["terminal_published"] !== true) invalid.push(`cleanup for ${iid} does not record a published terminal`);
  const eventPresent = terminalState !== null && lifecycleEventPresent(input.cwd, { run_id: input.runId, instance_id: iid }, terminalState);
  if (!eventPresent) invalid.push(`terminal lifecycle event missing for ${iid}`);
  if (record["terminal_telemetry_state"] !== "complete") invalid.push(`cleanup terminal_telemetry_state for ${iid} is not complete`);

  // The actual final record decides, not the nullable recorded hash: any entry at the path (including a
  // symlink, non-regular or unreadable one) requires an exact hash of regular bytes; null only when absent.
  const finalSha = record["final_sha256"];
  const finalAbs = path.resolve(input.cwd, finalEvidencePath(input.runId, iid));
  let finalPresent = true;
  try {
    fs.lstatSync(finalAbs);
  } catch (error) {
    finalPresent = (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
  if (finalPresent) {
    const finalBytes = regularBytes(finalAbs);
    if (typeof finalSha !== "string" || finalBytes === null || sha256(finalBytes) !== finalSha) {
      invalid.push(`cleanup final_sha256 for ${iid} does not match the actual final.json`);
    }
  } else if (finalSha !== null) {
    invalid.push(`cleanup final_sha256 for ${iid} names a final.json that does not exist`);
  }
  const reconciliation = record["terminal_reconciliation"];
  if (reconciliation !== null) {
    const ref = reconciliation as { path?: unknown; sha256?: unknown } | undefined;
    const refBytes = typeof ref?.path === "string" ? regularBytes(path.resolve(input.cwd, ref.path)) : null;
    if (refBytes === null || sha256(refBytes) !== ref?.sha256) {
      invalid.push(`cleanup terminal_reconciliation for ${iid} does not resolve to its recorded file`);
    }
  }
  return { missing, invalid };
}
