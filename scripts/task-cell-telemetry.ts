#!/usr/bin/env -S npx tsx

import * as fs from "node:fs";
import * as path from "node:path";

import {
  importTaskCellUsageFromTrace,
  recordTaskCellUsage,
  summarizeTaskCellTelemetry,
  type TaskCellUsageV1,
} from "../src/modules/telemetry";
import { reconcileTaskCellLifecycleTelemetry } from "../src/modules/dispatch";

function usage(message: string): never {
  process.stderr.write(`[task-cell-telemetry] ${message}\n`);
  process.exit(2);
}

function main(argv: string[]): void {
  const command = argv.shift();
  let cwd = ".";
  let runId: string | null = null;
  let usageFile: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (arg === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (arg === "--usage-file" && i + 1 < argv.length) usageFile = argv[++i];
    else usage(`unknown or incomplete argument: ${arg}`);
  }
  if (command === "summary") {
    if (!runId || !/^[A-Za-z0-9_.-]+$/.test(runId)) usage("summary requires --run-id <safe-id>");
    reconcileTaskCellLifecycleTelemetry({ cwd: path.resolve(cwd), runId });
    importTaskCellUsageFromTrace({ cwd: path.resolve(cwd), runId });
    const summary = summarizeTaskCellTelemetry({ cwd: path.resolve(cwd), runId });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(summary.ok ? 0 : 1);
  }
  if (command === "record-usage") {
    if (!usageFile) usage("record-usage requires --usage-file <path>");
    let value: unknown;
    try { value = JSON.parse(fs.readFileSync(path.resolve(usageFile), "utf8")); }
    catch (error) { usage(`cannot read usage record: ${error instanceof Error ? error.message : String(error)}`); }
    try {
      const written = recordTaskCellUsage({ cwd: path.resolve(cwd), usage: value as TaskCellUsageV1 });
      process.stdout.write(`${JSON.stringify({ ok: true, usage_ref: written }, null, 2)}\n`);
      process.exit(0);
    } catch (error) {
      process.stderr.write(`[task-cell-telemetry] ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  }
  usage("expected summary or record-usage");
}

main(process.argv.slice(2));
