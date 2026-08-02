/**
 * src/modules/host-runtime/workflows/host-registry-schema.ts
 *
 * P1-L0 FOUNDATION — `guild.host_registry.v1`: the single-source-of-truth SCHEMA
 * for host identity, detection, and the **independent capability columns**, wrapping
 * the existing P0 `guild.host_capabilities.v1` row.
 *
 * Contract authority (SoT) — the retired `docs/knowledge/` store was harvested
 * into the canonical wiki (workspace-v2-compliance, 2026-06-27):
 *   .guild/wiki/decisions/host-adapter-contract.md §Capability Matrix (FROZEN successor)
 *   .guild/wiki/decisions/verified-multi-host-support.md (the L0 ADR — registry §2, adapter_binding §3)
 *   docs/v2/host-adapter-migration-spec.html (the canonical design set)
 *
 * WHY (ADR §capability matrix): the new hosts carry **independent capability columns**,
 * NOT a single "detect-only" flag. Today the detect-only assumption is encoded as the
 * single boolean `ProviderSpec.hasAdapter` (provider-detect.ts:188/204), which conflates
 * three orthogonal facts. P1 splits it:
 *
 *   - `installability` (native|target|none) — can a package be INSTALLED for this host
 *   - `result_adapter` (bool)               — does a cross-review/RESULT adapter exist
 *   - `dispatch_selectable` (bool)          — can a lane be DISPATCHED/selected here
 *
 * These are independent: a host can be dispatch-selectable (a lane runs there) without a
 * result_adapter (no cross-review path back), and installable-as-target without being
 * either. Routing/role-resolution read the COLUMNS, never the host NAME.
 *
 * CONTRACT: pure types + a `validateHostRegistryEntry()` validator + the 5 Phase-1
 * INFERRED rows. No I/O, no clock, never throws. P1-L0 ships the SCHEMA + design-time
 * rows; L7 (`host-registry.ts`) builds the runtime registry that routes
 * host-router/team-backend/provider-detect through these rows (behavior-preserving).
 *
 * Owned by plugin-architect (P1-L0); consumed by L7 (unify), L6 (renderers), L8 (roles),
 * L11 (adapters), Ltest (RED→GREEN).
 */

import { deepFreeze } from "../../kernel";

import { UPDATE_COMMANDS,
  GuildHostCapabilitiesV1,
  validateHostCapabilitiesV1,
  AGENTS_FILE_CAPABILITIES,
  CLAUDE_CAPABILITIES,
  CODEX_CAPABILITIES,
} from "./host-capabilities-schema";

// ---------------------------------------------------------------------------
// Host id namespace (P1 registry)
// ---------------------------------------------------------------------------

/**
 * The v2 registry host-id namespace. These are the canonical host ids used by
 * settings, package rendering, dispatch routing, model-tier maps, docs, and the
 * generated support matrix. Legacy inputs normalize into this set via
 * host-id-namespace.ts; legacy aliases are never authoritative registry ids.
 */
export const HOST_IDS = Object.freeze([
  // keep CLI/file (5)
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  // keep-as-refuse (4) — RETAINED verbatim
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector",
  // new CLI-with-binary (4) — verified_multi_host L0 ADR §2.1
  "cursor",
  "github-copilot",
  "opencode",
  "rovo-dev",
  // new IDE-embedded (3) — bind the universal agents-file adapter (adapter_binding: "agents-file").
  // `trae-cn` is NOT distinct — it folds into `trae` (L0 ADR §9). host id set = 16.
  "kiro",
  "qoder",
  "trae",
] as const);
export type HostId = (typeof HOST_IDS)[number];

/**
 * Host families for the independence axis (adversarial different-family rule).
 * One family per new-CLI host; the IDE rows SHARE `family: "agents"` (no new family) —
 * verified_multi_host L0 ADR §2.2. `FAMILY_SET` below is `new Set(HOST_FAMILIES)`, so it
 * auto-derives — no separate edit. `gemini` was sunset 2026-06-14 (Antigravity replaced it).
 */
export const HOST_FAMILIES = Object.freeze([
  "claude",
  "codex",
  "agents",
  "pi",
  "antigravity",
  "cursor",
  "copilot",
  "opencode",
  "rovo",
] as const);
export type HostFamilyId = (typeof HOST_FAMILIES)[number];

// ---------------------------------------------------------------------------
// Independent capability columns (replace the single detect-only flag)
// ---------------------------------------------------------------------------

/**
 * Can a Guild package be INSTALLED for this host?
 *   - "native": a real install path is proven (Claude today).
 *   - "target": a renderer exists but install is NOT yet proven; the P0 Codex
 *               posture — flips to "native" when a live-host AC passes (SC-3-style).
 *   - "none":   no package surface for this host at all.
 * Distinct from `result_adapter`/`dispatch_selectable`: installability is about the
 * package, not about review or dispatch.
 */
export type Installability = "native" | "target" | "none";

/**
 * The named auth-probe recipe the detector runs (kept as a token so the runtime
 * registry — L7 — binds it to the real probe; L0 does not shell out). Closed union;
 * `AUTH_PROBE_SET` below auto-derives via `new Set(AUTH_PROBES)`.
 *   - "codex_stored_or_env":    ~/.codex/auth.json non-empty OR $OPENAI_API_KEY (the
 *                               verified codex recipe — never env-only, avoids the
 *                               stored-creds false-negative).
 *   - "none":                   no auth needed (file surface / detect-only).
 *   - "cursor_stored":          Cursor login present (~/.cursor / cursor-agent auth check).
 *   - "gh_auth":                `gh auth status` exits 0 AND the `gh copilot` extension is available.
 *   - "opencode_stored_or_env": opencode auth config present OR a provider env key set.
 *   - "acli_stored":            `acli` Atlassian auth present (`acli rovodev` reachable).
 */
export const AUTH_PROBES = Object.freeze([
  "codex_stored_or_env",
  "none",
  "cursor_stored",
  "gh_auth",
  "opencode_stored_or_env",
  "acli_stored",
] as const);
export type AuthProbe = (typeof AUTH_PROBES)[number];

/** The file/IDE detection recipe for `adapter_binding: "agents-file"` rows (null for CLI hosts). */
export interface HostMarker {
  /** The marker dir probed to recognize the editor on a box (e.g. `.kiro`). */
  config_dir: string;
  /** Where the marker is looked for. */
  scope: "project" | "home" | "either";
  /** Where Guild writes the instruction file (root `AGENTS.md` for the Phase-1 IDE set). */
  agents_placement: string;
}

/**
 * Detection metadata — how the registry recognizes the host on a box. Replaces the
 * scattered probe knowledge in provider-detect.ts (ProviderSpec.bin/requiresAuth).
 */
export interface HostDetection {
  /** CLI binary probed on PATH, or null for a non-CLI surface (e.g. an `agents-file` target). */
  bin: string | null;
  /** Selectability additionally requires a passing auth probe. */
  requires_auth: boolean;
  /** The named auth-probe recipe (token; L7 binds it to the real probe). */
  auth_probe: AuthProbe;
  /**
   * ADDITIVE OPTIONAL — the capability is a subcommand of a shared bin (`gh copilot`,
   * `acli rovodev`). null/absent for others; existing rows validate unchanged.
   */
  subcommand?: string | null;
  /**
   * ADDITIVE OPTIONAL — the file/IDE recipe for `adapter_binding: "agents-file"` hosts.
   * null/absent for CLI hosts; existing rows validate unchanged.
   */
  marker?: HostMarker | null;
}

/**
 * How a host binds its adapter + renderer (verified_multi_host L0 ADR §3.1):
 *   - "self":         the host has its OWN adapter + renderer (all CLI hosts).
 *   - "agents-file":  the host DEREFERENCES the universal agents-file adapter/renderer
 *                     (IDE file-surface rows). It MUST NOT carry a per-host adapter — the
 *                     factory routing + AC-REG-4 forbid a hidden per-host chain (R2).
 */
export type AdapterBinding = "self" | "agents-file";

// ---------------------------------------------------------------------------
// Registry entry — `guild.host_registry.v1`
// ---------------------------------------------------------------------------

export interface HostRegistryEntry {
  schema_version: "guild.host_registry.v1";
  /** Concrete registry host id. */
  host_id: HostId;
  /** Family for the independence checks (adversarial must be different-family for `strong`). */
  family: HostFamilyId;
  /** Surface kind (cli | app | file). */
  surface_kind: "cli" | "app" | "file";
  /**
   * How the host binds its adapter + renderer (L0 ADR §3.1). "self" for every CLI host
   * (its own adapter); "agents-file" for IDE file-surface rows (dereference the universal
   * agents-file adapter — MUST NOT carry a per-host adapter, AC-REG-4).
   */
  adapter_binding: AdapterBinding;
  /** How the host is detected on a box. */
  detection: HostDetection;

  // ── The three INDEPENDENT capability columns (replace `hasAdapter`) ──────────
  /** Can a package be installed for this host. */
  installability: Installability;
  /** Does a cross-review / result adapter exist for this host TODAY (↔ legacy hasAdapter). */
  result_adapter: boolean;
  /** Can a lane be dispatched / selected on this host. */
  dispatch_selectable: boolean;

  /** The embedded P0 capability row (the deep, normalized capability matrix). */
  capabilities: GuildHostCapabilitiesV1;
  /**
   * Whether the COLUMNS above are verified on a live host or INFERRED off-box.
   * Phase-1 new hosts ship "inferred"; flips to "verified" at live-host availability.
   */
  provenance: "verified" | "inferred";
}

// ---------------------------------------------------------------------------
// Phase-1 registry rows (claude/codex verified columns; new hosts INFERRED)
// ---------------------------------------------------------------------------

const CLAUDE_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-cli",
  family: "claude",
  adapter_binding: "self",
  surface_kind: "cli",
  detection: { bin: "claude", requires_auth: false, auth_probe: "none" },
  installability: "native",
  result_adapter: false, // Claude is the reference author host, not a cross reviewer for itself.
  dispatch_selectable: true,
  capabilities: CLAUDE_CAPABILITIES,
  provenance: "verified",
};

const CODEX_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "codex-cli",
  family: "codex",
  adapter_binding: "self",
  surface_kind: "cli",
  detection: { bin: "codex", requires_auth: true, auth_probe: "codex_stored_or_env" },
  // installability:"target" mirrors the P0 capability row (renderer exists, install unproven).
  installability: "target",
  result_adapter: true, // The only selectable cross reviewer today (provider-detect codex-plugin/codex-cli).
  dispatch_selectable: true,
  capabilities: CODEX_CAPABILITIES,
  provenance: "verified", // columns verified from plugin facts; the embedded caps row carries its own INFERRED notes.
};

/**
 * A minimal INFERRED capability row for a new host whose deep matrix is not yet
 * authored on-box. It is a HONEST placeholder: installable:false / "target", every
 * uncertain block degraded, marked at the row level via the registry `provenance`.
 * L6 (renderers) / live-host verification replace these with full rows.
 */
function inferredCaps(
  host_kind: string,
  family: string,
  surface_kind: "cli" | "app" | "file" = "cli",
  /**
   * CODEX-REVIEW FIX (S6 round 1, HIGH-3): injection facts derive from whether a
   * lane can actually be DISPATCHED here, NOT from the surface kind. The previous
   * `surface_kind === "cli"` test relied on an undocumented correlation: a
   * non-selectable CLI would have been handed `target`/`prompt_text`, and a
   * selectable non-CLI `absent`/`none`, with nothing to catch either. Callers pass
   * the SAME value they put on the registry entry's `dispatch_selectable`, and
   * `validateHostRegistryEntry` now cross-checks that they agree.
   */
  dispatch_selectable: boolean = surface_kind === "cli"
): GuildHostCapabilitiesV1 {
  return {
    schema_version: "guild.host_capabilities.v1",
    host_kind,
    family,
    // Must equal the registry entry's top-level surface_kind (cross-field invariant,
    // enforced by validateHostRegistryEntry). `.agents` is a file surface, not cli.
    surface_kind,
    package: {
      installable: false,
      installability: "target",
      manifest_format: `${host_kind}-package`,
      // AC-7 by surface: cli = Guild-owned wrapper packages → guild-run
      // self-update; file = AGENTS-file packages → reinstall command (notify +
      // one command, no daemon); app = refused install surfaces → no check, no
      // apply (degrades to notify-only prose; the recorded loss IS this row).
      update:
        surface_kind === "cli"
          ? { check: "receipt", apply: "self_update", command: UPDATE_COMMANDS.self_update, auto_capable: false }
          : surface_kind === "file"
            ? { check: "receipt", apply: "reinstall_command", command: UPDATE_COMMANDS.reinstall_command, auto_capable: false }
            : { check: "none", apply: "none", command: null, auto_capable: false },
    },
    bootstrap: {
      context_injection: "instruction_file",
      skill_autoload: false,
      prompt_transform: false,
      wrapper_injection: true,
    },
    commands: { slash_commands: false, command_files: "none" },
    skills: { native_skills: false, skill_dir: null },
    agents: { native_agents: false, agent_format: null },
    // cap-loc-D11 — injection facts derived STRUCTURALLY from the surface kind.
    // A `cli` surface has somewhere to dispatch a lane, so injection is an
    // unproven TARGET. An `app` or `file` surface has no pane to dispatch into
    // (see the AGENTS_FILE / kiro / qoder / trae rows: `dispatch_selectable:
    // false`), so there is nothing to inject INTO — `absent`, and nothing to
    // degrade to either. That is a structural fact, not pessimism.
    //
    // NO ROW STARTS `verified`: injection is unbuilt, so no probe of it has ever
    // run on any host. A row flips only on a real probe receipt (E3 / cap-loc-D12).
    injection:
      dispatch_selectable
        ? {
            definition_injection: false,
            definition_injection_support: "target" as const,
            skill_bundle_injection: false,
            skill_bundle_injection_support: "target" as const,
            dynamic_registration: false,
            dynamic_registration_support: "absent" as const,
            fallback: "prompt_text" as const,
            definition_injection_verified_by: null,
            skill_bundle_injection_verified_by: null,
            dynamic_registration_verified_by: null,
          }
        : {
            definition_injection: false,
            definition_injection_support: "absent" as const,
            skill_bundle_injection: false,
            skill_bundle_injection_support: "absent" as const,
            dynamic_registration: false,
            dynamic_registration_support: "absent" as const,
            fallback: "none" as const,
            definition_injection_verified_by: null,
            skill_bundle_injection_verified_by: null,
            dynamic_registration_verified_by: null,
          },
    hooks: {
      session_start: false,
      user_prompt_submit: false,
      pre_tool_use: false,
      post_tool_use: false,
      stop: false,
      pre_compact: false,
      subagent_stop: false,
      task_created: false,
      task_completed: false,
      teammate_idle: false,
    },
    permissions: {
      deny: false,
      ask: true,
      ask_mode: null,
      accept_edits_without_prompt: false,
      auto_approve_tools: false,
      bypass_prompts: false,
      bypass_sandbox: false,
      permission_prompt_layer: false,
      launch_modes: {},
    },
    dispatch: {
      tmux_processes: true,
      plain_processes: true,
      independent_agents: false,
      subagents: false,
      inline: true,
    },
    interaction: { native_questions: false, terminal_prompt: true, file_bus_questions: true },
    sessions: { continue: false, resume_by_id: false, fork: false },
    structured_output: { native_json: false, schema_validation: false, repair_prompt: true },
    artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
    tools: {
      read: "native",
      search: "native",
      shell: "native",
      edit: "native",
      write: "native",
      browser: "none",
      web: "emulated",
      mcp: "none",
    },
    mcp: { stdio: false, http: false },
    models: { cheap: { model: null }, mid: { model: null }, powerful: { model: null } },
  };
}

const AGENTS_FILE_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "agents-file",
  family: "agents",
  // "self": agents-file is the universal AGENTS.md adapter/renderer ITSELF (the IDE rows
  // dereference it via adapter_binding: "agents-file"; this row is the target of that binding).
  adapter_binding: "self",
  // `agents-file` is the universal AGENTS.md package target — a FILE surface, not a CLI.
  surface_kind: "file",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "target",
  result_adapter: false, // INFERRED — no cross-review adapter; verify at live-host availability.
  // FLIPPED from `true` (gap-audit C-agents-file), applying the SAME G4b
  // host-reachability rule that flipped kiro/qoder/trae — see KIRO_ENTRY's comment.
  // The prior value was annotated INFERRED with the rationale "a host consuming
  // AGENTS.md can run a lane". That is a true statement about the CLASS of consuming
  // hosts, but `dispatch_selectable` is read per-ROW as "a lane can be dispatched into
  // THIS row", and under that reading it is false by construction:
  //   - `agents-file` is not a member of the `HostKind` union (host-types.ts), so no
  //     TeamBackend/pane path can name it;
  //   - the generic pane adapter requires `surface_kind:"cli"` (pane-adapter.ts), and
  //     this row is `surface_kind:"file"` — no PaneAdapter exists or can exist;
  //   - guild-run-wrapper.ts takes a `HostKind`, so it cannot wrap this row either;
  //   - decisively, THIS ROW'S OWN ADAPTER refuses: createAgentsFileAdapter().dispatch()
  //     returns `status:"degraded"`, `command:null`, "agents-file is an instruction
  //     package target, not a process launcher".
  // The G4b lane carved this row out as a documented exception rather than flipping it.
  // That carve-out is superseded here because the field has REAL per-row consumers that
  // read it as selectability: config-cli.ts builds the operator-pinnable host set from
  // `dispatch_selectable === true`, and role-model-schema.ts picks the host/advisory
  // substrate from `installability !== "none" && dispatch_selectable`. With `true` and
  // `installability:"target"`, Guild could select `agents-file` as a run's host substrate
  // and then dispatch into an adapter that returns `command: null`. A concrete
  // AGENTS.md-consuming host carries its OWN row (kiro/qoder/trae dereference this one);
  // this row is the render TARGET, never a dispatch destination.
  dispatch_selectable: false,
  capabilities: AGENTS_FILE_CAPABILITIES, // file surface — matches top-level surface_kind.
  provenance: "inferred",
};

const PI_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "pi-cli",
  family: "pi",
  adapter_binding: "self",
  surface_kind: "cli",
  detection: { bin: "pi", requires_auth: false, auth_probe: "none" }, // VERIFIED on-host 2026-06-16: `pi` 0.79.3 at /opt/homebrew/bin/pi.
  installability: "target", // VERIFIED-as-target: CLI present; Guild-package install into pi unproven.
  result_adapter: false, // VERIFIED: no Guild cross-review adapter ships for pi (detect-only, provider-detect.ts:206).
  dispatch_selectable: true, // VERIFIED: pi is a CLI process a lane can run on.
  capabilities: {
    ...inferredCaps("pi-cli", "pi"),
    // VERIFIED on-host (pi --help, 0.79.3):
    sessions: { continue: true, resume_by_id: true, fork: true }, // --continue/-c, --resume/-r + --session-id, --fork
    structured_output: { native_json: true, schema_validation: false, repair_prompt: true }, // --mode json
    permissions: {
      ...inferredCaps("pi-cli", "pi").permissions,
      // G4b: carries forward the Phase-1 hand-authored host-capabilities-schema.ts
      // PI_CAPABILITIES.permissions.deny value (a field the inferredCaps() default
      // left false) — pi's --tools allowlist lets an invocation deny specific tools,
      // so `deny:true` is the correct capability. Recorded here (not just in the
      // now-superseded PI_CAPABILITIES row) so the registry stays the single source.
      deny: true,
    },
  },
  provenance: "verified", // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
};

const ANTIGRAVITY_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "antigravity-cli",
  family: "antigravity",
  adapter_binding: "self",
  surface_kind: "cli",
  // VERIFIED on-host 2026-06-16: the CLI is `agy` 1.0.8 (~/.local/bin/agy) — NOT `antigravity`. Detection bin corrected.
  detection: { bin: "agy", requires_auth: false, auth_probe: "none" },
  installability: "target", // VERIFIED-as-target: CLI present; Guild-package install unproven.
  result_adapter: false, // VERIFIED: no Guild cross-review adapter ships for antigravity (detect-only, provider-detect.ts:207).
  dispatch_selectable: true, // VERIFIED: agy is a CLI process a lane can run on.
  capabilities: {
    ...inferredCaps("antigravity-cli", "antigravity"),
    // VERIFIED on-host (agy --help, 1.0.8):
    sessions: { continue: true, resume_by_id: true, fork: false }, // --continue/-c, --conversation <id>; no fork flag
    permissions: {
      ...inferredCaps("antigravity-cli", "antigravity").permissions,
      bypass_prompts: true, // --dangerously-skip-permissions auto-approves all tool-permission prompts (agy also has a separate --sandbox restrict toggle)
      launch_modes: { bypass_all: ["--dangerously-skip-permissions"] },
      // G4b: carries forward two Phase-1 hand-authored host-capabilities-schema.ts
      // ANTIGRAVITY_CAPABILITIES fields the inferredCaps() default did not set —
      // `deny` (agy can refuse a tool) and `bypass_sandbox` (the same
      // --dangerously-skip-permissions flag that sets bypass_prompts above also lifts
      // the sandbox restriction agy's separate --sandbox toggle would otherwise apply).
      // Recorded here so the registry — not a second hand-authored row — is the one
      // source of truth (closes the "two diverged capability truths" audit finding).
      deny: true,
      bypass_sandbox: true,
    },
  },
  provenance: "verified", // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
};

const CLAUDE_APP_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-app",
  family: "claude",
  adapter_binding: "self",
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("claude-code-app", "claude", "app"),
  provenance: "inferred",
};

const CLAUDE_WEB_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-web",
  family: "claude",
  adapter_binding: "self",
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("claude-code-web", "claude", "app"),
  provenance: "inferred",
};

const CODEX_APP_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "codex-app",
  family: "codex",
  adapter_binding: "self",
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("codex-app", "codex", "app"),
  provenance: "inferred",
};

const CLAUDE_AI_CONNECTOR_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-ai-connector",
  family: "claude",
  adapter_binding: "self",
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("claude-ai-connector", "claude", "app"),
  provenance: "inferred",
};

// ---------------------------------------------------------------------------
// New-CLI rows (verified_multi_host L0 ADR §2.3) — full 11-concern chain on the
// shared wrapped-CLI base. adapter_binding "self"; installability "target";
// result_adapter false; dispatch_selectable true. Provenance is per-row since
// issue #110: github-copilot + opencode are "verified" (live on-box completions,
// #104 pass); cursor + rovo-dev remain "inferred". Registry provenance stays
// decoupled from runtime support — L0 ADR §5.2; L1 does NOT mutate provenance,
// and an operator-box receipt is still what flips the DERIVED public state.
// Each bootstraps via the guild-run wrapper (inferredCaps → wrapper_injection: true).
// ---------------------------------------------------------------------------

const CURSOR_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "cursor",
  family: "cursor",
  adapter_binding: "self",
  surface_kind: "cli",
  detection: { bin: "cursor-agent", requires_auth: true, auth_probe: "cursor_stored", subcommand: null, marker: null },
  installability: "target",
  result_adapter: false,
  dispatch_selectable: true,
  capabilities: inferredCaps("cursor", "cursor", "cli"),
  // STAYS inferred (issue #110): detection bin + `-p` flag shape + requires_auth
  // were live-checked 2026-07-30, but no authenticated completion has run —
  // partial verification does not flip the row.
  provenance: "inferred",
};

const GITHUB_COPILOT_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "github-copilot",
  family: "copilot",
  adapter_binding: "self",
  surface_kind: "cli",
  // capability is a subcommand of the shared `gh` bin (`gh copilot`).
  detection: { bin: "gh", requires_auth: true, auth_probe: "gh_auth", subcommand: "copilot", marker: null },
  installability: "target",
  result_adapter: false,
  dispatch_selectable: true,
  capabilities: inferredCaps("github-copilot", "copilot", "cli"),
  // Columns + detection live-checked 2026-07-30 (issue #104/#110): `gh copilot -p`
  // real completion end to end through guild-run; per-host receipt + live
  // self-update swap. Capability RUNGS stay INFERRED (adapter-fallback-ladders
  // INFERRED_HOSTS) until all cells are live-verified.
  provenance: "verified",
};

const OPENCODE_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "opencode",
  family: "opencode",
  adapter_binding: "self",
  surface_kind: "cli",
  detection: { bin: "opencode", requires_auth: true, auth_probe: "opencode_stored_or_env", subcommand: null, marker: null },
  installability: "target",
  result_adapter: false,
  dispatch_selectable: true,
  capabilities: inferredCaps("opencode", "opencode", "cli"),
  // Columns + detection live-checked 2026-07-30 (issue #104/#110): real completion
  // via `opencode run` (the `-p` shape was refuted and corrected, PR #109);
  // per-host receipt + live self-update swap. Capability RUNGS stay INFERRED
  // (adapter-fallback-ladders INFERRED_HOSTS) until all cells are live-verified.
  provenance: "verified",
};

const ROVO_DEV_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "rovo-dev",
  family: "rovo",
  adapter_binding: "self",
  surface_kind: "cli",
  // capability is a subcommand of the shared `acli` bin (`acli rovodev`).
  detection: { bin: "acli", requires_auth: true, auth_probe: "acli_stored", subcommand: "rovodev", marker: null },
  installability: "target",
  result_adapter: false,
  dispatch_selectable: true,
  capabilities: inferredCaps("rovo-dev", "rovo", "cli"),
  provenance: "inferred",
};

// ---------------------------------------------------------------------------
// New-IDE rows (verified_multi_host L0 ADR §2.4) — file surface, family "agents".
// adapter_binding "agents-file": they DEREFERENCE the universal agents-file
// adapter/renderer and MUST NOT carry a per-host adapter (AC-REG-4 + AC-ADP-1, R2).
// detection.bin null (excluded from install.sh PATH auto-detect, AC-INS-3); detection
// is the project marker dir. All three read root AGENTS.md. `trae-cn` folds into `trae`.
//
// dispatch_selectable: FALSE (G4b host-reachability fix, was true). An agents-file
// surface is a FILE the host reads at its own pace — there is no pane/process Guild
// spawns and dispatches a lane into, so "a lane can be dispatched here" is false by
// construction. The prior `true` was never backed by a HostKind member, a PaneAdapter,
// or a legacy hand-authored HOST_CAPABILITY_ROWS row for kiro/qoder/trae — confirmed
// unreachable through every dispatch surface (the audit finding this rollout closes).
// (DERIVED_HOST_CAPABILITY_ROWS now carries a row for every registry id, these
// included — but a capability row is not a dispatch surface; the conclusion stands.)
// ---------------------------------------------------------------------------

const KIRO_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "kiro",
  family: "agents",
  adapter_binding: "agents-file",
  surface_kind: "file",
  detection: {
    bin: null,
    requires_auth: false,
    auth_probe: "none",
    subcommand: null,
    marker: { config_dir: ".kiro", scope: "project", agents_placement: "AGENTS.md" },
  },
  installability: "target",
  result_adapter: false,
  // G4b (host-reachability audit): FLIPPED from true — an agents-file surface is a
  // FILE the host reads (root AGENTS.md), never a pane a lane can be dispatched into.
  // `dispatch_selectable:true` was a lie: no HostKind member, no PaneAdapter, no
  // legacy hand-authored HOST_CAPABILITY_ROWS row ever backed it (confirmed
  // unreachable through EVERY dispatch surface; the registry-DERIVED map now carries
  // a row per registry id, but a capability row is not a dispatch surface). The
  // honest column for a pane-less file surface is false.
  dispatch_selectable: false,
  capabilities: inferredCaps("kiro", "agents", "file"),
  provenance: "inferred",
};

const QODER_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "qoder",
  family: "agents",
  adapter_binding: "agents-file",
  surface_kind: "file",
  detection: {
    bin: null,
    requires_auth: false,
    auth_probe: "none",
    subcommand: null,
    marker: { config_dir: ".qoder", scope: "project", agents_placement: "AGENTS.md" },
  },
  installability: "target",
  result_adapter: false,
  // G4b: FLIPPED from true (see KIRO_ENTRY comment — agents-file is a file surface,
  // never a pane; dispatch_selectable:true was unreachable-through-every-surface).
  dispatch_selectable: false,
  capabilities: inferredCaps("qoder", "agents", "file"),
  provenance: "inferred",
};

const TRAE_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "trae",
  family: "agents",
  adapter_binding: "agents-file",
  surface_kind: "file",
  detection: {
    bin: null,
    requires_auth: false,
    auth_probe: "none",
    subcommand: null,
    marker: { config_dir: ".trae", scope: "project", agents_placement: "AGENTS.md" },
  },
  installability: "target",
  result_adapter: false,
  // G4b: FLIPPED from true (see KIRO_ENTRY comment — agents-file is a file surface,
  // never a pane; dispatch_selectable:true was unreachable-through-every-surface).
  dispatch_selectable: false,
  capabilities: inferredCaps("trae", "agents", "file"),
  provenance: "inferred",
};

/** The registry rows, keyed by host_id. The single design-time SoT for L7 (16 hosts). */
export const HOST_REGISTRY_ROWS: Record<HostId, HostRegistryEntry> = deepFreeze({
  "claude-code-cli": CLAUDE_ENTRY,
  "codex-cli": CODEX_ENTRY,
  "pi-cli": PI_ENTRY,
  "antigravity-cli": ANTIGRAVITY_ENTRY,
  "agents-file": AGENTS_FILE_ENTRY,
  "claude-code-app": CLAUDE_APP_ENTRY,
  "claude-code-web": CLAUDE_WEB_ENTRY,
  "codex-app": CODEX_APP_ENTRY,
  "claude-ai-connector": CLAUDE_AI_CONNECTOR_ENTRY,
  cursor: CURSOR_ENTRY,
  "github-copilot": GITHUB_COPILOT_ENTRY,
  opencode: OPENCODE_ENTRY,
  "rovo-dev": ROVO_DEV_ENTRY,
  kiro: KIRO_ENTRY,
  qoder: QODER_ENTRY,
  trae: TRAE_ENTRY,
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const HOST_ID_SET = new Set<string>(HOST_IDS);
const FAMILY_SET = new Set<string>(HOST_FAMILIES);
const INSTALLABILITY_SET = new Set<string>(["native", "target", "none"]);
const SURFACE_SET = new Set<string>(["cli", "app", "file"]);
// Auto-derives from the closed AUTH_PROBES union — no separate edit when a probe is added.
const AUTH_PROBE_SET = new Set<string>(AUTH_PROBES);
const ADAPTER_BINDING_SET = new Set<string>(["self", "agents-file"]);
const MARKER_SCOPE_SET = new Set<string>(["project", "home", "either"]);

/**
 * Validator for a `guild.host_registry.v1` entry. Checks the discriminator, the
 * id/family/surface enums, the three INDEPENDENT columns (each present + correctly
 * typed — the load-bearing invariant: the columns are NOT collapsed back into one
 * flag), and delegates the embedded capability row to `validateHostCapabilitiesV1`.
 * Never throws.
 */
export function validateHostRegistryEntry(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["host registry entry must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;

  if (o["schema_version"] !== "guild.host_registry.v1") {
    errors.push(
      `schema_version must be "guild.host_registry.v1"; got ${JSON.stringify(o["schema_version"])}`
    );
  }
  if (typeof o["host_id"] !== "string" || !HOST_ID_SET.has(o["host_id"] as string)) {
    errors.push(`host_id must be one of ${HOST_IDS.join("|")}; got ${JSON.stringify(o["host_id"])}`);
  }
  if (typeof o["family"] !== "string" || !FAMILY_SET.has(o["family"] as string)) {
    errors.push(`family must be one of ${HOST_FAMILIES.join("|")}; got ${JSON.stringify(o["family"])}`);
  }
  if (typeof o["surface_kind"] !== "string" || !SURFACE_SET.has(o["surface_kind"] as string)) {
    errors.push(`surface_kind must be cli|app|file; got ${JSON.stringify(o["surface_kind"])}`);
  }

  // detection block
  const det = o["detection"];
  if (typeof det !== "object" || det === null || Array.isArray(det)) {
    errors.push("detection must be a present object");
  } else {
    const d = det as Record<string, unknown>;
    if (!(d["bin"] === null || typeof d["bin"] === "string")) {
      errors.push("detection.bin must be a string or null");
    }
    if (typeof d["requires_auth"] !== "boolean") {
      errors.push("detection.requires_auth must be a boolean");
    }
    if (typeof d["auth_probe"] !== "string" || !AUTH_PROBE_SET.has(d["auth_probe"] as string)) {
      errors.push(`detection.auth_probe must be one of ${[...AUTH_PROBE_SET].join("|")}; got ${JSON.stringify(d["auth_probe"])}`);
    }
    // ADDITIVE OPTIONAL: subcommand — checked only when present (existing rows omit it).
    if ("subcommand" in d && !(d["subcommand"] === null || typeof d["subcommand"] === "string")) {
      errors.push("detection.subcommand must be a string or null when present");
    }
    // ADDITIVE OPTIONAL: marker — the file/IDE detection recipe; checked only when present.
    if ("marker" in d && d["marker"] !== null && d["marker"] !== undefined) {
      const m = d["marker"];
      if (typeof m !== "object" || Array.isArray(m)) {
        errors.push("detection.marker must be an object or null");
      } else {
        const mo = m as Record<string, unknown>;
        if (typeof mo["config_dir"] !== "string" || mo["config_dir"].length === 0) {
          errors.push("detection.marker.config_dir must be a non-empty string");
        }
        if (typeof mo["scope"] !== "string" || !MARKER_SCOPE_SET.has(mo["scope"] as string)) {
          errors.push(`detection.marker.scope must be project|home|either; got ${JSON.stringify(mo["scope"])}`);
        }
        if (typeof mo["agents_placement"] !== "string" || mo["agents_placement"].length === 0) {
          errors.push("detection.marker.agents_placement must be a non-empty string");
        }
      }
    }
  }

  // The three INDEPENDENT columns — each must be present + its own type.
  if (typeof o["installability"] !== "string" || !INSTALLABILITY_SET.has(o["installability"] as string)) {
    errors.push(`installability must be native|target|none; got ${JSON.stringify(o["installability"])}`);
  }
  if (typeof o["result_adapter"] !== "boolean") {
    errors.push(`result_adapter must be a boolean (independent column); got ${JSON.stringify(o["result_adapter"])}`);
  }
  if (typeof o["dispatch_selectable"] !== "boolean") {
    errors.push(`dispatch_selectable must be a boolean (independent column); got ${JSON.stringify(o["dispatch_selectable"])}`);
  }

  if (o["provenance"] !== "verified" && o["provenance"] !== "inferred") {
    errors.push(`provenance must be "verified" or "inferred"; got ${JSON.stringify(o["provenance"])}`);
  }

  // ── adapter_binding + AC-REG-4 (L0 ADR §3.1) ────────────────────────────────
  // AC-REG-4: a supported host MUST carry a valid adapter_binding, and an IDE row that
  // DEREFERENCES the universal agents-file adapter must NOT masquerade as its own
  // per-host adapter (R2 — no second support system, no hidden per-host chain).
  const binding = o["adapter_binding"];
  if (typeof binding !== "string" || !ADAPTER_BINDING_SET.has(binding)) {
    // A supported host (installability !== "none") that lacks a legal adapter_binding fails.
    errors.push(`adapter_binding must be self|agents-file; got ${JSON.stringify(binding)}`);
  } else if (binding === "agents-file") {
    // The IDE dereference contract: file surface, no CLI binary (excluded from PATH
    // auto-detect, AC-INS-3), detected by a marker recipe, and NOT claiming a per-host
    // result adapter. Any of these being wrong means the row would spawn a parallel
    // chain instead of binding the shared agents-file adapter.
    if (o["surface_kind"] !== "file") {
      errors.push(
        `adapter_binding "agents-file" requires surface_kind "file"; got ${JSON.stringify(o["surface_kind"])}`
      );
    }
    if (typeof det === "object" && det !== null && !Array.isArray(det)) {
      const d = det as Record<string, unknown>;
      if (d["bin"] !== null) {
        errors.push(`adapter_binding "agents-file" requires detection.bin null (file surface); got ${JSON.stringify(d["bin"])}`);
      }
      if (d["marker"] === null || d["marker"] === undefined) {
        errors.push('adapter_binding "agents-file" requires a detection.marker recipe (how the IDE is detected)');
      }
    }
    if (o["result_adapter"] !== false) {
      errors.push('adapter_binding "agents-file" must not carry a per-host result_adapter (AC-REG-4 / R2)');
    }
  }

  // Embedded capability row — delegate to the P0 validator.
  const caps = o["capabilities"];
  const capsResult = validateHostCapabilitiesV1(caps);
  if (!capsResult.valid) {
    for (const e of capsResult.errors) errors.push(`capabilities.${e}`);
  }

  // Cross-field invariant: the embedded capability row's surface_kind must equal the
  // registry entry's top-level surface_kind — otherwise a `.agents` (file) row could
  // carry a "cli" caps surface and pass validation (codex G-lane finding).
  if (
    typeof caps === "object" &&
    caps !== null &&
    !Array.isArray(caps) &&
    typeof o["surface_kind"] === "string"
  ) {
    const capsSurface = (caps as Record<string, unknown>)["surface_kind"];
    if (capsSurface !== o["surface_kind"]) {
      errors.push(
        `surface_kind mismatch: top-level ${JSON.stringify(o["surface_kind"])} !== capabilities.surface_kind ${JSON.stringify(capsSurface)}`
      );
    }
  }

  // CODEX-REVIEW FIX (S6 round 1, HIGH-2): the structural injection invariant is
  // CROSS-FIELD, so it can only be checked HERE — `validateHostCapabilitiesV1` sees
  // the capabilities object alone and never sees `dispatch_selectable`. Without
  // this, a row with `dispatch_selectable: false` but `"target"`/`"prompt_text"`
  // injection facts passed both validators while violating the rule outright.
  //
  // The invariant, in one place: a pane-less surface has nothing to inject INTO
  // (⇒ `absent`, `none`), and a dispatchable surface is never structurally absent.
  {
    const caps = o["capabilities"];
    const selectable = o["dispatch_selectable"];
    if (
      typeof selectable === "boolean" &&
      typeof caps === "object" &&
      caps !== null &&
      !Array.isArray(caps)
    ) {
      const inj = (caps as Record<string, unknown>)["injection"];
      if (typeof inj === "object" && inj !== null && !Array.isArray(inj)) {
        const i = inj as Record<string, unknown>;
        const supports = [
          "definition_injection_support",
          "skill_bundle_injection_support",
          "dynamic_registration_support",
        ] as const;
        if (!selectable) {
          for (const k of supports) {
            if (i[k] !== "absent") {
              errors.push(
                `dispatch_selectable is false but injection.${k} is ${JSON.stringify(i[k])} — ` +
                  `a host with no dispatch surface has nothing to inject into (must be "absent")`
              );
            }
          }
          if (i["fallback"] !== "none") {
            errors.push(
              `dispatch_selectable is false but injection.fallback is ` +
                `${JSON.stringify(i["fallback"])} — there is no lane to fall back to (must be "none")`
            );
          }
        } else if (i["definition_injection_support"] === "absent") {
          errors.push(
            "dispatch_selectable is true but injection.definition_injection_support is " +
              '"absent" — a dispatchable surface is never structurally absent'
          );
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to HostRegistryEntry after passing validation. */
export function isHostRegistryEntry(value: unknown): value is HostRegistryEntry {
  return validateHostRegistryEntry(value).valid;
}
