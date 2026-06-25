#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public and CLI entrypoint.
 *
 * Command coverage now lives in src/modules/docs-sync so the docs-sync module
 * owns its executable workflows.
 */
export * from "../../src/modules/docs-sync/workflows/check-command-coverage";

import { main } from "../../src/modules/docs-sync/workflows/check-command-coverage";

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
