/**
 * scripts/lib/host-registry-schema.ts
 *
 * P1-L0 FOUNDATION — `guild.host_registry.v1`: the single-source-of-truth SCHEMA
 * for host identity, detection, and the **independent capability columns**, wrapping
 * the existing P0 `guild.host_capabilities.v1` row.
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §Capability Matrix
 *   docs/knowledge/decisions/universal-host-p1-l0-foundation-contracts.md (this lane's ADR-addendum)
 *   .guild/plan/universal-host-p1.md §"Foundation-contract specifications" (G-plan codex-gated, 3 rounds)
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

import {
  GuildHostCapabilitiesV1,
  validateHostCapabilitiesV1,
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
export const HOST_IDS = [
  "claude-code-cli",
  "codex-cli",
  "pi-cli",
  "antigravity-cli",
  "agents-file",
  "claude-code-app",
  "claude-code-web",
  "codex-app",
  "claude-ai-connector",
] as const;
export type HostId = (typeof HOST_IDS)[number];

/** Host families for the independence axis (adversarial different-family rule). */
export const HOST_FAMILIES = ["claude", "codex", "agents", "pi", "antigravity"] as const;
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
 * Detection metadata — how the registry recognizes the host on a box. Replaces the
 * scattered probe knowledge in provider-detect.ts (ProviderSpec.bin/requiresAuth).
 */
export interface HostDetection {
  /** CLI binary probed on PATH, or null for a non-CLI surface (e.g. `.agents` file target). */
  bin: string | null;
  /** Selectability additionally requires a passing auth probe. */
  requires_auth: boolean;
  /**
   * Named auth-probe recipe the detector runs (kept as a token so the runtime
   * registry — L7 — binds it to the real probe; L0 does not shell out).
   *   - "codex_stored_or_env": ~/.codex/auth.json non-empty OR $OPENAI_API_KEY (the
   *                            verified codex recipe — never env-only, avoids the
   *                            stored-creds false-negative).
   *   - "none":                no auth needed (host provider / detect-only).
   */
  auth_probe: "codex_stored_or_env" | "none";
}

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
  surface_kind: "cli" | "app" | "file" = "cli"
): GuildHostCapabilitiesV1 {
  return {
    schema_version: "guild.host_capabilities.v1",
    host_kind,
    family,
    // Must equal the registry entry's top-level surface_kind (cross-field invariant,
    // enforced by validateHostRegistryEntry). `.agents` is a file surface, not cli.
    surface_kind,
    package: { installable: false, installability: "target", manifest_format: `${host_kind}-package` },
    bootstrap: {
      context_injection: "instruction_file",
      skill_autoload: false,
      prompt_transform: false,
      wrapper_injection: true,
    },
    commands: { slash_commands: false, command_files: "none" },
    skills: { native_skills: false, skill_dir: null },
    agents: { native_agents: false, agent_format: null },
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
  // `agents-file` is the universal AGENTS.md package target — a FILE surface, not a CLI.
  surface_kind: "file",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "target",
  result_adapter: false, // INFERRED — no cross-review adapter; verify at live-host availability.
  dispatch_selectable: true, // INFERRED — a host consuming AGENTS.md can run a lane.
  capabilities: inferredCaps("agents-file", "agents", "file"), // file surface — matches top-level surface_kind.
  provenance: "inferred",
};

const PI_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "pi-cli",
  family: "pi",
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
  },
  provenance: "verified", // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
};

const ANTIGRAVITY_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "antigravity-cli",
  family: "antigravity",
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
    },
  },
  provenance: "verified", // 3 columns + detection live-checked; browser rung still INFERRED (adapter-fallback-ladders INFERRED_HOSTS).
};

const CLAUDE_APP_ENTRY: HostRegistryEntry = {
  schema_version: "guild.host_registry.v1",
  host_id: "claude-code-app",
  family: "claude",
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
  surface_kind: "app",
  detection: { bin: null, requires_auth: false, auth_probe: "none" },
  installability: "none",
  result_adapter: false,
  dispatch_selectable: false,
  capabilities: inferredCaps("claude-ai-connector", "claude", "app"),
  provenance: "inferred",
};

/** The Phase-1 registry rows, keyed by host_id. The single design-time SoT for L7. */
export const HOST_REGISTRY_ROWS: Record<HostId, HostRegistryEntry> = {
  "claude-code-cli": CLAUDE_ENTRY,
  "codex-cli": CODEX_ENTRY,
  "pi-cli": PI_ENTRY,
  "antigravity-cli": ANTIGRAVITY_ENTRY,
  "agents-file": AGENTS_FILE_ENTRY,
  "claude-code-app": CLAUDE_APP_ENTRY,
  "claude-code-web": CLAUDE_WEB_ENTRY,
  "codex-app": CODEX_APP_ENTRY,
  "claude-ai-connector": CLAUDE_AI_CONNECTOR_ENTRY,
};

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
const AUTH_PROBE_SET = new Set<string>(["codex_stored_or_env", "none"]);

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
      errors.push(`detection.auth_probe must be codex_stored_or_env|none; got ${JSON.stringify(d["auth_probe"])}`);
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

  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to HostRegistryEntry after passing validation. */
export function isHostRegistryEntry(value: unknown): value is HostRegistryEntry {
  return validateHostRegistryEntry(value).valid;
}
