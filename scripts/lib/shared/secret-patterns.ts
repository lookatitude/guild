/**
 * Backward-compatible public entrypoint.
 *
 * The canonical SECRET_PATTERNS list lives in src/modules/security so the reorg
 * can move internals without breaking existing imports from scripts/lib/shared/*.
 */

export { SECRET_PATTERNS } from "../../../src/domains/security/index";
