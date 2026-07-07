/**
 * scripts/__tests__/initiative-workitems.test.ts
 *
 * WorkItem shape + auto release/docs work-item population from D8 gate state
 * (deferred item 13). docs/v2/06-initiatives.md §D8; data-model.md §WorkItem.
 */

import { validateWorkItem, populateReleaseDocsWorkItems, type WorkItem } from "../lib/initiative-workitems";
import { d8CloseGate } from "../lib/initiative";

describe("validateWorkItem", () => {
  const wi: WorkItem = { id: "WI-1", initiative_id: "i", title: "t", type: "docs", status: "ready" };
  test("accepts a well-formed item; rejects off-enum type/status", () => {
    expect(validateWorkItem(wi).valid).toBe(true);
    expect(validateWorkItem({ ...wi, type: "bogus" }).valid).toBe(false);
    expect(validateWorkItem({ ...wi, status: "weird" }).valid).toBe(false);
    expect(validateWorkItem({ ...wi, id: "" }).valid).toBe(false);
  });
});

describe("populateReleaseDocsWorkItems (item 13)", () => {
  const docsAssessed: "update_required" = "update_required";

  test("a fully-resolved D8 emits NO work items", () => {
    const d8 = d8CloseGate({ execVerified: true, execution_status: "done", release_status: "released", documentation_status: "updated" });
    expect(populateReleaseDocsWorkItems("init_x", d8, "updated")).toEqual([]);
  });

  test("unresolved release + docs → both items, docs depends on release (D8 order)", () => {
    const d8 = d8CloseGate({ execVerified: true, execution_status: "done", release_status: "release_candidate", documentation_status: docsAssessed });
    const items = populateReleaseDocsWorkItems("init_x", d8, docsAssessed);
    expect(items.map((i) => i.type)).toEqual(["release", "docs"]);
    expect(items.map((i) => i.id)).toEqual(["init_x-wi-release", "init_x-wi-docs"]);
    const docs = items.find((i) => i.type === "docs")!;
    expect(docs.depends_on).toEqual(["init_x-wi-release"]); // can't sync docs before release resolves
    expect(items.every((i) => validateWorkItem(i).valid)).toBe(true);
  });

  test("release resolved, docs not assessed → only a docs ASSESSMENT item, no dependency", () => {
    const d8 = d8CloseGate({ execVerified: true, execution_status: "done", release_status: "released", documentation_status: "not_assessed" });
    const items = populateReleaseDocsWorkItems("init_x", d8, "not_assessed");
    expect(items.map((i) => i.type)).toEqual(["docs"]);
    expect(items[0].title).toMatch(/Assess/);
    expect(items[0].depends_on).toEqual([]);
  });

  test("stable, deterministic output (same inputs → identical items)", () => {
    const d8 = d8CloseGate({ execVerified: false, execution_status: "active", release_status: "not_released", documentation_status: "stale" });
    expect(populateReleaseDocsWorkItems("z", d8, "stale")).toEqual(populateReleaseDocsWorkItems("z", d8, "stale"));
  });
});
