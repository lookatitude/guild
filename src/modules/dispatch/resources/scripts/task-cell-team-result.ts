#!/usr/bin/env -S npx tsx

import * as path from "node:path";

import { isStation } from "../src/modules/teams/workflows/station-composer";
import { reconcileStationTaskCellResult } from "./lib/task-cell-launch-plan";

function fail(message: string, code = 2): never {
  process.stderr.write(`[task-cell-team-result] ${message}\n`);
  process.exit(code);
}

function main(argv: string[]): void {
  let cwd = ".";
  let runId: string | null = null;
  let station: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (arg === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (arg === "--station" && i + 1 < argv.length) station = argv[++i];
    else fail(`unknown or incomplete argument: ${arg}`);
  }
  if (!runId || !station || !/^[A-Za-z0-9_.-]+$/.test(runId)) {
    fail("--run-id <safe-id> and --station <station> are required");
  }
  if (!isStation(station)) fail(`unknown station: ${station}`);
  try {
    const result = reconcileStationTaskCellResult(path.resolve(cwd), runId, station);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 1);
  }
}

main(process.argv.slice(2));
