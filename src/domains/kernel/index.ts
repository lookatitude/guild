/**
 * kernel — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/kernel/ may reach a sibling module directly.
 *
 * Folded here (KTD36): kernel.
 */


// ── from src/modules/kernel ──────────────────────────────────────────
export * from "./module-manifest";
export * from "./yaml-loader";
export * from "./identifier-tokenize";
export * from "./sealed-collections";
export * from "./path-containment";
// U-RSI (T11): the AC37 no-self-edit guard. Here, not in `templates`, because every
// evolve writer asks the same question and a second copy is a second place to forget
// a newly-forbidden tree.
export * from "./runtime-tree-guard";
// U-TIER (T08): the T0/T1/T2 bus contract. Here rather than in `dispatch` so the
// communication domain's artifact bus can enforce it without a dependency cycle.
export * from "./tier-bus";
export * from "./plugin-root";
// The §1 canonical-hash rule (team-contracts). Pure (crypto only), so config and
// teams both reach it here without a teams -> config -> teams cycle.
export * from "./canonical-hash";
