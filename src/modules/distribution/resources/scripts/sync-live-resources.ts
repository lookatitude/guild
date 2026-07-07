#!/usr/bin/env -S npx tsx
/**
 * Stable CLI shim. The implementation lives in src/modules/distribution.
 */

import { runModuleLiveResourcesCli } from "../src/modules/distribution/workflows/module-resources";

if (require.main === module) {
  process.exit(runModuleLiveResourcesCli());
}
