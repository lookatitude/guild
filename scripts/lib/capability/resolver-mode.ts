/**
 * Backward-compatible public entrypoint.
 *
 * `guild.resolver_mode_outcome.v1` — the five resolver operating modes (D4) —
 * lives in src/modules/capability so the reorg can move internals without
 * breaking existing imports from scripts/lib/capability/*.
 */

export {
  resolverModePolicy,
  resolverModeRank,
  isResolverModeFailure,
  classifyCompatibilityRead,
  resolveCapability,
  planModeTransition,
  RESOLVER_MODE_OUTCOME_SCHEMA,
  RESOLVER_AUTHORITIES,
  type ResolverAuthority,
  CAPABILITY_RESOLUTION_INTENTS,
  type CapabilityResolutionIntent,
  type ResolverModePolicy,
  RESOLVER_MODE_POLICIES,
  RESOLVER_MODE_FAILURES,
  type ResolverModeFailure,
  type CompatibilityReadClassification,
  type CapabilityResolutionRequest,
  type CapabilityResolutionOutcome,
  MODE_TRANSITION_DIRECTIONS,
  type ModeTransitionDirection,
  type ModeTransitionOutcome,
} from "../../../src/domains/config/index";
