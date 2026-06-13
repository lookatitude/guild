/**
 * scripts/lib/per-host-packaging.ts
 *
 * Surface 1 of the host-adapter contract — per-host packaging renderers.
 * Contract (BY POINTER): docs/knowledge/decisions/host-adapter-contract.md
 *   §Decision 1 / Surface 1 (Packaging)
 * Distribution doc (BY POINTER): docs/v2/15-distribution.md §Per-host packaging
 *
 * Status: [v2.x] — dormant surfaces. These renderers are NOT wired into any
 * install path yet. The installer's via-Claude/planned postures in
 * docs/v2/15-distribution.md §The repo-hosted installer are the ground truth;
 * no doc surface may present a non-Claude render as installable until the
 * adapter ships.
 *
 * Provides three pure renderers that derive from a common GuildPluginManifest
 * input (the neutral inventory). Each renders the host-native package format:
 *
 *   renderCodexPluginJson(manifest) → .codex-plugin/plugin.json object
 *   renderGeminiToml(manifest)      → TOML string
 *   renderPiManifest(manifest)      → Pi package.json pi-block object
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
 * Fields that Codex's plugin format cannot express are noted in `_unsupported`.
 */
export interface CodexPluginJson {
  /** Schema identifier for the Codex plugin format. */
  schema_version: "codex-plugin.v1";
  name: string;
  version: string;
  description: string;
  homepage?: string;
  repository?: string;
  author?: { name: string; email?: string };
  license?: string;
  keywords?: string[];
  /**
   * Codex workflow/command entries — derived from the manifest's command list.
   * Codex does not use .md slash-command files; commands are rendered as workflow
   * entry descriptors pointing at the canonical command path.
   */
  commands?: CodexCommandEntry[];
  /**
   * MCP block for servers Codex can bundle.
   * Codex supports stdio MCP; HTTP transport is unsupported and flagged.
   */
  mcpServers?: CodexMcpEntry[];
  /**
   * Fields from the source manifest that could not be rendered into the
   * Codex plugin format (render-or-degrade — ADR Surface 1).
   * Stub present means the installer must surface the gap to the operator.
   */
  _unsupported?: UnsupportedField[];
  /**
   * Provenance: the timestamp the caller supplied for this render.
   * Callers MUST pass this — the renderer never reads the clock.
   */
  _rendered_at: string;
  /** Source manifest version included for traceability. */
  _source_version: string;
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
  const unsupported: UnsupportedField[] = [];

  // Commands → Codex workflow descriptors
  const commands: CodexCommandEntry[] = (manifest.commands ?? []).map((cmdPath) => ({
    name: commandNameFromPath(cmdPath),
    source_path: cmdPath,
  }));

  // MCP servers — stdio only; HTTP flagged
  const mcpServers: CodexMcpEntry[] = [];
  for (const srv of manifest.mcpServers ?? []) {
    if (srv.transport === "stdio" && srv.command) {
      mcpServers.push({
        id: srv.id,
        command: srv.command,
        ...(srv.args ? { args: srv.args } : {}),
        ...(srv.description ? { description: srv.description } : {}),
      });
    } else if (srv.transport === "http") {
      unsupported.push({
        field: `mcpServers[${srv.id}]`,
        reason:
          "Codex does not support HTTP MCP transport; " +
          "this server cannot be bundled in the Codex plugin manifest",
      });
    } else if (srv.transport === "stdio" && !srv.command) {
      unsupported.push({
        field: `mcpServers[${srv.id}]`,
        reason:
          "stdio MCP server is missing a command field; " +
          "cannot render a Codex mcpServers entry without a launch command",
      });
    }
  }

  // Agents — no direct Codex equivalent
  if (manifest.agents && manifest.agents.length > 0) {
    unsupported.push({
      field: "agents",
      reason:
        "Codex has no direct equivalent of Guild agent definition files; " +
        "agents are omitted from the Codex plugin manifest",
    });
  }

  // Hooks — Codex hook taxonomy differs from Claude; requires a dedicated HookEmitter
  if (manifest.hooks && manifest.hooks.length > 0) {
    unsupported.push({
      field: "hooks",
      reason:
        "Hook event semantics differ between Claude and Codex; " +
        "hooks require a dedicated HookEmitter adapter (ADR Surface 3) — " +
        "not rendered by this Surface 1 packager",
    });
  }

  // Skills — no direct Codex equivalent
  if (manifest.skills && manifest.skills.length > 0) {
    unsupported.push({
      field: "skills",
      reason:
        "Codex has no equivalent of Guild skill directories; " +
        "skills are omitted from the Codex plugin manifest",
    });
  }

  const result: CodexPluginJson = {
    schema_version: "codex-plugin.v1",
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
  if (mcpServers.length > 0) result.mcpServers = mcpServers;
  if (unsupported.length > 0) result._unsupported = unsupported;

  return result;
}

// ---------------------------------------------------------------------------
// renderGeminiToml — minimal TOML serializer (subset sufficient for Gemini)
// ---------------------------------------------------------------------------

/**
 * Render a Gemini extension manifest as a TOML string.
 *
 * Gemini extension format (from the host-adapter contract):
 *   gemini-extension.json + commands/<group>/<name>.toml + GEMINI.md
 *
 * This renderer emits the top-level TOML block (the gemini-extension equivalent).
 * Individual command TOML files are derived from the commands array but the
 * multi-file output is represented here as a single TOML document for the
 * primary manifest. The caller is responsible for splitting out per-command
 * files.
 *
 * Gemini capabilities:
 *  - Native TOML command format (toml_commands: true in host_capabilities.v1).
 *  - No native skill directory support; flagged if present.
 *  - No direct agent equivalent; flagged if present.
 *  - Hooks require a dedicated HookEmitter; flagged if present.
 *  - MCP support in gemini-extension.json; HTTP and stdio both representable.
 *
 * @param manifest - The neutral Guild plugin manifest.
 * @param opts - Render options (caller supplies renderedAt).
 * @returns A TOML string ready to write as the primary Gemini extension manifest.
 */
export function renderGeminiToml(
  manifest: GuildPluginManifest,
  opts: RenderOptions
): string {
  const lines: string[] = [];
  const unsupportedComments: string[] = [];

  // [extension] header
  lines.push("[extension]");
  lines.push(`name = ${tomlString(manifest.name)}`);
  lines.push(`version = ${tomlString(manifest.version)}`);
  lines.push(`description = ${tomlString(manifest.description)}`);
  if (manifest.homepage) {
    lines.push(`homepage = ${tomlString(manifest.homepage)}`);
  }
  if (manifest.repository) {
    lines.push(`repository = ${tomlString(manifest.repository)}`);
  }
  if (manifest.license) {
    lines.push(`license = ${tomlString(manifest.license)}`);
  }
  if (manifest.keywords && manifest.keywords.length > 0) {
    lines.push(`keywords = [${manifest.keywords.map(tomlString).join(", ")}]`);
  }
  lines.push(`_rendered_at = ${tomlString(opts.renderedAt)}`);
  lines.push(`_source_version = ${tomlString(manifest.version)}`);

  // [author]
  if (manifest.author) {
    lines.push("");
    lines.push("[extension.author]");
    lines.push(`name = ${tomlString(manifest.author.name)}`);
    if (manifest.author.email) {
      lines.push(`email = ${tomlString(manifest.author.email)}`);
    }
  }

  // [[commands]] — Gemini TOML command entries
  const cmds = manifest.commands ?? [];
  if (cmds.length > 0) {
    for (const cmdPath of cmds) {
      const name = commandNameFromPath(cmdPath);
      lines.push("");
      lines.push("[[commands]]");
      lines.push(`name = ${tomlString(name)}`);
      lines.push(`source_path = ${tomlString(cmdPath)}`);
    }
  }

  // [[mcp_servers]] — MCP entries (Gemini supports both stdio and HTTP)
  const servers = manifest.mcpServers ?? [];
  for (const srv of servers) {
    lines.push("");
    lines.push("[[mcp_servers]]");
    lines.push(`id = ${tomlString(srv.id)}`);
    lines.push(`transport = ${tomlString(srv.transport)}`);
    if (srv.transport === "stdio" && srv.command) {
      lines.push(`command = ${tomlString(srv.command)}`);
      if (srv.args && srv.args.length > 0) {
        lines.push(`args = [${srv.args.map(tomlString).join(", ")}]`);
      }
    } else if (srv.transport === "http" && srv.url) {
      lines.push(`url = ${tomlString(srv.url)}`);
    }
    if (srv.description) {
      lines.push(`description = ${tomlString(srv.description)}`);
    }
  }

  // Unsupported fields — agents, hooks, skills each have no Gemini equivalent
  if (manifest.agents && manifest.agents.length > 0) {
    unsupportedComments.push(
      "# UNSUPPORTED: agents — Gemini has no direct equivalent of Guild agent definition files"
    );
  }
  if (manifest.hooks && manifest.hooks.length > 0) {
    unsupportedComments.push(
      "# UNSUPPORTED: hooks — hooks require a dedicated HookEmitter adapter (ADR Surface 3)"
    );
  }
  if (manifest.skills && manifest.skills.length > 0) {
    unsupportedComments.push(
      "# UNSUPPORTED: skills — Gemini has no equivalent of Guild skill directories"
    );
  }

  if (unsupportedComments.length > 0) {
    lines.push("");
    lines.push("# Per-host packaging render-or-degrade (ADR Surface 1):");
    lines.push("# The following source manifest fields have no Gemini equivalent.");
    lines.push("# The installer must surface these gaps to the operator.");
    for (const c of unsupportedComments) {
      lines.push(c);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Minimal TOML string literal encoder (single-line strings only).
 * Escapes backslashes, double quotes, and the standard TOML control characters.
 */
function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
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
