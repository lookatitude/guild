/**
 * src/modules/config/workflows/host-open-preflight.ts
 *
 * Host-neutral startup/preflight contract (spec init-config-goal §O lines 96-99,
 * §E step 3, §V1/§V2). DESIGN CONTRACT authored on lane L1 (run-8202a843):
 * this file pins the TYPES + SIGNATURES that host adapters (L3) and the init /
 * repair APIs (L2) bind to. Function BODIES are L2's implementation work — the
 * stubs throw so the contract is importable but cannot be silently half-wired.
 *
 * STRUCTURED DATA ONLY — these functions return data describing what an adapter
 * should render; they NEVER render UI, prompt, or write files. Adapters render;
 * `initializeGuild` / `repairGuildInstall` write (spec §O line 105, V10).
 *
 * Module: config — pure detection + node builtins; no host/runtime imports.
 */

import type { ScaffoldEntry } from "./init-scaffold-manifest";

// ===========================================================================
// detectGuildState — install-state + workspace-mode detection from cwd
// ===========================================================================

/** Schema version stamped on a detection result. */
export const GUILD_STATE_SCHEMA_VERSION = "guild.guild_state.v1" as const;

/**
 * Install + topology state of a `cwd` (spec §O line 98).
 * - `not_installed`          — no `.guild/` at cwd and cwd is not under a workspace root.
 * - `single_project`         — cwd has `.guild/` (no workspace.json), required floor present.
 * - `workspace_root`         — cwd has `.guild/workspace.json` with is_workspace:true, floor present.
 * - `workspace_child`        — cwd is under an ancestor workspace root; cwd has its own `.guild/`.
 * - `installed_needs_repair` — `.guild/` present but malformed/incomplete (NEVER a silent single fallback, NEVER a crash).
 */
export type GuildState =
  | "not_installed"
  | "single_project"
  | "workspace_root"
  | "workspace_child"
  | "installed_needs_repair";

/** A single piece of evidence backing the classification (spec §O line 98 "with evidence paths"). */
export interface GuildStateEvidence {
  /** What this evidence is about. */
  readonly kind:
    | "guild_dir"
    | "workspace_json"
    | "settings_json"
    | "ancestor_workspace"
    | "child_git_repo"
    | "manifest_entry";
  /** Absolute path the evidence refers to. */
  readonly path: string;
  /** Whether the path was found to exist / be valid. */
  readonly present: boolean;
  /** Optional detail (e.g. "is_workspace:true", "JSON parse error at offset N"). */
  readonly detail?: string;
}

/**
 * Why an install is `installed_needs_repair`. Exactly the two V1-mandated
 * problem codes. `null` for every non-repair state.
 */
export interface GuildStateProblem {
  readonly problem: "malformed_workspace_json" | "missing_required_manifest_entry";
  /** Absolute path of the malformed file or the first missing required entry. */
  readonly path: string;
  /** Optional human detail for the repair report. */
  readonly detail?: string;
}

/** Result of `detectGuildState(cwd)`. */
export interface GuildStateResult {
  readonly schema_version: typeof GUILD_STATE_SCHEMA_VERSION;
  readonly state: GuildState;
  /** Absolute cwd the detection ran for. */
  readonly cwd: string;
  /**
   * Absolute path of the governing `.guild/` root for this session:
   * cwd for single_project / workspace_root / workspace_child / single-project repair;
   * cwd even for a child (the child owns its project layer). `null` for not_installed.
   */
  readonly projectRoot: string | null;
  /**
   * Absolute path of the ancestor (or self) workspace root, when one applies:
   * cwd for workspace_root; the discovered ancestor for workspace_child; else `null`.
   */
  readonly workspaceRoot: string | null;
  /** The required-floor entries that were checked for this mode (mirror of requiredEntriesFor). */
  readonly checkedRequired: readonly ScaffoldEntry[];
  /** Ordered evidence supporting the classification. */
  readonly evidence: readonly GuildStateEvidence[];
  /** Populated ONLY when state === "installed_needs_repair"; otherwise null. */
  readonly problem: GuildStateProblem | null;
}

/**
 * Detect Guild install state + workspace topology from `cwd`. Pure, read-only,
 * crash-free (all fs/JSON access wrapped; malformed → installed_needs_repair).
 *
 * Algorithm (L2 implements; pinned here as the contract):
 *  1. Discover the nearest workspace root: walk up INCLUSIVE of cwd for
 *     `.guild/workspace.json`. For a workspace.json AT cwd, presence COMMITS to the
 *     workspace-root interpretation — it is NEVER reinterpreted as single_project:
 *       - unparseable JSON  → installed_needs_repair{malformed_workspace_json, path}.
 *       - parseable but INVALID SHAPE (missing `is_workspace:true`, wrong/extra-typed
 *         required fields per guild.workspace.v1) → installed_needs_repair{
 *         malformed_workspace_json, path}. (Closes the V1 silent-fallback hole — a
 *         present-but-invalid workspace.json must NOT fall through to step 4.)
 *     A malformed/invalid workspace.json in an ANCESTOR (not at cwd) is skipped
 *     (continue up) — matches the resolver's F4 rule.
 *  2. cwd has a VALID `.guild/workspace.json` (is_workspace:true + shape ok) →
 *     workspace_root; verify requiredEntriesFor("workspace_root"); first missing →
 *     needs_repair{missing_required_manifest_entry, path}.
 *  3. cwd is under an ancestor workspace root → workspace_child; verify
 *     requiredEntriesFor("workspace_child"); first missing → needs_repair.
 *  4. cwd has `.guild/` AND NO workspace.json at cwd AND no ancestor workspace →
 *     single_project; verify requiredEntriesFor("single_project"); first missing →
 *     needs_repair. (Only reachable when no workspace.json exists at cwd — a present
 *     one was already resolved in step 1/2.)
 *  5. No `.guild/` at cwd and no ancestor workspace → not_installed.
 * Never silently fall back to single_project on malformed/incomplete (V1).
 */
export function detectGuildState(_cwd: string): GuildStateResult {
  throw new Error(
    "L1 design stub: detectGuildState is implemented in L2 (init-config-goal §E step 3).",
  );
}

// ===========================================================================
// hostOpenPreflight — per-session-start routing data for host adapters
// ===========================================================================

/** Schema version stamped on a preflight result. */
export const HOST_OPEN_PREFLIGHT_SCHEMA_VERSION = "guild.host_open_preflight.v1" as const;

/**
 * The CLI/agents-file hosts that have a native config surface in THIS build.
 * App/connector hosts are OPEN blockers (L0 verdict) → preflight returns
 * action:"blocked" for them, never a false-native render path.
 */
export const CLI_NATIVE_HOSTS: ReadonlySet<string> = new Set([
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
]);

/** What the adapter should do next — DATA, not a rendered surface. */
export type PreflightAction = "proceed" | "offer_init" | "offer_repair" | "blocked";

/** Advisory copy code — message text comes from init-config-copy.ts (centralized, spec line 83). */
export interface PreflightAdvisory {
  readonly code: "ready" | "not_installed" | "needs_repair" | "host_unsupported";
  /** Centralized copy resolved from init-config-copy.ts. */
  readonly message: string;
}

/** Classification of the opened root for the init prompt (spec lines 85-92). */
export type RootKind = "empty" | "non_empty_no_child_repos" | "has_child_repos";

/**
 * The mode vocabulary `initializeGuild(cwd, mode)` accepts (spec §E step 4 / line 100):
 * `single_project | workspace`. DISTINCT from the detection/scaffold vocabulary
 * `ScaffoldMode` (whose workspace value is `workspace_root`) — the init prompt must speak
 * the initializer's language so L3/L4 never pass `workspace_root` into `initializeGuild`.
 * Mapping: detected `workspace_root` ⇄ init `workspace`; `single_project` is identical.
 */
export type InitMode = "single_project" | "workspace";

/** Init-prompt data for adapters to render natively (action === "offer_init"). */
export interface InitPromptData {
  /** Recommended INIT mode given root_kind (has_child_repos → "workspace"; else "single_project").
   *  This is the `initializeGuild` mode, NOT ScaffoldMode — see {@link InitMode}. */
  readonly recommended_mode: InitMode;
  readonly root_kind: RootKind;
  /** Absolute paths of detected immediate/nested child `.git/` repos (drives the workspace recommendation). */
  readonly child_git_repos: readonly string[];
  /** The branches the adapter must offer (always includes "skip"). */
  readonly branches: readonly ("single_project" | "multiple_repo_workspace" | "skip")[];
}

/** Result of `hostOpenPreflight(cwd, host)`. */
export interface HostOpenPreflightResult {
  readonly schema_version: typeof HOST_OPEN_PREFLIGHT_SCHEMA_VERSION;
  /** Host id this preflight ran for. */
  readonly host: string;
  readonly cwd: string;
  /** The underlying detection result. */
  readonly detection: GuildStateResult;
  /** What the adapter should do next. */
  readonly action: PreflightAction;
  /** True only when state ∈ {single_project, workspace_root, workspace_child} AND host can render. */
  readonly lifecycle_available: boolean;
  /** Centralized advisory copy + code. */
  readonly advisory: PreflightAdvisory;
  /** Present when action === "offer_init"; else null. */
  readonly init_prompt: InitPromptData | null;
  /** Present when action === "offer_repair"; else null. Mirrors detection.problem. */
  readonly repair_hint: GuildStateProblem | null;
  /**
   * Optional cache key a long-lived host may key a positive result on
   * (spec line 64): "<cwd>|<host>|<settings mtime+size fingerprint>". Correctness
   * never depends on cache hits; null when not computed.
   */
  readonly cache_fingerprint: string | null;
}

/**
 * Run host-open preflight for a session-start event (spec §O line 99, §V2).
 * Runs `detectGuildState(cwd)`, then maps state → action for the host:
 *  - not_installed                       → offer_init (with InitPromptData), lifecycle_available:false
 *  - installed_needs_repair              → offer_repair (with repair_hint),  lifecycle_available:false
 *  - single/workspace_root/workspace_child → proceed,    lifecycle_available:true
 *  - host ∉ CLI_NATIVE_HOSTS             → blocked, advisory.code:"host_unsupported" (L0 OPEN blocker)
 *
 * Returns structured data only — the adapter renders it through its native surface.
 */
export function hostOpenPreflight(_cwd: string, _host: string): HostOpenPreflightResult {
  throw new Error(
    "L1 design stub: hostOpenPreflight is implemented in L2 (init-config-goal §E step 3).",
  );
}
