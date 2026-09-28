#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public and CLI entrypoint.
 *
 * SQLite index migrations live in src/modules/migrations so the reorg can move
 * internals without breaking `npx tsx scripts/index-migrate.ts` or imports from
 * scripts/index-migrate.
 */

import { runIndexMigrateCli } from "../src/domains/state/index";

export {
  CURRENT_SCHEMA_VERSION,
  runMigrations,
  indexMigrateResolveGuildRoot as resolveGuildRoot,
  runIndexMigrateCli,
} from "../src/domains/state/index";
export type { MigrationResult } from "../src/domains/state/index";

if (typeof module !== "undefined" && require.main === module) {
  runIndexMigrateCli();
}
