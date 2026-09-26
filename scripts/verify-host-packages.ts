#!/usr/bin/env -S npx tsx
/**
 * Stable CLI shim. The implementation lives in src/modules/distribution.
 */

import { runVerifyHostPackagesCli } from "../src/domains/distribution";

export {
  verifyGeneratedHostPackages,
  parseVerifyHostPackagesArgs,
  runVerifyHostPackagesCli,
  type HostPackageVerification,
} from "../src/domains/distribution";

if (require.main === module) {
  process.exit(runVerifyHostPackagesCli());
}
