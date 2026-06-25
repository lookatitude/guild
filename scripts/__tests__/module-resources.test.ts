import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildInventory } from "../build-inventory";
import {
  MODULE_RESOURCES_SCHEMA_VERSION,
  buildModuleResourcePlan,
  syncModuleResources,
  syncLiveResourcesFromModules,
} from "../lib/module-resources";
import * as shim from "../lib/module-resources";
import * as moduleImpl from "../../src/modules/distribution/workflows/module-resources";

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");

function copyFixturePlugin(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-module-resources-"));
  for (const dir of ["commands", "skills", "agents", "hooks", "scripts", "mcp-servers", ".claude-plugin", "src"]) {
    fs.cpSync(path.join(PLUGIN_ROOT, dir), path.join(tmp, dir), {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`),
    });
  }
  fs.copyFileSync(path.join(PLUGIN_ROOT, ".mcp.json"), path.join(tmp, ".mcp.json"));
  return tmp;
}

describe("module resource mirrors", () => {
  it("keeps scripts/lib/module-resources as a compatibility shim over src/modules/distribution", () => {
    expect(shim.MODULE_RESOURCES_SCHEMA_VERSION).toBe(moduleImpl.MODULE_RESOURCES_SCHEMA_VERSION);
    expect(shim.buildModuleResourcePlan).toBe(moduleImpl.buildModuleResourcePlan);
    expect(shim.syncModuleResources).toBe(moduleImpl.syncModuleResources);
    expect(shim.syncLiveResourcesFromModules).toBe(moduleImpl.syncLiveResourcesFromModules);
  });

  it("plans one module-local resource for every owned live inventory source file", () => {
    const inventory = buildInventory(PLUGIN_ROOT);
    const plans = buildModuleResourcePlan(PLUGIN_ROOT);
    const plannedResources = plans.reduce((sum, plan) => sum + plan.entries.length, 0);
    const uniqueSources = new Set<string>();
    for (const category of ["commands", "skills", "agents", "hooks", "mcp_servers", "scripts"] as const) {
      for (const entry of inventory[category]) uniqueSources.add(`${category}:${entry.source_path}`);
    }

    expect(plans.length).toBeGreaterThanOrEqual(30);
    expect(plannedResources).toBeGreaterThanOrEqual(uniqueSources.size);
    expect(plans.find((plan) => plan.module_id === "lifecycle")?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "commands",
          id: "plan",
          resource_path: "resources/commands/plan.md",
        }),
      ])
    );
  });

  it("writes and checks a full module resource mirror", () => {
    const root = copyFixturePlugin();
    try {
      const write = syncModuleResources({ root });
      expect(write.ok).toBe(true);
      expect(write.written).toBe(true);
      expect(write.resources).toBeGreaterThanOrEqual(300);

      const manifestPath = path.join(root, "src/modules/lifecycle/resources/module-resources.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      expect(manifest.schema_version).toBe(MODULE_RESOURCES_SCHEMA_VERSION);
      expect(fs.existsSync(path.join(root, "src/modules/lifecycle/resources/commands/plan.md"))).toBe(true);

      const check = syncModuleResources({ root, check: true });
      expect(check).toEqual(expect.objectContaining({ ok: true, checked: true }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("CONTROL: check mode catches resource drift", () => {
    const root = copyFixturePlugin();
    try {
      expect(syncModuleResources({ root }).ok).toBe(true);
      const resource = path.join(root, "src/modules/lifecycle/resources/commands/plan.md");
      fs.appendFileSync(resource, "\nDRIFT\n");
      const check = syncModuleResources({ root, check: true });
      expect(check.ok).toBe(false);
      expect(check.errors).toContainEqual(expect.stringContaining("resource drift resources/commands/plan.md"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks and repairs live host-facing resources from module resources", () => {
    const root = copyFixturePlugin();
    try {
      expect(syncModuleResources({ root }).ok).toBe(true);
      const live = path.join(root, "commands", "plan.md");
      const original = fs.readFileSync(live, "utf8");
      fs.appendFileSync(live, "\nLIVE DRIFT\n");

      const check = syncLiveResourcesFromModules({ root, check: true });
      expect(check.ok).toBe(false);
      expect(check.errors).toContainEqual(expect.stringContaining("live resource drift commands/plan.md"));

      const sync = syncLiveResourcesFromModules({ root });
      expect(sync).toEqual(expect.objectContaining({ ok: true, written: true }));
      expect(fs.readFileSync(live, "utf8")).toBe(original);
      expect(syncLiveResourcesFromModules({ root, check: true })).toEqual(
        expect.objectContaining({ ok: true, checked: true })
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("CONTROL: live sync refuses module resources whose manifest hash is stale", () => {
    const root = copyFixturePlugin();
    try {
      expect(syncModuleResources({ root }).ok).toBe(true);
      fs.appendFileSync(path.join(root, "src/modules/lifecycle/resources/commands/plan.md"), "\nMODULE DRIFT\n");
      const sync = syncLiveResourcesFromModules({ root });
      expect(sync.ok).toBe(false);
      expect(sync.errors).toContainEqual(
        expect.stringContaining("module resource hash drift resources/commands/plan.md")
      );
      expect(fs.readFileSync(path.join(root, "commands", "plan.md"), "utf8")).not.toContain("MODULE DRIFT");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
