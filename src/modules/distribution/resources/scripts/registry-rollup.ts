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
  // IN-1/IN-2: reader-consumed + curated fields. The settings-reader resolves
  // workspace scope from `scope`; the dashboard projector reads
  // title/status/final_status/scope/path/updated_at. Optional so the minimal
  // (test-fixture) path stays valid, and so unknown curated keys pass through.
  title?: string;
  definition_status?: string;
  execution_status?: string;
  release_status?: string;
  documentation_status?: string;
  final_status?: string;
  scope?: string;
  path?: string;
  created_at?: string;
  updated_at?: string;
  notes?: string;
  [key: string]: unknown;
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
  const runsRoot = path.join(guildDir, "runs");
  const runDirs = [
    ...listDirs(runsRoot).filter((d) => path.basename(d) !== "_archive"),
    ...listDirs(path.join(runsRoot, "_archive")),
  ];
  for (const runDir of runDirs) {
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

/** A manifest may nest its body under an `initiative:` key (the on-disk convention,
 *  also how settings-reader reads it) or be flat (test fixtures). Unwrap either. */
function unwrapManifest(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object") return {};
  const top = parsed as Record<string, unknown>;
  const inner = top["initiative"];
  if (inner && typeof inner === "object") return inner as Record<string, unknown>;
  return top;
}

/** Collapse a manifest `notes` value (string OR list of strings) to one scalar
 *  string, matching the on-disk registry's scalar `notes:` shape. */
function notesToScalar(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const parts = v.filter((x) => typeof x === "string") as string[];
    return parts.length ? parts.join(" ") : undefined;
  }
  return undefined;
}

/**
 * Load the existing on-disk registry entries (top-level `initiatives[]`) so a
 * rebuild PRESERVES cached fields that are not supplied by a validated
 * manifest, retained run linkage, and entries that have no manifest. Returns
 * a Map id → full entry object.
 */
function loadExistingEntries(guildDir: string): Map<string, RegistryEntry> {
  const out = new Map<string, RegistryEntry>();
  const p = path.join(guildDir, "indexes", "initiatives-registry.yaml");
  if (!fs.existsSync(p)) return out;
  try {
    const parsed = yaml.load(fs.readFileSync(p, "utf8")) as Record<string, unknown> | null;
    // Tolerate BOTH the new top-level shape and the legacy nested wrapper.
    const container = parsed && typeof parsed === "object"
      ? ((parsed as Record<string, unknown>)["initiatives"]
        ? (parsed as Record<string, unknown>)
        : ((parsed as Record<string, unknown>)["initiatives_registry"] as Record<string, unknown> | undefined) ?? {})
      : {};
    const list = (container as Record<string, unknown>)["initiatives"];
    if (Array.isArray(list)) {
      for (const e of list) {
        if (e && typeof e === "object" && typeof (e as Record<string, unknown>)["id"] === "string") {
          out.set((e as Record<string, string>)["id"], e as RegistryEntry);
        }
      }
    }
  } catch { /* malformed → treat as no base */ }
  return out;
}

/**
 * Derive the cross-initiative registry. Pure over the on-disk .guild tree.
 *
 * IN-1/IN-2: the writer now emits the SAME top-level `initiatives[]` shape the
 * settings-reader + dashboard projector consume (previously it nested the list
 * under `initiatives_registry:` with a 4-field schema the readers never read).
 *
 * Rebuild is LOSSLESS by authority: a validated manifest supplies identity,
 * axes, derived status, title, scope, dates, and notes; the filesystem bucket
 * supplies path and archived closure; live provenance replaces run linkage
 * only when it finds runs. Cached fields absent from those authorities survive,
 * including retained run linkage and manifest-less entries.
 */
export function buildInitiativesRegistry(guildDir: string): InitiativesRegistry {
  const runs = collectRuns(guildDir);
  const byId = new Map<string, RegistryEntry>(loadExistingEntries(guildDir));

  for (const bucket of ["active", "archived"] as const) {
    const archived = bucket === "archived";
    for (const initDir of listDirs(path.join(guildDir, "initiatives", bucket))) {
      const manifestPath = path.join(initDir, "initiative.yaml");
      if (!fs.existsSync(manifestPath)) continue;
      let m: Record<string, unknown> = {};
      try { m = unwrapManifest(yaml.load(fs.readFileSync(manifestPath, "utf8"))); } catch { /* skip */ }
      const id = (typeof m["id"] === "string" && m["id"]) || path.basename(initDir);
      const existing = byId.get(id);

      const manifestValid = validateInitiativeManifest(m).valid;
      // Prefer a validated 4-axis derivation; fall back to a present status field.
      let status: DerivedStatus | string;
      if (manifestValid) {
        status = deriveInitiativeStatus(m as unknown as InitiativeAxes, {
          archived,
          cancelled: m["status"] === "cancelled"
            || existing?.status === "cancelled"
            || existing?.final_status === "cancelled",
        });
      } else if (typeof m["status"] === "string" && (DERIVED_STATUS as readonly string[]).includes(m["status"] as string)) {
        status = m["status"] as DerivedStatus;
      } else {
        status = archived ? "closed" : (typeof m["status"] === "string" ? (m["status"] as string) : "proposed");
      }

      const runRec = runs.get(id)?.runs ?? [];
      const runsById = new Map<string, { id: string; at: string }>();
      for (const run of runRec) {
        const prior = runsById.get(run.id);
        if (!prior || run.at > prior.at) runsById.set(run.id, run);
      }
      const uniqueRuns = [...runsById.values()];
      const run_ids = [...uniqueRuns].sort((a, b) => a.id.localeCompare(b.id)).map((r) => r.id);
      const last = [...uniqueRuns].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id.localeCompare(b.id))).at(-1);
      const last_run_id = last?.id ?? null;

      const str = (k: string): string | undefined => (typeof m[k] === "string" ? (m[k] as string) : undefined);
      // Fields the manifest can supply for a NEW entry / to fill a curated gap.
      const fromManifest: RegistryEntry = {
        id,
        title: str("title"),
        status,
        definition_status: str("definition_status"),
        execution_status: str("execution_status"),
        release_status: str("release_status"),
        documentation_status: str("documentation_status"),
        final_status: status === "cancelled" ? "cancelled" : (archived ? "closed" : "open"),
        scope: str("scope"),
        path: `.guild/initiatives/${bucket}/${id}/`,
        run_ids,
        last_run_id,
        created_at: str("created_at"),
        updated_at: str("updated_at") ?? str("created_at"),
        notes: notesToScalar(m["notes"]),
      };
      // Drop undefined-valued keys so they neither override nor pollute the merge.
      for (const k of Object.keys(fromManifest)) {
        if (fromManifest[k] === undefined) delete fromManifest[k];
      }

      if (existing) {
        // Only a VALID manifest gets field authority. An invalid legacy body
        // may seed a new entry, but cannot roll a trusted cached entry backward.
        const authoritative = { ...fromManifest };
        delete authoritative.run_ids;
        delete authoritative.last_run_id;
        delete authoritative.final_status; // bucket-derived, not manifest-supplied
        const merged: RegistryEntry = manifestValid
          ? { ...existing, ...authoritative }
          : { ...fromManifest, ...existing };

        // Filesystem location is authoritative even when the manifest is bad.
        merged.id = id;
        merged.path = `.guild/initiatives/${bucket}/${id}/`;
        // Archiving is terminal; an active bucket preserves curated dispositions
        // such as cancelled/superseded rather than synthesizing "open" over them.
        const cancelled = merged.status === "cancelled"
          || existing.status === "cancelled"
          || existing.final_status === "cancelled";
        merged.final_status = cancelled ? "cancelled" : (archived ? "closed" : (existing.final_status ?? "open"));
        if (cancelled) merged.status = "cancelled";
        else if (archived) merged.status = "closed";
        // Live provenance is authoritative when present. When retention has
        // rotated all runs away, preserve the cached historical linkage.
        if (run_ids.length > 0) {
          merged.run_ids = run_ids;
          merged.last_run_id = last_run_id;
        }
        byId.set(id, merged);
      } else {
        byId.set(id, fromManifest); // NEW initiative — fully manifest-sourced.
      }
    }
  }

  // Normalize run linkage on every entry (incl. curated, manifest-less ones).
  const entries = [...byId.values()].map((e) => ({
    ...e,
    run_ids: Array.isArray(e.run_ids) ? e.run_ids : [],
    last_run_id: e.last_run_id ?? null,
  }));
  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { schema_version: REGISTRY_SCHEMA, built_from: ["initiatives/*", "runs/**/provenance.json"], initiatives: entries };
}

/**
 * Write the registry to .guild/indexes/initiatives-registry.yaml in the TOP-LEVEL
 * shape the readers consume (`schema_version` + `initiatives[]`), NOT the legacy
 * `initiatives_registry:` wrapper (IN-1).
 */
export function writeInitiativesRegistry(guildDir: string, registry: InitiativesRegistry): string {
  const out = path.join(guildDir, "indexes", "initiatives-registry.yaml");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, yaml.dump(registry), "utf8");
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
    process.stdout.write(yaml.dump(registry));
  }
}
