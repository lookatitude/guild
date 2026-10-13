/**
 * Backward-compatible public entrypoint.
 *
 * Role model schema implementation lives in src/modules/capability so the reorg
 * can move internals without breaking existing imports from scripts/lib.
 */

export {
  resolveRoles,
  validateRoleResolutionSet,
  ROLES,
  type Role,
  ROLE_STRENGTHS,
  type RoleStrength,
  type RoleResolution,
  type RoleResolutionSet,
  type RoleResolveInput,
  type ValidationResult,
} from "../../src/domains/config/index";
