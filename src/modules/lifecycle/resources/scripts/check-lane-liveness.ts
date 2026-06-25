#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Lane liveness now lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runCheckLaneLivenessCli } from "../src/modules/lifecycle/workflows/check-lane-liveness";

export * from "../src/modules/lifecycle/workflows/check-lane-liveness";

if (require.main === module) {
  process.exit(runCheckLaneLivenessCli());
}
