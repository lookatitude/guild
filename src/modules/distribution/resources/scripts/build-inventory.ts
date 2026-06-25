#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * The implementation lives in src/modules/distribution so the reorganization can
 * move internals without breaking imports or `npx tsx scripts/build-inventory.ts`.
 */

export * from "../src/modules/distribution/workflows/build-inventory";

import { main } from "../src/modules/distribution/workflows/build-inventory";

if (require.main === module) {
  process.exit(main());
}
