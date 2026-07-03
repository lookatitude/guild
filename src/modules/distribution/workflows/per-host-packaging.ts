/**
 * src/modules/distribution/workflows/per-host-packaging.ts
 *
 * Surface 1 of the host-adapter contract — per-host packaging renderers.
 * Contract (BY POINTER) — the retired `docs/knowledge/` store was harvested into the
 * canonical wiki (workspace-v2-compliance, 2026-06-27):
 *   .guild/wiki/decisions/host-adapter-contract.md §Decision 1 / Surface 1 (Packaging)
 *   .guild/wiki/decisions/verified-multi-host-support.md (the L0 ADR — §4.2 renderer base)
 * Distribution doc (BY POINTER): docs/v2/16-host-adapter-migration-spec.md,
 *   docs/v2/15-distribution.md §Per-host packaging
 *
 * Status: [v2] — wired render surfaces. These renderers are called by
 * build-host-packages.ts and the repo-hosted installer dry-runs for the CLI/file
 * targets. A renderer existing is still separate from live installability:
 * unsupported fields are emitted as degradation records until a host adapter
 * proves the runtime path.
 *
 * Provides three pure renderers that derive from a common GuildPluginManifest
 * input (the neutral inventory). Each renders the host-native package format:
 *
 *   renderCodexPluginJson(manifest) → .codex-plugin/plugin.json object
 *   renderPiManifest(manifest)      → Pi package.json pi-block object
 *
 * (A `renderGeminiToml` renderer was removed when Gemini was sunset 2026-06-14 in
 * favour of Antigravity — the live build never wired it.)
 *
 * CONTRACT:
 *   - All exported functions are PURE (no I/O, no filesystem, no network,
 *     no Date.now(), no Math.random()).
 *   - Callers supply timestamps and ids.
 *   - A field the host cannot express is stubbed + flagged in `_unsupported`
 *     on the rendered object, never silently omitted (ADR Surface 1:
 *     "render-or-degrade").
 *   - These functions are INERT until explicitly wired by an installer or
 *     packaging script — they have no side effects.
 *
 * Owned by plugin-architect; consumed by future per-host packaging scripts.
 */

// ---------------------------------------------------------------------------
// Input type — the neutral Guild plugin manifest
// ---------------------------------------------------------------------------

/**
 * The host-neutral Guild plugin manifest: one source-of-truth inventory from
 * which every host renderer derives its package format.
 * Shape mirrors .claude-plugin/plugin.json (the shipped reference manifest)
 * with optional extension fields for cross-host rendering.
 */
export interface GuildPluginManifest {
  /** Plugin display name (e.g. "guild"). */
  name: string;
  /** Semver version string (e.g. "2.0.0"). Version of record: .claude-plugin/plugin.json. */
  version: string;
  /** Human-readable description. */
  description: string;
  /** Homepage URL. */
  homepage?: string;
  /** Source repository URL. */
  repository?: string;
  /** Author block. */
  author?: { name: string; email?: string };
  /** SPDX license identifier. */
  license?: string;
  /** Free-form tags / keywords. */
  keywords?: string[];
  /**
   * Skill glob paths (relative to plugin root).
   * e.g. ["./skills/core/", "./skills/meta/"]
   */
  skills?: string[];
  /**
   * Command file paths (relative to plugin root).
   * e.g. ["./commands/guild.md", "./commands/init.md"]
   */
  commands?: string[];
  /**
   * Agent definition file paths (relative to plugin root).
   * e.g. ["./agents/architect.md"]
   */
  agents?: string[];
  /**
   * MCP server definitions — optional; present when the host can bundle them.
   * Each entry is a host-neutral server descriptor.
   */
  mcpServers?: McpServerEntry[];
  /**
   * Hooks definitions — optional; present when the host supports hooks.
   * Each entry is a host-neutral hook descriptor.
   */
  hooks?: HookEntry[];
}

/** Host-neutral MCP server descriptor (one server bundled in the manifest). */
export interface McpServerEntry {
  /** Stable server id (e.g. "guild-memory", "guild-telemetry"). */
  id: string;
  /** Transport type the server uses. */
  transport: "stdio" | "http";
  /** Launch command (for stdio servers). */
  command?: string;
  /** Launch arguments. */
  args?: string[];
  /** HTTP endpoint (for http servers). */
  url?: string;
  /** Human-readable description. */
  description?: string;
}

/** Host-neutral hook descriptor. */
export interface HookEntry {
  /** Event name matching the Guild normalized hook taxonomy (e.g. "SessionStart"). */
  event: string;
  /** Script path relative to plugin root. */
  script: string;
  /** Optional matcher expression (host-specific syntax applied by the adapter). */
  matcher?: string;
}

// ---------------------------------------------------------------------------
// Rendered output types
// ---------------------------------------------------------------------------

/**
 * The rendered .codex-plugin/plugin.json object.
 * Codex's live plugin schema is intentionally narrow. Host capability gaps are
 * recorded by adapter receipts and package evidence, not inside plugin.json.
 */
export interface CodexPluginJson {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  author?: { name: string; email?: string };
  license?: string;
  keywords?: string[];
  /** Codex skill root relative to the plugin package. */
  skills: string;
  interface: {
    displayName: string;
    shortDescription: string;
    longDescription: string;
    developerName?: string;
    category: string;
    capabilities: string[];
    websiteURL?: string;
    defaultPrompt: string[];
    brandColor: string;
  };
}

/** A single command entry in the Codex plugin format. */
export interface CodexCommandEntry {
  /** Slash-command token (e.g. "guild", "init", "plan"). */
  name: string;
  /** Human-readable description of the command. */
  description?: string;
  /** Original .md file path (for reference/traceability). */
  source_path: string;
}

/** A Codex-native MCP server entry (stdio only). */
export interface CodexMcpEntry {
  id: string;
  command: string;
  args?: string[];
  description?: string;
}

/**
 * The rendered Pi package manifest pi-block.
 * Pi does not natively support MCP; that gap is flagged in `_unsupported`.
 */
export interface PiManifest {
  /** Schema identifier for the Pi package manifest block. */
  schema_version: "pi-manifest.v1";
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  author?: { name: string; email?: string };
  license?: string;
  keywords?: string[];
  /**
   * Pi extension commands — derived from the manifest's command list.
   * Pi renders commands as extension descriptors pointing at the source path.
   */
  commands?: PiCommandEntry[];
  /**
   * Pi skills entries (skill directories the extension exposes).
   */
  skills?: string[];
  /**
   * Fields that Pi's package format cannot express.
   * MCP is always flagged here (Pi core omits MCP — ADR Surface 1, Surface 7).
   */
  _unsupported?: UnsupportedField[];
  /** Provenance: caller-supplied render timestamp. */
  _rendered_at: string;
  /** Source manifest version included for traceability. */
  _source_version: string;
}

/** A Pi extension command entry. */
export interface PiCommandEntry {
  name: string;
  description?: string;
  source_path: string;
}

/** A field that could not be rendered into the target format. */
export interface UnsupportedField {
  /** The source manifest field that had no equivalent. */
  field: string;
  /** Human-readable reason this field is not supported in the target format. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Validation result returned by manifest validators. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a GuildPluginManifest has the required minimum fields.
 * Returns { valid, errors } — never throws.
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["manifest must be a non-null object"] };
  }
  const m = manifest as Record<string, unknown>;
  if (typeof m["name"] !== "string" || m["name"].trim() === "") {
    errors.push("manifest.name must be a non-empty string");
  }
  if (typeof m["version"] !== "string" || m["version"].trim() === "") {
    errors.push("manifest.version must be a non-empty string");
  }
  if (typeof m["description"] !== "string") {
    errors.push("manifest.description must be a string");
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Render options
// ---------------------------------------------------------------------------

/** Options shared across all renderers. */
export interface RenderOptions {
  /**
   * ISO 8601 timestamp for the render provenance record.
   * The caller MUST supply this — renderers never call Date.now().
   */
  renderedAt: string;
}

// ---------------------------------------------------------------------------
// Command path helpers
// ---------------------------------------------------------------------------

/**
 * Extract the bare command name from a command path.
 * "./commands/guild.md"  → "guild"
 * "./commands/init.md"   → "init"
 * "commands/plan.md"     → "plan"
 */
function commandNameFromPath(commandPath: string): string {
  const base = commandPath.split("/").pop() ?? commandPath;
  return base.replace(/\.md$/i, "");
}

// ---------------------------------------------------------------------------
// renderCodexPluginJson
// ---------------------------------------------------------------------------

/**
 * Render a Codex plugin manifest (.codex-plugin/plugin.json) from a neutral
 * GuildPluginManifest.
 *
 * Codex capabilities:
 *  - Supports stdio MCP; HTTP MCP is unsupported → flagged in _unsupported.
 *  - No native slash-command .md format; commands are workflow descriptors.
 *  - Agents have no direct Codex equivalent; flagged if present.
 *  - Hooks are not rendered (Codex hook event taxonomy differs); flagged if present.
 *  - Skills directories have no direct Codex equivalent; flagged if present.
 *
 * @param manifest - The neutral Guild plugin manifest.
 * @param opts - Render options (caller supplies renderedAt).
 * @returns A CodexPluginJson object ready to serialize to .codex-plugin/plugin.json.
 */
export function renderCodexPluginJson(
  manifest: GuildPluginManifest,
  opts: RenderOptions
): CodexPluginJson {
  void opts;
  const result: CodexPluginJson = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    skills: "./.agents/skills/",
    interface: {
      displayName: "Guild Stack",
      shortDescription: "Specialist agent teams for Codex",
      longDescription: manifest.description,
      ...(manifest.author?.name ? { developerName: manifest.author.name } : {}),
      category: "Developer Tools",
      capabilities: ["Read", "Write"],
      ...(manifest.homepage ? { websiteURL: manifest.homepage } : {}),
      defaultPrompt: [
        "Run a Guild planning pass for this task",
        "Review this implementation with Guild",
      ],
      brandColor: "#202A44",
    },
  };

  if (manifest.homepage !== undefined) result.homepage = manifest.homepage;
  if (manifest.repository !== undefined) result.repository = manifest.repository;
  if (manifest.author !== undefined) result.author = manifest.author;
  if (manifest.license !== undefined) result.license = manifest.license;
  if (manifest.keywords && manifest.keywords.length > 0) result.keywords = manifest.keywords;

  return result;
}

// ---------------------------------------------------------------------------
// renderClaudePluginPackage — the Claude .claude-plugin/plugin.json manifest
// ---------------------------------------------------------------------------

/**
 * The rendered .claude-plugin/plugin.json manifest object. Claude is the
 * CANONICAL host format, so this mirrors the committed plugin.json EXACTLY —
 * metadata + the skill DIRECTORY globs + the command/agent file-path lists. No
 * provenance fields are emitted (the committed reference carries none), keeping
 * the generated manifest byte-faithful so SC-2 equivalence holds without relying
 * on provenance-stripping. MCP servers and hooks live in .mcp.json / hooks.json
 * respectively (NOT inline in plugin.json), so they are not part of this object —
 * matching the committed manifest.
 */
export interface ClaudePluginJson {
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  author?: { name: string; email?: string };
  license?: string;
  keywords?: string[];
  /** Skill directory globs, e.g. "./skills/core/". */
  skills?: string[];
  /** Command file paths, e.g. "./commands/plan.md". */
  commands?: string[];
  /** Agent file paths, e.g. "./agents/architect.md". */
  agents?: string[];
}

/** The Claude marketplace file that points Claude Code at this local plugin. */
export interface ClaudeMarketplaceJson {
  name: string;
  description: string;
  owner: { name: string; email?: string };
  plugins: Array<{
    name: string;
    source: string;
    description: string;
    version: string;
    homepage?: string;
    repository?: string;
    author?: { name: string; email?: string };
    license?: string;
    keywords?: string[];
  }>;
}

/**
 * Render the Claude plugin manifest (.claude-plugin/plugin.json) from a neutral
 * GuildPluginManifest. The file-tree body (command/skill/agent/hook contents) is
 * copied by the I/O caller (build-host-packages.ts); this PURE renderer produces
 * only the manifest object.
 *
 * The neutral input carries the Claude-shaped surface lists: `skills` as
 * directory globs, `commands`/`agents` as file paths (the caller derives these
 * from guild.inventory.v1). Arrays are emitted in sorted order for deterministic
 * output; the SC-2 normalizer also sorts these manifest arrays, so either side's
 * ordering is non-semantic.
 *
 * @param manifest - The neutral Guild plugin manifest.
 * @param opts - Render options (renderedAt accepted for interface parity; the
 *               Claude manifest intentionally emits no provenance field).
 */
export function renderClaudePluginPackage(
  manifest: GuildPluginManifest,
  _opts: RenderOptions
): ClaudePluginJson {
  const result: ClaudePluginJson = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
  };
  if (manifest.homepage !== undefined) result.homepage = manifest.homepage;
  if (manifest.repository !== undefined) result.repository = manifest.repository;
  if (manifest.author !== undefined) result.author = manifest.author;
  if (manifest.license !== undefined) result.license = manifest.license;
  if (manifest.keywords && manifest.keywords.length > 0) result.keywords = manifest.keywords;
  if (manifest.skills && manifest.skills.length > 0) result.skills = [...manifest.skills].sort();
  if (manifest.commands && manifest.commands.length > 0) result.commands = [...manifest.commands].sort();
  if (manifest.agents && manifest.agents.length > 0) result.agents = [...manifest.agents].sort();
  return result;
}

/**
 * Render `.claude-plugin/marketplace.json` from the same neutral manifest as
 * `.claude-plugin/plugin.json`. Claude treats the marketplace file as install
 * metadata, so it must be generated with the plugin manifest instead of
 * drifting as a hand-maintained sidecar.
 */
export function renderClaudeMarketplacePackage(
  manifest: GuildPluginManifest,
  _opts: RenderOptions
): ClaudeMarketplaceJson {
  const owner = {
    name: manifest.author?.name ?? "Guild",
    ...(manifest.author?.email ? { email: manifest.author.email } : {}),
  };
  const plugin: ClaudeMarketplaceJson["plugins"][number] = {
    name: manifest.name,
    source: "./",
    description:
      "Self-evolving teams of specialist agents for Claude Code. 14 specialists across engineering, content, and commercial groups; the v2 single-verb lifecycle (init · ideate · plan · build · qa · ops); a settings.json config surface; an understand-everything engine for brownfield onboarding; a categorized wiki with decision capture; and a self-evolution loop with shadow mode, flip-gating, and versioned rollback. Built and maintained by its own dev-team of self-build agents. Optional tmux agent-team backend + BM25 wiki search + trace query MCPs.",
    version: manifest.version,
  };
  if (manifest.homepage !== undefined) plugin.homepage = manifest.homepage;
  if (manifest.repository !== undefined) plugin.repository = manifest.repository;
  if (manifest.author !== undefined) plugin.author = manifest.author;
  if (manifest.license !== undefined) plugin.license = manifest.license;
  if (manifest.keywords && manifest.keywords.length > 0) plugin.keywords = [...manifest.keywords];

  return {
    name: manifest.name,
    description:
      "Guild marketplace for Claude Code plugins focused on specialist agent teams, durable memory, and evidence-based evolution.",
    owner,
    plugins: [plugin],
  };
}

// ---------------------------------------------------------------------------
// renderPiManifest
// ---------------------------------------------------------------------------

/**
 * Render a Pi package manifest pi-block from a neutral GuildPluginManifest.
 *
 * Pi capabilities (from the host-adapter contract):
 *  - Extension commands via pi.registerCommand() — rendered as command entries.
 *  - Skill directories — passed through as skill paths.
 *  - MCP is NOT natively supported by Pi core; always flagged in _unsupported.
 *    The installer must bridge MCP via a package-provided shim (ADR Surface 7).
 *  - Agents have no direct Pi equivalent; flagged if present.
 *  - Hooks require a dedicated HookEmitter; flagged if present.
 *
 * @param manifest - The neutral Guild plugin manifest.
 * @param opts - Render options (caller supplies renderedAt).
 * @returns A PiManifest object representing the pi block of a package.json.
 */
export function renderPiManifest(
  manifest: GuildPluginManifest,
  opts: RenderOptions
): PiManifest {
  const unsupported: UnsupportedField[] = [];

  // Commands → Pi extension command entries
  const commands: PiCommandEntry[] = (manifest.commands ?? []).map((cmdPath) => ({
    name: commandNameFromPath(cmdPath),
    source_path: cmdPath,
  }));

  // Skills — passed through as directory paths
  const skills = manifest.skills ?? [];

  // MCP — Pi core does not support MCP; always flag
  if (manifest.mcpServers && manifest.mcpServers.length > 0) {
    for (const srv of manifest.mcpServers) {
      unsupported.push({
        field: `mcpServers[${srv.id}]`,
        reason:
          "Pi core omits MCP; this server must be bridged via a package-provided " +
          "shim that exposes the same .guild/ paths the MCP server would serve " +
          "(ADR Surface 1 + Surface 7 render-or-degrade)",
      });
    }
  }

  // Agents — no Pi equivalent
  if (manifest.agents && manifest.agents.length > 0) {
    unsupported.push({
      field: "agents",
      reason:
        "Pi has no direct equivalent of Guild agent definition files; " +
        "agents are omitted from the Pi manifest",
    });
  }

  // Hooks — Pi uses ctx.ui.confirm / ctx.ui.input; requires a dedicated PermissionEmitter
  if (manifest.hooks && manifest.hooks.length > 0) {
    unsupported.push({
      field: "hooks",
      reason:
        "Pi hook semantics differ from Claude (ctx.ui.confirm / ctx.ui.input); " +
        "hooks require a dedicated HookEmitter + PermissionEmitter adapter " +
        "(ADR Surface 3 + Surface 5) — not rendered by this Surface 1 packager",
    });
  }

  const result: PiManifest = {
    schema_version: "pi-manifest.v1",
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    _rendered_at: opts.renderedAt,
    _source_version: manifest.version,
  };

  if (manifest.homepage !== undefined) result.homepage = manifest.homepage;
  if (manifest.repository !== undefined) result.repository = manifest.repository;
  if (manifest.author !== undefined) result.author = manifest.author;
  if (manifest.license !== undefined) result.license = manifest.license;
  if (manifest.keywords && manifest.keywords.length > 0) result.keywords = manifest.keywords;
  if (commands.length > 0) result.commands = commands;
  if (skills.length > 0) result.skills = skills;
  if (unsupported.length > 0) result._unsupported = unsupported;

  return result;
}

// ---------------------------------------------------------------------------
// renderAntigravityManifest — verified target renderer, installability: target
// ---------------------------------------------------------------------------

/** The rendered Antigravity package manifest. Mirrors PiManifest (extension shape). */
export interface AntigravityManifest {
  schema_version: "antigravity-manifest.v1";
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  author?: { name: string; email?: string };
  license?: string;
  keywords?: string[];
  commands?: PiCommandEntry[];
  skills?: string[];
  _unsupported?: UnsupportedField[];
  _rendered_at: string;
  _source_version: string;
  /** Registry provenance for the Antigravity row that backed the render. */
  _provenance: "verified";
}

/**
 * Render an Antigravity package manifest from a neutral GuildPluginManifest.
 *
 * Antigravity (registry id `antigravity-cli`, family `antigravity`) is a verified
 * target host (`installability: target`, `provenance: verified`). Its package
 * shape is modeled on the extension surface (commands as descriptors, skill dirs
 * passed through). Native agents / hooks / MCP are flagged in `_unsupported`
 * (render-or-degrade) because the CLI package path still coordinates through
 * AGENTS.md, the wrapper, and the file bus.
 */
export function renderAntigravityManifest(
  manifest: GuildPluginManifest,
  opts: RenderOptions
): AntigravityManifest {
  const unsupported: UnsupportedField[] = [];

  const commands: PiCommandEntry[] = (manifest.commands ?? []).map((cmdPath) => ({
    name: commandNameFromPath(cmdPath),
    source_path: cmdPath,
  }));
  const skills = manifest.skills ?? [];

  if (manifest.mcpServers && manifest.mcpServers.length > 0) {
    for (const srv of manifest.mcpServers) {
      unsupported.push({
        field: `mcpServers[${srv.id}]`,
        reason:
          "Antigravity MCP support is not exposed by the CLI package surface; this server must be bridged via a " +
          "package-provided shim or filesystem/BM25 fallback.",
      });
    }
  }
  if (manifest.agents && manifest.agents.length > 0) {
    unsupported.push({
      field: "agents",
      reason: "Antigravity has no confirmed agent-definition equivalent in the CLI package surface — agents omitted.",
    });
  }
  if (manifest.hooks && manifest.hooks.length > 0) {
    unsupported.push({
      field: "hooks",
      reason: "Antigravity hook semantics do not map to Guild hooks in the package surface — hooks require a dedicated emitter.",
    });
  }

  const result: AntigravityManifest = {
    schema_version: "antigravity-manifest.v1",
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    _rendered_at: opts.renderedAt,
    _source_version: manifest.version,
    _provenance: "verified",
  };
  if (manifest.homepage !== undefined) result.homepage = manifest.homepage;
  if (manifest.repository !== undefined) result.repository = manifest.repository;
  if (manifest.author !== undefined) result.author = manifest.author;
  if (manifest.license !== undefined) result.license = manifest.license;
  if (manifest.keywords && manifest.keywords.length > 0) result.keywords = manifest.keywords;
  if (commands.length > 0) result.commands = commands;
  if (skills.length > 0) result.skills = skills;
  if (unsupported.length > 0) result._unsupported = unsupported;
  return result;
}

// ---------------------------------------------------------------------------
// renderAgentsPackage (P1-L6) — the universal AGENTS.md instruction-file target
// ---------------------------------------------------------------------------

/**
 * The rendered universal `.agents` package: a single AGENTS.md instruction file
 * (context injection = instruction_file) plus the list of skills/commands exposed under
 * `.agents/skills/guild/**`. This is the host-AGNOSTIC fallback any AGENTS.md-consuming
 * host can install. `.agents` is a FILE surface (registry surface_kind:"file",
 * detection.bin:null) — NOT a CLI plugin manifest.
 */
export interface AgentsPackage {
  schema_version: "agents-package.v1";
  /** The AGENTS.md instruction-file content (markdown) the host reads at session start. */
  agents_md: string;
  /** Skill source paths exposed under .agents/skills/guild/** (for the subset gate). */
  skills: string[];
  /** Command names exposed (referenced from AGENTS.md). */
  commands: string[];
  _unsupported?: UnsupportedField[];
  _rendered_at: string;
  _source_version: string;
}

/**
 * Render the universal `.agents` package. The AGENTS.md bootstraps the `using-guild`
 * skill and points the host at the bundled Guild skill tree. Native commands / agents /
 * hooks / MCP have no AGENTS.md equivalent — they degrade to "drive Guild through the
 * skill tree", recorded in `_unsupported`.
 */
export function renderAgentsPackage(
  manifest: GuildPluginManifest,
  opts: RenderOptions
): AgentsPackage {
  const unsupported: UnsupportedField[] = [];
  const skills = manifest.skills ?? [];
  const commands = (manifest.commands ?? []).map(commandNameFromPath);

  if (manifest.agents && manifest.agents.length > 0) {
    unsupported.push({
      field: "agents",
      reason: "AGENTS.md has no native agent-definition mechanism; specialists are dispatched through the Guild skill tree instead.",
    });
  }
  if (manifest.hooks && manifest.hooks.length > 0) {
    unsupported.push({
      field: "hooks",
      reason: "AGENTS.md hosts have no native hook event surface; lifecycle steps run as explicit skill invocations.",
    });
  }
  if (manifest.mcpServers && manifest.mcpServers.length > 0) {
    unsupported.push({
      field: "mcpServers",
      reason: "MCP availability is host-dependent for AGENTS.md targets; the bundled stdio MCP servers are reachable only when the host provides an MCP transport.",
    });
  }

  const agents_md = [
    `# AGENTS.md — ${manifest.name} (universal Guild package)`,
    ``,
    manifest.description,
    ``,
    `This repository ships **Guild** as a universal AGENTS.md package. Guild is a`,
    `self-evolving specialist-team workflow engine. Its skills are bundled under`,
    "`.agents/skills/guild/**`.",
    ``,
    `## Start here`,
    `Read the **using-guild** skill first (\`.agents/skills/guild/meta/using-guild/SKILL.md\`)`,
    `— it is the gateway that tells you when to reach for Guild's lifecycle`,
    `(init → ideate → plan → build → qa → ops), specialists, adversarial review, and`,
    `knowledge ingestion.`,
    ``,
    `## How to drive Guild here`,
    `This host has no native slash-command or agent surface, so invoke Guild by READING`,
    `the relevant skill from the bundled tree and following it. The lifecycle skills live`,
    `under \`.agents/skills/guild/meta/\`; specialist skills under`,
    "`.agents/skills/guild/specialists/`.",
    ``,
    `## Run the Guild CLI`,
    `A \`guild-run\` launcher is bundled at \`bin/guild-run\` (forwards to the bundled`,
    "`scripts/guild-run.ts`).",
    ``,
    `<!-- rendered_at: ${opts.renderedAt} · source_version: ${manifest.version} -->`,
    ``,
  ].join("\n");

  const result: AgentsPackage = {
    schema_version: "agents-package.v1",
    agents_md,
    skills,
    commands,
    _rendered_at: opts.renderedAt,
    _source_version: manifest.version,
  };
  if (unsupported.length > 0) result._unsupported = unsupported;
  return result;
}
