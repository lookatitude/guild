/**
 * Backward-compatible public entrypoint.
 *
 * Capability tiebreak ordering lives in src/modules/capability so the reorg can
 * move internals without breaking existing imports from scripts/lib/capability/*.
 */
export { hostKindRank } from "../../../src/modules/capability/workflows/tiebreak";
