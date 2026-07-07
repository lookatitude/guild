#!/usr/bin/env -S npx tsx
/**
 * Stable CLI shim. The implementation lives in src/modules/distribution.
 */

import { runModuleOwnershipCheck } from "../src/modules/distribution/workflows/check-module-ownership";

if (require.main === module) {
  process.exit(runModuleOwnershipCheck());
}
