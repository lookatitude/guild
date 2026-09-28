/**
 * Backward-compatible public entrypoint.
 *
 * The prototype-pollution guard lives in src/modules/security so the reorg can
 * move internals without breaking existing imports from scripts/lib/shared/*.
 */

export { isProtoPoisonKey, PROTO_POISON_KEYS } from "../../../src/domains/security/index";
