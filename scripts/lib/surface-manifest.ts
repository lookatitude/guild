/**
 * Backward-compatible public entrypoint.
 *
 * The declarative live-surface manifest validator lives in src/modules/distribution
 * so the reorg can move internals without breaking existing imports from scripts/lib/*.
 */

export {
  validateSurfaceManifest,
  SURFACE_MANIFEST_SCHEMA_VERSION,
  type SurfaceKind,
  SURFACE_KINDS,
  type SurfaceManifest,
  type SurfaceManifestValidationResult as ValidationResult,
} from "../../src/domains/distribution/index";
