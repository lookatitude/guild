/**
 * Backward-compatible public entrypoint.
 *
 * Guild root/discovery helpers live in src/modules/state so the reorg can move
 * internals without breaking imports from scripts/lib/guild-discovery.
 */

import * as discoveryImpl from "../../src/modules/state/workflows/guild-discovery";

export const readWorkspaceManifest = discoveryImpl.readWorkspaceManifest;
export const discoverGuild = discoveryImpl.discoverGuild;
export const workspaceReadThroughSources = discoveryImpl.workspaceReadThroughSources;
export const isCanonicalGuildMemoryPath = discoveryImpl.isCanonicalGuildMemoryPath;
export const classifyMemoryPath = discoveryImpl.classifyMemoryPath;
export type {
  GuildLevel,
  WorkspaceSubGuild,
  WorkspaceManifest,
  GuildDiscovery,
  ReadThroughSource,
} from "../../src/modules/state/workflows/guild-discovery";
