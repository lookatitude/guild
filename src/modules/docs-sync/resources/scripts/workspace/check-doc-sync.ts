#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public and CLI entrypoint.
 *
 * Doc-sync evaluation now lives in src/modules/docs-sync so the docs-sync
 * module owns its executable workflows.
 */
export * from "../../src/modules/docs-sync/workflows/check-doc-sync";

import { main } from "../../src/modules/docs-sync/workflows/check-doc-sync";

if (require.main === module) {
  main();
}
