/**
 * Backward-compatible public entrypoint.
 *
 * Initiative activity lives in src/modules/initiatives so the reorg can move
 * internals without breaking existing imports from scripts/lib/*.
 */
export {
  isValidActivityRow,
  makeActivityRow,
  appendActivity,
  readActivity,
  ACTIVITY_SCHEMA,
  ACTIVITY_EVENTS,
  type ActivityEvent,
  type ActivityRow,
} from "../../src/domains/lifecycle/index";
