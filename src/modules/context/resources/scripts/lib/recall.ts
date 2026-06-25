/**
 * Backward-compatible public and CLI entrypoint.
 *
 * Deterministic protected recall lives in src/modules/context so the reorg can
 * move internals without breaking imports from scripts/lib/recall or
 * `npx tsx scripts/lib/recall.ts`.
 */

import * as recallImpl from "../../src/modules/context/workflows/recall";

export const DEFAULT_RECALL_HALF_LIFE_DAYS = recallImpl.DEFAULT_RECALL_HALF_LIFE_DAYS;
export const recencyDecay = recallImpl.recencyDecay;
export const compositeScore = recallImpl.compositeScore;
export const resolveCompositeConfig = recallImpl.resolveCompositeConfig;
export const ingestImportanceScore = recallImpl.ingestImportanceScore;
export const recall = recallImpl.recall;
export const runRecallCli = recallImpl.runRecallCli;
export type {
  RecallSource,
  RecallResult,
  RecallOpts,
  CompositeConfig,
} from "../../src/modules/context/workflows/recall";

if (typeof module !== "undefined" && require.main === module) {
  runRecallCli();
}
