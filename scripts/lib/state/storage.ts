/**
 * scripts/lib/state/storage.ts
 *
 * Usage: import { createGuildStorage } from "./lib/state/storage"
 *
 * Stable entrypoint for the `GuildStorage` API so `scripts/` callers do not reach
 * into `src/modules/state/workflows/**` (KTD27: the domain index is the API).
 *
 * This is the ONLY path a script should use to name a durable, cache, runtime,
 * worktree or temp location. Building the durable directory path by hand is a
 * `no-direct-guild-join` lint failure (KTD15).
 */

export {
  createGuildStorage,
  guildRootId,
  resolveStorageRoots,
  artifactPolicy,
  assertRegistered,
  validateRegistry,
  assertClassPlacement,
  assertSafeSegments,
  isKtd16FrozenPath,
  isUnderDurable,
  isContainedRealDir,
  resolveContainedRealDir,
  removeContainedTree,
  removeContainedEmptyDir,
  lstatSafe,
  readdirSafe,
  runStorageGc,
  formatGcReport,
  scanDurableDebris,
  StoragePlacementError,
  DURABLE_CLASSES,
  NON_DURABLE_CLASSES,
  KTD16_FROZEN_PREFIXES,
  SCRATCH_TTL_HOURS,
  STORAGE_ARTIFACT_REGISTRY,
  STORAGE_ARTIFACT_REGISTRY_SCHEMA,
  GUILD_NAMESPACE,
} from "../../../src/modules/state";

export type {
  GuildStorage,
  CreateStorageOptions,
  CloseRunResult,
  RootProfile,
  ScopedDurablePaths,
  GuildStorageRoots,
  StorageRootsOptions,
  ArtifactPolicy,
  CleanupOwner,
  GuildScope,
  RetentionPolicy,
  StorageClass,
  GcOptions,
  GcReport,
  DurableFinding,
  SweepEntry,
} from "../../../src/modules/state";
