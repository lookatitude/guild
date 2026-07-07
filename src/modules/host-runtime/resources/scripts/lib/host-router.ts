/**
 * scripts/lib/host-router.ts — THIN RE-EXPORT SHIM (W3 god-file split)
 *
 * Public entrypoint preserved for backward compatibility per public-entrypoints.txt.
 * All implementation has moved to:
 *   scripts/lib/capability/router.ts   — route(), planTeamRouting(), types
 *   scripts/lib/capability/rank.ts     — affinityBoost(), backendForMode(), getDefaultModelTierMap()
 *   scripts/lib/capability/tiebreak.ts — hostKindRank()
 *
 * Importers of this path continue to resolve unchanged.
 */

export type {
  Tier,
  AgentMode,
  WorkType,
  BackendCapability,
  CapabilityRequirements,
  HostCapabilitySet,
  RoutableHost,
  LaneRequest,
  RouteOptions,
  ModelParams,
  RouteTarget,
  RejectedHost,
  RoutingDecision,
  SpecialistBackend,
  SpecialistRoute,
  PlanTeamRoutingOpts,
} from "./capability/router";
export { RouteError, resolveModel, resolveModelParams, route, planTeamRouting } from "./capability/router";
export { getDefaultModelTierMap, backendForMode, affinityBoost } from "./capability/rank";
