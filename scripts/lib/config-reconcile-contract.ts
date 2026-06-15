/**
 * scripts/lib/config-reconcile-contract.ts
 *
 * P1-L0 FOUNDATION — the **config-schema shape + reconcile-mode contract**
 * (`check|sync|repair`, provenance + never-clobber). This is the DESIGN SoT;
 * L9 builds the runtime `config-schema.ts` implementation against it.
 *
 * Contract authority (SoT):
 *   .guild/spec/universal-host-p1.md §9 (config schema + reconciler)
 *   .guild/plan/universal-host-p1.md P1-L9
 *   docs/knowledge/decisions/universal-host-p1-l0-foundation-contracts.md (ADR-addendum)
 *
 * WHY: today's settings live behind `read-guild-config.ts` / `settings-resolver.ts`
 * DEFAULTS with no typed registry, no provenance, no reconcile semantics. P1 introduces
 * a single typed schema registry as the SoT, materialized into workspace/project JSON,
 * and a reconciler that **NEVER overwrites user choices**. The never-clobber invariant
 * is load-bearing (security-auditor depends on it covering security keys too).
 *
 * CONTRACT: pure types + the never-clobber predicate + a pure reconcile reference +
 * validators. No I/O, no clock, never throws. L9 owns materialization/persistence.
 *
 * Owned by plugin-architect (P1-L0); consumed by L9 (impl), Lsec (never-clobber on
 * security keys), Ltest (SC-6 idempotency + never-clobber fixtures).
 */

// ---------------------------------------------------------------------------
// Reconcile modes
// ---------------------------------------------------------------------------

/**
 * The three reconcile modes:
 *   - "check":  report drift only — write NOTHING. (read-only diagnostic)
 *   - "sync":   fill MISSING keys to their schema default; NEVER overwrite a value
 *               the user has set. `config init` becomes `reconcile sync`.
 *   - "repair": additionally coerce a MALFORMED value back to a schema-valid one;
 *               still NEVER clobbers a VALID user choice.
 */
export const RECONCILE_MODES = ["check", "sync", "repair"] as const;
export type ReconcileMode = (typeof RECONCILE_MODES)[number];

// ---------------------------------------------------------------------------
// Field provenance
// ---------------------------------------------------------------------------

/**
 * Where a materialized config value came from. The reconciler reads provenance to
 * decide whether a key is clobberable: ONLY "default"/"reconciled" values may be
 * rewritten; a "user" value is immutable to the reconciler.
 */
export const FIELD_PROVENANCE = ["default", "user", "reconciled"] as const;
export type FieldProvenance = (typeof FIELD_PROVENANCE)[number];

// ---------------------------------------------------------------------------
// Schema field registry
// ---------------------------------------------------------------------------

export type ConfigScope = "workspace" | "project";
export type ConfigValueType = "string" | "number" | "boolean" | "array" | "object" | "enum";

/** One typed field in the config schema registry (the SoT for one setting). */
export interface ConfigFieldSpec {
  /** Dotted config key (e.g. "auto_approve", "security.bypass_permissions_policy"). */
  key: string;
  type: ConfigValueType;
  /** Allowed values when type === "enum". */
  enum_values?: readonly string[];
  /** The schema default — what `sync` fills a MISSING key to. */
  default: unknown;
  scope: ConfigScope;
  /**
   * Security-sensitive flag. The never-clobber invariant applies to ALL keys, but
   * for a security-sensitive key `repair` must FAIL CLOSED: it may never coerce a
   * malformed value DOWN to the permissive `default` (security-auditor F4 — e.g.
   * `bypass_permissions_policy` default `"audit"` is less restrictive than `"deny"`).
   */
  security_sensitive: boolean;
  /**
   * The most-restrictive value for a security-sensitive key (e.g. `"deny"` for
   * `bypass_permissions_policy`). When set, `repair` of a malformed security value
   * coerces to THIS (fail-closed), never to `default`. When absent, `repair` leaves
   * a malformed security value untouched for explicit user resolution — it is NEVER
   * silently weakened. Ignored for non-security keys.
   */
  most_restrictive?: unknown;
}

/**
 * A materialized config value with its provenance metadata. Stored alongside the
 * value in the workspace/project JSON (the reconciler reads it to gate clobbering).
 */
export interface MaterializedField {
  key: string;
  value: unknown;
  provenance: FieldProvenance;
  /** RFC3339 UTC; supplied by the caller (deterministic — no clock here). */
  last_reconciled_at: string | null;
}

// ---------------------------------------------------------------------------
// Never-clobber predicate (load-bearing)
// ---------------------------------------------------------------------------

/**
 * The never-clobber invariant: a reconciler may write `key` ONLY when the current
 * materialized field is absent OR its provenance is "default"/"reconciled". A field
 * with provenance "user" is NEVER overwritten — by any mode, including `repair`,
 * for any key (security keys included).
 *
 * @param current the existing materialized field, or undefined if the key is absent.
 * @returns true iff the reconciler is permitted to write this key.
 */
export function mayReconcileWrite(current: MaterializedField | undefined): boolean {
  if (current === undefined) return true; // absent ⇒ fill is allowed
  return current.provenance !== "user"; // user-set ⇒ immutable to the reconciler
}

// ---------------------------------------------------------------------------
// Reconcile reference (pure)
// ---------------------------------------------------------------------------

export interface ReconcileFinding {
  key: string;
  /** "missing" | "malformed" | "ok" | "user-override-kept". */
  status: "missing" | "malformed" | "ok" | "user-override-kept";
  /**
   * The action the mode took (or would take, for `check`).
   * - "repair-most-restrictive": a malformed SECURITY value coerced to `most_restrictive` (fail-closed, F4).
   * - "security-hold": a malformed SECURITY value left untouched (no `most_restrictive` set) — never weakened (F4).
   */
  action: "none" | "fill-default" | "repair-default" | "repair-most-restrictive" | "security-hold";
  /** The value AFTER reconcile (unchanged for `check` / kept user values). */
  resolved_value: unknown;
  resolved_provenance: FieldProvenance;
}

export interface ReconcileResult {
  mode: ReconcileMode;
  findings: ReconcileFinding[];
  /** True iff any field was (or would be) written. `check` always reports wrote=false. */
  wrote: boolean;
}

/**
 * Pure reconcile reference. L9's runtime reconciler MUST match this decision logic
 * (SC-6 contract-test). Determinism: `now` is supplied by the caller.
 *
 * - `check`  never writes; classifies each field.
 * - `sync`   fills MISSING keys to default (provenance → "reconciled"); keeps user values.
 * - `repair` additionally coerces MALFORMED values to default; keeps VALID user values.
 *
 * "malformed" detection is delegated to `isValidValue` (the schema-aware validator the
 * caller supplies); L0 ships a structural default below.
 */
export function reconcile(
  schema: ConfigFieldSpec[],
  current: Record<string, MaterializedField>,
  mode: ReconcileMode,
  now: string,
  isValidValue: (spec: ConfigFieldSpec, value: unknown) => boolean = defaultIsValidValue
): ReconcileResult {
  const findings: ReconcileFinding[] = [];
  let wrote = false;

  for (const spec of schema) {
    const cur = current[spec.key];

    // Absent ⇒ candidate for fill (sync/repair).
    if (cur === undefined) {
      if (mode === "check") {
        findings.push({
          key: spec.key,
          status: "missing",
          action: "none",
          resolved_value: undefined,
          resolved_provenance: "default",
        });
      } else {
        findings.push({
          key: spec.key,
          status: "missing",
          action: "fill-default",
          resolved_value: spec.default,
          resolved_provenance: "reconciled",
        });
        wrote = true;
      }
      continue;
    }

    // Present + user-set ⇒ NEVER clobbered (any mode, any key).
    if (cur.provenance === "user") {
      findings.push({
        key: spec.key,
        status: "user-override-kept",
        action: "none",
        resolved_value: cur.value,
        resolved_provenance: "user",
      });
      continue;
    }

    // Present + default/reconciled ⇒ repair only if malformed AND mode === repair.
    const valid = isValidValue(spec, cur.value);
    if (!valid && mode === "repair" && spec.security_sensitive) {
      // F4 (security-auditor): NEVER coerce a malformed security value down to the
      // permissive `default`. Fail closed: coerce to `most_restrictive` if declared,
      // else leave it untouched for explicit user resolution.
      if (spec.most_restrictive !== undefined) {
        findings.push({
          key: spec.key,
          status: "malformed",
          action: "repair-most-restrictive",
          resolved_value: spec.most_restrictive,
          resolved_provenance: "reconciled",
        });
        wrote = true;
      } else {
        findings.push({
          key: spec.key,
          status: "malformed",
          action: "security-hold",
          resolved_value: cur.value,
          resolved_provenance: cur.provenance,
        });
      }
    } else if (!valid && mode === "repair") {
      findings.push({
        key: spec.key,
        status: "malformed",
        action: "repair-default",
        resolved_value: spec.default,
        resolved_provenance: "reconciled",
      });
      wrote = true;
    } else if (!valid) {
      findings.push({
        key: spec.key,
        status: "malformed",
        action: "none",
        resolved_value: cur.value,
        resolved_provenance: cur.provenance,
      });
    } else {
      findings.push({
        key: spec.key,
        status: "ok",
        action: "none",
        resolved_value: cur.value,
        resolved_provenance: cur.provenance,
      });
    }
  }

  // `now` participates only when L9 stamps last_reconciled_at on written fields;
  // referenced here so the contract carries the determinism obligation explicitly.
  void now;
  return { mode, findings, wrote };
}

/** Structural default validity check (type-level only; L9 may supply a richer one). */
export function defaultIsValidValue(spec: ConfigFieldSpec, value: unknown): boolean {
  switch (spec.type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "enum":
      return typeof value === "string" && !!spec.enum_values?.includes(value);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const VALUE_TYPE_SET = new Set<string>(["string", "number", "boolean", "array", "object", "enum"]);
const SCOPE_SET = new Set<string>(["workspace", "project"]);

/** Validate a single ConfigFieldSpec. Never throws. */
export function validateConfigFieldSpec(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["config field spec must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  if (typeof o["key"] !== "string" || (o["key"] as string).trim() === "") {
    errors.push("key must be a non-empty string");
  }
  if (typeof o["type"] !== "string" || !VALUE_TYPE_SET.has(o["type"] as string)) {
    errors.push(`type must be one of ${[...VALUE_TYPE_SET].join("|")}; got ${JSON.stringify(o["type"])}`);
  }
  if (o["type"] === "enum" && !Array.isArray(o["enum_values"])) {
    errors.push("enum field must declare enum_values[]");
  }
  if (typeof o["scope"] !== "string" || !SCOPE_SET.has(o["scope"] as string)) {
    errors.push(`scope must be workspace|project; got ${JSON.stringify(o["scope"])}`);
  }
  if (typeof o["security_sensitive"] !== "boolean") {
    errors.push("security_sensitive must be a boolean");
  }
  if (!("default" in o)) {
    errors.push("default must be present (may be null)");
  }
  return { valid: errors.length === 0, errors };
}
