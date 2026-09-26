#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public and CLI entrypoint.
 *
 * Command coverage now lives in src/modules/docs-sync so the docs-sync module
 * owns its executable workflows.
 */
export {
  isTokenCovered,
  evaluateCommandCoverage,
  collectCommandTokens,
  htmlToText,
  gatherKnowledgeText,
  checkCommandCoverageMain as main,
  type CheckCommandCoverageCoverageResult as CoverageResult,
} from "../../src/domains/distribution";

import { checkCommandCoverageMain as main } from "../../src/domains/distribution";

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
