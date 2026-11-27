/**
 * review — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/review/ may reach a sibling module directly.
 *
 * Folded here (KTD36): review, quality.
 */


// ── from src/modules/review ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./review-pairing";
export * from "./review-progress";
export * from "./advisory-contract";

// ── from src/modules/quality ──────────────────────────────────────────
export * from "./quality-catalog";
