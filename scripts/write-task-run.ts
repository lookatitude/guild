#!/usr/bin/env -S npx tsx
/**
 * Backward-compatible executable entrypoint.
 *
 * Task-run writing lives in src/modules/lifecycle so the reorg can move
 * internals without breaking existing script paths.
 */

import { runWriteTaskRunCli } from "../src/domains/lifecycle";

export {
  taskRunPath,
  readTaskRunCapReqs,
  writeTaskRun,
  runWriteTaskRunCli,
  type AutonomyPolicy,
  type LoopsApplicable,
  type NetworkPolicy,
  type ApprovalPolicy,
  type TaskRunIds,
  type TaskRunPermissions,
  type TaskRunBudget,
  type TaskRunCapabilityRequirements,
  type TaskRunModelParams,
  type TaskRunHost,
  type TaskRunTrace,
  type TaskRun,
  type TaskRunDocument,
  type TaskRunCapabilityRequirementsParams,
  type TaskRunPermissionsParams,
  type TaskRunBudgetParams,
  type TaskRunHostParams,
  type TaskRunParams,
} from "../src/domains/lifecycle";

if (require.main === module) {
  runWriteTaskRunCli();
}
