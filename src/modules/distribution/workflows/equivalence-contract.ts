/**
 * src/modules/distribution/workflows/equivalence-contract.ts
 *
 * L0 FOUNDATION — the Claude FULL-TREE equivalence contract (SC-2).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/guild-inventory-and-parity-contracts.md §Equivalence contract
 *   spec .guild/spec/universal-host-p0.md SC-2
 *
 * SC-2: the GENERATED Claude artifact (dist/claude-code/**) must be functionally
 * EQUIVALENT to the COMMITTED Claude package across the FULL installed tree —
 * manifest, commands, skills, agents, hooks+bootstrap, MCP refs, scripts refs —
 * OR every omitted/changed surface is explicitly enumerated as an INTENTIONAL
 * exclusion. Checking only plugin.json + skills/ would pass VACUOUSLY; the
 * contract spans all eight logical surfaces below.
 *
 * EQUIVALENCE ≠ byte-identity. It is content equivalence after canonical
 * normalization: JSON is key-sorted and render-provenance fields are stripped;
 * text is trailing-whitespace/newline normalized. Two surfaces are equivalent
 * iff their normalized forms are equal.
 *
 * PURITY: the caller (L2 build-host-packages.ts, L6 tests) reads BOTH trees off
 * disk into the `LogicalPackage` shape; this module compares them. No filesystem
 * access here (per-host-packaging.ts convention).
 *
 * Owned by plugin-architect (L0); consumed by L2, L6.
 */

// ---------------------------------------------------------------------------
// Logical package view — the eight full-tree surfaces (decoupled from dist layout)
// ---------------------------------------------------------------------------

/**
 * A normalized, layout-independent view of a Claude package. The caller maps
 * physical paths (committed plugin/** or generated dist/claude-code/**) into this
 * shape so the equivalence check never hard-codes a dist directory structure.
 *
 * Every surface here is in the SC-2 equivalence scope. A surface that is null/
 * empty in one side but populated in the other is a mismatch unless covered by
 * an INTENTIONAL_EXCLUSION.
 */
export interface LogicalPackage {
  /** Parsed .claude-plugin/plugin.json object. */
  manifest: Record<string, unknown>;
  /** command id → file content (commands/*.md). */
  commands: Record<string, string>;
  /** skill id → SKILL.md content (skills/**). */
  skills: Record<string, string>;
  /** agent id → file content (agents/*.md). */
  agents: Record<string, string>;
  /** Parsed hooks/hooks.json object. */
  hooks_json: Record<string, unknown>;
  /** hooks/bootstrap.sh content. */
  bootstrap_sh: string;
  /** Parsed .mcp.json object (MCP server references). */
  mcp_json: Record<string, unknown>;
  /** Set of script ids the package references (scripts/** + mcp-server dist refs). */
  script_refs: string[];
}

/** The eight logical surfaces, in scope for SC-2. Iterated by the checker. */
export const EQUIVALENCE_SURFACES = [
  "manifest",
  "commands",
  "skills",
  "agents",
  "hooks_json",
  "bootstrap_sh",
  "mcp_json",
  "script_refs",
] as const;

// ---------------------------------------------------------------------------
// Enumerated INTENTIONAL exclusions (SC-2 "or every omission enumerated")
// ---------------------------------------------------------------------------

export interface IntentionalExclusion {
  /** Dotted surface/field path the exclusion applies to. */
  path: string;
  /** Why this delta is intentional, not drift. */
  reason: string;
  /** What guards the delta INSTEAD of equivalence (so it is not unverified). */
  verified_by: string;
}

/**
 * The CLOSED set of intentional exclusions for Phase 1. Any delta NOT on this
 * list is a SC-2 failure. Adding to this list is an explicit, reviewed decision.
 */
export const INTENTIONAL_EXCLUSIONS: IntentionalExclusion[] = [
  {
    path: "hooks_json.SessionStart (using-guild additionalContext injection)",
    reason:
      "L5b deliberately changes Claude SessionStart from bootstrap.sh plain-stdout " +
      "banners to hookSpecificOutput.additionalContext injection — a chosen format " +
      "change, NOT zero-delta (spec SC-8).",
    verified_by: "L5b golden test (NOT this equivalence check).",
  },
  {
    path: "*._rendered_at, *._source_version, generated_at",
    reason:
      "Render-provenance fields are build metadata the committed package does not " +
      "carry; they are normalized OUT before comparison, never compared.",
    verified_by: "normalizeJson() strips them (PROVENANCE_FIELDS).",
  },
  {
    path: "manifest.skills, manifest.commands, manifest.agents (glob ordering)",
    reason:
      "The generated manifest's skill/command/agent path globs derive from the " +
      "inventory in a canonical order; ordering is not semantically meaningful.",
    verified_by:
      "normalizeJson() sorts arrays of path-strings for these manifest fields " +
      "(see SORTED_MANIFEST_ARRAYS) so order deltas are not failures.",
  },
];

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Render-provenance keys stripped from every JSON object before comparison. */
export const PROVENANCE_FIELDS = new Set<string>([
  "_rendered_at",
  "_source_version",
  "generated_at",
]);

/** Manifest array fields whose element order is normalized (sorted) before compare. */
export const SORTED_MANIFEST_ARRAYS = new Set<string>(["skills", "commands", "agents"]);

/**
 * Recursively canonicalize a JSON value: drop provenance fields, sort object keys,
 * and sort the SORTED_MANIFEST_ARRAYS string arrays. Returns a new value with a
 * deterministic shape suitable for deep-equality via JSON.stringify.
 */
export function normalizeJson(value: unknown, keyPath = ""): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map((v) => normalizeJson(v));
    // Sort only the designated manifest path-string arrays (stable, string-only).
    const leaf = keyPath.split(".").pop() ?? "";
    if (SORTED_MANIFEST_ARRAYS.has(leaf) && mapped.every((v) => typeof v === "string")) {
      return [...(mapped as string[])].sort();
    }
    return mapped;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      if (PROVENANCE_FIELDS.has(k)) continue;
      out[k] = normalizeJson((value as Record<string, unknown>)[k], k);
    }
    return out;
  }
  return value;
}

/** Normalize text: strip trailing whitespace per line + collapse trailing blank lines. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n+$/g, "\n");
}

/** Deep-equality of two JSON values after normalization. */
export function jsonEquivalent(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalizeJson(a)) === JSON.stringify(normalizeJson(b));
}

/** Equivalence of two text blobs after normalization. */
export function textEquivalent(a: string, b: string): boolean {
  return normalizeText(a) === normalizeText(b);
}

// ---------------------------------------------------------------------------
// The full-tree equivalence check
// ---------------------------------------------------------------------------

export interface EquivalenceResult {
  ok: boolean;
  /** Per-surface mismatch reasons. */
  reasons: string[];
  /** Surfaces that matched (for an audit trail / "not vacuous" evidence). */
  surfaces_compared: string[];
}

/**
 * The expected floor — the id/ref set each surface MUST contain, derived from
 * guild.inventory.v1 by the caller (L2/L6). Supplying this turns SC-2 from
 * "compare whatever was loaded" into "prove the full tree was loaded AND matches":
 * a snapshot that misloaded (omitted) a surface fails instead of passing
 * vacuously. STRONGLY RECOMMENDED for any real SC-2 gate.
 */
export interface ExpectedSurfaces {
  commands: string[];
  skills: string[];
  agents: string[];
  script_refs: string[];
}

/** Assert every expected id is present in a snapshot's id set; collect misses. */
function assertFloor(
  surface: string,
  side: string,
  presentIds: Iterable<string>,
  expectedIds: string[],
  reasons: string[]
): void {
  const present = new Set(presentIds);
  for (const id of expectedIds) {
    if (!present.has(id)) {
      reasons.push(
        `equivalence: ${side} package is missing expected ${surface} "${id}" — ` +
          `snapshot did not load the full tree (vacuity guard, SC-2)`
      );
    }
  }
}

function compareIdMap(
  surface: string,
  committed: Record<string, string>,
  generated: Record<string, string>,
  reasons: string[]
): void {
  const cIds = new Set(Object.keys(committed));
  const gIds = new Set(Object.keys(generated));
  for (const id of cIds) {
    if (!gIds.has(id)) {
      reasons.push(`equivalence: ${surface} "${id}" present in committed package but MISSING from generated (SC-2)`);
      continue;
    }
    if (!textEquivalent(committed[id]!, generated[id]!)) {
      reasons.push(`equivalence: ${surface} "${id}" content differs between committed and generated (SC-2)`);
    }
  }
  for (const id of gIds) {
    if (!cIds.has(id)) {
      reasons.push(`equivalence: ${surface} "${id}" present in generated package but has NO committed counterpart and is not an enumerated addition (SC-2)`);
    }
  }
}

/**
 * SC-2 full-tree equivalence. Compares all eight logical surfaces. The caller is
 * responsible for having already applied the INTENTIONAL_EXCLUSIONS that change a
 * surface's expected content (e.g. for the L5b SessionStart delta, the caller
 * compares hooks_json with that injection masked, since it is golden-tested
 * separately). This function compares what it is given, surface by surface, and
 * reports every mismatch.
 *
 * Pure: takes two already-read LogicalPackage snapshots.
 */
export function checkClaudeEquivalence(
  committed: LogicalPackage,
  generated: LogicalPackage,
  expected?: ExpectedSurfaces
): EquivalenceResult {
  const reasons: string[] = [];
  const compared: string[] = [];

  // Anti-vacuity floor: if the caller supplies the inventory-derived expected
  // sets, prove BOTH snapshots actually loaded every expected surface before
  // comparing. A misloaded/empty snapshot fails here instead of passing as
  // "compared". (See ExpectedSurfaces — strongly recommended for a real gate.)
  if (expected) {
    assertFloor("command", "committed", Object.keys(committed.commands), expected.commands, reasons);
    assertFloor("command", "generated", Object.keys(generated.commands), expected.commands, reasons);
    assertFloor("skill", "committed", Object.keys(committed.skills), expected.skills, reasons);
    assertFloor("skill", "generated", Object.keys(generated.skills), expected.skills, reasons);
    assertFloor("agent", "committed", Object.keys(committed.agents), expected.agents, reasons);
    assertFloor("agent", "generated", Object.keys(generated.agents), expected.agents, reasons);
    assertFloor("script_ref", "committed", committed.script_refs, expected.script_refs, reasons);
    assertFloor("script_ref", "generated", generated.script_refs, expected.script_refs, reasons);
  }

  // manifest
  compared.push("manifest");
  if (!jsonEquivalent(committed.manifest, generated.manifest)) {
    reasons.push("equivalence: manifest (.claude-plugin/plugin.json) differs after normalization (SC-2)");
  }

  // id-keyed file surfaces
  compared.push("commands", "skills", "agents");
  compareIdMap("commands", committed.commands, generated.commands, reasons);
  compareIdMap("skills", committed.skills, generated.skills, reasons);
  compareIdMap("agents", committed.agents, generated.agents, reasons);

  // hooks.json
  compared.push("hooks_json");
  if (!jsonEquivalent(committed.hooks_json, generated.hooks_json)) {
    reasons.push(
      "equivalence: hooks/hooks.json differs after normalization — if this is the L5b " +
        "SessionStart injection, mask it per INTENTIONAL_EXCLUSIONS before comparing (SC-2/SC-8)"
    );
  }

  // bootstrap.sh
  compared.push("bootstrap_sh");
  if (!textEquivalent(committed.bootstrap_sh, generated.bootstrap_sh)) {
    reasons.push("equivalence: hooks/bootstrap.sh differs after normalization (SC-2)");
  }

  // .mcp.json
  compared.push("mcp_json");
  if (!jsonEquivalent(committed.mcp_json, generated.mcp_json)) {
    reasons.push("equivalence: .mcp.json (MCP server references) differs after normalization (SC-2)");
  }

  // script references (set equality)
  compared.push("script_refs");
  const cRefs = new Set(committed.script_refs);
  const gRefs = new Set(generated.script_refs);
  for (const r of cRefs) {
    if (!gRefs.has(r)) reasons.push(`equivalence: script ref "${r}" in committed but MISSING from generated (SC-2)`);
  }
  for (const r of gRefs) {
    if (!cRefs.has(r)) reasons.push(`equivalence: script ref "${r}" in generated but not in committed (SC-2)`);
  }

  return { ok: reasons.length === 0, reasons, surfaces_compared: compared };
}
