/**
 * src/domains/distribution/module-resources.ts
 *
 * The surface-projection plan: for every host-facing surface file (commands,
 * skills and their on-demand companions, agents, hooks, scripts, MCP servers),
 * which module owns it and where the LIVE file is.
 *
 * T12 retired the `src/modules/<id>/resources/**` byte mirrors and the two sync
 * scripts that maintained them. There is now ONE projector step: the host
 * package renderer reads this plan and copies straight from the live surface
 * path, so a host package is a projection and never a second copy of the tree
 * (KTD28). A stale-mirror drift gate is therefore not something that can exist.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildInventory, PLUGIN_ROOT } from "./build-inventory";
import {
  OWNED_INVENTORY_CATEGORIES,
  ownersFor,
  loadModuleManifests,
  validateModuleOwnership,
  type ModuleManifest,
  type OwnedInventoryCategory,
} from "../kernel";

export const MODULE_RESOURCES_SCHEMA_VERSION = "guild.module_resources.v1" as const;

/** One projected surface file: the live path plus the owner that answers for it. */
export interface ModuleResourceEntry {
  category: OwnedInventoryCategory;
  id: string;
  /** Repo-relative POSIX path of the LIVE file the renderer copies. */
  source_path: string;
  sha256: string;
}

export interface ModuleResourcePlan {
  module_id: string;
  entries: ModuleResourceEntry[];
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function sha256(content: Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function categoryEntries(
  inventory: ReturnType<typeof buildInventory>,
  category: OwnedInventoryCategory
): Array<{ id: string; source_path: string }> {
  return inventory[category] as Array<{ id: string; source_path: string }>;
}

/**
 * Every companion file inside a skill folder, repo-relative to that folder,
 * deterministic order. Recursive: `references/` chapters and `scripts/` are part
 * of the shipped three-stage folder (KTD25), not just the immediate siblings.
 */
function skillCompanionFiles(skillDir: string, rel = "", out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(skillDir, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) skillCompanionFiles(skillDir, r, out);
    else if (e.isFile()) out.push(r);
  }
  return out;
}

export function buildModuleResourcePlan(root: string = PLUGIN_ROOT): ModuleResourcePlan[] {
  const inventory = buildInventory(root);
  const manifests = loadModuleManifests(root);
  const ownership = validateModuleOwnership(inventory, manifests);
  if (!ownership.ok) {
    throw new Error("surface projection requires valid module ownership");
  }

  const plans = new Map<string, ModuleResourcePlan>();
  const manifestById = new Map<string, ModuleManifest>(manifests.map((manifest) => [manifest.id, manifest]));
  for (const manifest of manifests) {
    plans.set(manifest.id, {
      module_id: manifest.id,
      entries: [],
    });
  }

  const seen = new Set<string>();
  for (const category of OWNED_INVENTORY_CATEGORIES) {
    for (const entry of categoryEntries(inventory, category)) {
      const owners = ownersFor(manifests, category, entry.id);
      if (owners.length !== 1) {
        throw new Error(`expected exactly one owner for ${category}:${entry.id}; got ${owners.join(",")}`);
      }
      const owner = owners[0];
      if (!manifestById.has(owner)) {
        throw new Error(`unknown owner ${owner} for ${category}:${entry.id}`);
      }
      const sourceAbs = path.join(root, entry.source_path);
      if (!fs.existsSync(sourceAbs) || !fs.statSync(sourceAbs).isFile()) {
        throw new Error(`source for ${category}:${entry.id} is missing or not a file: ${entry.source_path}`);
      }
      const content = fs.readFileSync(sourceAbs);
      const key = `${owner}:${entry.source_path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      plans.get(owner)!.entries.push({
        category,
        id: entry.id,
        source_path: entry.source_path,
        sha256: sha256(content),
      });

      // RV-1/RV-2: a skill's SKILL.md is its only inventory entry, but the skill
      // directory also holds progressive-disclosure companion files (e.g.
      // quality-mechanics.md, loop-mechanics.md, io-contract.md) plus evals.json
      // that SKILL.md references and the host must therefore ship. Enumerate the
      // immediate sibling files (everything but SKILL.md / SKILL.src.md) so they
      // are tracked, SHA-pinned, and projected into host packages alongside the
      // skill. Same owner as the parent skill.
      if (category === "skills") {
        const skillDir = path.dirname(sourceAbs);
        // T03/KTD25: a three-stage skill folder is SKILL.md + `references/`
        // (L3 chapters, loaded on demand) + `scripts/`. The companion walk is
        // therefore RECURSIVE — an immediate-files-only walk silently drops
        // every chapter from every host package.
        for (const sib of skillCompanionFiles(skillDir)) {
          // SKILL.md/.src.md are the inventory entry itself; evals.json is a
          // dev-time eval fixture (NOT a runtime/progressive-disclosure reference)
          // and must NOT ship in host packages (PA ruling, lane TE).
          if (sib === "SKILL.md" || sib === "SKILL.src.md") continue;
          if (sib === "evals.json" || sib.endsWith("/evals.json") || sib.endsWith(".evals.json")) continue;
          const sibAbs = path.join(skillDir, sib);
          const sibSourcePath = toPosix(path.relative(root, sibAbs));
          const sibKey = `${owner}:${sibSourcePath}`;
          if (seen.has(sibKey)) continue;
          seen.add(sibKey);
          plans.get(owner)!.entries.push({
            category: "skills",
            id: `${entry.id}/${sib}`,
            source_path: sibSourcePath,
            sha256: sha256(fs.readFileSync(sibAbs)),
          });
        }
      }
    }
  }

  return [...plans.values()].sort((a, b) => a.module_id.localeCompare(b.module_id));
}


