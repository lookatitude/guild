#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * The protect-chunks CLI implementation lives in src/modules/context so the
 * reorg can move internals without breaking existing script invocations.
 */

import { runProtectChunksCli } from "../../src/domains/knowledge/index";

export { runProtectChunksCli } from "../../src/domains/knowledge/index";

if (require.main === module) {
  runProtectChunksCli();
}
