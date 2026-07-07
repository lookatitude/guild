#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Workspace manifest writing lives in src/modules/workspace so the reorg can
 * move internals without breaking existing script paths.
 */

import { runWriteWorkspaceManifestCli } from "../../src/modules/workspace/workflows/write-manifest";

export * from "../../src/modules/workspace/workflows/write-manifest";

if (require.main === module) {
  runWriteWorkspaceManifestCli();
}
