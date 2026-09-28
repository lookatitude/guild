/**
 * Backward-compatible public entrypoint.
 *
 * The KnowledgeGraph scoring implementation lives in src/modules/knowledge so
 * the reorg can move internals without breaking imports from scripts/lib/shared/*.
 */

export {
  importanceMultiplier,
  confidenceBonus,
  termMatchScore,
  scoreNode,
  rankKgNodes,
  buildProximityBonuses,
  PROXIMITY_WEIGHT,
} from "../../../src/domains/knowledge/index";
