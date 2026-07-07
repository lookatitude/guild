#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Task-run writing lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runWriteTaskRunCli } from "../src/modules/lifecycle/workflows/write-task-run";

export * from "../src/modules/lifecycle/workflows/write-task-run";

if (require.main === module) {
  runWriteTaskRunCli();
}
