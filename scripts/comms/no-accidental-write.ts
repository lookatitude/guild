/**
 * Backward-compatible public entrypoint.
 *
 * Accidental-write protection now lives in src/modules/communication so the
 * communication module owns its executable workflows. Keep this path stable for
 * existing imports from scripts/comms.
 */
export {
  checkAccidentalWrite,
  type ProtectedSurface,
  SETTINGS_JSON_REQUIRED_KEYS,
  SETTINGS_JSON_KNOWN_KEYS,
  WORKSPACE_JSON_REQUIRED_KEYS,
  PROVENANCE_JSON_REQUIRED_KEYS,
  TRACE_JSONL_REQUIRED_KEYS,
  DOCS_KNOWLEDGE_FRONTMATTER_REQUIRED_KEYS,
  type AccidentalWriteViolation,
  type AccidentalWriteResult,
  type AccidentalWriteOpts,
} from "../../src/domains/dispatch";
