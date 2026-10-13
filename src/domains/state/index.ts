/**
 * state — the public domain surface (KTD1/KTD27). This index is the ONLY
 * import surface: no file outside src/domains/state/ may reach a sibling module directly.
 *
 * Folded here (KTD36): state, migrations, workspace.
 */


// ── from src/modules/state ──────────────────────────────────────────
export * from "./atomic-write";
export * from "./dependency-graph-reader";
export * from "./dependency-graph-schema";
export * from "./frontmatter";
export * from "./guild-discovery";
export * from "./guild-root";
export * from "./index-cache";
export * from "./storage-artifact-registry";
export * from "./storage-fs";
export * from "./storage-janitor";
export * from "./storage-layout";
export * from "./storage-policy";
export * from "./storage-roots";
export * from "./upgrade-glossary";
export * from "./upgrade-journal";
export * from "./upgrade-runner";
export * from "./upgrade-steps";

// ── from src/modules/migrations ──────────────────────────────────────────
export const MODULE_PUBLIC_API_VERSION = "guild.module.public-api.v1" as const;

export {
  CURRENT_SCHEMA_VERSION,
  type MigrationResult,
  resolveGuildRoot as indexMigrateResolveGuildRoot,
  runIndexMigrateCli,
  runMigrations,
} from "./index-migrate";
export {
  type FmSplit,
  STRUCTURAL_BASENAMES,
  fmValue,
  isProvenance,
  splitFrontmatter as wikiImportanceSplitFrontmatter,
} from "./wiki-importance";

// ── from src/modules/workspace ──────────────────────────────────────────
export * from "./detect";
export * from "./federated-query";
export * from "./promote-upstream";
export * from "./write-manifest";

// ── consumed outside the domain (T16: every importer goes through this index) ──
export {
  assertNotUnderPluginInstall,
} from "./plugin-install-guard";
