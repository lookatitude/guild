/**
 * knowledge — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/knowledge/ may reach a sibling module directly.
 *
 * Folded here (KTD36): knowledge, context, learning.
 */


// ── from src/modules/knowledge ──────────────────────────────────────────
export * from "./bm25";
export * from "./graph-scoring";
export * from "./ingest-importance";
export * from "./knowledge-links-contract";
export * from "./wiki-frontmatter-contract";

// ── T09 work loop (U-LOOP) ───────────────────────────────────────────────────
// The knowledge domain owns the whole recall→research→harvest inner loop: the
// working-set card and its fingerprint, the lazy BM25 index (glossary included),
// the two context sizes, the cheap after-edit refresh, and the ONE automatic wiki
// writer with its journal and revert. Exported here because that writer is the
// only auto wiki writer there is — reaching into `workflows/` for it would be a
// second door onto the same durable surface.
export * from "./glossary";
export * from "./harvest";
export * from "./harvest-journal";
export * from "./lane-bundle";
export * from "./redirect-ledger";
export * from "./refresh-touched";
export * from "./research-packet";
export * from "./wiki-index";
export * from "./working-set";

// ── from src/modules/context ──────────────────────────────────────────
export * from "./fs-scanner";
export * from "./memory-adapter";
export * from "./protect-chunks-cli";
export * from "./recall";
export * from "./recall-protect";
export * from "./wiki-recall";

// ── from src/modules/learning ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./knowledge-graph-contract";
export * from "./graph-query";
export * from "./wiki-lint-knowledge";
