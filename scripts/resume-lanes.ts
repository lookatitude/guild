#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Lane resume scanning lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runResumeLanesCli } from "../src/domains/lifecycle";

export {
  parseResumeLanesArgs,
  scanResumableLanes,
  runResumeLanesCli,
  type ResumableLane,
  type ResumeLanesArgs,
} from "../src/domains/lifecycle";

if (require.main === module) {
  runResumeLanesCli();
}
