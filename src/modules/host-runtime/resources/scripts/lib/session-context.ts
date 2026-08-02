/**
 * Backward-compatible public entrypoint.
 *
 * guild.session_context.v1 (immutable per-run identity) lives in
 * src/modules/host-runtime so the reorg can move internals without breaking
 * imports from scripts/lib/*.
 */
export * from "../../src/modules/host-runtime/workflows/session-context";
