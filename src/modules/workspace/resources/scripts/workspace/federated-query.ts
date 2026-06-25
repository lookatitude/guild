#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Federated workspace query planning lives in src/modules/workspace so the
 * reorg can move internals without breaking existing script paths.
 */

import { runFederatedQueryCli } from "../../src/modules/workspace/workflows/federated-query";

export * from "../../src/modules/workspace/workflows/federated-query";

if (require.main === module) {
  runFederatedQueryCli();
}
