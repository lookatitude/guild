#!/usr/bin/env npx tsx
/**
 * Backward-compatible public and CLI entrypoint.
 *
 * Wiki lint checks now live in src/modules/docs-sync so the docs-sync module
 * owns its executable workflows.
 */
export {
  readLabelTaxonomy,
  lintWiki,
  wikiLintChecksMain as main,
  DEFAULT_CONCERN_ENUM,
  type LabelTaxonomy,
} from "../src/domains/distribution";

import { wikiLintChecksMain as main } from "../src/domains/distribution";

// The domain module carries the compiled-bundle CLI gate. This one fires only
// for a direct TypeScript run, so a bundle never runs the CLI twice.
if (require.main === module && /\.[cm]?ts$/.test(process.argv[1] ?? "")) {
  main();
}
