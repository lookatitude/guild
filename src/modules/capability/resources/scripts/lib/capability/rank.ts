/**
 * Backward-compatible public entrypoint.
 *
 * Capability ranking lives in src/modules/capability so the reorg can move
 * internals without breaking existing imports from scripts/lib/capability/*.
 */
export {
  isClaudeHost,
  isCodexHost,
  isClaudeCli,
  isCodexCli,
  isPiCli,
  isAntigravityCli,
  affinityBoost,
  rankScore,
  backendForMode,
  getDefaultModelTierMap,
} from "../../../src/modules/capability/workflows/rank";
