/**
 * src/modules/distribution/workflows/inventory-schema.ts
 *
 * L0 FOUNDATION — canonical TypeScript type + runtime validator for the
 * `guild.inventory.v1` neutral core inventory.
 *
 * Contract authority (SoT):
 *   ADR: universal-host-plugin-architecture (workspace wiki)
 *     §Decision (1. Neutral core inventory) · §P0: Make the package surface universal
 *   ADR: guild-inventory-and-parity-contracts (workspace wiki) (this lane's ADR)
 *
 * WHAT THIS IS: the single, host-neutral description of every Guild surface —
 * commands, skills, agents, hooks, MCP servers, scripts, schemas, and docs —
 * described ONCE, with stable host-neutral ids and the repo-relative source path
 * each surface is authored at. Every host package (Claude, Codex, …) is RENDERED
 * from this inventory; the inventory itself is the source of truth, NOT any one
 * host's package format (ADR Non-Goal: "Do not preserve Claude file formats as
 * canonical for every host").
 *
 * CONTRACT (mirrors per-host-packaging.ts conventions):
 *   - This module is PURE: types + a `validateInventoryV1()` validator that never
 *     does I/O, never reads the clock, never throws. Callers (L1 build-inventory.ts)
 *     do the filesystem scan and supply `generated_at`.
 *   - Every surface list MUST be present (may be empty). A missing list is a
 *     validation error — this is what makes SC-7(a) coverage enforceable: you
 *     cannot silently drop a whole category.
 *   - Within a category, `id` MUST be unique. Duplicate ids are a validation error.
 *
 * Consumers:
 *   - L1 scripts/build-inventory.ts → emits plugin/guild.inventory.json conforming here.
 *   - L2 scripts/build-host-packages.ts → renders Claude full-tree + Codex FROM here.
 *   - L6 tests → parity (SC-7) + equivalence (SC-2) fixtures validate against here.
 *
 * Owned by plugin-architect (L0); consumed by every downstream lane.
 */

// ---------------------------------------------------------------------------
// Surface categories — the closed set (ADR Decision §1)
// ---------------------------------------------------------------------------

/**
 * The eight neutral surface categories. This list is CLOSED for guild.inventory.v1:
 * adding a category is a schema-version bump, not an additive change, because the
 * coverage contract (SC-7a) iterates exactly these keys.
 */
export const INVENTORY_CATEGORIES = [
  "commands",
  "skills",
  "agents",
  "hooks",
  "mcp_servers",
  "scripts",
  "schemas",
  "docs",
] as const;

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Entry types
// ---------------------------------------------------------------------------

/** Fields shared by every inventory entry. */
export interface InventoryEntryBase {
  /**
   * Stable, host-neutral id, UNIQUE within its category.
   * Examples: command "plan", skill "guild:review", agent "architect".
   * This is the identity the parity contract (SC-7) keys on — it must be derived
   * deterministically by discovery (see parity-contract.ts §DISCOVERY).
   */
  id: string;
  /**
   * Repo-relative path (POSIX separators) the surface is authored at.
   * Renderers copy/transform FROM this path. Example: "commands/plan.md".
   * NOT prefixed with "./" — bare repo-relative.
   */
  source_path: string;
}

/** A slash-command surface. id = bare command token ("plan", not "/guild:plan"). */
export interface CommandEntry extends InventoryEntryBase {
  /** Optional one-line description (from the command file's frontmatter/heading). */
  description?: string;
}

/** A skill surface. id = the skill `name:` frontmatter value (e.g. "guild:review"). */
export interface SkillEntry extends InventoryEntryBase {
  /**
   * The skill tier folder it lives under: core | meta | knowledge | specialists |
   * guild-quality | guild-operations. Derived from source_path; carried for
   * host renderers that group skills by tier.
   */
  tier?: string;
  /** Optional one-line description (skill frontmatter `description:`). */
  description?: string;
}

/** An agent/specialist surface. id = bare agent name ("architect"). */
export interface AgentEntry extends InventoryEntryBase {
  /** Optional one-line description (agent frontmatter `description:`). */
  description?: string;
}

/**
 * A hook surface — one (event, script) binding from hooks/hooks.json.
 * id = "<event>:<script-basename>" (stable, unique per binding).
 */
export interface HookEntry extends InventoryEntryBase {
  /**
   * Normalized Guild hook event name (the GuildHookEvent taxonomy L5a owns):
   * e.g. "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop",
   * "SubagentStop", "TaskCreated", "TaskCompleted", "TeammateIdle".
   */
  event: string;
  /** Optional host-specific matcher expression (applied by the host adapter). */
  matcher?: string;
}

/** An MCP server surface. id = stable server id ("guild-memory"). */
export interface McpServerEntry extends InventoryEntryBase {
  /** Transport the server uses. */
  transport: "stdio" | "http";
  /** Launch command (stdio servers). */
  command?: string;
  /** Launch arguments (stdio servers). */
  args?: string[];
  /** HTTP endpoint (http servers). */
  url?: string;
  /** Declared read-only posture (from .mcp.json mcp_capability.read_only). */
  read_only?: boolean;
  /** Optional human-readable description. */
  description?: string;
}

/** A script surface. id = logical script name (basename without .ts, or a stable label). */
export interface ScriptEntry extends InventoryEntryBase {
  /**
   * Whether the script is a CLI entrypoint or a library module.
   *   - "cli": invocable (has a main / shebang).
   *   - "lib": imported helper (scripts/lib/**).
   */
  kind?: "cli" | "lib";
}

/**
 * A result-contract / schema surface — the result-contract registry (item e).
 * id = the canonical machine `schema_version` string EXACTLY as it appears on the
 * wire (e.g. "guild.handoff.v2", "review_result.v1" — note the latter has NO
 * `guild.` prefix; see result-contracts.ts for the verified registry).
 */
export interface SchemaEntry extends InventoryEntryBase {
  /**
   * Producer status:
   *   - "exists":   a real producer/validator exists today (Phase-1 normalizer target).
   *   - "deferred": no producer yet; do NOT design ahead of it (premature churn).
   */
  status: "exists" | "deferred";
  /**
   * The validator strictness for an existing contract:
   *   - "strict":  rejects unknown keys (e.g. validateHandoffV2).
   *   - "lenient": consume-only minimal reader (e.g. parseReviewResult).
   *   - "none":    deferred (no validator yet).
   */
  validator_kind?: "strict" | "lenient" | "none";
}

/** A doc surface. id = stable doc slug/path. */
export interface DocEntry extends InventoryEntryBase {
  /** Optional title. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Manifest metadata (host-neutral subset of plugin.json)
// ---------------------------------------------------------------------------

/**
 * The host-neutral manifest metadata block. This is the plugin-identity subset
 * that every host package shares; host-specific fields (skill globs, command
 * globs) are DERIVED from the surface lists, never duplicated here.
 */
export interface InventoryManifest {
  /** Plugin display name (e.g. "guild"). */
  name: string;
  /** Semver version. Version of record: .claude-plugin/plugin.json. */
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
}

// ---------------------------------------------------------------------------
// The top-level inventory
// ---------------------------------------------------------------------------

/**
 * `guild.inventory.v1` — the neutral core inventory. One generated document from
 * which every host package is rendered.
 */
export interface GuildInventoryV1 {
  /** Self-versioned discriminator; always "guild.inventory.v1". */
  schema_version: "guild.inventory.v1";
  /**
   * Provenance: caller-supplied ISO 8601 build timestamp. The builder MUST pass
   * this — this module never reads the clock. Excluded from SC-2 equivalence
   * normalization (it is render metadata, not package content).
   */
  generated_at: string;
  /** The plugin version this inventory was generated from. */
  plugin_version: string;
  /** Host-neutral manifest metadata. */
  manifest: InventoryManifest;
  /** Slash-command surfaces. Present (may be empty). */
  commands: CommandEntry[];
  /** Skill surfaces. Present (may be empty). */
  skills: SkillEntry[];
  /** Agent/specialist surfaces. Present (may be empty). */
  agents: AgentEntry[];
  /** Hook (event, script) bindings. Present (may be empty). */
  hooks: HookEntry[];
  /** MCP server surfaces. Present (may be empty). */
  mcp_servers: McpServerEntry[];
  /** Script surfaces. Present (may be empty). */
  scripts: ScriptEntry[];
  /** Result-contract / schema registry (item e). Present (may be empty). */
  schemas: SchemaEntry[];
  /** Doc surfaces. Present (may be empty). */
  docs: DocEntry[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Validation result — never throws (per-host-packaging.ts convention). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** All top-level keys allowed in guild.inventory.v1 (strict — extras rejected). */
export const ALLOWED_INVENTORY_KEYS = new Set<string>([
  "schema_version",
  "generated_at",
  "plugin_version",
  "manifest",
  ...INVENTORY_CATEGORIES,
]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

/** Validate a single entry's shared base (id + source_path) and collect errors. */
function validateEntryBase(
  entry: unknown,
  category: InventoryCategory,
  index: number,
  errors: string[]
): { id?: string } {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    errors.push(`${category}[${index}] must be a non-null object`);
    return {};
  }
  const e = entry as Record<string, unknown>;
  if (!isNonEmptyString(e["id"])) {
    errors.push(`${category}[${index}].id must be a non-empty string`);
  }
  // A DEFERRED result-contract has no producer file yet → empty source_path is
  // legitimate (it is the only case; everything else MUST carry a real path).
  // This lets L1 emit inventory.schemas[] straight from the result-contracts
  // registry (which includes deferred rows) and still pass validation.
  const isDeferredSchema = category === "schemas" && e["status"] === "deferred";
  if (!isNonEmptyString(e["source_path"])) {
    if (!(isDeferredSchema && e["source_path"] === "")) {
      errors.push(
        `${category}[${index}].source_path must be a non-empty string` +
          (category === "schemas" ? ` (empty allowed only for status:"deferred")` : "")
      );
    }
  } else if ((e["source_path"] as string).startsWith("./")) {
    errors.push(
      `${category}[${index}].source_path must be bare repo-relative (no "./" prefix): ` +
        `got ${JSON.stringify(e["source_path"])}`
    );
  }
  return { id: typeof e["id"] === "string" ? e["id"] : undefined };
}

/** Validate a category list is present, an array, and has unique ids. */
function validateCategory(
  obj: Record<string, unknown>,
  category: InventoryCategory,
  errors: string[]
): void {
  const list = obj[category];
  if (!Array.isArray(list)) {
    errors.push(`${category} must be an array (may be empty, but must be present)`);
    return;
  }
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const { id } = validateEntryBase(list[i], category, i, errors);
    if (id !== undefined) {
      if (seen.has(id)) {
        errors.push(`${category} has duplicate id ${JSON.stringify(id)} (ids must be unique within a category)`);
      }
      seen.add(id);
    }
    // Category-specific required fields
    const e = list[i] as Record<string, unknown>;
    if (category === "hooks" && !isNonEmptyString(e?.["event"])) {
      errors.push(`hooks[${i}].event must be a non-empty string`);
    }
    if (category === "mcp_servers") {
      const t = e?.["transport"];
      if (t !== "stdio" && t !== "http") {
        errors.push(`mcp_servers[${i}].transport must be "stdio" or "http"; got ${JSON.stringify(t)}`);
      }
    }
    if (category === "schemas") {
      const s = e?.["status"];
      if (s !== "exists" && s !== "deferred") {
        errors.push(`schemas[${i}].status must be "exists" or "deferred"; got ${JSON.stringify(s)}`);
      }
    }
  }
}

/**
 * Runtime validator for `guild.inventory.v1`.
 * Returns { valid, errors } listing every violation — callers surface structured
 * rejection. Never throws.
 */
export function validateInventoryV1(value: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["inventory must be a non-null object"] };
  }
  const obj = value as Record<string, unknown>;

  for (const k of Object.keys(obj)) {
    if (!ALLOWED_INVENTORY_KEYS.has(k)) {
      errors.push(`unknown key "${k}" — strict guild.inventory.v1 rejects extra/misspelled keys`);
    }
  }

  if (obj["schema_version"] !== "guild.inventory.v1") {
    errors.push(
      `schema_version must be "guild.inventory.v1"; got ${JSON.stringify(obj["schema_version"])}`
    );
  }
  if (!isNonEmptyString(obj["generated_at"])) {
    errors.push("generated_at must be a non-empty ISO 8601 string");
  }
  if (!isNonEmptyString(obj["plugin_version"])) {
    errors.push("plugin_version must be a non-empty string");
  }

  // manifest
  const manifest = obj["manifest"];
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    errors.push("manifest must be a non-null object");
  } else {
    const m = manifest as Record<string, unknown>;
    if (!isNonEmptyString(m["name"])) errors.push("manifest.name must be a non-empty string");
    if (!isNonEmptyString(m["version"])) errors.push("manifest.version must be a non-empty string");
    if (typeof m["description"] !== "string") errors.push("manifest.description must be a string");
  }

  // every category present + valid
  for (const category of INVENTORY_CATEGORIES) {
    validateCategory(obj, category, errors);
  }

  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to GuildInventoryV1 after passing validation. */
export function isInventoryV1(value: unknown): value is GuildInventoryV1 {
  return validateInventoryV1(value).valid;
}
