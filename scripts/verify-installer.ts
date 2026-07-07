#!/usr/bin/env -S npx tsx
/**
 * Stable CLI shim. The implementation lives in src/modules/distribution.
 */

import { runVerifyInstallerCli } from "../src/modules/distribution/workflows/verify-installer";

export * from "../src/modules/distribution/workflows/verify-installer";

if (require.main === module) {
  process.exit(runVerifyInstallerCli());
}
