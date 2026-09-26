/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/state/. This file republishes the exact
 * pre-fold public surface of src/modules/workspace so existing importers keep working;
 * T16 deletes it. New code imports src/domains/state directly.
 */

export {
  collectUpstreamCandidates,
  detect,
  federatedQuery,
  runFederatedQueryCli,
  runPromoteUpstreamCli,
  runWorkspaceDetectCli,
  runWriteWorkspaceManifestCli,
  validateRunId,
  writeManifest,
} from "../../domains/state";
export type {
  CollectOptions,
  DetectionResult,
  RepoKind,
  SubGuild,
  SubGuildKind,
  UpstreamCandidate,
  WorkspaceMode,
} from "../../domains/state";
