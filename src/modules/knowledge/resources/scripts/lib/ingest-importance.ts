/**
 * Backward-compatible public entrypoint.
 *
 * Importance-at-ingest scoring lives in src/modules/knowledge so the reorg can
 * move internals without breaking imports from scripts/lib/ingest-importance.
 */

import * as importanceImpl from "../../src/modules/knowledge/workflows/ingest-importance";

export const RECALL_IMPORTANCE_KEY = importanceImpl.RECALL_IMPORTANCE_KEY;
export const RECALL_IMPORTANCE_PINNED_KEY = importanceImpl.RECALL_IMPORTANCE_PINNED_KEY;
export const isValidScore = importanceImpl.isValidScore;
export const ingestImportanceScore = importanceImpl.ingestImportanceScore;
export const parseRecallImportance = importanceImpl.parseRecallImportance;
export const isRecallImportancePinned = importanceImpl.isRecallImportancePinned;
export const resolveRecallImportance = importanceImpl.resolveRecallImportance;
export const stampRecallImportance = importanceImpl.stampRecallImportance;
export type { StampResult } from "../../src/modules/knowledge/workflows/ingest-importance";
