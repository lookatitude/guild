/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/knowledge/. This file republishes the exact
 * pre-fold public surface of src/modules/context so existing importers keep working;
 * T16 deletes it. New code imports src/domains/knowledge directly.
 */

export {
  DEFAULT_RECALL_HALF_LIFE_DAYS,
  DEFAULT_RECALL_SCORE_THRESHOLD,
  RECALL_INTEGRITY_DIRECTIVE,
  classifyStructuralIntent,
  classifyTrustTier,
  compositeScore,
  fsScan,
  hashQuery,
  ingestImportanceScore,
  isIdentifierAwareQuery,
  normalizeFtsQuery,
  protectChunks,
  queryGuildMemory,
  recall,
  recencyDecay,
  resolveCompositeConfig,
  resolveRecallBeforeRead,
  resolveRecallScoreThreshold,
  runFsScannerCli,
  runProtectChunksCli,
  runRecallCli,
  runWikiRecallCli,
  selectMemoryTransport,
  wikiRecall,
} from "../../domains/knowledge";
export type {
  ClassifyOpts,
  CompositeConfig,
  FsScanHit,
  FsScanOpts,
  FsScanResult,
  MemoryCapabilities,
  MemoryPayload,
  MemoryQuery,
  MemoryReceipt,
  MemoryTransport,
  ProtectChunksOpts,
  ProtectChunksResult,
  ProtectedChunk,
  RawRecallHit,
  RecallOpts,
  RecallResult,
  RecallSource,
  TrustTier,
  WikiChunk,
  WikiHit,
  WikiRecallResult,
} from "../../domains/knowledge";
