/**
 * src/modules/config/workflows/init-scaffold-manifest.ts
 *
 * Versioned init scaffold manifest — the SINGLE scaffold contract consumed by
 * `/guild:init`, host-open init, and `repairGuildInstall` (spec init-config-goal
 * §O line 110, §E step 5, risk "Scaffold drift" → V5/V6/V7).
 *
 * This is the canonical module-source implementation. The plugin-root path named
 * by the spec — `plugin/scripts/lib/init-scaffold-manifest.ts` — is a thin
 * re-export shim, mirroring the settings-resolver pattern.
 *
 * Module: config — zero internal runtime deps (only node builtins / pure data),
 * so the manifest stays importable by init, repair, and detection without
 * pulling host/runtime layers upward (same discipline as config-defaults.ts).
 *
 * Contract authored on lane L1 (run-8202a843). L2 consumes these arrays from
 * `initializeGuild` / `repairGuildInstall`; detection (`detectGuildState`) uses
 * `requiredEntriesFor(mode)` for the "complete enough" gate (V1).
 */

import { deepFreeze } from "../../kernel";

/** Schema version stamped on this manifest contract. */
export const INIT_SCAFFOLD_SCHEMA_VERSION = "guild.init_scaffold.v1" as const;

/**
 * Scaffold installation modes. `repair` is NOT a separate scaffold — repair
 * reconciles an existing install against the mode it detects (single_project or
 * workspace_root) plus the mode-independent `repairRequired` floor.
 */
export type ScaffoldMode = "single_project" | "workspace_root";

/**
 * How a scaffold entry's content originates.
 * - `template`   — rendered from a fixed plugin-owned template (carries an embedded schema_version).
 * - `generated`  — produced by a Guild workflow (init/learn/reconcile); content is data-derived.
 * - `empty-dir`  — a directory whose mere existence is the requirement; no seed content.
 */
export type ScaffoldSource = "template" | "generated" | "empty-dir";

/**
 * No-clobber policy for an entry (spec §O lines 112-118):
 * - `never`          — once present, init AND repair must never overwrite it (user-authored after seeding).
 * - `reconcile-only` — only config reconcile/sync/repair or a scoped config write API may change it
 *                      (e.g. `.guild/settings.json`); init/repair never wholesale-rewrite it.
 */
export type ScaffoldClobber = "never" | "reconcile-only";

/**
 * One required directory or file in the init scaffold.
 *
 * `path` is ALWAYS repo-root-relative and POSIX-separated (`.guild/...`); callers
 * resolve it against the target `cwd`. Absolute paths are never stored here.
 */
export interface ScaffoldEntry {
  /** repo-root-relative POSIX path, e.g. ".guild/settings.json" or ".guild/raw/". */
  readonly path: string;
  /** "file" or "dir". Directory paths conventionally end in "/". */
  readonly kind: "file" | "dir";
  /** Content origin — drives how init seeds it and how repair classifies an existing copy. */
  readonly source: ScaffoldSource;
  /** No-clobber policy. */
  readonly clobber: ScaffoldClobber;
  /**
   * Whether a MISSING copy of this entry marks an install `installed_needs_repair`
   * (detection gate) and is restored by repair. Entries with `repair_required:false`
   * are seeded at init but their later absence does not force the repair state
   * (e.g. brownfield-only or per-run artifacts).
   */
  readonly repair_required: boolean;
  /**
   * Schema version embedded in the seeded content, when the entry carries one.
   * Repair uses an embedded `schema_version` (or `expected_hash`) to decide
   * `already_present` vs `skipped_user_modified` (spec §O lines 116-117). When
   * BOTH are absent, any existing file is treated as user-authored (never
   * overwritten); a missing copy may still be created.
   */
  readonly version?: string;
  /** Optional content hash for exact-match reconcile detection. Omitted = use embedded schema_version. */
  readonly expected_hash?: string;
  /** Human note for the repair report / docs. Not used for matching. */
  readonly description?: string;
}

// ---------------------------------------------------------------------------
// Shared Guild root floor
// ---------------------------------------------------------------------------

/**
 * The must-exist floor for ANY Guild root, whether it is a workspace root,
 * workspace child, or standalone project. The shape is intentionally consistent:
 * a workspace and a project both know where shared agents, skills, workflows,
 * loops, knowledge, memory, initiatives, teams, artifacts, and run records live.
 *
 * `.guild/indexes/` remains as a compatibility location for existing Guild
 * readers/writers while `.guild/knowledge/indexes/` becomes the structured
 * knowledge-layer home for new consumers.
 */
/**
 * DEEP-FROZEN, and the freeze here is what protects the three EXPORTED arrays.
 * `singleProject`, `workspaceRoot` and `repairRequired` are all built by spreading or
 * filtering this array, so they share ELEMENT OBJECT IDENTITY with it: before this,
 * `singleProject[0].path = "x"` also changed `repairRequired[0].path`, because they are
 * the same object. Freezing the three exported arrays only closes the arrays; the shared
 * element graph has to be frozen at its source.
 */
const STANDARD_ROOT_FLOOR: readonly ScaffoldEntry[] = deepFreeze([
  {
    path: ".guild/guild.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.root.v1",
    description: "Guild root identity and kind (workspace or project).",
  },
  {
    path: ".guild/agents/registry.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.agents_registry.v1",
    description: "Project/workspace-shared specialist agent registry.",
  },
  {
    path: ".guild/skills/registry.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.skills_registry.v1",
    description: "Project/workspace-shared skill registry.",
  },
  {
    path: ".guild/workflows/registry.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.workflows_registry.v1",
    description: "Repeatable project/workspace workflow registry.",
  },
  {
    path: ".guild/loops/registry.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.loops_registry.v1",
    description: "Custom loop registry.",
  },
  {
    path: ".guild/init/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Holds per-run init records (.guild/init/<slug>.md). The dir is the requirement; the slug file is per-run.",
  },
  {
    path: ".guild/wiki/index.md",
    kind: "file",
    source: "template",
    clobber: "never",
    repair_required: true,
    version: "guild.wiki_index.v1",
    description: "Wiki entrypoint; user-authored knowledge accretes here.",
  },
  {
    path: ".guild/raw/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Immutable source inputs + checksums.",
  },
  {
    path: ".guild/settings.json",
    kind: "file",
    source: "generated",
    clobber: "reconcile-only",
    repair_required: true,
    version: "guild.settings.v2",
    description: "Project settings. ONLY config reconcile/sync/repair + scoped write APIs may change it (never init/repair wholesale).",
  },
  {
    path: ".guild/knowledge/graph/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Structured knowledge graph artifacts.",
  },
  {
    path: ".guild/knowledge/indexes/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Structured knowledge indexes.",
  },
  {
    path: ".guild/knowledge/sources/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Source material and checksums promoted into knowledge.",
  },
  {
    path: ".guild/knowledge/candidates/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Human-gated knowledge promotion candidates.",
  },
  {
    path: ".guild/memory/summaries/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Durable summarized memory promoted from runs.",
  },
  {
    path: ".guild/memory/lessons/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Reusable lessons promoted from reflections and run analysis.",
  },
  {
    path: ".guild/memory/recall-index.json",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.recall_index.v1",
    description: "Project/workspace recall index placeholder.",
  },
  {
    path: ".guild/initiatives/active/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Active initiative records.",
  },
  {
    path: ".guild/initiatives/archived/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Archived initiative records.",
  },
  {
    path: ".guild/initiatives/registry.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.initiatives_registry.v1",
    description: "Initiative registry for this Guild root.",
  },
  {
    path: ".guild/runs/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Run records and replay evidence.",
  },
  {
    path: ".guild/teams/registry.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.teams_registry.v1",
    description: "Reusable team composition registry.",
  },
  {
    path: ".guild/artifacts/reports/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Shared reports not yet promoted to wiki/memory.",
  },
  {
    path: ".guild/artifacts/audits/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Shared audit outputs.",
  },
  {
    path: ".guild/artifacts/handoffs/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Shared handoff artifacts.",
  },
  {
    path: ".guild/artifacts/generated/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Generated artifacts reviewed for sharing.",
  },
  {
    path: ".guild/workspace/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Workspace relationship files; inert for standalone projects.",
  },
  {
    path: ".guild/hosts/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: false,
    description: "Host-local capability state. Usually ignored unless explicitly shared.",
  },
  {
    path: ".guild/indexes/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Compatibility home for existing Guild index artifacts.",
  },
  {
    path: ".guild/indexes/codebase-map.json",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.codebase_map.v1",
    description: "Cheap-scan CodebaseMap produced by init/learn-map.",
  },
  {
    path: ".guild/indexes/architecture-map.md",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: false,
    version: "guild.architecture_map.v1",
    description: "Brownfield-only architecture-map stub. Seeded for brownfield init; absence is not a broken install.",
  },
] as const);

// ---------------------------------------------------------------------------
// Workspace-root-only additions (spec §O line 110 — "Workspace mode additionally creates")
// ---------------------------------------------------------------------------

/** Deep-frozen for the same shared-identity reason as STANDARD_ROOT_FLOOR. */
const WORKSPACE_EXTRAS: readonly ScaffoldEntry[] = deepFreeze([
  {
    path: ".guild/workspace.json",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.workspace.v1",
    description: "Workspace federation manifest. Its presence + is_workspace:true is what makes this root a workspace_root.",
  },
  {
    path: ".guild/workspace/workspace.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.workspace_root.v1",
    description: "Human-readable workspace root descriptor.",
  },
  {
    path: ".guild/workspace/children.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.workspace_children.v1",
    description: "Workspace child project registry.",
  },
  {
    path: ".guild/workspace/relationships.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.workspace_relationships.v1",
    description: "Cross-project relationship and release-coupling registry.",
  },
  {
    path: ".guild/workspace-knowledge/",
    kind: "dir",
    source: "empty-dir",
    clobber: "never",
    repair_required: true,
    description: "Cross-project coordination knowledge (workspace-only).",
  },
  {
    path: ".guild/indexes/initiatives-registry.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.initiatives_registry.v1",
    description: "Workspace initiative registry (scope resolution for initiative_default inheritance).",
  },
] as const);

// ---------------------------------------------------------------------------
// Exported manifest arrays (spec §O line 110 — "exports three arrays")
// ---------------------------------------------------------------------------

/** Complete scaffold for a single-project install. */
export const singleProject: readonly ScaffoldEntry[] = Object.freeze([...STANDARD_ROOT_FLOOR]);

/**
 * Complete scaffold for a workspace-root install — the standard root floor PLUS
 * the workspace-only additions. Self-contained: consumers do not concat with
 * `singleProject`.
 */
export const workspaceRoot: readonly ScaffoldEntry[] = Object.freeze([...STANDARD_ROOT_FLOOR, ...WORKSPACE_EXTRAS]);

/**
 * The mode-independent required floor — entries whose absence marks ANY install
 * `installed_needs_repair` (V1 `missing_required_manifest_entry`) and which repair
 * restores. Mode-specific required entries (e.g. `.guild/workspace.json` for a
 * workspace root) are obtained via `requiredEntriesFor(mode)`; this array is the
 * intersection that holds regardless of mode.
 *
 * Note `.guild/workspace.json` is NOT here: its presence is the very signal that
 * selects workspace_root mode, so it is required only in that mode.
 */
export const repairRequired: readonly ScaffoldEntry[] = Object.freeze(
  STANDARD_ROOT_FLOOR.filter((e) => e.repair_required),
);

// ---------------------------------------------------------------------------
// Selectors L2 / detection bind to
// ---------------------------------------------------------------------------

/** Full scaffold for a given mode. */
export function scaffoldFor(mode: ScaffoldMode): readonly ScaffoldEntry[] {
  return mode === "workspace_root" ? workspaceRoot : singleProject;
}

/**
 * Mode-specific required floor used by `detectGuildState` to decide whether an
 * install is complete or `installed_needs_repair`, and by `repairGuildInstall`
 * to know what to restore. Returns only entries with `repair_required:true`.
 *
 * `workspace_child` is governed by its OWN `.guild/` and inherits the
 * single-project required floor (it never owns workspace-root extras).
 */
export function requiredEntriesFor(
  mode: ScaffoldMode | "workspace_child",
): readonly ScaffoldEntry[] {
  const base = mode === "workspace_root" ? workspaceRoot : singleProject;
  return base.filter((e) => e.repair_required);
}
