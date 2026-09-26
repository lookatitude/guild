#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Loop event emission lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runEmitLoopEventCli } from "../src/domains/lifecycle";

export {
  runEmitLoopEventCli,
} from "../src/domains/lifecycle";

if (require.main === module) {
  runEmitLoopEventCli();
}
