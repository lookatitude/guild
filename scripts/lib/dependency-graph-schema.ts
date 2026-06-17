/**
 * scripts/lib/dependency-graph-schema.ts
 *
 * P2-Wave-1 ADDITIVE CONTRACT — `guild.dependency_graph.v1`: a first-class, DISTINCT
 * artifact (`.guild/workspace/dependency-graph.json`) declaring the child repos of a
 * workspace and the DIRECTED dependency edges between them (ADR migration step 13 /
 * AC33, spec SC-W1-4; G-spec finding F-2).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §Workspace impact (AC33)
 *   .guild/spec/universal-host-p2-wave1.md  SC-W1-4 + "Design clarifications" (F-2)
 *   .guild/plan/universal-host-p2-wave1.md  lane LW1-1 (shape) / LW1-4 (consumer)
 *
 * WHY this is distinct from `product-map.json` (F-2): `product-map.json`
 * (`guild.workspace.product_map.v1`) is a cross-cutting PORTFOLIO map. The dependency
 * graph is the DIRECTED build-order / impact substrate the LW1-4 impact detector walks
 * to compute the transitive affected set. The detector reads BOTH; they are not merged.
 *
 * Shape:
 *   - nodes[]  — child repos, each { id (UNIQUE), path } ; references children by
 *                id/path only (no embedded child knowledge — AC33 isolation).
 *   - edges[]  — directed `from depends-on to`, each { from, to, reason? } ; endpoints
 *                must reference declared node ids; no self-loop; reason is a bounded,
 *                single-line reference (≤280 chars — bulk wiki content cannot ride it).
 *
 * CONTRACT: fail-closed rules — `nodes` non-empty (unique ids, non-empty paths);
 * `edges` PRESENT (may be empty) with referential integrity + no self-loop + bounded
 * reason; strict unknown-key rejection on every object; NEVER throws on exotic input.
 * Pure types + validator; no I/O, no clock, no process IO at module scope. Returns
 * `{ valid, errors }` matching the P1 convention.
 *
 * Owned by tooling-engineer (LW1-1); consumed by LW1-4 (impact detector), LW1-8 (negatives).
 */

// ---------------------------------------------------------------------------
// Schema constant + result shape
// ---------------------------------------------------------------------------

export const DEPENDENCY_GRAPH_SCHEMA_VERSION = "guild.dependency_graph.v1" as const;

/** Max length for a single-line reference reason (bulk-content guard, F-7). */
export const REASON_MAX_LEN = 280;

/** Fail-closed validator result — `{ valid, errors }` (P1 convention). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Sub-shapes
// ---------------------------------------------------------------------------

/** A child repo node — referenced by id/path only (no embedded child knowledge). */
export interface DependencyNode {
  /** Stable, UNIQUE child-repo id (matches a workspace child id). */
  id: string;
  /** Workspace-relative path to the child repo root. */
  path: string;
}

/** A directed dependency edge: `from` depends on `to`. */
export interface DependencyEdge {
  /** Dependent node id (the repo that consumes). */
  from: string;
  /** Dependency node id (the repo that is consumed). */
  to: string;
  /** Optional bounded single-line reason (e.g. "imports shared schema"). */
  reason?: string;
}

const NODE_ALLOWED_KEYS = ["id", "path"];
const EDGE_ALLOWED_KEYS = ["from", "to", "reason"];

// ---------------------------------------------------------------------------
// Type — `guild.dependency_graph.v1`
// ---------------------------------------------------------------------------

export interface DependencyGraphV1 {
  schema_version: typeof DEPENDENCY_GRAPH_SCHEMA_VERSION;
  /** Child repos (must be non-empty; ids unique). */
  nodes: DependencyNode[];
  /** Directed `from depends-on to` edges (present array; MAY be empty). */
  edges: DependencyEdge[];
}

const GRAPH_ALLOWED_KEYS = ["schema_version", "nodes", "edges"];

// ---------------------------------------------------------------------------
// Shared, never-throwing helpers (local — keeps the module self-contained)
// ---------------------------------------------------------------------------

/** Never-throwing stringify for error messages (guards BigInt/undefined/exotic). */
function show(v: unknown): string {
  if (typeof v === "bigint") return `${v.toString()}n`;
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

/** Strict: push an error for any key on `obj` not in `allowed`. */
function rejectUnknownKeys(
  errors: string[],
  obj: Record<string, unknown>,
  allowed: string[],
  label: string
): void {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      errors.push(`${label} has unknown key "${k}" (strict: only ${allowed.join(", ")} allowed)`);
    }
  }
}

/**
 * Bound a reference reason (F-7): single line, ≤REASON_MAX_LEN chars. This caps the
 * field so bulk child-wiki content cannot be smuggled through a "reason". Assumes the
 * caller has already confirmed `value` is a string.
 */
function checkBoundedReason(errors: string[], value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    errors.push(`${field} must be a single line (no embedded newlines)`);
  }
  if (value.length > REASON_MAX_LEN) {
    errors.push(`${field} exceeds ${REASON_MAX_LEN} chars (got ${value.length}); single-line reference only`);
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value against `guild.dependency_graph.v1`. Fails closed on:
 * missing/empty `nodes`, malformed/duplicate nodes, a missing `edges` field, an edge
 * referencing an unknown node, a self-loop edge, an over-long/multi-line reason, or any
 * unknown key. Never throws; returns `{ valid, errors }`.
 */
export function validateDependencyGraphV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["dependency graph must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;

  rejectUnknownKeys(errors, o, GRAPH_ALLOWED_KEYS, "dependency graph");

  if (typeof o["schema_version"] !== "string" || o["schema_version"] !== DEPENDENCY_GRAPH_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${DEPENDENCY_GRAPH_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }

  // nodes — non-empty array of { id (unique), path } ; strict keys.
  const nodeIds = new Set<string>();
  const nodes = o["nodes"];
  if (!Array.isArray(nodes)) {
    errors.push(`"nodes" must be an array of { id, path }`);
  } else if (nodes.length === 0) {
    errors.push(`"nodes" must not be empty (fail-closed required field)`);
  } else {
    nodes.forEach((el, i) => {
      if (typeof el !== "object" || el === null || Array.isArray(el)) {
        errors.push(`nodes[${i}] must be an object { id, path }`);
        return;
      }
      const n = el as Record<string, unknown>;
      rejectUnknownKeys(errors, n, NODE_ALLOWED_KEYS, `nodes[${i}]`);
      const id = n["id"];
      if (typeof id !== "string" || id.trim() === "") {
        errors.push(`nodes[${i}].id must be a non-empty string`);
      } else if (nodeIds.has(id)) {
        errors.push(`nodes[${i}].id "${id}" is a duplicate; node ids must be unique`);
      } else {
        nodeIds.add(id);
      }
      if (typeof n["path"] !== "string" || n["path"].trim() === "") {
        errors.push(`nodes[${i}].path must be a non-empty string`);
      }
    });
  }

  // edges — PRESENT array (may be empty); strict keys; endpoints declared; no self-loop;
  // bounded reason. Referential integrity is load-bearing for LW1-4.
  const edges = o["edges"];
  if (!Array.isArray(edges)) {
    errors.push(`"edges" must be an array (may be empty, but the field is required)`);
  } else {
    edges.forEach((el, i) => {
      if (typeof el !== "object" || el === null || Array.isArray(el)) {
        errors.push(`edges[${i}] must be an object { from, to, reason? }`);
        return;
      }
      const e = el as Record<string, unknown>;
      rejectUnknownKeys(errors, e, EDGE_ALLOWED_KEYS, `edges[${i}]`);
      const from = e["from"];
      const to = e["to"];
      const fromOk = typeof from === "string" && from.trim() !== "";
      const toOk = typeof to === "string" && to.trim() !== "";
      if (!fromOk) errors.push(`edges[${i}].from must be a non-empty node id`);
      if (!toOk) errors.push(`edges[${i}].to must be a non-empty node id`);
      if (fromOk && toOk && from === to) {
        errors.push(`edges[${i}] is a self-loop ("${from as string}" → itself); not allowed`);
      }
      if (fromOk && nodeIds.size > 0 && !nodeIds.has(from as string)) {
        errors.push(`edges[${i}].from "${from as string}" references an unknown node`);
      }
      if (toOk && nodeIds.size > 0 && !nodeIds.has(to as string)) {
        errors.push(`edges[${i}].to "${to as string}" references an unknown node`);
      }
      if (e["reason"] !== undefined) {
        if (typeof e["reason"] !== "string") {
          errors.push(`edges[${i}].reason, when present, must be a string`);
        } else {
          checkBoundedReason(errors, e["reason"], `edges[${i}].reason`);
        }
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to DependencyGraphV1 after passing validation. */
export function isDependencyGraphV1(value: unknown): value is DependencyGraphV1 {
  return validateDependencyGraphV1(value).valid;
}

// ---------------------------------------------------------------------------
// Deterministic example (for LW1-8 fixtures)
// ---------------------------------------------------------------------------

/** A valid `guild.dependency_graph.v1` sample (≥3 child repos, one edge). */
export const DEPENDENCY_GRAPH_V1_EXAMPLE: DependencyGraphV1 = {
  schema_version: DEPENDENCY_GRAPH_SCHEMA_VERSION,
  nodes: [
    { id: "guild-plugin", path: "plugin" },
    { id: "guild-website", path: "website" },
    { id: "guild-benchmark", path: "benchmark" },
  ],
  edges: [
    { from: "guild-website", to: "guild-plugin", reason: "docs the plugin surface" },
    { from: "guild-benchmark", to: "guild-plugin", reason: "evals the plugin behavior" },
  ],
};

// ---------------------------------------------------------------------------
// Import-pure self-check (NO process IO at module scope — F8-F11). LW1-8 may call it.
// ---------------------------------------------------------------------------

/**
 * Deterministic smoke check. Returns `{ pass, details }`; NO process IO, never exits.
 * Confirms the valid sample passes, a dangling edge fails closed, and an exotic BigInt
 * schema_version fails closed WITHOUT throwing.
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  const good = validateDependencyGraphV1(DEPENDENCY_GRAPH_V1_EXAMPLE);
  const dangling: DependencyGraphV1 = {
    ...DEPENDENCY_GRAPH_V1_EXAMPLE,
    edges: [{ from: "guild-website", to: "does-not-exist" }],
  };
  const bad = validateDependencyGraphV1(dangling);
  let exoticThrew = false;
  let exoticRejected = false;
  try {
    exoticRejected = !validateDependencyGraphV1({
      ...DEPENDENCY_GRAPH_V1_EXAMPLE,
      schema_version: 1n as unknown,
    }).valid;
  } catch {
    exoticThrew = true;
  }
  const pass = good.valid && !bad.valid && exoticRejected && !exoticThrew;
  return {
    pass,
    details: `valid-sample=${good.valid} dangling-edge-rejected=${!bad.valid} bigint-rejected-no-throw=${exoticRejected && !exoticThrew}`,
  };
}
