import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

function workspaceRoot(): string {
  return path.resolve(__dirname, "../../..");
}

function readYaml(rel: string): Record<string, unknown> {
  const abs = path.join(workspaceRoot(), rel);
  return yaml.load(fs.readFileSync(abs, "utf8")) as Record<string, unknown>;
}

describe("workspace lifecycle registries", () => {
  test("workflow registry is populated with end-to-end lifecycle workflows", () => {
    const registry = readYaml(".guild/workflows/registry.yaml");
    expect(registry.schema_version).toBe("guild.workflows_registry.v1");
    const workflows = registry.workflows as Array<Record<string, unknown>>;
    expect(workflows.length).toBeGreaterThanOrEqual(10);
    const ids = workflows.map((w) => w.id);
    expect(ids).toEqual(expect.arrayContaining([
      "ambient-prompt-intake",
      "research-synthesis",
      "spec-to-goals",
      "implementation-dynamic",
      "qa-dynamic",
      "devops-dynamic",
      "docs-code-sync",
    ]));
  });

  test("loop registry includes prompt routing, goal decomposition, QA, and DevOps loops", () => {
    const registry = readYaml(".guild/loops/registry.yaml");
    expect(registry.schema_version).toBe("guild.loops_registry.v1");
    const loops = registry.loops as Array<Record<string, unknown>>;
    const ids = loops.map((loop) => loop.id);
    expect(ids).toEqual(expect.arrayContaining([
      "ambient-prompt-routing",
      "research-synthesis",
      "spec-to-goals-and-tasks",
      "per-goal-team-composition",
      "modality-specific-implementation",
      "runtime-qa",
      "devops-release-runbook",
      "devops-incident-rollback",
      "devops-monitoring-maintenance",
    ]));
  });
});
