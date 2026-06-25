#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Workspace detection lives in src/modules/workspace so the reorg can move
 * internals without breaking existing script paths.
 */

import { runWorkspaceDetectCli } from "../../src/modules/workspace/workflows/detect";

export * from "../../src/modules/workspace/workflows/detect";

if (require.main === module) {
  runWorkspaceDetectCli();
}
