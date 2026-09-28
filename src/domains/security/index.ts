/**
 * security — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/security/ may reach a sibling module directly.
 *
 * Folded here (KTD36): security.
 */


// ── from src/modules/security ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export * from "./safe-object";
export * from "./injection-guard";
export * from "./scrubbed-write";
export * from "./redact-log";
export * from "./share-set";
// T6b: the canonical redaction applier + its pattern SoT are published so
// consuming modules (e.g. capability's `guild models inspect` emit path) scrub
// through the SAME code as the share scrubber and the package leak audit,
// instead of re-spelling patterns or wiring a private import.
export * from "./scrub-redact";
export * from "./secret-patterns";
// T09 (R53): the D-AUDIT security-event record + writer. Harvest is the one
// UNATTENDED durable-write path in Guild, so the knowledge domain must be able to
// emit its audit twin through this module's public entrypoint rather than
// reaching into `workflows/`.
export * from "./events";
// T15 (D5): the permission-content classifier. Every automatic writer of a
// prompt-loaded file screens through this one copy — evolve, its rollback, and
// the harvest playbook span-replace.
export * from "./d5-permission-content";
// T15 rework: the wiki-ingest pause marker the PreToolUse hook enforces.
export * from "./ingest-pause";
