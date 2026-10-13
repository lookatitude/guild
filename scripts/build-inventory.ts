#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * The implementation lives in src/modules/distribution so the reorganization can
 * move internals without breaking imports or `npx tsx scripts/build-inventory.ts`.
 */

export {
  discoverSurfaces,
  buildInventory,
  serializeInventory,
  parseArgs,
  main,
  PLUGIN_ROOT,
  UNSTAMPED_GENERATED_AT,
  type DiscoveryOutput,
} from "../src/domains/distribution";

import { main } from "../src/domains/distribution";

if (require.main === module) {
  process.exit(main());
}
