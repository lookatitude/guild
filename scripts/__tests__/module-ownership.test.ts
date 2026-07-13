/**
 * Module-ownership rail for the src/modules/* reorganization.
 *
 * Module manifests own every inventory id, module resources hold the canonical
 * bodies, and live host-facing paths stay as generated compatibility mirrors.
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";

import { buildInventory } from "../build-inventory";
import {
  loadModuleManifests,
  validateModuleBoundaries,
  validateModuleHealth,
  validateModuleOwnership,
  type ModuleManifest,
} from "../lib/module-manifest";
import * as shim from "../lib/module-manifest";
import * as moduleImpl from "../../src/modules/kernel/workflows/module-manifest";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

function cloneManifests(manifests: ModuleManifest[]): ModuleManifest[] {
  return JSON.parse(JSON.stringify(manifests)) as ModuleManifest[];
}

describe("src/modules ownership manifests", () => {
  const inventory = buildInventory(PLUGIN_ROOT);
  const manifests = loadModuleManifests(PLUGIN_ROOT);

  it("loads the module map with the expected substrate modules present", () => {
    const ids = manifests.map((manifest) => manifest.id).sort();
    expect(ids).toContain("context");
    expect(ids).toContain("prompting");
    expect(ids).toContain("communication");
    expect(ids).toContain("dispatch");
    expect(ids).toContain("kernel");
    for (const id of ["intake", "loops", "review"]) {
      expect(manifests.find((manifest) => manifest.id === id)?.implementation_mode).toBe("workflow-backed");
    }
    // dashboard flipped to resource-only when its orphaned projector was deleted
    // (plugin-audit-remediation G5b) — it owns resources, ships no workflow code.
    expect(manifests.find((manifest) => manifest.id === "dashboard")?.implementation_mode).toBe("resource-only");
    expect(ids.length).toBeGreaterThanOrEqual(25);
  });

  it("keeps scripts/lib/module-manifest as a compatibility shim over src/modules/kernel", () => {
    expect(shim.MODULE_MANIFEST_SCHEMA_VERSION).toBe(moduleImpl.MODULE_MANIFEST_SCHEMA_VERSION);
    expect(shim.loadModuleManifests).toBe(moduleImpl.loadModuleManifests);
    expect(shim.validateModuleOwnership).toBe(moduleImpl.validateModuleOwnership);
    expect(shim.validateModuleBoundaries).toBe(moduleImpl.validateModuleBoundaries);
    expect(shim.validateModuleHealth).toBe(moduleImpl.validateModuleHealth);
  });

  it("assigns every live command/skill/agent/hook/mcp/script inventory id to exactly one module", () => {
    const result = validateModuleOwnership(inventory, manifests);
    expect(result).toEqual({ ok: true, missing: [], duplicate: [], errors: [] });

    // Anti-vacuity floors: the rail is checking the real current surface, not an
    // empty fixture or a narrow sample.
    expect(inventory.commands.length).toBeGreaterThanOrEqual(20);
    expect(inventory.skills.length).toBeGreaterThanOrEqual(100);
    // Machinery agents only (machinery-vs-template-library ADR): advisor +
    // developer. The 15 domain roles are templates/specialists/*.md, not
    // inventoried agents.
    expect(inventory.agents.length).toBe(2);
    expect(inventory.hooks.length).toBeGreaterThanOrEqual(10);
    expect(inventory.scripts.length).toBeGreaterThanOrEqual(200);
  });

  it("uses public module indexes for cross-module imports and declares each dependency", () => {
    const result = validateModuleBoundaries(PLUGIN_ROOT, manifests);
    expect(result).toEqual({ ok: true, violations: [], errors: [] });
  });

  it("keeps every module healthy: generated resources exist and workflow modules expose public indexes", () => {
    const result = validateModuleHealth(PLUGIN_ROOT, manifests);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.modules.length).toBe(manifests.length);
    expect(result.modules.filter((module) => module.workflows > 0).length).toBeGreaterThanOrEqual(20);
    expect(result.modules.filter((module) => module.workflows > 0).every((module) => module.has_public_index)).toBe(
      true
    );
    expect(
      result.modules
        .filter((module) => module.implementation_mode === "resource-only")
        .map((module) => module.module_id)
        .sort()
      // dashboard: resource-only since its orphaned projector was deleted (G5b)
    ).toEqual(["dashboard"]);
    expect(
      result.modules
        .filter((module) => module.implementation_mode === "resource-only")
        .every((module) => module.workflows === 0)
    ).toBe(true);
    expect(
      result.modules
        .filter((module) => module.implementation_mode === "workflow-backed")
        .every((module) => module.workflows > 0)
    ).toBe(true);
    expect(result.modules.reduce((sum, module) => sum + module.resources, 0)).toBeGreaterThanOrEqual(390);
  });

  it("CONTROL: removing an owner makes the real inventory report a missing surface", () => {
    const mutated = cloneManifests(manifests);
    const knowledge = mutated.find((manifest) => manifest.id === "knowledge");
    if (!knowledge) throw new Error("knowledge manifest missing");
    knowledge.owns.skills = (knowledge.owns.skills ?? []).filter((id) => id !== "guild-learn");

    const result = validateModuleOwnership(inventory, mutated);
    expect(result.ok).toBe(false);
    expect(result.missing).toContainEqual(
      expect.objectContaining({ category: "skills", id: "guild-learn", owners: [] })
    );
  });

  it("CONTROL: adding a second owner reports a duplicate surface", () => {
    const mutated = cloneManifests(manifests);
    const context = mutated.find((manifest) => manifest.id === "context");
    if (!context) throw new Error("context manifest missing");
    context.owns.skills = [...(context.owns.skills ?? []), "guild-learn"];

    const result = validateModuleOwnership(inventory, mutated);
    expect(result.ok).toBe(false);
    expect(result.duplicate).toContainEqual(
      expect.objectContaining({
        category: "skills",
        id: "guild-learn",
        owners: ["context", "knowledge"],
      })
    );
  });

  it("CONTROL: removing a dependency makes an existing cross-module import fail the boundary rail", () => {
    const mutated = cloneManifests(manifests);
    const context = mutated.find((manifest) => manifest.id === "context");
    if (!context) throw new Error("context manifest missing");
    context.depends_on = (context.depends_on ?? []).filter((id) => id !== "knowledge");

    const result = validateModuleBoundaries(PLUGIN_ROOT, mutated);
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        importer: "src/modules/context/workflows/recall.ts",
        from_module: "context",
        to_module: "knowledge",
        reason: "undeclared_dependency",
      })
    );
  });

  it("CONTROL: declared dependencies still reject private cross-module workflow imports", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-boundary-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/a/workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "src/modules/b/workflows"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/a/index.ts"), "export * from './workflows/a';\n");
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/workflows/a.ts"),
        "import { b } from '../../b/workflows/b';\nexport const a = b;\n"
      );
      fs.writeFileSync(path.join(tmp, "src/modules/b/index.ts"), "export * from './workflows/b';\n");
      fs.writeFileSync(path.join(tmp, "src/modules/b/workflows/b.ts"), "export const b = 1;\n");

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "a",
          title: "A",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          depends_on: ["b"],
          owns: {},
        },
        {
          schema_version: "guild.module_manifest.v1",
          id: "b",
          title: "B",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleBoundaries(tmp, fixtureManifests);
      expect(result.ok).toBe(false);
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          importer: "src/modules/a/workflows/a.ts",
          imported: "src/modules/b/workflows/b.ts",
          from_module: "a",
          to_module: "b",
          reason: "private_import",
        })
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CONTROL: workflow modules without a public index fail the health rail", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-health-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/a/workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "src/modules/a/resources"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/a/workflows/a.ts"), "export const a = 1;\n");
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/.generated-by-guild-module-resources"),
        "generated by test\n"
      );
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/module-resources.json"),
        JSON.stringify(
          {
            schema_version: "guild.module_resources.v1",
            module_id: "a",
            generated_from: "guild.inventory.v1",
            entries: [],
          },
          null,
          2
        ) + "\n"
      );

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "a",
          title: "A",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleHealth(tmp, fixtureManifests);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          module_id: "a",
          reason: "workflow_module_missing_public_index",
          path: "src/modules/a/index.ts",
        })
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CONTROL: resource-only modules with workflows fail the health rail", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-resource-only-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/a/workflows"), { recursive: true });
      fs.mkdirSync(path.join(tmp, "src/modules/a/resources"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/a/index.ts"), "export * from './workflows/a';\n");
      fs.writeFileSync(path.join(tmp, "src/modules/a/workflows/a.ts"), "export const a = 1;\n");
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/.generated-by-guild-module-resources"),
        "generated by test\n"
      );
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/module-resources.json"),
        JSON.stringify(
          {
            schema_version: "guild.module_resources.v1",
            module_id: "a",
            generated_from: "guild.inventory.v1",
            entries: [],
          },
          null,
          2
        ) + "\n"
      );

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "a",
          title: "A",
          kind: "substrate",
          implementation_mode: "resource-only",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleHealth(tmp, fixtureManifests);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          module_id: "a",
          reason: "resource_only_module_has_workflows",
          path: "src/modules/a/workflows",
        })
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("CONTROL: workflow-backed modules without workflows fail the health rail", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-workflow-backed-"));
    try {
      fs.mkdirSync(path.join(tmp, "src/modules/a/resources"), { recursive: true });
      fs.writeFileSync(path.join(tmp, "src/modules/a/index.ts"), "export const a = 1;\n");
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/.generated-by-guild-module-resources"),
        "generated by test\n"
      );
      fs.writeFileSync(
        path.join(tmp, "src/modules/a/resources/module-resources.json"),
        JSON.stringify(
          {
            schema_version: "guild.module_resources.v1",
            module_id: "a",
            generated_from: "guild.inventory.v1",
            entries: [],
          },
          null,
          2
        ) + "\n"
      );

      const fixtureManifests: ModuleManifest[] = [
        {
          schema_version: "guild.module_manifest.v1",
          id: "a",
          title: "A",
          kind: "substrate",
          implementation_mode: "workflow-backed",
          description: "fixture",
          owns: {},
        },
      ];

      const result = validateModuleHealth(tmp, fixtureManifests);
      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual(
        expect.objectContaining({
          module_id: "a",
          reason: "workflow_backed_module_has_no_workflows",
          path: "src/modules/a/workflows",
        })
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
