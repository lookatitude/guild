/**
 * src/modules/state/workflows/guild-root.ts
 *
 * Canonical state-module entrypoint for resolving the active Guild root. The
 * hook implementation remains the shared low-level resolver so hook-side JS
 * paths keep their current install contract.
 */

export { resolveGuildRoot } from "../../../../hooks/lib/guild-root";
