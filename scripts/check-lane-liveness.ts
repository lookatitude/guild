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

if (require.main === module) {
  process.exit(runCheckLaneLivenessCli());
}
