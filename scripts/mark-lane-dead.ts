#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Lane exhaustion marking lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runMarkLaneDeadCli } from "../src/domains/lifecycle";

export {
  parseMarkLaneDeadArgs,
  markLaneDeadFromArgs,
  runMarkLaneDeadCli,
  type MarkLaneDeadArgs,
} from "../src/domains/lifecycle";

// The domain module carries the compiled-bundle CLI gate. This one fires only
// for a direct TypeScript run, so a bundle never runs the CLI twice.
if (require.main === module && /\.[cm]?ts$/.test(process.argv[1] ?? "")) {
  runMarkLaneDeadCli();
}
