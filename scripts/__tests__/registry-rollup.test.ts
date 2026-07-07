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
