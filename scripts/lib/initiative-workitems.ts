/**
 * Backward-compatible public entrypoint.
 *
 * Initiative work items live in src/modules/initiatives so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export {
  validateWorkItem,
  populateReleaseDocsWorkItems,
  WORK_ITEM_TYPES,
  WORK_ITEM_STATUS,
  type WorkItemType,
  type WorkItemStatus,
  type WorkItem,
} from "../../src/domains/lifecycle/index";
