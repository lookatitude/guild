/**
 * Backward-compatible public entrypoint.
 *
 * The redaction applier implementation lives in src/modules/security so the reorg
 * can move internals without breaking existing imports from scripts/lib/shared/*.
 */

export {
  redact,
  redactShareableFile,
  type SecretHit,
  type RedactResult,
} from "../../../src/domains/security/index";
