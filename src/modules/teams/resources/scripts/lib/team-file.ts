/**
 * Backward-compatible public entrypoint.
 *
 * Team-file parsing and phase-aware team artifact resolution live in
 * src/modules/teams so the reorg can move internals without breaking existing
 * imports from scripts/lib/team-file.
 */

export * from "../../src/modules/teams/workflows/team-file";
