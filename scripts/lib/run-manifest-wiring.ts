/**
 * Backward-compatible executable entrypoint.
 *
 * Run manifest wiring lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing imports from scripts/lib/run-manifest-wiring.
 */

import { runRunManifestWiringCli } from "../../src/domains/lifecycle/run-manifest-wiring";

export * from "../../src/domains/lifecycle/run-manifest-wiring";

if (require.main === module) {
  runRunManifestWiringCli();
}
