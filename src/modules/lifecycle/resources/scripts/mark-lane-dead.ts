#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Lane exhaustion marking lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runMarkLaneDeadCli } from "../src/modules/lifecycle/workflows/mark-lane-dead";

export * from "../src/modules/lifecycle/workflows/mark-lane-dead";

if (require.main === module) {
  runMarkLaneDeadCli();
}
