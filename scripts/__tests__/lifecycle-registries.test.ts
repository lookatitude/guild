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

/**
 * OPERATOR/MACHINE-STATE GUARD (plugin-audit-remediation G1b, 2026-07-12).
 *
 * This suite asserts the UMBRELLA WORKSPACE's `.guild/workflows|loops/registry.yaml`
 * (`workspaceRoot()` = `../../..`, i.e. the guild umbrella repo). Those registries are
 * MACHINE STATE of an operator's umbrella checkout — they are NOT part of the plugin repo
 * (the umbrella gitignores its sub-repos and versions `.guild/` in the umbrella repo). On a
 * clean plugin-only CI checkout `../../..` is the runner's parent dir with no `.guild/`, so
 * the reads ENOENT and the suite fails vacuously. Self-skip (with a loud reason) when the
 * required registries are absent, so CI is honest-green and a real operator checkout still runs.
 */
const REQUIRED_REGISTRIES = [".guild/workflows/registry.yaml", ".guild/loops/registry.yaml"];
const missingRegistry = REQUIRED_REGISTRIES.find(
  (rel) => !fs.existsSync(path.join(workspaceRoot(), rel)),
);
const describeOrSkip = missingRegistry ? describe.skip : describe;
if (missingRegistry) {
  // eslint-disable-next-line no-console
  console.warn(
    `[lifecycle-registries] SKIPPED — umbrella workspace registry '${missingRegistry}' absent ` +
      `under ${workspaceRoot()} (operator/machine state, not present on a clean plugin CI checkout).`,
  );
}

describeOrSkip("workspace lifecycle registries", () => {
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
