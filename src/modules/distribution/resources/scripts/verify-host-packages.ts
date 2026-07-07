#!/usr/bin/env -S npx tsx
/**
 * Stable CLI shim. The implementation lives in src/modules/distribution.
 */

import { runVerifyHostPackagesCli } from "../src/modules/distribution/workflows/verify-host-packages";

export * from "../src/modules/distribution/workflows/verify-host-packages";

if (require.main === module) {
  process.exit(runVerifyHostPackagesCli());
}
