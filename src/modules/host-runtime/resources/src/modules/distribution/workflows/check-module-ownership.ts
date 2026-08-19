/**
 * src/modules/distribution/workflows/check-module-ownership.ts
 *
 * Module-owned implementation for the module-ownership CLI. The script in
 * scripts/check-module-ownership.ts is kept as the stable inventory/CLI shim.
 */

import * as path from "node:path";

import { buildInventory, PLUGIN_ROOT } from "./build-inventory";
import {
  formatBoundaryValidation,
  formatModuleHealthValidation,
  formatOwnershipValidation,
  loadModuleManifests,
  validateModuleBoundaries,
  validateModuleHealth,
  validateModuleOwnership,
} from "../../kernel";

export function parseRoot(argv: string[]): string | { error: string } {
  let root = PLUGIN_ROOT;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1] !== undefined) root = path.resolve(argv[++i]);
    else if (arg.startsWith("--root=")) root = path.resolve(arg.slice("--root=".length));
    else return { error: `unknown argument: ${arg}` };
  }
  return root;
}

export function runModuleOwnershipCheck(argv: string[] = process.argv.slice(2)): number {
  const root = parseRoot(argv);
  if (typeof root !== "string") {
    process.stderr.write(`${root.error}\nusage: check-module-ownership.ts [--root <pluginRoot>]\n`);
    return 1;
  }

  try {
    const inventory = buildInventory(root);
    const manifests = loadModuleManifests(root);
    const ownership = validateModuleOwnership(inventory, manifests);
    const boundaries = validateModuleBoundaries(root, manifests);
    const health = validateModuleHealth(root, manifests);
    if (!ownership.ok || !boundaries.ok || !health.ok) {
      const details = [
        formatOwnershipValidation(ownership),
        formatBoundaryValidation(boundaries),
        formatModuleHealthValidation(health),
      ]
        .filter((message) => message.length > 0)
        .join("\n");
      process.stderr.write(details + "\n");
      return 2;
    }
    process.stdout.write(
      `check-module-ownership: ${manifests.length} modules own ` +
        `${inventory.commands.length} commands, ${inventory.skills.length} skills, ` +
        `${inventory.agents.length} agents, ${inventory.hooks.length} hooks, ` +
        `${inventory.mcp_servers.length} mcp servers, ${inventory.scripts.length} scripts; ` +
        `${health.modules.filter((module) => module.workflows > 0).length} workflow modules expose public APIs; ` +
        `${health.modules.filter((module) => module.implementation_mode === "resource-only").length} resource-only modules declared; ` +
        `module import boundaries declared.\n`
    );
    return 0;
  } catch (err) {
    process.stderr.write(String(err instanceof Error ? err.message : err) + "\n");
    return 2;
  }
}
