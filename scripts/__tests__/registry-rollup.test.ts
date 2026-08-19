/**
 * scripts/__tests__/registry-rollup.test.ts
 *
 * Initiatives-registry rollup builder + D8 close gate (deferred items 15 & 16).
 * Real path (temp .guild tree, real fs).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { buildInitiativesRegistry, writeInitiativesRegistry, REGISTRY_SCHEMA } from "../registry-rollup";
import { d8CloseGate } from "../lib/initiative";

function mkGuild(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "guild-registry-"));
}
function manifest(root: string, bucket: string, id: string, body: string): void {
  const p = path.join(root, "initiatives", bucket, id, "initiative.yaml");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}
function prov(root: string, runId: string, initiative: string | null, closedAt: string): void {
  const p = path.join(root, "runs", runId, "provenance.json");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ schema_version: "guild.provenance.v1", run_id: runId, initiative, closed_at: closedAt }), "utf8");
}

const v1 = (id: string, axes: string) =>
  `id: ${id}\ntitle: "${id}"\nsummary_ref: ".guild/initiatives/active/${id}/summary.md"\ncreated_at: "2026-06-13T00:00:00Z"\nupdated_at: "2026-06-13T00:00:00Z"\n${axes}\n`;

describe("buildInitiativesRegistry (item 15)", () => {
  test("derives status + rolls up run_ids + last_run_id, sorted, archived→closed", () => {
    const g = mkGuild();
    manifest(g, "active", "init_a",
      v1("init_a", "definition_status: complete\nexecution_status: active\nrelease_status: not_released\ndocumentation_status: not_assessed"));
    manifest(g, "archived", "init_b",
      v1("init_b", "definition_status: complete\nexecution_status: done\nrelease_status: released\ndocumentation_status: updated"));
    prov(g, "run-2", "init_a", "2026-06-12T00:00:00Z");
    prov(g, "run-1", "init_a", "2026-06-10T00:00:00Z");
    prov(g, "run-x", null, "2026-06-11T00:00:00Z"); // unattached → ignored

    const reg = buildInitiativesRegistry(g);
    expect(reg.schema_version).toBe(REGISTRY_SCHEMA);
    expect(reg.initiatives.map((e) => e.id)).toEqual(["init_a", "init_b"]); // sorted

    const a = reg.initiatives.find((e) => e.id === "init_a")!;
    expect(a.status).toBe("in_progress");
    expect(a.run_ids).toEqual(["run-1", "run-2"]); // sorted by id
    expect(a.last_run_id).toBe("run-2");           // latest closed_at

    const b = reg.initiatives.find((e) => e.id === "init_b")!;
    expect(b.status).toBe("closed");               // archived bucket
    expect(b.run_ids).toEqual([]);
    expect(b.last_run_id).toBeNull();

    fs.rmSync(g, { recursive: true, force: true });
  });

  test("empty tree → empty registry; --write persists the yaml", () => {
    const g = mkGuild();
    const reg = buildInitiativesRegistry(g);
    expect(reg.initiatives).toEqual([]);
    const out = writeInitiativesRegistry(g, reg);
    expect(fs.existsSync(out)).toBe(true);
    expect(fs.readFileSync(out, "utf8")).toMatch(/guild\.initiatives_registry\.v1/);
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("legacy manifest (off-enum axes) falls back to its status field", () => {
    const g = mkGuild();
    manifest(g, "active", "legacy", `id: legacy\nstatus: in_progress\nexecution_status: in-progress\n`);
    const reg = buildInitiativesRegistry(g);
    expect(reg.initiatives[0].status).toBe("in_progress");
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("validated manifest authority overrides stale cached status axes while curated extras survive", () => {
    const g = mkGuild();
    manifest(g, "active", "live",
      v1("live", "definition_status: complete\nexecution_status: active\nrelease_status: not_released\ndocumentation_status: update_required"));

    const cached = path.join(g, "indexes", "initiatives-registry.yaml");
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, [
      "schema_version: guild.initiatives_registry.v1",
      "initiatives:",
      "  - id: live",
      "    status: proposed",
      "    definition_status: incomplete",
      "    execution_status: not_started",
      "    release_status: released",
      "    documentation_status: no_update_required",
      "    title: stale cached title",
      "    path: .guild/initiatives/archived/live/",
      "    notes: preserve this operator note",
      "    custom_operator_field: preserve-me",
      "",
    ].join("\n"), "utf8");

    const entry = buildInitiativesRegistry(g).initiatives.find((e) => e.id === "live")!;
    expect(entry).toMatchObject({
      status: "in_progress",
      definition_status: "complete",
      execution_status: "active",
      release_status: "not_released",
      documentation_status: "update_required",
      title: "live",
      path: ".guild/initiatives/active/live/",
      notes: "preserve this operator note",
      custom_operator_field: "preserve-me",
    });

    fs.rmSync(g, { recursive: true, force: true });
  });

  test("cached run linkage survives when retained runs are absent from the live runs directory", () => {
    const g = mkGuild();
    manifest(g, "active", "live",
      v1("live", "definition_status: complete\nexecution_status: active\nrelease_status: not_released\ndocumentation_status: update_required"));
    const cached = path.join(g, "indexes", "initiatives-registry.yaml");
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, [
      "schema_version: guild.initiatives_registry.v1",
      "initiatives:",
      "  - id: live",
      "    status: in_progress",
      "    run_ids: [run-retained-1]",
      "    last_run_id: run-retained-1",
      "",
    ].join("\n"), "utf8");

    const entry = buildInitiativesRegistry(g).initiatives.find((e) => e.id === "live")!;
    expect(entry.run_ids).toEqual(["run-retained-1"]);
    expect(entry.last_run_id).toBe("run-retained-1");
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("invalid manifest cannot replace cached status axes with synthesized or off-enum values", () => {
    const g = mkGuild();
    manifest(g, "active", "live", "id: live\ntitle: invalid-new-title\nexecution_status: in-progress\n");
    const cached = path.join(g, "indexes", "initiatives-registry.yaml");
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, [
      "schema_version: guild.initiatives_registry.v1",
      "initiatives:",
      "  - id: live",
      "    title: trusted cached title",
      "    status: in_progress",
      "    definition_status: complete",
      "    execution_status: active",
      "    release_status: not_released",
      "    documentation_status: update_required",
      "",
    ].join("\n"), "utf8");

    const entry = buildInitiativesRegistry(g).initiatives.find((e) => e.id === "live")!;
    expect(entry).toMatchObject({
      title: "trusted cached title",
      status: "in_progress",
      definition_status: "complete",
      execution_status: "active",
      release_status: "not_released",
      documentation_status: "update_required",
      path: ".guild/initiatives/active/live/",
    });
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("active entries preserve curated final_status while archived location forces closure", () => {
    const g = mkGuild();
    manifest(g, "active", "cancelled",
      v1("cancelled", "definition_status: complete\nexecution_status: active\nrelease_status: not_released\ndocumentation_status: update_required"));
    manifest(g, "archived", "moved",
      v1("moved", "definition_status: complete\nexecution_status: done\nrelease_status: released\ndocumentation_status: updated"));
    const cached = path.join(g, "indexes", "initiatives-registry.yaml");
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, [
      "schema_version: guild.initiatives_registry.v1",
      "initiatives:",
      "  - id: cancelled",
      "    status: cancelled",
      "    final_status: cancelled",
      "  - id: moved",
      "    status: in_progress",
      "    final_status: open",
      "    path: .guild/initiatives/active/moved/",
      "",
    ].join("\n"), "utf8");

    const entries = buildInitiativesRegistry(g).initiatives;
    expect(entries.find((e) => e.id === "cancelled")).toMatchObject({
      status: "cancelled",
      final_status: "cancelled",
    });
    expect(entries.find((e) => e.id === "moved")).toMatchObject({
      status: "closed",
      final_status: "closed",
      path: ".guild/initiatives/archived/moved/",
    });
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("archived filesystem location closes cached live status even when the manifest is invalid", () => {
    const g = mkGuild();
    manifest(g, "archived", "broken", "id: broken\ntitle: broken\nexecution_status: in-progress\n");
    const cached = path.join(g, "indexes", "initiatives-registry.yaml");
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, [
      "schema_version: guild.initiatives_registry.v1",
      "initiatives:",
      "  - id: broken",
      "    status: in_progress",
      "    final_status: open",
      "    path: .guild/initiatives/active/broken/",
      "",
    ].join("\n"), "utf8");

    expect(buildInitiativesRegistry(g).initiatives.find((e) => e.id === "broken")).toMatchObject({
      status: "closed",
      final_status: "closed",
      path: ".guild/initiatives/archived/broken/",
    });
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("archived cancelled disposition is terminal and rollup is idempotent", () => {
    const g = mkGuild();
    manifest(g, "archived", "cancelled", [
      v1("cancelled", "definition_status: complete\nexecution_status: active\nrelease_status: not_released\ndocumentation_status: update_required"),
      "status: cancelled\n",
    ].join(""));

    const first = buildInitiativesRegistry(g);
    expect(first.initiatives.find((e) => e.id === "cancelled")).toMatchObject({
      status: "cancelled",
      final_status: "cancelled",
      path: ".guild/initiatives/archived/cancelled/",
    });
    writeInitiativesRegistry(g, first);
    expect(buildInitiativesRegistry(g)).toEqual(first);
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("run linkage includes both live and retention-archived provenance", () => {
    const g = mkGuild();
    manifest(g, "active", "live",
      v1("live", "definition_status: complete\nexecution_status: active\nrelease_status: not_released\ndocumentation_status: update_required"));
    prov(g, "run-current", "live", "2026-08-10T00:00:00Z");
    const retained = path.join(g, "runs", "_archive", "run-retained", "provenance.json");
    fs.mkdirSync(path.dirname(retained), { recursive: true });
    fs.writeFileSync(retained, JSON.stringify({
      schema_version: "guild.provenance.v1",
      run_id: "run-retained",
      initiative: "live",
      closed_at: "2026-08-01T00:00:00Z",
    }), "utf8");

    const entry = buildInitiativesRegistry(g).initiatives.find((e) => e.id === "live")!;
    expect(entry.run_ids).toEqual(["run-current", "run-retained"]);
    expect(entry.last_run_id).toBe("run-current");
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("cancellation is preserved from either cached status field", () => {
    const g = mkGuild();
    manifest(g, "active", "status-only",
      v1("status-only", "definition_status: complete\nexecution_status: active\nrelease_status: not_released\ndocumentation_status: update_required"));
    manifest(g, "archived", "final-only", "id: final-only\ntitle: invalid\nexecution_status: in-progress\n");
    const cached = path.join(g, "indexes", "initiatives-registry.yaml");
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, [
      "schema_version: guild.initiatives_registry.v1",
      "initiatives:",
      "  - id: status-only",
      "    status: cancelled",
      "  - id: final-only",
      "    status: in_progress",
      "    final_status: cancelled",
      "",
    ].join("\n"), "utf8");

    const entries = buildInitiativesRegistry(g).initiatives;
    expect(entries.find((e) => e.id === "status-only")).toMatchObject({ status: "cancelled", final_status: "cancelled" });
    expect(entries.find((e) => e.id === "final-only")).toMatchObject({ status: "cancelled", final_status: "cancelled" });
    fs.rmSync(g, { recursive: true, force: true });
  });

  test("duplicate run ids across live and retention trees collapse to one linkage", () => {
    const g = mkGuild();
    manifest(g, "active", "live",
      v1("live", "definition_status: complete\nexecution_status: active\nrelease_status: not_released\ndocumentation_status: update_required"));
    prov(g, "run-moving", "live", "2026-08-10T00:00:00Z");
    const retained = path.join(g, "runs", "_archive", "run-moving", "provenance.json");
    fs.mkdirSync(path.dirname(retained), { recursive: true });
    fs.writeFileSync(retained, JSON.stringify({
      schema_version: "guild.provenance.v1",
      run_id: "run-moving",
      initiative: "live",
      closed_at: "2026-08-09T00:00:00Z",
    }), "utf8");

    const entry = buildInitiativesRegistry(g).initiatives.find((e) => e.id === "live")!;
    expect(entry.run_ids).toEqual(["run-moving"]);
    expect(entry.last_run_id).toBe("run-moving");
    fs.rmSync(g, { recursive: true, force: true });
  });
});

describe("d8CloseGate (item 16) — three legs never collapsed", () => {
  const base = { execVerified: true, execution_status: "done", release_status: "released", documentation_status: "updated" } as const;
  test("all three legs resolved → canClose", () => {
    const r = d8CloseGate(base);
    expect(r.canClose).toBe(true);
    expect(r.legs).toEqual({ exec: true, release: true, docs: true });
    expect(r.blockers).toEqual([]);
  });
  test("exec not verified → exec leg blocks", () => {
    const r = d8CloseGate({ ...base, execVerified: false });
    expect(r.canClose).toBe(false);
    expect(r.legs.exec).toBe(false);
    expect(r.blockers.join(" ")).toMatch(/exec leg/);
  });
  test("not released → release leg blocks (release & docs separate)", () => {
    const r = d8CloseGate({ ...base, release_status: "release_candidate" });
    expect(r.canClose).toBe(false);
    expect(r.legs).toEqual({ exec: true, release: false, docs: true });
  });
  test("rollback_required does NOT close", () => {
    expect(d8CloseGate({ ...base, release_status: "rollback_required" }).canClose).toBe(false);
  });
  test("docs unresolved → docs leg blocks", () => {
    const r = d8CloseGate({ ...base, documentation_status: "update_required" });
    expect(r.legs.docs).toBe(false);
    expect(r.canClose).toBe(false);
  });
  test("no_update_required resolves the docs leg", () => {
    expect(d8CloseGate({ ...base, documentation_status: "no_update_required" }).canClose).toBe(true);
  });
});
