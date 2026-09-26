/**
 * Transitional re-export shim (T12 fold, KTD36).
 *
 * The implementation moved once into src/domains/knowledge/. This file republishes the exact
 * pre-fold public surface of src/modules/learning so existing importers keep working;
 * T16 deletes it. New code imports src/domains/knowledge directly.
 */

export {
  ENTRY_POINT_NAMES,
  EVIDENCE_TIER,
  MODULE_PUBLIC_API_VERSION,
  NODE_CATEGORIES,
  isEntryPoint,
  kgDeadCode,
  kgEntryPoints,
  kgNeighbors,
  kgTrace,
  lintKnowledgeNodes,
  nodeRelPath,
  resolveEntryPointConfig,
  resolveSeeds,
  simpleName,
} from "../../domains/knowledge";
export type {
  DeadCodeOptions,
  DeadCodeResult,
  Direction,
  EntryPointSources,
  EvidenceNode,
  EvidenceTier,
  GraphEdge,
  GraphNode,
  GraphView,
  KnowledgeLintFinding,
  NeighborsResult,
  TraceEdge,
  TraceResult,
} from "../../domains/knowledge";
