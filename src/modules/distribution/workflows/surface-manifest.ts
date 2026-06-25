/**
 * src/modules/distribution/workflows/surface-manifest.ts
 *
 * W7 (declarative-surface EXEMPLAR SLICE) — the typed validator for the
 * `guild.surface_manifest.v1` declarative metadata contract.
 *
 * WHY THIS EXISTS (target-architecture.md §11, §4 R-LIVE):
 *   The live surface (skills/commands/agents) is PROSE instructions to the model —
 *   the body must stay verbatim. But the STRUCTURED, drift-prone parts (the
 *   frontmatter, the trigger/when_to_use phrasings, the type/tier, the gate list,
 *   the dispatch targets) are exactly the class the P1 audit found drifting
 *   (dispatch-table / gate-list / tier drift). This module defines an ADDITIVE
 *   declarative block — `surface_manifest:` inside the file's frontmatter — that
 *   EXTRACTS those parts into one validated shape. It does NOT replace the prose:
 *   the block is metadata the rail can check against the prose it mirrors.
 *
 * CONTRACT: pure validation. No file I/O, no clock, never throws. Callers parse a
 *   document's frontmatter (via scripts/lib/frontmatter.ts — the one canonical
 *   reader) and hand the `surface_manifest` value here. The R-DECL rail
 *   (tests/rearch/r-decl.ts) is the real-path consumer; it ALSO cross-checks each
 *   validated block against the file's own prose/frontmatter (the anti-drift half).
 *
 * Owner: skill-author (W7). Consumed by tests/rearch/r-decl.ts + parity tests.
 */

export const SURFACE_MANIFEST_SCHEMA_VERSION = "guild.surface_manifest.v1" as const;

/** The three live-surface artifact classes a manifest can describe. */
export type SurfaceKind = "skill" | "command" | "agent";
export const SURFACE_KINDS: readonly SurfaceKind[] = ["skill", "command", "agent"];

/**
 * The declarative metadata block. Common structured metadata across
 * skills/commands/agents. Optional fields are present only where the kind
 * legitimately carries them (e.g. `tier` for agents, `gates` for commands).
 */
export interface SurfaceManifest {
  schema_version: typeof SURFACE_MANIFEST_SCHEMA_VERSION;
  kind: SurfaceKind;
  /** The artifact name — MUST equal the file's frontmatter `name`. */
  name: string;
  /** The artifact description — MUST equal the file's frontmatter `description`. */
  description: string;
  /**
   * Skills/agents: the `when_to_use` phrasing (skill) or trigger phrasing (agent).
   * Commands have no when_to_use; they declare `dispatch_targets` instead.
   * Present iff the source declares one.
   */
  when_to_use?: string;
  /**
   * The skill `type` (e.g. "specialist") or the agent TIER (cheap|mid|powerful,
   * derived from the agent's `model:` per capability/tier-defaults.ts). Commands
   * have no type/tier. Present iff the source declares one.
   */
  type?: string;
  /**
   * Gate identifiers the artifact enforces (e.g. a command's interactive `I`
   * gate). Present iff the source declares any.
   */
  gates?: string[];
  /**
   * Names of the skills/agents this artifact dispatches/chains into — the
   * drift-prone "dispatch table". For a command, the skill it forwards to; for a
   * skill, the skills its Handoff chains into; for an agent, none when it returns
   * an envelope rather than dispatching. Present iff the source declares any.
   */
  dispatch_targets?: string[];
}

export interface ValidationResult {
  ok: boolean;
  /** The validated manifest when ok; null otherwise. */
  manifest: SurfaceManifest | null;
  /** Human-readable reasons the input failed (empty when ok). */
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0);
}

/**
 * Validate an arbitrary parsed value as a `guild.surface_manifest.v1` block.
 * Pure: returns a result, never throws. `ok` is true only when EVERY required
 * field is present and well-typed and every optional field (when present) is
 * well-typed; unknown keys are rejected (a typo'd field is drift, not noise).
 */
export function validateSurfaceManifest(input: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, manifest: null, errors: ["manifest is not an object"] };
  }

  // schema_version (required, exact)
  if (input.schema_version !== SURFACE_MANIFEST_SCHEMA_VERSION) {
    errors.push(
      `schema_version must be "${SURFACE_MANIFEST_SCHEMA_VERSION}" (got ${JSON.stringify(input.schema_version)})`,
    );
  }

  // kind (required, enum)
  if (typeof input.kind !== "string" || !SURFACE_KINDS.includes(input.kind as SurfaceKind)) {
    errors.push(`kind must be one of ${SURFACE_KINDS.join("|")} (got ${JSON.stringify(input.kind)})`);
  }
  const kind = input.kind as SurfaceKind;

  // name (required, non-empty string)
  if (typeof input.name !== "string" || input.name.trim() === "") {
    errors.push("name must be a non-empty string");
  }

  // description (required, non-empty string)
  if (typeof input.description !== "string" || input.description.trim() === "") {
    errors.push("description must be a non-empty string");
  }

  // when_to_use (optional string). A command must NOT carry when_to_use.
  if (input.when_to_use !== undefined) {
    if (typeof input.when_to_use !== "string" || input.when_to_use.trim() === "") {
      errors.push("when_to_use, when present, must be a non-empty string");
    } else if (kind === "command") {
      errors.push("commands must not declare when_to_use (use dispatch_targets)");
    }
  }

  // type (optional string). A command must NOT carry a type/tier.
  if (input.type !== undefined) {
    if (typeof input.type !== "string" || input.type.trim() === "") {
      errors.push("type, when present, must be a non-empty string");
    } else if (kind === "command") {
      errors.push("commands must not declare type/tier");
    }
  }

  // gates (optional string[])
  if (input.gates !== undefined && !isStringArray(input.gates)) {
    errors.push("gates, when present, must be a non-empty-string array");
  }

  // dispatch_targets (optional string[])
  if (input.dispatch_targets !== undefined && !isStringArray(input.dispatch_targets)) {
    errors.push("dispatch_targets, when present, must be a non-empty-string array");
  }

  // unknown-key rejection (a typo'd field is silent drift)
  const ALLOWED = new Set([
    "schema_version",
    "kind",
    "name",
    "description",
    "when_to_use",
    "type",
    "gates",
    "dispatch_targets",
  ]);
  for (const k of Object.keys(input)) {
    if (!ALLOWED.has(k)) errors.push(`unknown manifest key: ${k}`);
  }

  if (errors.length > 0) return { ok: false, manifest: null, errors };

  const manifest: SurfaceManifest = {
    schema_version: SURFACE_MANIFEST_SCHEMA_VERSION,
    kind,
    name: input.name as string,
    description: input.description as string,
  };
  if (input.when_to_use !== undefined) manifest.when_to_use = input.when_to_use as string;
  if (input.type !== undefined) manifest.type = input.type as string;
  if (input.gates !== undefined) manifest.gates = input.gates as string[];
  if (input.dispatch_targets !== undefined) {
    manifest.dispatch_targets = input.dispatch_targets as string[];
  }
  return { ok: true, manifest, errors: [] };
}
