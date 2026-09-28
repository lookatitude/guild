/**
 * Backward-compatible public entrypoint.
 *
 * Capability routing lives in src/modules/capability so the reorg can move
 * internals without breaking existing imports from scripts/lib/capability/*.
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
} from "../../../src/domains/config/index";
export {
  RouteError,
  resolveModel,
  resolveModelParams,
  route,
  planTeamRouting,
} from "../../../src/domains/config/index";
