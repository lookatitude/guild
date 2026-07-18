/**
 * scripts/__tests__/initiative-manifest.test.ts
 *
 * guild.initiative.v1 validator + 4-axis status derivation + definition-ledger
 * readiness (deferred items 10 & 11). docs/v2/initiatives.html;
 * docs/knowledge/observability/data-model.md §Initiative / §DefinitionItem.
 */

import {
  validateInitiativeManifest,
  deriveInitiativeStatus,
  validateDefinitionItem,
  ledgerReady,
  blockingUnresolved,
  type InitiativeAxes,
  type DefinitionItem,
} from "../lib/initiative";

const baseAxes: InitiativeAxes = {
  definition_status: "incomplete",
  execution_status: "not_started",
  release_status: "not_released",
  documentation_status: "not_assessed",
};
const validManifest = {
  id: "init_x", title: "X", summary_ref: ".guild/initiatives/active/init_x/summary.md",
  created_at: "2026-06-13T00:00:00Z", updated_at: "2026-06-13T00:00:00Z", ...baseAxes,
};

describe("validateInitiativeManifest", () => {
  test("accepts a well-formed manifest", () => {
    expect(validateInitiativeManifest(validManifest)).toEqual({ valid: true, errors: [] });
  });
  test("rejects missing required fields", () => {
    const { valid, errors } = validateInitiativeManifest({ ...validManifest, id: "", summary_ref: undefined });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/id/);
    expect(errors.join(" ")).toMatch(/summary_ref/);
  });
  test("rejects legacy/off-enum axis vocabulary", () => {
    const { valid, errors } = validateInitiativeManifest({ ...validManifest, execution_status: "in_progress" });
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/execution_status/);
  });
  test("non-object → invalid", () => {
    expect(validateInitiativeManifest(null).valid).toBe(false);
  });
});

describe("deriveInitiativeStatus — furthest-progressed point the axes support", () => {
  test("fresh / incomplete → proposed (defining once started)", () => {
    expect(deriveInitiativeStatus(baseAxes)).toBe("proposed");
    expect(deriveInitiativeStatus(baseAxes, { definingStarted: true })).toBe("defining");
  });
  test("definition complete/assumed (pre-exec) → ready", () => {
    expect(deriveInitiativeStatus({ ...baseAxes, definition_status: "complete" })).toBe("ready");
    expect(deriveInitiativeStatus({ ...baseAxes, definition_status: "assumed" })).toBe("ready");
  });
  test("execution active → in_progress; with review evidence → review", () => {
    const a = { ...baseAxes, definition_status: "complete", execution_status: "active" } as InitiativeAxes;
    expect(deriveInitiativeStatus(a)).toBe("in_progress");
    expect(deriveInitiativeStatus(a, { hasReview: true })).toBe("review");
  });
  test("release_candidate → release_ready; released → docs_update_pending → closed", () => {
    expect(deriveInitiativeStatus({ ...baseAxes, release_status: "release_candidate" })).toBe("release_ready");
    expect(deriveInitiativeStatus({ ...baseAxes, release_status: "released", documentation_status: "update_required" })).toBe("docs_update_pending");
    expect(deriveInitiativeStatus({ ...baseAxes, release_status: "released", documentation_status: "updated" })).toBe("closed");
  });
  test("detour states take precedence: cancelled, paused, archived, rollback", () => {
    expect(deriveInitiativeStatus(baseAxes, { cancelled: true })).toBe("cancelled");
    expect(deriveInitiativeStatus({ ...baseAxes, execution_status: "active" }, { paused: true })).toBe("paused");
    expect(deriveInitiativeStatus({ ...baseAxes, execution_status: "active" }, { archived: true })).toBe("closed");
    expect(deriveInitiativeStatus({ ...baseAxes, release_status: "rollback_required" })).toBe("release_ready");
  });
});

describe("definition ledger (item 11)", () => {
  const item = (status: DefinitionItem["status"], blocking: boolean): DefinitionItem => ({
    id: "DEF-1", initiative_id: "init_x", category: "goal", statement: "s", status, blocking,
  });
  test("validateDefinitionItem enforces the closed enums + blocking flag", () => {
    expect(validateDefinitionItem(item("defined", true)).valid).toBe(true);
    expect(validateDefinitionItem({ ...item("defined", true), category: "bogus" }).valid).toBe(false);
    expect(validateDefinitionItem({ ...item("defined", true), blocking: "yes" }).valid).toBe(false);
  });
  test("not ready while a blocking item is needs_definition", () => {
    expect(ledgerReady([item("defined", true), item("needs_definition", false)])).toBe(true);
    expect(ledgerReady([item("needs_definition", true)])).toBe(false);
    expect(blockingUnresolved([item("needs_definition", true), item("assumed", true)])).toHaveLength(1);
  });
  test("empty ledger is ready", () => {
    expect(ledgerReady([])).toBe(true);
  });
});
