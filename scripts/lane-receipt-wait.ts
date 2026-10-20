#!/usr/bin/env -S npx tsx
/**
 * lane-receipt-wait — the lead's deterministic receipt-wait for one lane (#138).
 *
 *   lane-receipt-wait --cwd <repo> --run-id <run> --specialist <role> --task-id <id>
 *                     [--timeout-ms <ms>] [--poll-ms <ms>] [--no-record]
 *
 * Prints one guild.lane_receipt_wait.v1 JSON line. Exit 0 = done; exit 1 =
 * failed or missing (timed out); exit 2 = usage error. The outcome is written
 * to the run-state lane checkpoint unless --no-record is passed.
 */

import * as path from "node:path";

import { durableGuildDir } from "./lib/state/storage";
import { waitForLaneReceipt } from "./lib/lane-receipt";

export const DEFAULT_LANE_RECEIPT_TIMEOUT_MS = 30 * 60 * 1000;

const USAGE =
  "usage: lane-receipt-wait --cwd <repo> --run-id <run> --specialist <role> --task-id <id> " +
  "[--timeout-ms <ms>] [--poll-ms <ms>] [--no-record]";

interface Args {
  cwd: string;
  runId: string;
  specialist: string;
  taskId: string;
  timeoutMs: number;
  pollMs: number | undefined;
  record: boolean;
}

function parseArgs(argv: string[]): Args {
  const values = new Map<string, string>();
  let record = true;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--no-record") {
      record = false;
      continue;
    }
    if (!["--cwd", "--run-id", "--specialist", "--task-id", "--timeout-ms", "--poll-ms"].includes(flag)) {
      throw new Error(`unknown argument ${flag}`);
    }
    const value = argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    values.set(flag, value);
  }
  const need = (flag: string): string => {
    const v = values.get(flag);
    if (!v) throw new Error(`${flag} is required`);
    return v;
  };
  const num = (flag: string): number | undefined => {
    const v = values.get(flag);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a non-negative integer`);
    return n;
  };
  return {
    cwd: path.resolve(values.get("--cwd") ?? process.cwd()),
    runId: need("--run-id"),
    specialist: need("--specialist"),
    taskId: need("--task-id"),
    timeoutMs: num("--timeout-ms") ?? DEFAULT_LANE_RECEIPT_TIMEOUT_MS,
    pollMs: num("--poll-ms"),
    record,
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(args.runId)) throw new Error("--run-id is not a safe run id");
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n${USAGE}\n`);
    return 2;
  }
  try {
    const result = await waitForLaneReceipt({
      runDir: path.join(durableGuildDir(args.cwd), "runs", args.runId),
      runId: args.runId,
      specialist: args.specialist,
      taskId: args.taskId,
      timeoutMs: args.timeoutMs,
      pollMs: args.pollMs,
      record: args.record,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "done" ? 0 : 1;
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
