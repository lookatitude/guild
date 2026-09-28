#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Workspace manifest writing lives in the state domain; it takes the settings
 * mode reader by injection, and this entrypoint supplies config's resolver so
 * the script behaves as before.
 */

import {
  runWriteWorkspaceManifestCli as runWriteWorkspaceManifestCliWithReader,
  writeManifest as writeManifestWithReader,
  type WorkspaceMode,
  type WorkspaceModeReader,
} from "../../src/domains/state";
import { resolveWorkspaceMode } from "../../src/domains/config";

const readMode: WorkspaceModeReader = resolveWorkspaceMode;

export function writeManifest(root: string, modeOverride?: WorkspaceMode): string {
  return writeManifestWithReader(root, modeOverride, readMode);
}

export function runWriteWorkspaceManifestCli(argv: string[] = process.argv.slice(2)): void {
  runWriteWorkspaceManifestCliWithReader(readMode, argv);
}

if (require.main === module) {
  runWriteWorkspaceManifestCli();
}
