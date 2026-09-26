#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Workspace manifest writing lives in src/modules/workspace so the reorg can
 * move internals without breaking existing script paths.
 */

import { runWriteWorkspaceManifestCli } from "../../src/domains/state";

export {
  writeManifest,
  runWriteWorkspaceManifestCli,
} from "../../src/domains/state";

if (require.main === module) {
  runWriteWorkspaceManifestCli();
}
