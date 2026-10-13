/**
 * Backward-compatible public entrypoint.
 *
 * Learning candidates live in src/modules/evolution so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export {
  recommendedDestination,
  promotionGate,
  makeLearningCandidate,
  isValidLearningCandidate,
  deriveLearningCandidates,
  LEARNING_CANDIDATE_SCHEMA,
  LEARNING_CANDIDATE_TYPES,
  type LearningCandidateType,
  type Confidence,
  type Impact,
  type CandidateScope,
  type RecommendedDestination,
  type PromotionGate,
  type LearningCandidate,
} from "../../src/domains/evolve/index";
