/**
 * Backward-compatible public entrypoint.
 *
 * Recall protection lives in src/modules/context so the reorg can move internals
 * without breaking existing imports from scripts/lib/*.
 */
export type {
  TrustTier,
  RawRecallHit,
  ProtectedChunk,
  ProtectChunksOpts,
  ProtectChunksResult,
} from "../../src/modules/context/workflows/recall-protect";
export {
  RECALL_INTEGRITY_DIRECTIVE,
  classifyTrustTier,
  protectChunks,
} from "../../src/modules/context/workflows/recall-protect";
