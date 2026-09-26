import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildInventory } from "../build-inventory";
import { MODULE_RESOURCES_SCHEMA_VERSION, buildModuleResourcePlan } from "../lib/module-resources";
import * as shim from "../lib/module-resources";
import * as moduleImpl from "../../src/domains/distribution/module-resources";

// T12: the resources/ mirrors are retired. The plan is now the projector's input:
// one live source_path per owned surface file, hashed from the live bytes.

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

describe("surface projection plan", () => {
  it("keeps scripts/lib/module-resources as a compatibility shim over src/domains/distribution", () => {
    expect(shim.MODULE_RESOURCES_SCHEMA_VERSION).toBe(moduleImpl.MODULE_RESOURCES_SCHEMA_VERSION);
    expect(MODULE_RESOURCES_SCHEMA_VERSION).toBe("guild.module_resources.v1");
    expect(shim.buildModuleResourcePlan).toBe(moduleImpl.buildModuleResourcePlan);
  });

  it("the retired mirror API is gone", () => {
    for (const name of ["syncModuleResources", "syncLiveResourcesFromModules", "runModuleResourcesCli"]) {
      expect(name in moduleImpl).toBe(false);
    }
  });

  it("plans one live source for every owned inventory source file, hashed from the live bytes", () => {
    const inventory = buildInventory(PLUGIN_ROOT);
    const plans = buildModuleResourcePlan(PLUGIN_ROOT);
    const planned = new Map<string, string>();
    for (const plan of plans) {
      for (const entry of plan.entries) planned.set(`${entry.category}:${entry.source_path}`, entry.sha256);
    }
    let checked = 0;
    for (const category of ["commands", "skills", "agents", "hooks", "mcp_servers", "scripts"] as const) {
      for (const entry of inventory[category]) {
        const sha = planned.get(`${category}:${entry.source_path}`);
        expect(sha).toBeDefined();
        const live = fs.readFileSync(path.join(PLUGIN_ROOT, entry.source_path));
        expect(sha).toBe(crypto.createHash("sha256").update(live).digest("hex"));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(plans.find((plan) => plan.module_id === "lifecycle")?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "commands", id: "plan", source_path: "commands/plan.md" }),
      ])
    );
    for (const plan of plans) {
      for (const entry of plan.entries) expect(entry).not.toHaveProperty("resource_path");
    }
  });

  it("CONTROL: the plan tracks a live edit with no sync step", () => {
    const root = copyFixturePlugin();
    try {
      const shaOf = (): string | undefined =>
        buildModuleResourcePlan(root)
          .flatMap((plan) => plan.entries)
          .find((entry) => entry.source_path === "commands/plan.md")?.sha256;
      const before = shaOf();
      fs.appendFileSync(path.join(root, "commands", "plan.md"), "\nLIVE EDIT CONTROL\n");
      const after = shaOf();
      expect(before).toBeDefined();
      expect(after).toBe(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "commands", "plan.md"))).digest("hex"));
      expect(after).not.toBe(before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("CONTROL: a deleted surface leaves the plan (the render-time refusal is the resolver's; see claude-host-adapter)", () => {
    const root = copyFixturePlugin();
    try {
      fs.rmSync(path.join(root, "commands", "plan.md"));
      const sources = buildModuleResourcePlan(root).flatMap((plan) => plan.entries.map((e) => e.source_path));
      expect(sources).not.toContain("commands/plan.md");
      expect(sources).toContain("commands/build.md");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
