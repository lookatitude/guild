/**
 * src/modules/distribution/workflows/per-host-packaging.ts
 *
 * Surface 1 of the host-adapter contract — per-host packaging renderers.
 * Contract (BY POINTER) — the retired `docs/knowledge/` store was harvested into the
 * canonical wiki (workspace-v2-compliance, 2026-06-27):
 *   .guild/wiki/decisions/host-adapter-contract.md §Decision 1 / Surface 1 (Packaging)
 *   .guild/wiki/decisions/verified-multi-host-support.md (the L0 ADR — §4.2 renderer base)
 * Distribution doc (BY POINTER): docs/v2/host-adapter-migration-spec.html,
 *   docs/v2/distribution.html §Per-host packaging
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
  /** Codex hook manifest for the app/CLI prompt bridge. */
  hooks: string;
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
  /**
   * Registry provenance for the Pi row that backed the render — "verified" or
   * "inferred", supplied by the caller from `HOST_REGISTRY_ROWS["pi-cli"].provenance`
   * (audit fix: Pi previously omitted this field entirely, unlike Antigravity/
   * wrapped-CLI, so a receipt-driven provenance flip could never surface here).
   */
  _provenance: "verified" | "inferred";
}

/**
 * A Pi extension command entry.
 *
 * `source_path` is OPTIONAL: commands/*.md prompt bodies are a Claude-Code-only
 * artifact (they are never copied into Pi/Antigravity/agents/wrapped-CLI
 * packages — those hosts dispatch phase verbs by reading the bundled skill
 * tree instead, see AGENTS.md). Renderers for those hosts omit it rather than
 * echo a Claude-shaped path that resolves to nothing in the package
 * (plugin-implementation-audit-2026-07-12 finding: "non-Claude manifests ship
 * commands[].source_path './commands/<id>.md' ... that resolve to nothing").
 */
export interface PiCommandEntry {
  name: string;
  description?: string;
  source_path?: string;
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

/**
 * Registry-derived facts the Pi and Antigravity renderers need, read by the
 * I/O caller (build-host-packages.ts) off the host's HostRegistryEntry —
 * mirroring WrappedCliRenderSpec's discipline ("the renderer consumes the row,
 * it never re-declares host facts") so these two bespoke renderers stay just
 * as PURE as the shared wrapped-CLI base.
 */
export interface NewHostRenderSpec {
  /** Where the Guild skill tree is exposed in the package (L2 packaging contract). */
  agentsSkillRoot: string;
  /** Registry provenance for the row that backed the render ("verified" | "inferred"). */
  provenance: "verified" | "inferred";
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

/**
 * Remap Claude-shaped skill tier globs (`./skills/<tier>/`, as carried by the
 * neutral manifest's `skills` field) to a package's ACTUAL on-disk skill-tree
 * root. Every non-Claude/non-Codex package (agents, Pi, Antigravity, the 4
 * wrapped-CLI hosts) exposes the skill tree under `<agentsSkillRoot>/<tier>/`
 * (see `exposeGuildSkillTree` in build-host-packages.ts) — NOT at the
 * Claude-shaped path, which does not exist in those trees at all
 * (plugin-implementation-audit-2026-07-12 finding: "skills globs './skills/<tier>/'
 * that resolve to NOTHING in their trees").
 */
function remapSkillDirsToPackageRoot(skillDirs: readonly string[], agentsSkillRoot: string): string[] {
  return skillDirs.map((dir) => {
    const tier = dir.replace(/^\.\/skills\//, "").replace(/\/$/, "");
    return `${agentsSkillRoot}/${tier}/`;
  });
}

/**
 * Command names for a package that ships NO per-command prompt file (every
 * host besides Claude Code and Codex — see PiCommandEntry doc comment). Keeps
 * the command NAME (useful metadata: the phase verbs Guild supports) but never
 * echoes the Claude-shaped `./commands/<id>.md` path, and records the
 * degradation like every other unsupported field (render-or-degrade, per this
 * file's CONTRACT).
 */
function degradedCommandNames(
  manifest: GuildPluginManifest,
  unsupported: UnsupportedField[]
): PiCommandEntry[] {
  const commands: PiCommandEntry[] = (manifest.commands ?? []).map((cmdPath) => ({
    name: commandNameFromPath(cmdPath),
  }));
  if (commands.length > 0) {
    unsupported.push({
      field: "commands[].source_path",
      reason:
        "commands/*.md prompt bodies are a Claude-Code-only artifact and are not packaged for this " +
        "host; Guild's phase verbs are dispatched by reading the bundled skill tree instead (see AGENTS.md).",
    });
  }
  return commands;
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
 *  - No native slash-command .md format; commands are routed through a
 *    UserPromptSubmit bridge hook when the host submits `/guild...` as text.
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
    hooks: "./hooks/codex-hooks.json",
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
    // Single-sourced from the neutral manifest description (which is the committed
    // .claude-plugin/plugin.json description) so the marketplace plugin blurb can
    // never drift from the plugin manifest.
    description: manifest.description,
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
 * @param spec - Registry-derived facts the pure renderer needs (agentsSkillRoot,
 *   provenance) — read off the Pi row by the caller (build-host-packages.ts),
 *   mirroring the wrapped-CLI renderer's discipline (the renderer never reads
 *   the registry itself).
 * @returns A PiManifest object representing the pi block of a package.json.
 */
export function renderPiManifest(
  manifest: GuildPluginManifest,
  opts: RenderOptions,
  spec: NewHostRenderSpec
): PiManifest {
  const unsupported: UnsupportedField[] = [];

  // Commands → Pi extension command entries (name-only; see PiCommandEntry doc).
  const commands = degradedCommandNames(manifest, unsupported);

  // Skills — remapped to where Pi packages actually expose them.
  const skills = remapSkillDirsToPackageRoot(manifest.skills ?? [], spec.agentsSkillRoot);

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
    _provenance: spec.provenance,
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
  /**
   * Registry provenance for the Antigravity row that backed the render —
   * "verified" or "inferred", supplied by the caller from
   * `HOST_REGISTRY_ROWS["antigravity-cli"].provenance` (audit fix: this used to
   * be a hardcoded "verified" literal, decoupled from the registry row it
   * claims to reflect — a future provenance downgrade could never surface here).
   */
  _provenance: "verified" | "inferred";
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
 *
 * @param spec - Registry-derived facts (agentsSkillRoot, provenance) — see
 *   NewHostRenderSpec; read off the Antigravity row by the caller.
 */
export function renderAntigravityManifest(
  manifest: GuildPluginManifest,
  opts: RenderOptions,
  spec: NewHostRenderSpec
): AntigravityManifest {
  const unsupported: UnsupportedField[] = [];

  const commands = degradedCommandNames(manifest, unsupported);
  const skills = remapSkillDirsToPackageRoot(manifest.skills ?? [], spec.agentsSkillRoot);

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
    _provenance: spec.provenance,
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
// SHARED renderer base (verified-multi-host-support L0 §4.2 / AC-PKG-3)
// ---------------------------------------------------------------------------
//
// The 4 new-CLI hosts (cursor, github-copilot, opencode, rovo-dev) MUST be built
// on ONE shared render-extension base — NOT copy-pasted. The 5 EXISTING bespoke
// renderers (claude, codex, pi, antigravity, agents) stay as-is (A-m3 — the two
// patterns coexist); only the NEW renderers are mandated onto this base. IDE hosts
// (kiro/qoder/trae) carry NO per-host renderer — they REUSE renderAgentsPackage via
// the registry `adapter_binding: "agents-file"` dereference (AC-REG-4 / AC-ADP-1).
//
// PURITY is preserved (§ CONTRACT): the renderer reads NO registry and does NO I/O.
// The registry-derived host facts (the schema_version and host_id) are supplied by
// the I/O caller (build-host-packages.ts, which reads the row) via WrappedCliRenderSpec
// — mirroring the L2 adapter discipline "the renderer/adapter consumes the row, it
// never re-declares host facts".

/**
 * Registry-derived host facts the pure wrapped-CLI renderer needs. The caller
 * (build-host-packages.ts) reads these from the host's HostRegistryEntry:
 *   - schemaVersion   ← capabilities.package.manifest_format  (e.g. "cursor-package")
 *   - hostId          ← host_id                                (e.g. "cursor")
 *   - agentsSkillRoot ← the packaging contract L2's adapter surfaces (".agents/skills/guild")
 *   - launcher        ← the 11th-concern guild-run bin path    ("bin/guild-run")
 *   - provenance      ← the row's own `provenance` field       ("verified" | "inferred")
 */
export interface WrappedCliRenderSpec {
  /** The host's registry id, echoed for traceability (e.g. "cursor"). */
  hostId: string;
  /** The host's package schema id — capabilities.package.manifest_format (e.g. "cursor-package"). */
  schemaVersion: string;
  /** Where the Guild skill tree is exposed in the package (L2 packaging contract). */
  agentsSkillRoot: string;
  /** The bundled guild-run launcher path (AC-BOOT-1, the 11th concern). */
  launcher: string;
  /**
   * Registry provenance for the row that backed the render (audit fix: this used
   * to be hardcoded "inferred" in the renderer, decoupled from the row it claims
   * to reflect — read from `HOST_REGISTRY_ROWS[hostId].provenance` by the caller).
   */
  provenance: "verified" | "inferred";
}

/**
 * The rendered wrapped-CLI package manifest — the shared shape all 4 new-CLI hosts
 * emit. Modeled on the Pi/Antigravity extension surface (commands as descriptors,
 * skill dirs passed through, native agents/hooks/MCP flagged in `_unsupported`).
 * `schema_version` is the host's own `manifest_format` so each host's package is
 * self-identifying. R1: a rendered manifest is NEVER support — `installability`
 * stays "target" and `_provenance` "inferred" until an operator-box receipt promotes
 * the derived public state (host-public-state.ts, L5/L7).
 */
export interface WrappedCliPackage {
  /** Host-own package schema id, e.g. "cursor-package" (from manifest_format). */
  schema_version: string;
  /** Registry host id, e.g. "cursor". */
  host_id: string;
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
  /** Where the Guild skill tree lives in the package (L2 packaging contract). */
  agents_skill_root: string;
  /** The bundled guild-run launcher (11th concern, AC-BOOT-1). */
  launcher: string;
  /** Install semantics — target/unproven (R1: renderer ≠ support). */
  installability: "target";
  _unsupported?: UnsupportedField[];
  _rendered_at: string;
  _source_version: string;
  /**
   * Registry provenance for the row that backed the render — "verified" or
   * "inferred" (today always "inferred" per R1: these 4 rows are
   * installability:"target" and have no operator-box receipt yet, but the value
   * is DERIVED from `spec.provenance`, not hardcoded, so a future receipt-driven
   * flip surfaces here automatically).
   */
  _provenance: "verified" | "inferred";
}

/**
 * The near-identical extension body shared by the wrapped-CLI renderers: commands
 * as descriptors, skills passed through, and native agents/hooks/MCP degraded to
 * `_unsupported` (render-or-degrade). Factored out so the 4 new-CLI renderers carry
 * ZERO copy-pasted logic — the ONE definition of "what a wrapped-CLI package can and
 * cannot express" (AC-PKG-3).
 */
function buildWrappedCliExtensionBody(
  manifest: GuildPluginManifest,
  agentsSkillRoot: string
): {
  commands: PiCommandEntry[];
  skills: string[];
  unsupported: UnsupportedField[];
} {
  const unsupported: UnsupportedField[] = [];

  const commands = degradedCommandNames(manifest, unsupported);
  const skills = remapSkillDirsToPackageRoot(manifest.skills ?? [], agentsSkillRoot);

  if (manifest.mcpServers && manifest.mcpServers.length > 0) {
    for (const srv of manifest.mcpServers) {
      unsupported.push({
        field: `mcpServers[${srv.id}]`,
        reason:
          "Wrapped-CLI hosts have no confirmed native MCP surface in the package format; this server is " +
          "reachable only when the host provides an MCP transport, else it degrades to the filesystem/BM25 " +
          "fallback the guild-run wrapper coordinates (ADR Surface 1 + Surface 7 render-or-degrade).",
      });
    }
  }
  if (manifest.agents && manifest.agents.length > 0) {
    unsupported.push({
      field: "agents",
      reason:
        "Wrapped-CLI hosts have no native agent-definition mechanism; specialists are dispatched through the " +
        "Guild skill tree exposed under agents_skill_root instead of a host-native agent format.",
    });
  }
  if (manifest.hooks && manifest.hooks.length > 0) {
    unsupported.push({
      field: "hooks",
      reason:
        "Wrapped-CLI hosts have no native session-hook surface; lifecycle steps (run-start preflight + the " +
        "using-guild gateway) are injected by the bundled bin/guild-run wrapper (AC-BOOT-1), not host hooks.",
    });
  }

  return { commands, skills, unsupported };
}

/**
 * Render a wrapped-CLI package manifest from a neutral GuildPluginManifest + the
 * registry-derived spec. This is the ONE shared base the 4 new-CLI hosts render on
 * (AC-PKG-3). The only per-host difference is the spec (schema_version + host_id) —
 * every host-neutral fact comes from `manifest`, every host-specific fact comes from
 * `spec` (read off the registry row by the caller), so a new wrapped-CLI host is a
 * one-line call, never a copy-pasted renderer.
 */
export function renderWrappedCliPackage(
  manifest: GuildPluginManifest,
  opts: RenderOptions,
  spec: WrappedCliRenderSpec
): WrappedCliPackage {
  const { commands, skills, unsupported } = buildWrappedCliExtensionBody(manifest, spec.agentsSkillRoot);

  const result: WrappedCliPackage = {
    schema_version: spec.schemaVersion,
    host_id: spec.hostId,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    agents_skill_root: spec.agentsSkillRoot,
    launcher: spec.launcher,
    installability: "target",
    _rendered_at: opts.renderedAt,
    _source_version: manifest.version,
    _provenance: spec.provenance,
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
 *
 * @param agentsSkillRoot - Where the Guild skill tree is exposed in the package
 *   (L2 packaging contract, e.g. ".agents/skills/guild") — used to remap the
 *   Claude-shaped `./skills/<tier>/` globs onto the package's actual layout and
 *   to point the bootstrap prose at the file that actually ships.
 */
export function renderAgentsPackage(
  manifest: GuildPluginManifest,
  opts: RenderOptions,
  agentsSkillRoot: string
): AgentsPackage {
  const unsupported: UnsupportedField[] = [];
  const skills = remapSkillDirsToPackageRoot(manifest.skills ?? [], agentsSkillRoot);
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
    `\`${agentsSkillRoot}/**\`.`,
    ``,
    `## Start here`,
    // Points at SKILL.src.md, NOT SKILL.md: the using-guild gateway is deliberately
    // shipped un-rendered (it is injected via a SessionStart hook on Claude Code
    // instead of being loaded through the native skill mechanism), so SKILL.src.md
    // is the ONLY file this path resolves to in every shipped package (audit fix —
    // this text used to point at a SKILL.md that never ships for this skill).
    `Read the **using-guild** skill first (\`${agentsSkillRoot}/meta/using-guild/SKILL.src.md\`)`,
    `— it is the gateway that tells you when to reach for Guild's lifecycle`,
    `(init → ideate → plan → build → qa → ops), specialists, adversarial review, and`,
    `knowledge ingestion.`,
    ``,
    `## How to drive Guild here`,
    `This host has no native slash-command or agent surface, so invoke Guild by READING`,
    `the relevant skill from the bundled tree and following it. The lifecycle skills live`,
    `under \`${agentsSkillRoot}/meta/\`; specialist skills under`,
    `\`${agentsSkillRoot}/specialists/\`.`,
    ``,
    `## Run the Guild CLI`,
    `A \`guild-run\` launcher is bundled at \`bin/guild-run\` (forwards to the bundled`,
    "`scripts/guild-run.ts`).",
    ``,
    `## Update check (once per session)`,
    // File-surface hosts have no hook events, so the staleness signal cannot
    // fire on its own — this preamble instruction IS the G4 fallback for them
    // (xhrd-wi-04). The bundle ships in this package; the command degrades
    // silently offline and never blocks.
    `This package is a point-in-time copy and does not update itself. At the start`,
    `of a session, if a Node runtime is available, run:`,
    ``,
    "```bash",
    `node hooks/dist/update-check.js --host agents-file`,
    "```",
    ``,
    `and surface any line it prints to the user verbatim — it names the installed`,
    `version, the latest release, and the exact update command for this package.`,
    `Silence is NOT proof of currency: the check needs the`,
    `\`guild-install-receipt.json\` the installer writes beside this file. If that`,
    `receipt is missing (for example, this tree was hand-copied without it), the`,
    `check cannot run — treat the package's age as unknown and suggest re-running`,
    `the installer when the user asks about updates. With the receipt present,`,
    `silence means current-or-offline.`,
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
