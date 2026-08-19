/**
 * src/modules/distribution/workflows/parity-contract.ts
 *
 * L0 FOUNDATION — the TWO-SIDED parity contract (SC-7), as shared pure predicates.
 *
 * Contract authority (SoT):
 *   ADR: guild-inventory-and-parity-contracts (workspace wiki) §Parity contract
 *   spec .guild/spec/universal-host-p0.md SC-7
 *
 * SC-7 has two independent sides; BOTH must hold:
 *
 *   (a) COVERAGE — `discovery == inventory`.
 *       The set of surfaces DISCOVERED by scanning the live repo equals the set
 *       represented in guild.inventory.v1, per category, keyed by id. A real
 *       surface that is in NEITHER the inventory NOR a package is the silent-drop
 *       failure this side catches: discovery finds it, inventory lacks it → FAIL.
 *       (Also catches phantoms: inventory has an id the repo no longer has.)
 *
 *   (b) SUBSET — `package ⊆ inventory`.
 *       No host package references a command id, skill id, or schema_version that
 *       is absent from the inventory. A package hand-edited to point at a
 *       non-inventoried surface → FAIL. Generated packages are never hand-edited;
 *       this side is the guard.
 *
 *   Together: discovery == inventory ⊇ package.
 *
 * PURITY: every function here takes ALREADY-READ data structures (Sets/objects)
 * and returns a result object. The filesystem scan + package parse are the
 * CALLER's job (L1 build-inventory.ts, L2 build-host-packages.ts, L6 tests) — this
 * module never touches the filesystem, mirroring per-host-packaging.ts.
 *
 * Owned by plugin-architect (L0); consumed by L1, L2, L6.
 */

import type { GuildInventoryV1, InventoryCategory } from "./inventory-schema";
import { deepFreeze } from "../../kernel";
import { INVENTORY_CATEGORIES } from "./inventory-schema";

// ---------------------------------------------------------------------------
// Discovery rules — the deterministic id-derivation contract
// ---------------------------------------------------------------------------

/**
 * How each category is DISCOVERED from the live repo, and how an entry's `id`
 * is derived. The caller (L1/L6) implements the scan; this is the binding
 * specification so discovery and inventory agree on identity.
 *
 * `id_rule` is documentation of the derivation — both the inventory builder (L1)
 * and the discovery scan (L6) MUST apply the identical rule or coverage will
 * report false mismatches.
 *
 * Coverage (SC-7a) is ENFORCED for the `enforced: true` categories. The L6
 * fail-fixtures MUST add an unmapped surface in each enforced category and
 * require failure. `schemas` and `docs` are registry/curated categories — see
 * notes — and are not glob-discovered the same way.
 */
export interface DiscoveryRule {
  category: InventoryCategory;
  /** Glob(s) the discovery scan enumerates (repo-relative, POSIX). */
  globs: string[];
  /** Human-readable id-derivation rule (applied identically by L1 and L6). */
  id_rule: string;
  /** Whether SC-7(a) coverage is enforced (with an L6 fail-fixture) for this category. */
  enforced: boolean;
  /** Optional clarifying note. */
  note?: string;
}

export const DISCOVERY_RULES: readonly DiscoveryRule[] = deepFreeze([
  {
    category: "commands",
    globs: ["commands/*.md"],
    id_rule: "basename without .md (commands/plan.md → 'plan')",
    enforced: true,
  },
  {
    category: "agents",
    globs: ["agents/*.md"],
    id_rule: "basename without .md (agents/architect.md → 'architect')",
    enforced: true,
  },
  {
    category: "skills",
    globs: ["skills/**/SKILL.md", "skills/**/SKILL.src.md"],
    id_rule: "the skill's `name:` frontmatter value (e.g. 'guild:review'). SKILL.src.md and its generated SKILL.md share one id (the src is the authored source).",
    enforced: true,
    note: "A SKILL.src.md (e.g. using-guild) is the authored source; if both SKILL.src.md and a generated SKILL.md exist they collapse to ONE id — discovery must dedupe by name, not by file.",
  },
  {
    category: "hooks",
    globs: ["hooks/hooks.json"],
    id_rule: "one entry per (event, script) binding parsed from hooks.json; id = '<event>:<script-basename>'",
    enforced: true,
    note: "Discovery parses hooks.json, it does not glob script files — the binding (not the script) is the surface.",
  },
  {
    category: "mcp_servers",
    globs: [".mcp.json"],
    id_rule: "each key under .mcp.json `mcpServers` (e.g. 'guild-memory')",
    enforced: true,
    note: "Discovery parses .mcp.json; MCP is NOT inline in plugin.json (verified).",
  },
  {
    category: "scripts",
    globs: ["scripts/**/*.ts"],
    id_rule: "repo-relative path under scripts/ without the .ts extension (scripts/build-inventory.ts → 'build-inventory'; scripts/lib/x.ts → 'lib/x')",
    enforced: true,
    note: "Exclude __tests__/** and *.test.ts (test files are not shipped surfaces). The L6 fail-fixture adds a non-test script and requires failure.",
  },
  {
    category: "schemas",
    globs: [],
    id_rule: "the curated result-contract registry (result-contracts.ts RESULT_CONTRACTS); id = wire_schema_version",
    enforced: false,
    note: "Schemas are a CURATED registry, not a filesystem glob. Coverage here = the inventory's schemas[] equals result-contracts.ts RESULT_CONTRACTS (checked by L6 against the registry, not a scan).",
  },
  {
    category: "docs",
    globs: ["docs/**/*.md"],
    id_rule: "doc slug = repo-relative path without .md (unique across the full docs/ tree)",
    enforced: false,
    note: "Full docs/ tree is inventoried (FU-5). Still non-enforced: docs are a coverage/curation surface, not a load-bearing package input, so a missing doc is not an SC-7 fail-fixture.",
  },
]);

/** Categories whose coverage is enforced with an L6 fail-fixture (SC-7a). */
export const COVERAGE_ENFORCED_CATEGORIES: readonly InventoryCategory[] = Object.freeze(DISCOVERY_RULES.filter(
  (r) => r.enforced
).map((r) => r.category));

// ---------------------------------------------------------------------------
// (a) COVERAGE — discovery == inventory
// ---------------------------------------------------------------------------

/** A per-category set of discovered ids (what the live-repo scan found). */
export type DiscoveredSurfaces = Partial<Record<InventoryCategory, Set<string>>>;

export interface CoverageCategoryResult {
  category: InventoryCategory;
  /** ids found by discovery but ABSENT from the inventory (the silent-drop failure). */
  missing_from_inventory: string[];
  /** ids present in the inventory but NOT found by discovery (phantom entries). */
  phantom_in_inventory: string[];
  ok: boolean;
}

export interface CoverageResult {
  ok: boolean;
  categories: CoverageCategoryResult[];
  /** Flat human-readable reasons (one per mismatch). */
  reasons: string[];
}

/** Project an inventory category to its set of ids. */
function inventoryIds(inventory: GuildInventoryV1, category: InventoryCategory): Set<string> {
  const list = (inventory as unknown as Record<string, Array<{ id: string }>>)[category] ?? [];
  return new Set(list.map((e) => e.id));
}

/**
 * SC-7(a) coverage check. For each category present in `discovered`, assert the
 * discovered id set equals the inventory id set. Categories absent from
 * `discovered` are skipped (the caller decides which to scan) — but a caller
 * enforcing SC-7a MUST supply every category in COVERAGE_ENFORCED_CATEGORIES.
 *
 * Pure: takes the scanned `discovered` sets + the parsed inventory.
 */
export function checkCoverage(
  discovered: DiscoveredSurfaces,
  inventory: GuildInventoryV1
): CoverageResult {
  const categories: CoverageCategoryResult[] = [];
  const reasons: string[] = [];

  // Anti-vacuity guard: an enforced category that was never scanned cannot be
  // declared covered. Without this, a caller passing {} (or omitting hooks/
  // mcp_servers/scripts) would receive ok:true while real surfaces go unchecked.
  for (const enforced of COVERAGE_ENFORCED_CATEGORIES) {
    if (discovered[enforced] === undefined) {
      reasons.push(
        `coverage: enforced category "${enforced}" was not supplied in the discovery scan ` +
          `(SC-7a requires every enforced category to be scanned — cannot pass vacuously)`
      );
    }
  }

  for (const category of INVENTORY_CATEGORIES) {
    const found = discovered[category];
    if (found === undefined) continue; // caller chose not to scan this category
    const inv = inventoryIds(inventory, category);

    const missing = [...found].filter((id) => !inv.has(id)).sort();
    const phantom = [...inv].filter((id) => !found.has(id)).sort();
    const ok = missing.length === 0 && phantom.length === 0;

    categories.push({
      category,
      missing_from_inventory: missing,
      phantom_in_inventory: phantom,
      ok,
    });
    for (const id of missing) {
      reasons.push(
        `coverage: ${category} "${id}" exists in the repo but is MISSING from guild.inventory.v1 (silent drop — SC-7a)`
      );
    }
    for (const id of phantom) {
      reasons.push(
        `coverage: ${category} "${id}" is in guild.inventory.v1 but was NOT discovered in the repo (phantom — SC-7a)`
      );
    }
  }

  return { ok: reasons.length === 0, categories, reasons };
}

// ---------------------------------------------------------------------------
// (b) SUBSET — package ⊆ inventory
// ---------------------------------------------------------------------------

/**
 * The id/schema references a rendered host package makes. The caller (L2/L6)
 * extracts these from a generated package. EVERY category is
 * REQUIRED (pass `[]` when the package genuinely references none) — optionality
 * would let a sparse extractor silently skip MCP servers, scripts, or hooks and
 * pass subset vacuously. The required shape forces the extractor to consciously
 * account for each category, exactly like guild.inventory.v1 requires every list.
 */
export interface PackageReferences {
  /** Host this package is for (e.g. "claude", "codex") — for diagnostics. */
  host: string;
  command_ids: string[];
  skill_ids: string[];
  agent_ids: string[];
  /** MCP server ids the package bundles/references (must exist in inventory.mcp_servers). */
  mcp_server_ids: string[];
  /** Script ids the package references (must exist in inventory.scripts). */
  script_ids: string[];
  /** Hook binding ids the package wires (must exist in inventory.hooks). */
  hook_ids: string[];
  /** Every schema_version the package references (must exist in inventory.schemas). */
  schema_versions: string[];
}

export interface SubsetResult {
  ok: boolean;
  /** Each offending reference: { host, kind, id }. */
  violations: Array<{ host: string; kind: string; id: string }>;
  reasons: string[];
}

/**
 * SC-7(b) subset check. Every id/schema_version a host package references must
 * exist in the inventory. Pure: takes the package's extracted references + the
 * parsed inventory.
 */
export function checkSubset(
  pkg: PackageReferences,
  inventory: GuildInventoryV1
): SubsetResult {
  const violations: Array<{ host: string; kind: string; id: string }> = [];
  const reasons: string[] = [];

  const check = (kind: string, ids: string[] | undefined, invSet: Set<string>) => {
    for (const id of ids ?? []) {
      if (!invSet.has(id)) {
        violations.push({ host: pkg.host, kind, id });
        reasons.push(
          `subset: ${pkg.host} package references ${kind} "${id}" which is ABSENT from guild.inventory.v1 (package drift / hand-edit — SC-7b)`
        );
      }
    }
  };

  check("command", pkg.command_ids, inventoryIds(inventory, "commands"));
  check("skill", pkg.skill_ids, inventoryIds(inventory, "skills"));
  check("agent", pkg.agent_ids, inventoryIds(inventory, "agents"));
  check("mcp_server", pkg.mcp_server_ids, inventoryIds(inventory, "mcp_servers"));
  check("script", pkg.script_ids, inventoryIds(inventory, "scripts"));
  check("hook", pkg.hook_ids, inventoryIds(inventory, "hooks"));
  check("schema_version", pkg.schema_versions, inventoryIds(inventory, "schemas"));

  return { ok: violations.length === 0, violations, reasons };
}

// ---------------------------------------------------------------------------
// Combined two-sided gate
// ---------------------------------------------------------------------------

export interface ParityResult {
  ok: boolean;
  coverage: CoverageResult;
  subset: SubsetResult[];
  reasons: string[];
}

/**
 * The full two-sided SC-7 gate: coverage (a) AND subset (b) over every host
 * package. Pure aggregation of checkCoverage + checkSubset.
 */
export function checkParity(
  discovered: DiscoveredSurfaces,
  packages: PackageReferences[],
  inventory: GuildInventoryV1
): ParityResult {
  const coverage = checkCoverage(discovered, inventory);
  const subset = packages.map((p) => checkSubset(p, inventory));
  const reasons = [...coverage.reasons, ...subset.flatMap((s) => s.reasons)];
  return {
    ok: coverage.ok && subset.every((s) => s.ok),
    coverage,
    subset,
    reasons,
  };
}
