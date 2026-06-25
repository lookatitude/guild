/**
 * Backward-compatible public and CLI entrypoint.
 *
 * SQLite wiki recall lives in src/modules/context so the reorg can move
 * internals without breaking existing imports or `npx tsx scripts/lib/wiki-recall.ts`.
 */

import { runWikiRecallCli } from "../../src/modules/context/workflows/wiki-recall";

export type {
  TrustTier,
  WikiHit,
  WikiChunk,
  WikiRecallResult,
} from "../../src/modules/context/workflows/wiki-recall";
export {
  classifyTrustTier,
  RECALL_INTEGRITY_DIRECTIVE,
  wikiRecall,
  normalizeFtsQuery,
  runWikiRecallCli,
} from "../../src/modules/context/workflows/wiki-recall";

if (typeof module !== "undefined" && require.main === module) {
  runWikiRecallCli();
}
