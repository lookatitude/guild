/**
 * Backward-compatible public entrypoint.
 *
 * Host type definitions live in src/modules/host-runtime so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */

export type { HostKind } from "../../src/modules/host-runtime/workflows/host-types";
