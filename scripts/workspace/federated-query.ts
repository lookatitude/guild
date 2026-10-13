#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Federated workspace query planning lives in src/modules/workspace so the
 * reorg can move internals without breaking existing script paths.
 */

import { runFederatedQueryCli } from "../../src/domains/state";

export {
  federatedQuery,
  runFederatedQueryCli,
} from "../../src/domains/state";

if (require.main === module) {
  runFederatedQueryCli();
}
