#!/usr/bin/env -S npx tsx

import * as path from "node:path";

import { auditTaskCellArtifactJoin } from "../src/modules/dispatch/workflows/task-cell-artifact-join";

function fail(message: string): never {
  process.stderr.write(`[task-cell-audit] ${message}\n`);
  process.exit(2);
}

function main(argv: string[]): void {
  let cwd = ".";
  let runId: string | null = null;
  let requireClosed = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--cwd" && i + 1 < argv.length) cwd = argv[++i];
    else if (arg === "--run-id" && i + 1 < argv.length) runId = argv[++i];
    else if (arg === "--open") requireClosed = false;
    else fail(`unknown or incomplete argument: ${arg}`);
  }
  if (!runId || !/^[A-Za-z0-9_.-]+$/.test(runId)) fail("--run-id <safe-id> is required");
  const audit = auditTaskCellArtifactJoin({ cwd: path.resolve(cwd), runId, requireClosed });
  process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  process.exit(audit.ok ? 0 : 1);
}

main(process.argv.slice(2));
