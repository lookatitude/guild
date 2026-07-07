#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Lane resume scanning lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runResumeLanesCli } from "../src/modules/lifecycle/workflows/resume-lanes";

export * from "../src/modules/lifecycle/workflows/resume-lanes";

if (require.main === module) {
  runResumeLanesCli();
}
