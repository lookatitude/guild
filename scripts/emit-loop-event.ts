#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Loop event emission lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runEmitLoopEventCli } from "../src/modules/lifecycle/workflows/emit-loop-event";

export * from "../src/modules/lifecycle/workflows/emit-loop-event";

if (require.main === module) {
  runEmitLoopEventCli();
}
