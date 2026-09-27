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

// The domain module carries the compiled-bundle CLI gate. This one fires only
// for a direct TypeScript run, so a bundle never runs the CLI twice.
if (require.main === module && /\.[cm]?ts$/.test(process.argv[1] ?? "")) {
  runEmitLoopEventCli();
}
