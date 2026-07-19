/**
 * lib/initiative-workitems.ts — WorkItem shape + auto release/docs work-item
 * population (deferred item 13; docs/v2/initiatives.html §D8 / data-model.md
 * §WorkItem).
 *
 * The release/ + docs-sync/ dirs were scaffolded but populated by hand. This is
 * the deferred automation: derive the needed release + docs work-items from the
 * D8 gate state, so an initiative heading into close automatically gains the
 * exact work items the gate's unresolved legs require. Pure + deterministic
 * (stable ids); the caller persists them via manual capture / the sub-verb.
 */
import type { D8Result, DocumentationStatus } from "./initiative";

export const WORK_ITEM_TYPES = [
  "research", "design", "implementation", "review", "validation", "docs", "release", "cleanup",
] as const;
export const WORK_ITEM_STATUS = [
  "proposed", "ready", "in_progress", "blocked", "done", "deferred", "cancelled",
] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];
export type WorkItemStatus = (typeof WORK_ITEM_STATUS)[number];

export interface WorkItem {
  id: string;
  initiative_id: string;
  title: string;
  type: WorkItemType;
  status: WorkItemStatus;
  owner?: string;
  depends_on?: string[];
  acceptance?: string[];
  evidence_refs?: string[];
}

const TYPES = new Set<string>(WORK_ITEM_TYPES);
const STATUS = new Set<string>(WORK_ITEM_STATUS);

export function validateWorkItem(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!obj || typeof obj !== "object") return { valid: false, errors: ["work_item is not an object"] };
  const w = obj as Record<string, unknown>;
  for (const f of ["id", "initiative_id", "title"]) {
    if (typeof w[f] !== "string" || w[f] === "") errors.push(`missing required string field "${f}"`);
  }
  if (!TYPES.has(w["type"] as string)) errors.push(`type must be one of ${WORK_ITEM_TYPES.join("|")}`);
  if (!STATUS.has(w["status"] as string)) errors.push(`status must be one of ${WORK_ITEM_STATUS.join("|")}`);
  return { valid: errors.length === 0, errors };
}

/**
 * Auto-populate the release + docs work items an initiative needs to clear D8.
 * Only emits items for UNRESOLVED legs (idempotent shape — a resolved gate emits
 * none). The exec leg is the contributing runs' verify.md responsibility, not a
 * populated work item, so it is never emitted here.
 *
 * Stable ids: `<initiative_id>-wi-release` / `<initiative_id>-wi-docs`.
 */
export function populateReleaseDocsWorkItems(
  initiativeId: string,
  d8: D8Result,
  documentationStatus: DocumentationStatus,
): WorkItem[] {
  const items: WorkItem[] = [];

  if (!d8.legs.release) {
    items.push({
      id: `${initiativeId}-wi-release`,
      initiative_id: initiativeId,
      title: "Resolve release readiness + record rollback stance",
      type: "release",
      status: "ready",
      acceptance: [
        "release_status = released (or a documented rollback stance recorded as release_evidence_refs)",
      ],
    });
  }

  if (!d8.legs.docs) {
    const needsAssessment = documentationStatus === "not_assessed";
    items.push({
      id: `${initiativeId}-wi-docs`,
      initiative_id: initiativeId,
      title: needsAssessment
        ? "Assess documentation-sync requirement"
        : "Create + verify documentation-update",
      type: "docs",
      status: "ready",
      // The docs work item can only start once release is resolved (D8 order).
      depends_on: d8.legs.release ? [] : [`${initiativeId}-wi-release`],
      acceptance: needsAssessment
        ? [
            "documentation_status resolved to update_required or no_update_required",
            "docs/v2 design-set impact assessed: confirm whether this initiative changed/added a feature surface that the docs/v2 canonical design set must reflect",
          ]
        : [
            "docs-update work item verified",
            "documentation_status = updated",
            "docs/v2 design set reconciled in the same rollout (or 'docs/v2: n/a <reason>' recorded when the change does not touch a docs/v2-covered surface)",
          ],
    });
  }

  return items;
}
