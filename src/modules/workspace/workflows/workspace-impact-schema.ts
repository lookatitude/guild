/**
 * scripts/lib/workspace-impact-schema.ts
 *
 * P2-Wave-1 ADDITIVE CONTRACT — `guild.workspace_impact.v1`: the impact map the LW1-4
 * detector emits BEFORE planning, naming the child repos a change set affects and
 * whether the affected set was computed transitively (ADR migration step 13 / AC33-34,
 * spec SC-W1-4).
 *
 * Contract authority (SoT):
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §Workspace impact (AC33/34)
 *   .guild/spec/universal-host-p2-wave1.md  SC-W1-4
 *   .guild/plan/universal-host-p2-wave1.md  lane LW1-1 (shape) / LW1-4 (emitter)
 *
 * WHY: AC33's isolation rule (R2/F-7) is that the impact map carries ONLY child
 * ids/paths/dependency-reasons — never any content derived from a child's `.guild/wiki`.
 * This schema encodes exactly that surface AND enforces it physically: each `affected`
 * entry is STRICT (only id/path/dependency_reason allowed — extra keys are rejected so
 * child-wiki text cannot be smuggled), and `dependency_reason` is a bounded single line
 * (≤280 chars) so bulk content cannot ride through it. The map answers: given
 * `changed_set`, which children are `affected[]`, by what `dependency_reason`, and was
 * the set `transitive`.
 *
 * Shape:
 *   - changed_set[]  — the input change set (child ids/paths that changed)
 *   - affected[]     — { id, path, dependency_reason } per affected child (STRICT keys)
 *   - transitive     — boolean: was the affected set closed over the dependency edges
 *
 * CONTRACT: `changed_set`/`affected` PRESENT arrays (may be empty — a no-op change set
 * legitimately yields zero affected children); every present element fails closed; strict
 * unknown-key rejection; bounded `dependency_reason`; NEVER throws on exotic input. Pure
 * types + validator; no I/O, no clock, no process IO at module scope. Returns
 * `{ valid, errors }` matching the P1 convention.
 *
 * Owned by tooling-engineer (LW1-1); emitted by LW1-4 (impact detector), checked by
 * LW1-8 (negatives + anti-vacuous isolation test).
 */

// ---------------------------------------------------------------------------
// Schema constant + result shape
// ---------------------------------------------------------------------------

export const WORKSPACE_IMPACT_SCHEMA_VERSION = "guild.workspace_impact.v1" as const;

/** Max length for a single-line dependency_reason (bulk-content guard, F-7). */
export const DEPENDENCY_REASON_MAX_LEN = 280;

/** Fail-closed validator result — `{ valid, errors }` (P1 convention). */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Sub-shape — one affected child (ids/paths/reasons ONLY; no child knowledge)
// ---------------------------------------------------------------------------

export interface AffectedChild {
  /** Affected child-repo id (matches a dependency-graph node id). */
  id: string;
  /** Workspace-relative path to the affected child repo. */
  path: string;
  /** Why it is affected — a bounded reference reason, NOT child content. */
  dependency_reason: string;
}

const AFFECTED_ALLOWED_KEYS = ["id", "path", "dependency_reason"];

// ---------------------------------------------------------------------------
// Type — `guild.workspace_impact.v1`
// ---------------------------------------------------------------------------

export interface WorkspaceImpactV1 {
  schema_version: typeof WORKSPACE_IMPACT_SCHEMA_VERSION;
  /** The input change set (child ids/paths that changed). Present array; may be empty. */
  changed_set: string[];
  /** Affected children by id/path/dependency_reason. Present array; may be empty. */
  affected: AffectedChild[];
  /** Whether the affected set was closed transitively over the dependency edges. */
  transitive: boolean;
}

const IMPACT_ALLOWED_KEYS = ["schema_version", "changed_set", "affected", "transitive"];

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
 * Bound a dependency_reason (F-7): single line, ≤DEPENDENCY_REASON_MAX_LEN chars — caps
 * the field so bulk child-wiki content cannot be smuggled. Assumes `value` is a string.
 */
function checkBoundedReason(errors: string[], value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    errors.push(`${field} must be a single line (no embedded newlines)`);
  }
  if (value.length > DEPENDENCY_REASON_MAX_LEN) {
    errors.push(
      `${field} exceeds ${DEPENDENCY_REASON_MAX_LEN} chars (got ${value.length}); single-line reference only`
    );
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an unknown value against `guild.workspace_impact.v1`. Fails closed on a
 * missing `changed_set`/`affected` array, any malformed element, an unknown key (incl.
 * smuggled keys on an affected entry), an over-long/multi-line dependency_reason, or a
 * non-boolean `transitive`. The arrays MAY be empty (the legitimate "nothing impacted"
 * map). Never throws; returns `{ valid, errors }`.
 */
export function validateWorkspaceImpactV1(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["workspace impact map must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;

  rejectUnknownKeys(errors, o, IMPACT_ALLOWED_KEYS, "workspace impact map");

  if (typeof o["schema_version"] !== "string" || o["schema_version"] !== WORKSPACE_IMPACT_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${WORKSPACE_IMPACT_SCHEMA_VERSION}"; got ${show(o["schema_version"])}`);
  }

  // changed_set — required array; MAY be empty; each entry a non-empty string.
  const changed = o["changed_set"];
  if (!Array.isArray(changed)) {
    errors.push(`"changed_set" must be an array (may be empty, but the field is required)`);
  } else {
    changed.forEach((el, i) => {
      if (typeof el !== "string" || el.trim() === "") {
        errors.push(`changed_set[${i}] must be a non-empty string`);
      }
    });
  }

  // affected — required array; MAY be empty; each entry STRICT { id, path, dependency_reason }
  // all non-empty, dependency_reason bounded. This is the isolation surface (F-7).
  const affected = o["affected"];
  if (!Array.isArray(affected)) {
    errors.push(`"affected" must be an array (may be empty, but the field is required)`);
  } else {
    affected.forEach((el, i) => {
      if (typeof el !== "object" || el === null || Array.isArray(el)) {
        errors.push(`affected[${i}] must be an object { id, path, dependency_reason }`);
        return;
      }
      const a = el as Record<string, unknown>;
      // Strict keys: reject any extra key so child-wiki text cannot be smuggled (AC33/F-7).
      rejectUnknownKeys(errors, a, AFFECTED_ALLOWED_KEYS, `affected[${i}]`);
      if (typeof a["id"] !== "string" || a["id"].trim() === "") {
        errors.push(`affected[${i}].id must be a non-empty string`);
      }
      if (typeof a["path"] !== "string" || a["path"].trim() === "") {
        errors.push(`affected[${i}].path must be a non-empty string`);
      }
      const reason = a["dependency_reason"];
      if (typeof reason !== "string" || reason.trim() === "") {
        errors.push(`affected[${i}].dependency_reason must be a non-empty string`);
      } else {
        checkBoundedReason(errors, reason, `affected[${i}].dependency_reason`);
      }
    });
  }

  // transitive — required boolean.
  if (typeof o["transitive"] !== "boolean") {
    errors.push(`"transitive" must be a boolean; got ${show(o["transitive"])}`);
  }

  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows to WorkspaceImpactV1 after passing validation. */
export function isWorkspaceImpactV1(value: unknown): value is WorkspaceImpactV1 {
  return validateWorkspaceImpactV1(value).valid;
}

// ---------------------------------------------------------------------------
// Deterministic examples (for LW1-8 fixtures)
// ---------------------------------------------------------------------------

/** A valid `guild.workspace_impact.v1` sample (a transitive 2-child impact). */
export const WORKSPACE_IMPACT_V1_EXAMPLE: WorkspaceImpactV1 = {
  schema_version: WORKSPACE_IMPACT_SCHEMA_VERSION,
  changed_set: ["guild-plugin"],
  affected: [
    { id: "guild-website", path: "website", dependency_reason: "depends on guild-plugin" },
    { id: "guild-benchmark", path: "benchmark", dependency_reason: "depends on guild-plugin" },
  ],
  transitive: true,
};

/** A valid "nothing impacted" map — proves the empty-but-present arrays are legal. */
export const WORKSPACE_IMPACT_V1_EMPTY_EXAMPLE: WorkspaceImpactV1 = {
  schema_version: WORKSPACE_IMPACT_SCHEMA_VERSION,
  changed_set: [],
  affected: [],
  transitive: false,
};

// ---------------------------------------------------------------------------
// Import-pure self-check (NO process IO at module scope — F8-F11). LW1-8 may call it.
// ---------------------------------------------------------------------------

/**
 * Deterministic smoke check. Returns `{ pass, details }`; NO process IO, never exits.
 * Confirms the valid sample + empty map pass, a smuggled-extra-key affected entry fails
 * closed, and an exotic BigInt schema_version fails closed WITHOUT throwing.
 */
export function runSelfCheck(): { pass: boolean; details: string } {
  const good = validateWorkspaceImpactV1(WORKSPACE_IMPACT_V1_EXAMPLE);
  const empty = validateWorkspaceImpactV1(WORKSPACE_IMPACT_V1_EMPTY_EXAMPLE);
  // Negative: an affected entry with a smuggled extra key — must fail closed (F-7).
  const smuggled = validateWorkspaceImpactV1({
    schema_version: WORKSPACE_IMPACT_SCHEMA_VERSION,
    changed_set: ["guild-plugin"],
    affected: [
      { id: "guild-website", path: "website", dependency_reason: "depends", wiki_text: "secret child content" },
    ],
    transitive: true,
  });
  let exoticThrew = false;
  let exoticRejected = false;
  try {
    exoticRejected = !validateWorkspaceImpactV1({
      ...WORKSPACE_IMPACT_V1_EXAMPLE,
      schema_version: 1n as unknown,
    }).valid;
  } catch {
    exoticThrew = true;
  }
  const pass = good.valid && empty.valid && !smuggled.valid && exoticRejected && !exoticThrew;
  return {
    pass,
    details: `valid-sample=${good.valid} empty-map=${empty.valid} smuggled-key-rejected=${!smuggled.valid} bigint-rejected-no-throw=${exoticRejected && !exoticThrew}`,
  };
}
