#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Workspace upstream promotion staging lives in src/modules/workspace so the
 * reorg can move internals without breaking existing script paths.
 */

import { runPromoteUpstreamCli } from "../../src/modules/workspace/workflows/promote-upstream";

export * from "../../src/modules/workspace/workflows/promote-upstream";

if (require.main === module) {
  runPromoteUpstreamCli();
}
