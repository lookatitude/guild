/**
 * Backward-compatible public entrypoint for the host-open preflight API.
 *
 * The canonical implementation lives in src/modules/config/workflows so the
 * module reorganization can move internals without breaking imports — same shim
 * pattern as settings-resolver.ts / init-scaffold-manifest.ts. Host adapters (L3)
 * and the init/repair API (L2) consume `detectGuildState`, `hostOpenPreflight`,
 * and `suggestWorkspaceMode` through this path.
 */

export * from "../../src/modules/config/workflows/host-open-preflight";
