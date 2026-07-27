/**
 * src/modules/host-runtime/workflows/host-capabilities-schema.ts
 *
 * L0 FOUNDATION — `guild.host_capabilities.v1` capability-matrix row: the TS type
 * mirroring the ADR §Capability Matrix YAML, plus the two authored rows for
 * Phase 1 wrapper/package runtime rows.
 *
 * Contract authority (SoT):
 *   ADR: universal-host-plugin-architecture (workspace wiki) §Capability Matrix
 *   ADR: guild-inventory-and-parity-contracts (workspace wiki) (this lane's ADR)
 *
 * WHY: "Routing uses these booleans, not assumptions" (ADR). Every host advertises
 * a normalized capability row; routing/degradation read the row, never the host
 * NAME. A capability the host cannot advertise must degrade through an explicit
 * chain and record the loss (minimum-loss rule: native > wrapped > bridged >
 * emulated > degraded).
 *
 * CONTRACT: pure types + a `validateHostCapabilitiesV1()` validator + two frozen
 * row constants. No I/O, no clock, never throws. (Probed runtime rows land at
 * `.guild/hosts/<host-id>/capability.json` — a later phase; these static rows are
 * the Phase-1 design-time truth for generated package wrapper launches.)
 *
 * SCOPE NOTE (Phase 1): the CLAUDE row is verbatim from the ADR (authoritative).
 * The CODEX row is authored from verified plugin facts (per-host-packaging.ts
 * render-or-degrade behavior) plus Codex-CLI knowledge. Values NOT verified on a
 * live Codex box are marked `// INFERRED` — L2 (codex render) / L3 (codex wrapper)
 * confirm them against the real host before relying on the permission/launch rows.
 *
 * Owned by plugin-architect (L0); consumed by L2 (render), L3 (wrapper), L6 (tests).
 */

// ---------------------------------------------------------------------------
// Row type (mirrors the ADR §Capability Matrix YAML)
// ---------------------------------------------------------------------------

export interface PackageCaps {
  /**
   * Machine-readable install state — routing consumes THIS boolean, not comments.
   * `true` only when an install is actually proven for the host; a host whose
   * renderer exists but is unproven is `false` until its install acceptance
   * criterion passes (see `installability`).
   */
  installable: boolean;
  /**
   * Why `installable` holds its value:
   *   - "verified": a real install path is proven (e.g. Claude today).
   *   - "target":   a renderer exists but install is NOT yet proven; flips to
   *                 "verified" (and `installable` to true) when its AC passes
   *                 (Codex → SC-3). Routing may render a "target" package but must
   *                 not present it as installable.
   */
  installability: "verified" | "target";
  /** Host-native package format id (e.g. "claude-plugin", "codex-plugin"). */
  manifest_format: string;
  /**
   * plugin-update-lifecycle AC-7 (multi-host honesty): how an install of this
   * host detects and applies updates. A host without an apply path carries
   * apply:"none" and DEGRADES TO NOTIFY — the loss is this recorded row, and
   * no host is ever claimed auto-updatable without a real mechanism.
   */
  update: UpdateCaps;
}

export interface UpdateCaps {
  /**
   * Staleness-detection source: "marketplace_clone" (the host's own plugin
   * clone names the channel/SHA — Claude), "receipt" (guild.install_receipt.v1
   * written by install.sh — wrapper + file surfaces), or "none" (refused
   * app/connector surfaces; nothing installable to check).
   */
  check: "marketplace_clone" | "receipt" | "none";
  /**
   * The apply path: "marketplace_cli" (headless host plugin manager),
   * "self_update" (Guild-owned `guild-run update` re-render + staged swap),
   * "reinstall_command" (`install.sh --update`; notify + one command, no
   * daemon), or "none" (degrade to notify-only prose per AC-7).
   */
  apply: "marketplace_cli" | "self_update" | "reinstall_command" | "none";
  /** The exact one-command apply string surfaced in signals (AC-3); null iff apply is "none". */
  command: string | null;
  /**
   * True only where an IMPLEMENTED automatic apply exists TODAY (something
   * actually acts on defaults.update.mode=auto — currently the Claude
   * SessionStart hook's staged marketplace update). A mechanism that exists
   * but is only operator-invoked (guild-run update) is NOT auto_capable —
   * two-field honesty: capability rows never claim beyond implemented
   * behavior. Flips per host when its auto path ships.
   */
  auto_capable: boolean;
}

/** Canonical apply commands (AC-3: signals must name the EXACT command). */
export const UPDATE_COMMANDS = {
  marketplace_cli: "claude plugin marketplace update guild && claude plugin update guild@guild",
  self_update: "guild-run update",
  reinstall_command: "curl -fsSL https://guildstack.dev/install.sh | bash -s -- --update",
} as const;

export interface BootstrapCaps {
  /**
   * How startup context is injected. Claude: "hookSpecificOutput.additionalContext".
   * Codex (no native hook injection): "instruction_file" (AGENTS.md / wrapper-injected).
   */
  context_injection: string;
  /** Host autoloads skill files natively. */
  skill_autoload: boolean;
  /** Host transforms the prompt/first message for bootstrap. */
  prompt_transform: boolean;
  /** Bootstrap can be injected via the generated wrapper. */
  wrapper_injection: boolean;
}

export interface CommandsCaps {
  /** Native slash-command surface. */
  slash_commands: boolean;
  /**
   * Command file format the host consumes natively:
   *   "markdown" (Claude .md), "toml" (the format the sunset Gemini host used),
   *   "none" (Codex → workflow descriptors).
   */
  command_files: "markdown" | "toml" | "none";
}

export interface SkillsCaps {
  native_skills: boolean;
  /** Directory the host loads skills from, or null if unsupported. */
  skill_dir: string | null;
}

export interface AgentsCaps {
  native_agents: boolean;
  /** Agent definition format ("claude-md"), or null if unsupported. */
  agent_format: string | null;
}

/**
 * One boolean per normalized Guild hook event. The field set covers EVERY event
 * the live Claude hook package (hooks/hooks.json) binds — not just the five the
 * parent-ADR YAML sampled — so L5/L6 never have to guess how an event is
 * advertised or degraded. A host that lacks an event sets it false; degradation
 * routes through the HookEmitter (parent ADR Surface 3).
 */
export interface HooksCaps {
  session_start: boolean;
  user_prompt_submit: boolean;
  pre_tool_use: boolean;
  post_tool_use: boolean;
  stop: boolean;
  pre_compact: boolean;
  subagent_stop: boolean;
  task_created: boolean;
  task_completed: boolean;
  teammate_idle: boolean;
}

export interface PermissionsCaps {
  deny: boolean;
  ask: boolean;
  /** Layer at which ask-gating fires (e.g. "pre_tool_use"), or null. */
  ask_mode: string | null;
  accept_edits_without_prompt: boolean;
  auto_approve_tools: boolean;
  bypass_prompts: boolean;
  bypass_sandbox: boolean;
  permission_prompt_layer: boolean;
  /**
   * Host launch-flag recipes per Guild permission mode. Each maps a mode to the
   * argv the wrapper appends. A mode the host cannot express is omitted (its
   * absence is the degradation signal — AC20: record a lower-autonomy fallback,
   * never falsely claim a mode the host lacks).
   */
  launch_modes: Partial<Record<PermissionMode, string[]>>;
}

export type PermissionMode =
  | "read_only"
  | "ask"
  | "accept_edits"
  | "auto"
  | "bypass_all";

export interface DispatchCaps {
  tmux_processes: boolean;
  plain_processes: boolean;
  independent_agents: boolean;
  subagents: boolean;
  inline: boolean;
}

export interface InteractionCaps {
  native_questions: boolean;
  terminal_prompt: boolean;
  file_bus_questions: boolean;
}

export interface SessionsCaps {
  continue: boolean;
  resume_by_id: boolean;
  fork: boolean;
}

export interface StructuredOutputCaps {
  native_json: boolean;
  schema_validation: boolean;
  repair_prompt: boolean;
}

export interface ArtifactsCaps {
  direct_filesystem: boolean;
  file_bus: boolean;
  app_upload: boolean;
}

/** Per-tool substrate: how strong the host's path to each tool capability is. */
export type ToolStrength = "native" | "bridge" | "emulated" | "none";

export interface ToolsCaps {
  read: ToolStrength;
  search: ToolStrength;
  shell: ToolStrength;
  edit: ToolStrength;
  write: ToolStrength;
  browser: ToolStrength;
  web: ToolStrength;
  mcp: ToolStrength;
}

export interface McpCaps {
  stdio: boolean;
  http: boolean;
}

/** Model tier → host-native model id (null when the host has no model at that tier). */
export interface ModelTierEntry {
  model: string | null;
}

export interface ModelsCaps {
  cheap: ModelTierEntry;
  mid: ModelTierEntry;
  powerful: ModelTierEntry;
}

export interface GuildHostCapabilitiesV1 {
  schema_version: "guild.host_capabilities.v1";
  /** Concrete host id (e.g. "claude", "codex"). */
  host_kind: string;
  /** Host family for independence checks (e.g. "claude", "codex"). Same-family review is weak. */
  family: string;
  /** Surface kind (e.g. "cli", "app", "desktop"). */
  surface_kind: string;
  package: PackageCaps;
  bootstrap: BootstrapCaps;
  commands: CommandsCaps;
  skills: SkillsCaps;
  agents: AgentsCaps;
  hooks: HooksCaps;
  permissions: PermissionsCaps;
  dispatch: DispatchCaps;
  interaction: InteractionCaps;
  sessions: SessionsCaps;
  structured_output: StructuredOutputCaps;
  artifacts: ArtifactsCaps;
  tools: ToolsCaps;
  mcp: McpCaps;
  models: ModelsCaps;
}

// ---------------------------------------------------------------------------
// CLAUDE row — verbatim from the ADR §Capability Matrix (authoritative)
// ---------------------------------------------------------------------------

export const CLAUDE_CAPABILITIES: GuildHostCapabilitiesV1 = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "claude",
  family: "claude",
  surface_kind: "cli",
  package: {
    installable: true,
    installability: "verified",
    manifest_format: "claude-plugin",
    update: { check: "marketplace_clone", apply: "marketplace_cli", command: UPDATE_COMMANDS.marketplace_cli, auto_capable: true },
  },
  bootstrap: {
    context_injection: "hookSpecificOutput.additionalContext",
    skill_autoload: true,
    prompt_transform: false,
    wrapper_injection: true,
  },
  commands: { slash_commands: true, command_files: "markdown" },
  skills: { native_skills: true, skill_dir: ".claude/skills" },
  agents: { native_agents: true, agent_format: "claude-md" },
  hooks: {
    // All ten events are bound in the live hooks/hooks.json (verified).
    session_start: true,
    user_prompt_submit: true,
    pre_tool_use: true,
    post_tool_use: true,
    stop: true,
    pre_compact: true,
    subagent_stop: true,
    task_created: true,
    task_completed: true,
    teammate_idle: true,
  },
  permissions: {
    deny: true,
    ask: true,
    ask_mode: "pre_tool_use",
    accept_edits_without_prompt: true,
    auto_approve_tools: true,
    bypass_prompts: true,
    bypass_sandbox: false,
    permission_prompt_layer: true,
    launch_modes: {
      read_only: ["--tools", "Read,Grep,Glob"],
      ask: ["--permission-mode", "default"],
      accept_edits: ["--permission-mode", "acceptEdits"],
      auto: ["--permission-mode", "auto"],
      bypass_all: ["--permission-mode", "bypassPermissions"],
    },
  },
  dispatch: {
    tmux_processes: true,
    plain_processes: true,
    independent_agents: true,
    subagents: true,
    inline: true,
  },
  interaction: {
    native_questions: true,
    terminal_prompt: true,
    file_bus_questions: true,
  },
  sessions: { continue: true, resume_by_id: true, fork: true },
  structured_output: {
    native_json: true,
    schema_validation: true,
    repair_prompt: true,
  },
  artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
  tools: {
    read: "native",
    search: "native",
    shell: "native",
    edit: "native",
    write: "native",
    browser: "bridge",
    web: "native",
    mcp: "native",
  },
  mcp: { stdio: true, http: false },
  models: {
    cheap: { model: "haiku" },
    mid: { model: "sonnet" },
    powerful: { model: "opus" },
  },
};

// ---------------------------------------------------------------------------
// CODEX row — authored from verified plugin facts + Codex-CLI knowledge.
// Values not verified on a live Codex box are marked `// INFERRED` — L2/L3 confirm.
// ---------------------------------------------------------------------------

export const CODEX_CAPABILITIES: GuildHostCapabilitiesV1 = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "codex",
  family: "codex",
  surface_kind: "cli",
  // installable:false is the honest MACHINE state — the Codex renderer exists but
  // per-host-packaging.ts marks it DORMANT; a non-Claude render must not be treated
  // as installable until proven. installability:"target" records that the renderer
  // exists; both flip to verified/true at SC-3 (real Codex install + bootstrap).
  package: {
    installable: false,
    installability: "target",
    manifest_format: "codex-plugin",
    update: { check: "receipt", apply: "self_update", command: UPDATE_COMMANDS.self_update, auto_capable: false },
  },
  bootstrap: {
    // Codex has no hookSpecificOutput injection; bootstrap rides an instruction
    // file (AGENTS.md) / the generated wrapper (ADR P0: Codex "plugin-or-skill").
    context_injection: "instruction_file",
    skill_autoload: false, // Verified: Codex has no native skill dir (per-host-packaging flags skills unsupported).
    prompt_transform: false, // INFERRED
    wrapper_injection: true, // The generated guild-run wrapper injects bootstrap.
  },
  commands: {
    // Verified: Codex has no .md slash-command format; commands render as workflow descriptors.
    slash_commands: false,
    command_files: "none",
  },
  skills: { native_skills: false, skill_dir: null }, // Verified (per-host-packaging).
  agents: { native_agents: false, agent_format: null }, // Verified (per-host-packaging flags agents unsupported).
  hooks: {
    // Verified-by-design: Codex hook taxonomy differs from Claude; no native
    // Claude-equivalent hooks. All degrade through the HookEmitter (ADR Surface 3).
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
    // INFERRED (Codex CLI approval model). Confirm on-box at L3.
    deny: false,
    ask: true, // Codex prompts for approval by default.
    ask_mode: null, // No pre_tool_use layer; approval is interactive.
    accept_edits_without_prompt: false, // INFERRED
    auto_approve_tools: false, // INFERRED
    bypass_prompts: true, // Codex YOLO / --dangerously-bypass exists (AC19).
    bypass_sandbox: true, // INFERRED — YOLO bypasses the sandbox.
    permission_prompt_layer: false, // INFERRED
    launch_modes: {
      // INFERRED — only bypass_all has a well-known Codex flag today. ask/auto/
      // accept_edits/read_only recipes are confirmed at L3; OMITTED here rather
      // than guessed, so their absence reads as "degrade/record", not "supported".
      bypass_all: ["--dangerously-bypass-approvals-and-sandbox"], // INFERRED flag name — verify on-box (AC19).
    },
  },
  dispatch: {
    tmux_processes: true, // Codex is a CLI process — tmux panes work.
    plain_processes: true,
    independent_agents: false, // INFERRED — no native agent-team primitive.
    subagents: false, // INFERRED
    inline: true,
  },
  interaction: {
    native_questions: false, // INFERRED — no AskUserQuestion equivalent; use terminal/file-bus.
    terminal_prompt: true,
    file_bus_questions: true, // Guild file-bus approval works on any FS host.
  },
  sessions: {
    continue: true, // INFERRED — Codex has session continuation.
    resume_by_id: true, // INFERRED
    fork: false, // INFERRED
  },
  structured_output: {
    native_json: false, // INFERRED — no guaranteed native JSON mode; use fenced-block + repair.
    schema_validation: false, // Guild-side validation (validateHandoffV2) instead.
    repair_prompt: true, // Bounded repair prompt is the fallback (ADR §Result contracts).
  },
  artifacts: { direct_filesystem: true, file_bus: true, app_upload: false },
  tools: {
    read: "native",
    search: "native",
    shell: "native",
    edit: "native",
    write: "native",
    browser: "none", // INFERRED — no native browser; record fallback (AC29).
    web: "emulated", // INFERRED
    mcp: "native", // Codex supports stdio MCP.
  },
  mcp: { stdio: true, http: false }, // Verified: Codex supports stdio MCP only (per-host-packaging flags HTTP unsupported).
  models: {
    // Codex model ids are host-specific and not pinned in this repo yet; null =
    // "no Guild-mapped model at this tier" (settings models.tiers.codex is null today).
    cheap: { model: null },
    mid: { model: null },
    powerful: { model: null },
  },
};

// ---------------------------------------------------------------------------
// Shared no-hooks constant (consumed by AGENTS_FILE_CAPABILITIES below — the
// hand-authored PI_CAPABILITIES/ANTIGRAVITY_CAPABILITIES rows that used to
// share this section, plus their TARGET_CLI_COMMON base, were retired: no live
// consumer indexed them once guild-run-wrapper.ts/permission-policy.ts moved to
// host-registry.ts's registry-derived DERIVED_HOST_CAPABILITY_ROWS)
// ---------------------------------------------------------------------------

const NO_HOOKS: HooksCaps = {
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
};

export const AGENTS_FILE_CAPABILITIES: GuildHostCapabilitiesV1 = {
  schema_version: "guild.host_capabilities.v1",
  host_kind: "agents-file",
  family: "agents",
  surface_kind: "file",
  package: {
    installable: false,
    installability: "target",
    manifest_format: "agents-file",
    update: { check: "receipt", apply: "reinstall_command", command: UPDATE_COMMANDS.reinstall_command, auto_capable: false },
  },
  bootstrap: {
    context_injection: "instruction_file",
    skill_autoload: false,
    prompt_transform: false,
    wrapper_injection: true,
  },
  commands: { slash_commands: false, command_files: "none" },
  skills: { native_skills: false, skill_dir: ".agents/skills/guild" },
  agents: { native_agents: false, agent_format: null },
  hooks: NO_HOOKS,
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
    tmux_processes: false,
    plain_processes: false,
    independent_agents: false,
    subagents: false,
    inline: false,
  },
  interaction: {
    native_questions: false,
    terminal_prompt: false,
    file_bus_questions: true,
  },
  sessions: { continue: false, resume_by_id: false, fork: false },
  structured_output: {
    native_json: false,
    schema_validation: false,
    repair_prompt: true,
  },
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
  models: {
    cheap: { model: null },
    mid: { model: null },
    powerful: { model: null },
  },
};

// The Phase-1 convenience registry that used to live here (`HOST_CAPABILITY_ROWS`,
// keyed by host_kind: claude/codex/agents-file/pi/antigravity/antigravity-2) has
// been RETIRED (G4b host-reachability fix): it never carried the 4 wrapped-CLI
// hosts (cursor/github-copilot/opencode/rovo-dev) added to the registry, and its
// hand-authored pi/antigravity rows had drifted from the registry's own
// on-host-VERIFIED overrides — the "two diverged capability truths" audit
// finding. `host-registry.ts`'s `DERIVED_HOST_CAPABILITY_ROWS` is
// registry-derived, covers all 16 registry ids + the same legacy aliases, and
// is what guild-run-wrapper.ts and permission-policy.ts consume today. This
// file's `CLAUDE_CAPABILITIES`/`CODEX_CAPABILITIES`/`AGENTS_FILE_CAPABILITIES`
// constants remain — they're the frozen feedstock host-registry-schema.ts
// builds its own rows from.

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const TOOL_STRENGTHS = new Set<string>(["native", "bridge", "emulated", "none"]);

/** The ten hook events every capability row must advertise (matches HooksCaps). */
export const REQUIRED_HOOK_EVENTS = [
  "session_start",
  "user_prompt_submit",
  "pre_tool_use",
  "post_tool_use",
  "stop",
  "pre_compact",
  "subagent_stop",
  "task_created",
  "task_completed",
  "teammate_idle",
] as const;

/**
 * Validator for a `guild.host_capabilities.v1` row. Checks the discriminator,
 * the identity strings, and the presence + types of the required capability
 * blocks. Deep per-boolean validation is intentionally light — the row is large
 * and additive; the load-bearing invariants are: discriminator correct, identity
 * present, every top-level block present and an object, tool strengths in range.
 * Never throws.
 */
export function validateHostCapabilitiesV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["capability row must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;

  if (o["schema_version"] !== "guild.host_capabilities.v1") {
    errors.push(
      `schema_version must be "guild.host_capabilities.v1"; got ${JSON.stringify(o["schema_version"])}`
    );
  }
  for (const k of ["host_kind", "family", "surface_kind"]) {
    if (typeof o[k] !== "string" || (o[k] as string).trim() === "") {
      errors.push(`${k} must be a non-empty string`);
    }
  }
  const requiredBlocks = [
    "package",
    "bootstrap",
    "commands",
    "skills",
    "agents",
    "hooks",
    "permissions",
    "dispatch",
    "interaction",
    "sessions",
    "structured_output",
    "artifacts",
    "tools",
    "mcp",
    "models",
  ];
  for (const b of requiredBlocks) {
    const block = o[b];
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      errors.push(`${b} must be a present object`);
    }
  }

  // tools strengths must be in range (the one enum-y block routing depends on hard)
  const tools = o["tools"];
  if (typeof tools === "object" && tools !== null && !Array.isArray(tools)) {
    for (const [tk, tv] of Object.entries(tools as Record<string, unknown>)) {
      if (typeof tv !== "string" || !TOOL_STRENGTHS.has(tv)) {
        errors.push(`tools.${tk} must be one of native|bridge|emulated|none; got ${JSON.stringify(tv)}`);
      }
    }
  }

  // hooks: EVERY one of the ten events must be present and boolean. A probed row
  // that omits an event (e.g. pre_compact) would otherwise pass and reintroduce
  // the "downstream lane guesses hook support" gap.
  const hooks = o["hooks"];
  if (typeof hooks === "object" && hooks !== null && !Array.isArray(hooks)) {
    const h = hooks as Record<string, unknown>;
    for (const ev of REQUIRED_HOOK_EVENTS) {
      if (typeof h[ev] !== "boolean") {
        errors.push(`hooks.${ev} must be present and boolean (probed rows must advertise every event); got ${JSON.stringify(h[ev])}`);
      }
    }
  }

  // package.installability is a machine-readable routing signal — validate its enum.
  const pkg = o["package"];
  if (typeof pkg === "object" && pkg !== null && !Array.isArray(pkg)) {
    const inst = (pkg as Record<string, unknown>)["installability"];
    if (inst !== "verified" && inst !== "target") {
      errors.push(`package.installability must be "verified" or "target"; got ${JSON.stringify(inst)}`);
    }
    if (typeof (pkg as Record<string, unknown>)["installable"] !== "boolean") {
      errors.push("package.installable must be a boolean");
    }
    // AC-7: the update capability row is REQUIRED and internally coherent —
    // a row that validates without it would be a claimed-but-absent capability.
    const upd = (pkg as Record<string, unknown>)["update"];
    if (typeof upd !== "object" || upd === null || Array.isArray(upd)) {
      errors.push("package.update is required (AC-7 update capability row)");
    } else {
      const u = upd as Record<string, unknown>;
      if (u["check"] !== "marketplace_clone" && u["check"] !== "receipt" && u["check"] !== "none") {
        errors.push(`package.update.check must be "marketplace_clone" | "receipt" | "none"; got ${JSON.stringify(u["check"])}`);
      }
      const apply = u["apply"];
      if (apply !== "marketplace_cli" && apply !== "self_update" && apply !== "reinstall_command" && apply !== "none") {
        errors.push(`package.update.apply must be "marketplace_cli" | "self_update" | "reinstall_command" | "none"; got ${JSON.stringify(apply)}`);
      }
      if (apply === "none") {
        if (u["command"] !== null) errors.push("package.update.command must be null when apply is \"none\"");
        if (u["auto_capable"] !== false) errors.push("package.update.auto_capable must be false when apply is \"none\"");
        if (u["check"] !== "none") errors.push("package.update.check must be \"none\" when apply is \"none\"");
      } else if (typeof u["command"] !== "string" || (u["command"] as string).length === 0) {
        errors.push("package.update.command must be a non-empty string when an apply path exists");
      }
      if (typeof u["auto_capable"] !== "boolean") {
        errors.push("package.update.auto_capable must be a boolean");
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to GuildHostCapabilitiesV1 after passing validation. */
export function isHostCapabilitiesV1(value: unknown): value is GuildHostCapabilitiesV1 {
  return validateHostCapabilitiesV1(value).valid;
}
