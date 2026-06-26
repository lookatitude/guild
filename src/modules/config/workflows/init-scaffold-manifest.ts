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
// Shared single-project floor (spec §O line 110 — "current Init must-exist floor")
// ---------------------------------------------------------------------------

/**
 * The must-exist floor for ANY Guild install (single-project and the project
 * portion of a workspace root). `architecture-map.md` is brownfield-only, so it
 * is seeded but `repair_required:false` (its absence on a greenfield project is
 * legitimate, not a broken install).
 */
const PROJECT_FLOOR: readonly ScaffoldEntry[] = [
  {
    path: ".guild/project.yaml",
    kind: "file",
    source: "generated",
    clobber: "never",
    repair_required: true,
    version: "guild.project.v1",
    description: "Project identity + Guild metadata; user-editable after seeding.",
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
] as const;

// ---------------------------------------------------------------------------
// Workspace-root-only additions (spec §O line 110 — "Workspace mode additionally creates")
// ---------------------------------------------------------------------------

const WORKSPACE_EXTRAS: readonly ScaffoldEntry[] = [
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
] as const;

// ---------------------------------------------------------------------------
// Exported manifest arrays (spec §O line 110 — "exports three arrays")
// ---------------------------------------------------------------------------

/** Complete scaffold for a single-project install. */
export const singleProject: readonly ScaffoldEntry[] = [...PROJECT_FLOOR];

/**
 * Complete scaffold for a workspace-root install — the shared project floor PLUS
 * the workspace-only additions. Self-contained: consumers do not concat with
 * `singleProject`.
 */
export const workspaceRoot: readonly ScaffoldEntry[] = [...PROJECT_FLOOR, ...WORKSPACE_EXTRAS];

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
export const repairRequired: readonly ScaffoldEntry[] = PROJECT_FLOOR.filter(
  (e) => e.repair_required,
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
