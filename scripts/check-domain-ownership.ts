#!/usr/bin/env -S npx tsx
/**
 * Stable CLI shim. The implementation lives in src/domains/distribution.
 */

import { runDomainOwnershipCheck } from "../src/domains/distribution";

if (require.main === module) {
  process.exit(runDomainOwnershipCheck());
}
