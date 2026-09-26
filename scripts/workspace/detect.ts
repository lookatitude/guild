#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Workspace detection lives in src/modules/workspace so the reorg can move
 * internals without breaking existing script paths.
 */

import { runWorkspaceDetectCli } from "../../src/domains/state";

export {
  detect,
  runWorkspaceDetectCli,
  type WorkspaceMode,
  type RepoKind,
  type SubGuildKind,
  type SubGuild,
  type DetectionResult,
} from "../../src/domains/state";

if (require.main === module) {
  runWorkspaceDetectCli();
}
