#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Workspace detection lives in the state domain; it takes the settings mode
 * reader by injection, and this entrypoint supplies config's resolver so the
 * script behaves as before.
 */

import {
  detect as detectWithReader,
  runWorkspaceDetectCli as runWorkspaceDetectCliWithReader,
  type DetectionResult,
  type WorkspaceMode,
  type WorkspaceModeReader,
} from "../../src/domains/state";
import { resolveWorkspaceMode } from "../../src/domains/config";

const readMode: WorkspaceModeReader = resolveWorkspaceMode;

export type {
  WorkspaceMode,
  RepoKind,
  SubGuildKind,
  SubGuild,
  DetectionResult,
} from "../../src/domains/state";

export function detect(root: string, modeOverride?: WorkspaceMode): DetectionResult {
  return detectWithReader(root, modeOverride, readMode);
}

export function runWorkspaceDetectCli(argv: string[] = process.argv.slice(2)): void {
  runWorkspaceDetectCliWithReader(readMode, argv);
}

if (require.main === module) {
  runWorkspaceDetectCli();
}
