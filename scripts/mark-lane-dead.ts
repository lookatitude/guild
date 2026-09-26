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

if (require.main === module) {
  runMarkLaneDeadCli();
}
