/**
 * Backward-compatible public entrypoint.
 *
 * Communication-format linting now lives in src/modules/communication so the
 * communication module owns its executable workflows. Keep this path stable for
 * existing imports from scripts/comms and hook bundles.
 */
export {
  lintCommsFormat,
  printFindings,
  parseArgs,
  POLICY_EFFECTIVE_DATE,
  type CommsLintFinding,
  type CommsLintOpts,
  ALLOWED_ENVELOPE_KEYS,
} from "../../src/domains/dispatch";
