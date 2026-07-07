#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Run manifest writing lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runWriteRunManifestCli } from "../src/modules/lifecycle/workflows/write-run-manifest";

export * from "../src/modules/lifecycle/workflows/write-run-manifest";

if (require.main === module) {
  runWriteRunManifestCli();
}
