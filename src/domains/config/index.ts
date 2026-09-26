/**
 * config — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/config/ may reach a sibling module directly.
 *
 * Folded here (KTD36): config, capability, prompting.
 */


// ── from src/modules/config ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./config-defaults";
export * from "./policy-keys";
export * from "./policy-resolver";
export * from "./session-binding";
export * from "./config-validation";
export * from "./settings-resolver";
export * from "./tier-model";

// ── from src/modules/capability ──────────────────────────────────────────
export * from "./catalog-cache";
export * from "./compatibility-catalog";
export * from "./compatibility-usage";
export * from "./confirmation-arbiter";
export * from "./independence-predicates";
export * from "./independence-record";
export * from "./inspection-persist";
export * from "./inspection-record";
export * from "./model-catalog";
export * from "./model-inspect";
export * from "./model-policy";
export * from "./model-resolver";
export * from "./policy-migration";
export * from "./purpose-provenance";
export * from "./resolver-mode";
export * from "./rank";
export * from "./role-model-schema";
export * from "./routing-rollout";
export * from "./role-resolver";
export * from "./router";
export * from "./tiebreak";
export * from "./tier-defaults";

// ── from src/modules/prompting ──────────────────────────────────────────
export * from "./compose-prompt";
export * from "./team-prompt";
