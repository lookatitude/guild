import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FEATURE_GATE_REGISTRY_SCHEMA, executeResolverRollback, readFeatureGateRegistry, shadowCompareCapability, writeFeatureGateRegistry } from "../lib/capability/strangler-control";

describe("production strangler controls", () => {
  it("persists a validated feature-gate registry and executes a rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "guild-gates-"));
    try {
      writeFeatureGateRegistry(root, { schema_version: FEATURE_GATE_REGISTRY_SCHEMA, resolver_mode: "project-local", revision: 3, updated_at: "2026-08-10T00:00:00Z", updated_by: "operator", history: [] });
      expect(readFeatureGateRegistry(root)?.resolver_mode).toBe("project-local");
      expect(executeResolverRollback({ projectRoot: root, to: "shadow", reason: "Stage-05 drill", actor: "operator", recordedAt: "2026-08-10T00:01:00Z" })).toEqual({ status: "rolled_back", from: "project-local", to: "shadow", revision: 4 });
      expect(readFeatureGateRegistry(root)?.resolver_mode).toBe("shadow");
      expect(readFileSync(join(root, ".guild/artifacts/capability/feature-gates.json"), "utf8")).toContain("Stage-05 drill");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("runs both resolvers and compares normalized result plus receipt while legacy remains binding", () => {
    const calls: string[] = [];
    const result = shadowCompareCapability({ kind: "agent", capability_id: "architect", project_definition: ".guild/agents/architect.md", compatibility_asset: "templates/specialists/architect.md" }, (p, source) => {
      calls.push(source);
      return { normalized: { role: "architect", tools: ["Read"] }, receipt: { outcome: "resolved" } };
    });
    expect(calls).toEqual(["compatibility", "project"]);
    expect(result.status).toBe("match");
    expect(result.binding).toBe("compatibility");
    expect(result.side_effects_permitted).toBe(false);
  });

  it("reports drift when either normalized output or receipt differs", () => {
    const result = shadowCompareCapability({ kind: "agent", capability_id: "architect", project_definition: ".guild/agents/architect.md", compatibility_asset: "templates/specialists/architect.md" }, (_p, source) => ({ normalized: { role: "architect" }, receipt: { source } }));
    expect(result.status).toBe("drift");
    expect(result.normalized_equivalent).toBe(true);
    expect(result.receipt_equivalent).toBe(false);
  });
});
