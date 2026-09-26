#!/usr/bin/env -S npx tsx
/**
 * Stable CLI shim. The implementation lives in src/modules/distribution.
 */

import { runVerifyInstallerCli } from "../src/domains/distribution";

export {
  verifyInstallerDryRunOutput,
  verifyInstallerHostExecutionLog,
  verifyInstallerDryRuns,
  verifyInstallerFixtureExecutions,
  verifyInstallerLiveIsolatedExecutions,
  parseVerifyInstallerArgs,
  runVerifyInstallerCli,
  type InstallerHost,
  type InstallerHostExpectation,
  type InstallerVerification,
  INSTALLER_HOST_EXPECTATIONS,
} from "../src/domains/distribution";

if (require.main === module) {
  process.exit(runVerifyInstallerCli());
}
