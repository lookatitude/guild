/**
 * The adapter rung matrix and the per-family adapter maps (KTD4, KTD28).
 *
 * This file only maps: it reads `adapter.lock.json` and `<family>/map.json`,
 * validates each row through the dispatch domain's closed validator, and hands
 * the row to the dispatch domain. What a rung MEANS, and how a loss is
 * recorded, is decided in `src/domains/dispatch/adapter-rungs.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { HOST_FAMILIES, HOST_REGISTRY_ROWS, type HostId } from "../domains/config";
import {
  ADAPTER_RUNG_NAMES,
  resolveRungPlan,
  validateAdapterRungRow,
  type AdapterRungRow,
  type RungPlan,
} from "../domains/dispatch";
import { deepFreeze } from "../domains/kernel";
import LOCK from "./adapter.lock.json";
import CLAUDE_MAP from "./claude/map.json";
import CODEX_MAP from "./codex/map.json";
import AGENTS_MAP from "./agents/map.json";
import PI_MAP from "./pi/map.json";
import ANTIGRAVITY_MAP from "./antigravity/map.json";
import CURSOR_MAP from "./cursor/map.json";
import COPILOT_MAP from "./copilot/map.json";
import OPENCODE_MAP from "./opencode/map.json";
import ROVO_MAP from "./rovo/map.json";

export const ADAPTER_LOCK_SCHEMA = "guild.adapter_lock.v1" as const;
export const ADAPTER_MAP_SCHEMA = "guild.adapter_map.v1" as const;

export interface AdapterMap {
  schema_version: typeof ADAPTER_MAP_SCHEMA;
  family: string;
  host_ids: readonly string[];
  /** `dist/<tree>` package directories this family's hosts install from. */
  package_trees: readonly string[];
  /** Surface -> path inside the package. The projector copies exactly these. */
  projects: Readonly<Record<string, string>>;
  runtime: readonly string[];
  /** Globs a package of this family must never contain (KTD28: no domain copies). */
  never_projects: readonly string[];
  rungs: string;
}

const MAPS: Readonly<Record<string, AdapterMap>> = deepFreeze({
  claude: CLAUDE_MAP,
  codex: CODEX_MAP,
  agents: AGENTS_MAP,
  pi: PI_MAP,
  antigravity: ANTIGRAVITY_MAP,
  cursor: CURSOR_MAP,
  copilot: COPILOT_MAP,
  opencode: OPENCODE_MAP,
  rovo: ROVO_MAP,
} as unknown as Record<string, AdapterMap>);

interface LockFamily {
  host_ids: string[];
  map: string;
  rungs: unknown;
}

/** Every family row, validated once. A row that fails validation is absent, so it fails closed. */
const ROWS: ReadonlyMap<string, AdapterRungRow> = (() => {
  const out = new Map<string, AdapterRungRow>();
  const families = (LOCK as { families: Record<string, LockFamily> }).families;
  for (const [family, entry] of Object.entries(families)) {
    const row = validateAdapterRungRow({ family, rungs: entry.rungs });
    if (row) out.set(family, row);
  }
  return out;
})();

/** Families named by the lock: the closed host-family list, no more (no new hosts). */
export function adapterLockFamilies(): readonly string[] {
  return Object.keys((LOCK as { families: Record<string, LockFamily> }).families);
}

/** The validated rung row for a host family, or null (unknown family ⇒ every rung missing). */
export function rungRowForFamily(family: string | null | undefined): AdapterRungRow | null {
  if (!family) return null;
  const entry = HOST_REGISTRY_ROWS[family as HostId];
  if (!entry) return ROWS.get(family) ?? null;
  // A host id resolves through its family row, but an inferred host inherits no
  // verified cell from a verified sibling: every rung fails closed (KTD5).
  const row = ROWS.get(entry.family) ?? null;
  return row && entry.provenance !== "verified" ? inferredRow(row) : row;
}

function inferredRow(row: AdapterRungRow): AdapterRungRow {
  const rungs = Object.fromEntries(
    ADAPTER_RUNG_NAMES.map((name) => [
      name,
      { rung: row.rungs[name].rung, evidence: "inferred", verified_by: null },
    ]),
  ) as unknown as AdapterRungRow["rungs"];
  return deepFreeze({ family: row.family, rungs });
}

/**
 * The key a session resolves rungs by: its surface when that names a registry
 * host of the bound family (so an inferred host fails closed), else the family.
 */
export function rungKeyForSession(s: { host_family: string; surface?: string | null }): string {
  const entry = s.surface ? HOST_REGISTRY_ROWS[s.surface as HostId] : undefined;
  return entry && entry.family === s.host_family ? s.surface! : s.host_family;
}

/** The family a registry host id belongs to, or null for an id the registry does not know. */
export function familyForHostId(hostId: string | null | undefined): string | null {
  if (!hostId) return null;
  return HOST_REGISTRY_ROWS[hostId as HostId]?.family ?? null;
}

export function adapterMapForFamily(family: string): AdapterMap | null {
  return MAPS[family] ?? null;
}

/** The rung plan for the session's host family (T0 selects it from the session binding). */
export function rungPlanForFamily(
  family: string | null | undefined,
  opts: { verify_check_available: boolean },
): RungPlan {
  return resolveRungPlan(rungRowForFamily(family), opts);
}

/**
 * Projector gate: a family's package trees carry the surfaces its map names and
 * no path its map forbids. Returns the problems; empty means the package is a
 * projection and not a copy of the domains (KTD28).
 */
export function checkPackageAgainstMap(distRoot: string, family: string): string[] {
  const map = adapterMapForFamily(family);
  if (!map) return [`no adapter map for family ${family}`];
  const problems: string[] = [];
  for (const tree of map.package_trees) {
    const root = path.join(distRoot, tree);
    if (!fs.existsSync(root)) {
      problems.push(`${tree}: package tree missing`);
      continue;
    }
    for (const [surface, rel] of Object.entries(map.projects)) {
      if (!fs.existsSync(path.join(root, rel))) problems.push(`${tree}: ${surface} not projected at ${rel}`);
    }
    const domains = path.join(root, "src", "domains");
    if (fs.existsSync(domains)) {
      const ts: string[] = [];
      const walk = (dir: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) ts.push(path.relative(root, p));
        }
      };
      walk(domains);
      if (ts.length > 0) problems.push(`${tree}: ships ${ts.length} src/domains TypeScript file(s), e.g. ${ts[0]}`);
    }
  }
  return problems;
}

/** Closed-matrix self-check: one row per registry family, seven rungs each. */
export function adapterLockProblems(): string[] {
  const problems: string[] = [];
  const lock = LOCK as { schema_version?: string; rung_names?: string[]; families: Record<string, LockFamily> };
  if (lock.schema_version !== ADAPTER_LOCK_SCHEMA) problems.push("adapter.lock.json schema_version");
  if (JSON.stringify(lock.rung_names) !== JSON.stringify([...ADAPTER_RUNG_NAMES])) problems.push("rung_names drift");
  const families = Object.keys(lock.families).sort();
  const registry = [...HOST_FAMILIES].sort();
  if (JSON.stringify(families) !== JSON.stringify(registry)) {
    problems.push(`families ${families.join(",")} != registry ${registry.join(",")}`);
  }
  for (const f of families) {
    if (!ROWS.has(f)) problems.push(`${f}: row fails the closed validator`);
    const map = MAPS[f];
    if (!map) problems.push(`${f}: no map`);
    else if (JSON.stringify([...map.host_ids].sort()) !== JSON.stringify([...lock.families[f].host_ids].sort())) {
      problems.push(`${f}: map host_ids differ from the lock`);
    }
    const expected = Object.values(HOST_REGISTRY_ROWS)
      .filter((r) => r.family === f)
      .map((r) => r.host_id)
      .sort();
    if (JSON.stringify([...lock.families[f].host_ids].sort()) !== JSON.stringify(expected)) {
      problems.push(`${f}: lock host_ids differ from the registry`);
    }
  }
  return problems;
}
