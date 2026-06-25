#!/usr/bin/env npx tsx
/**
 * Backward-compatible public and CLI entrypoint.
 *
 * Wiki lint checks now live in src/modules/docs-sync so the docs-sync module
 * owns its executable workflows.
 */
export * from "../src/modules/docs-sync/workflows/wiki-lint-checks";

import { main } from "../src/modules/docs-sync/workflows/wiki-lint-checks";

if (require.main === module) {
  main();
}
