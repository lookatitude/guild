#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Workspace upstream promotion staging lives in src/modules/workspace so the
 * reorg can move internals without breaking existing script paths.
 */

import { runPromoteUpstreamCli } from "../../src/domains/state";

export {
  validateRunId,
  collectUpstreamCandidates,
  runPromoteUpstreamCli,
  type UpstreamCandidate,
  type CollectOptions,
} from "../../src/domains/state";

if (require.main === module) {
  runPromoteUpstreamCli();
}
