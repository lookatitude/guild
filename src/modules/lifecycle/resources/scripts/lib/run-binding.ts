/**
 * Backward-compatible public entrypoint.
 *
 * Run-binding core (guild.session_context.v1 §5) lives in
 * src/modules/lifecycle so the reorg can move internals without breaking
 * imports from scripts/lib/*.
 */
export * from "../../src/modules/lifecycle/workflows/run-binding";
