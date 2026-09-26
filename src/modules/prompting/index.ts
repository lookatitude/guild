/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/config/. This file republishes the exact
 * pre-fold public surface of src/modules/prompting so existing importers keep working;
 * T16 deletes it. New code imports src/domains/config directly.
 */

export {
  DIALECTS_DIRNAME,
  DIALECT_TOKEN_BUDGET,
  MODEL_FAMILIES,
  PLUGIN_DIALECTS_REL,
  PROMPTS_DIRNAME,
  PromptRejectedError,
  USING_GUILD_BASE_RELS,
  USING_GUILD_OVERLAY,
  approxTokens,
  buildPrompt,
  composePrompt,
  composeSessionPrompt,
  concreteModelNameIn,
  loadPromptExtensions,
  promptIdentityIn,
} from "../../domains/config";
export type {
  ComposeExtensions,
  ComposedPrompt,
  LoadedPromptExtensions,
  PromptFragment,
  PromptIdentityHit,
  PromptIdentityKind,
  SessionComposeInput,
  SkipReason,
  TeamPromptSpecialist,
} from "../../domains/config";
