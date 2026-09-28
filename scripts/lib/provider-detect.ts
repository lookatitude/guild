/**
 * Backward-compatible public entrypoint.
 *
 * Provider detection lives in src/modules/host-runtime so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export {
  resolveAuthorHost,
  detectProviders,
  recommendProvider,
  selectReviewer,
  defaultProbeEnv,
  type HostFamily,
  type ProviderKind,
  type DetectedProvider,
  type AuthorIdentityTrust,
  type DetectionResult,
  type ResolvedReview,
  type RecommendResult,
  type SelectResult,
  type ProbeEnv,
  type DetectOptions,
} from "../../src/domains/config/index";
