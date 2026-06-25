#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * The protect-chunks CLI implementation lives in src/modules/context so the
 * reorg can move internals without breaking existing script invocations.
 */

import { runProtectChunksCli } from "../../src/modules/context/workflows/protect-chunks-cli";

export { runProtectChunksCli } from "../../src/modules/context/workflows/protect-chunks-cli";

if (require.main === module) {
  runProtectChunksCli();
}
