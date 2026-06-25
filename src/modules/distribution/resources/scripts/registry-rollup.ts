#!/usr/bin/env npx tsx
/**
 * registry-rollup.ts — derive `.guild/indexes/initiatives-registry.yaml`
 * (guild.initiatives_registry.v1) from the initiative manifests + run provenance
 * (deferred item 15; data-model.md §InitiativesRegistry).
 *
 * The registry was [v2] in shape but HAND-MAINTAINED. This is the [v2.x]
 * rebuild/derive script: a pure projection of `initiatives/{active,archived}/* /
 * initiative.yaml` + `runs/** /provenance.json`. Derived, rebuildable, deletable
 * — deleting the registry loses nothing.
 *
 * Usage: npx tsx scripts/registry-rollup.ts [--guild-dir <.guild>] [--write] [--json]
 *   default prints the derived registry; --write persists it to indexes/.
 */
import * as fs from "fs";
import * as path from "path";
import { deriveInitiativeStatus, validateInitiativeManifest, type InitiativeAxes, type DerivedStatus, DERIVED_STATUS } from "./lib/initiative";

const yaml = require("js-yaml") as { load: (s: string) => unknown; dump: (o: unknown) => string };

export const REGISTRY_SCHEMA = "guild.initiatives_registry.v1";

export interface RegistryEntry {
  id: string;
  status: DerivedStatus | string;
  run_ids: string[];
  last_run_id: string | null;
}
export interface InitiativesRegistry {
  schema_version: typeof REGISTRY_SCHEMA;
  built_from: string[];
  initiatives: RegistryEntry[];
}

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch { return []; }
}

/** Map initiative-id → { run_ids[], last_run_id } from each run's provenance.json. */
function collectRuns(guildDir: string): Map<string, { runs: { id: string; at: string }[] }> {
  const map = new Map<string, { runs: { id: string; at: string }[] }>();
  for (const runDir of listDirs(path.join(guildDir, "runs"))) {
    const prov = path.join(runDir, "provenance.json");
    if (!fs.existsSync(prov)) continue;
    try {
      const p = JSON.parse(fs.readFileSync(prov, "utf8")) as { run_id?: string; initiative?: string | null; closed_at?: string; started_at?: string };
      if (!p.initiative || !p.run_id) continue;
      if (!map.has(p.initiative)) map.set(p.initiative, { runs: [] });
      map.get(p.initiative)!.runs.push({ id: p.run_id, at: p.closed_at ?? p.started_at ?? "" });
    } catch { /* malformed → skip */ }
  }
  return map;
}

/** Derive the cross-initiative registry. Pure over the on-disk .guild tree. */
export function buildInitiativesRegistry(guildDir: string): InitiativesRegistry {
  const runs = collectRuns(guildDir);
  const entries: RegistryEntry[] = [];

  for (const bucket of ["active", "archived"] as const) {
    const archived = bucket === "archived";
    for (const initDir of listDirs(path.join(guildDir, "initiatives", bucket))) {
      const manifestPath = path.join(initDir, "initiative.yaml");
      if (!fs.existsSync(manifestPath)) continue;
      let m: Record<string, unknown> = {};
      try { m = (yaml.load(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>) ?? {}; } catch { /* skip */ }
      const id = (typeof m["id"] === "string" && m["id"]) || path.basename(initDir);

      // Prefer a validated 4-axis derivation; fall back to a present status field.
      let status: DerivedStatus | string;
      if (validateInitiativeManifest(m).valid) {
        status = deriveInitiativeStatus(m as unknown as InitiativeAxes, { archived });
      } else if (typeof m["status"] === "string" && (DERIVED_STATUS as readonly string[]).includes(m["status"])) {
        status = m["status"] as DerivedStatus;
      } else {
        status = archived ? "closed" : (typeof m["status"] === "string" ? (m["status"] as string) : "proposed");
      }

      const runRec = runs.get(id)?.runs ?? [];
      const run_ids = [...runRec].sort((a, b) => a.id.localeCompare(b.id)).map((r) => r.id);
      const last = [...runRec].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id))).at(-1);
      entries.push({ id, status, run_ids, last_run_id: last?.id ?? null });
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { schema_version: REGISTRY_SCHEMA, built_from: ["initiatives/*", "runs/**/provenance.json"], initiatives: entries };
}

/** Write the registry to .guild/indexes/initiatives-registry.yaml. Returns the path. */
export function writeInitiativesRegistry(guildDir: string, registry: InitiativesRegistry): string {
  const out = path.join(guildDir, "indexes", "initiatives-registry.yaml");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, yaml.dump({ initiatives_registry: registry }), "utf8");
  return out;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  let guildDir = path.join(process.cwd(), ".guild");
  let write = false, json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--guild-dir" && argv[i + 1]) guildDir = path.resolve(argv[++i]);
    else if (argv[i] === "--write") write = true;
    else if (argv[i] === "--json") json = true;
  }
  const registry = buildInitiativesRegistry(guildDir);
  if (write) {
    const out = writeInitiativesRegistry(guildDir, registry);
    process.stdout.write(`[registry-rollup] wrote ${registry.initiatives.length} initiative(s) → ${out}\n`);
  } else if (json) {
    process.stdout.write(JSON.stringify(registry, null, 2) + "\n");
  } else {
    process.stdout.write(yaml.dump({ initiatives_registry: registry }));
  }
}
