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

// The domain module carries the compiled-bundle CLI gate. This one fires only
// for a direct TypeScript run, so a bundle never runs the CLI twice.
if (require.main === module && /\.[cm]?ts$/.test(process.argv[1] ?? "")) {
  runResumeLanesCli();
}
