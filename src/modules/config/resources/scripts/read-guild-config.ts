#!/usr/bin/env -S npx tsx
/**
 * scripts/read-guild-config.ts — THIN RE-EXPORT SHIM (W3 god-file split)
 *
 * Public entrypoint preserved for backward compatibility per public-entrypoints.txt.
 * All implementation has moved to:
 *   scripts/lib/core/config-cli.ts      — CLI, validate*, scaffold, DEFAULTS, HELP, types
 *
 * CLI invocation (npx tsx scripts/read-guild-config.ts ...) is preserved via
 * the `require.main === module` guard below, which calls __main() from core/config-cli.
 *
 * Importers of this path (config-cmd.ts, tests) continue to resolve unchanged.
 */

export type { TierModelSpec, TierHostValue, ResolvedTierModel } from "./lib/core/config-cli";
export {
  resolveTierModel,
  DEFAULTS,
  HELP,
  validateModels,
  validateSecurity,
  validateSecretsPolicy,
  validateMcp,
  validateRoles,
  validateHostProfiles,
  validateCapability,
  validateCrossHostBlock,
  validateDefaults,
  scaffold,
} from "./lib/core/config-cli";

// Only run the CLI when executed directly — NOT when imported.
// Without this guard the import would run main(), parse the importer's argv,
// and pollute stdout. Matches the require.main===module pattern used across scripts/.
// The argv test is load-bearing: esbuild inlines this file into the hook bundles
// (hooks/dist/*.js), where `require.main === module` is true for every inlined
// module, so the guard alone dumped the full resolved config on every hook fire.
if (require.main === module && /^read-guild-config\.[cm]?[jt]s$/.test((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "")) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { __main } = require("./lib/core/config-cli") as { __main: () => void };
  __main();
}
