/**
 * Backward-compatible public and CLI entrypoint.
 *
 * SQLite wiki recall lives in src/modules/context so the reorg can move
 * internals without breaking existing imports or `npx tsx scripts/lib/wiki-recall.ts`.
 */

import { runWikiRecallCli } from "../../src/domains/knowledge/wiki-recall";

export type {
  TrustTier,
  WikiHit,
  WikiChunk,
  WikiRecallResult,
} from "../../src/domains/knowledge/wiki-recall";
export {
  classifyTrustTier,
  RECALL_INTEGRITY_DIRECTIVE,
  wikiRecall,
  normalizeFtsQuery,
  isIdentifierAwareQuery,
  runWikiRecallCli,
} from "../../src/domains/knowledge/wiki-recall";

if (typeof module !== "undefined" && require.main === module) {
  runWikiRecallCli();
}
