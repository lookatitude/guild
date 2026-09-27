#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Lane liveness now lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runCheckLaneLivenessCli } from "../src/domains/lifecycle";

export {
  readRunStateLanes,
  readHeartbeatAges,
  readReceiptEvidence,
  readReceiptStems,
  isStalled,
  sweepLaneLiveness,
  resolveTimeoutMs,
  runCheckLaneLivenessCli,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  type HeartbeatRecord,
  type LaneLiveness,
  type ReceiptEvidence,
  type LivenessReport,
} from "../src/domains/lifecycle";

// The domain module carries the compiled-bundle CLI gate. This one fires only
// for a direct TypeScript run, so a bundle never runs the CLI twice.
if (require.main === module && /\.[cm]?ts$/.test(process.argv[1] ?? "")) {
  process.exit(runCheckLaneLivenessCli());
}
