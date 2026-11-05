/**
 * scripts/task-cell-api.ts — the E00 TaskCell controller library entry (CD14).
 *
 * Compiled to runtime/scripts/task-cell-api.js. Re-exports ONLY the approved
 * controller facades from the dispatch public index. The source-only
 * createTaskCellController and every low-level factory stay out of the package.
 * Not a CLI.
 */
export {
  approveOraclePlan,
  findQualifiedRunAcceptances,
  isQualifiedDownstreamRelease,
  readControllerStatus,
  recordAuthorityDecision,
  recordControllerLoss,
  startTaskCellController,
  submitObservedHandoff,
  writeAckClaim,
} from "../src/domains/dispatch";
