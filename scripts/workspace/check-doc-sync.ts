#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible public and CLI entrypoint.
 *
 * Doc-sync evaluation now lives in src/modules/docs-sync so the docs-sync
 * module owns its executable workflows.
 */
export {
  isUserFacingSkill,
  evaluateDocSync,
  getChangedFilesResult,
  getCommitMessagesResult,
  resolveUserFacingSkillPaths,
  gatherCrossRepoInputs,
  checkDocSyncMain as main,
  type DocSyncInput,
  type DocSyncResult,
  type GitResult,
  type CrossRepoOptions,
} from "../../src/domains/distribution";

import { checkDocSyncMain as main } from "../../src/domains/distribution";

if (require.main === module) {
  main();
}
