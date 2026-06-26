/**
 * Backward-compatible public entrypoint for the init scaffold manifest.
 *
 * The spec (init-config-goal §O line 110) names this path
 * (`plugin/scripts/lib/init-scaffold-manifest.ts`) as the manifest module that
 * `/guild:init`, host-open init, and repair consume. The canonical implementation
 * lives in src/modules/config so the reorganization can move internals without
 * breaking existing imports — same shim pattern as settings-resolver.ts.
 */

export * from "../../src/modules/config/workflows/init-scaffold-manifest";
