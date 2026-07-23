/**
 * scripts/lib/config-schema.ts
 *
 * P1-L9 — the typed config-schema SoT (`guild.config_schema.v1`), built against the
 * L0 `config-reconcile-contract.ts` shape. It is DERIVED from the single canonical
 * default tree (`read-guild-config.ts` DEFAULTS) by deep-flattening to dotted keys —
 * so the schema can never drift from the values `scaffold()` emits, and `reconcile
 * sync` on a fresh repo is byte-identical to today's `config init` (SC-6).
 *
 * Flattening rule: recurse into plain NON-empty objects; treat primitives, arrays, and
 * EMPTY objects as terminal leaves (one ConfigFieldSpec each). So `models.tiers.cheap.
 * claude` is a field, while `mcp.tool_description_hashes` ({}) and
 * `defaults.team.always_include` ([]) are single object/array leaves.
 *
 * CONTRACT: pure. No I/O, no clock. Owned by tooling-engineer (P1-L9); consumed by
 * config-reconcile.ts (impl), Lsec (security-key coverage), Ltest (SC-6 fixtures).
 */

import {
  type ConfigFieldSpec,
  type ConfigValueType,
} from "./config-reconcile-contract";
import { DEFAULTS } from "../read-guild-config";

/**
 * P1-L10 host autonomy modes (permission-policy-schema.ts HOST_MODES — the SoT).
 * Duplicated here as a small closed literal union (mirrors config-cli.ts's/
 * settings-reader.ts's existing inline-enum convention) rather than an import,
 * since permission-policy-schema.ts has not been migrated into a src/modules/*
 * workflow yet.
 */
const HOST_MODES = ["read_only", "ask", "accept_edits", "auto", "bypass_all"] as const;

// ---------------------------------------------------------------------------
// Security-sensitive key classification (load-bearing — Lsec asserts coverage)
// ---------------------------------------------------------------------------

/**
 * A dotted key is security-sensitive when it governs autonomy, permission/bypass
 * posture, secrets handling, remote dispatch, or MCP trust pinning. The never-clobber
 * invariant applies to ALL keys; this flag lets Lsec assert security keys are covered
 * (no silent weakening of a permission default on reconcile).
 */
export function isSecuritySensitiveKey(key: string): boolean {
  return (
    key === "auto_approve" ||
    key === "defaults.gates.auto_approve" ||
    key === "codex_skip_enforcement" ||
    key.startsWith("security.") ||
    key.startsWith("secrets_policy.") ||
    key.startsWith("defaults.cross_host") ||
    key === "mcp.tool_description_hashes" ||
    // rf-wi-01 (G1): host_mode governs P1-L10 host autonomy (bypass_all can disable a
    // host's native tool-permission prompt) — the sanctioned, schema-registered
    // replacement for the ad-hoc `security.host_mode` key the #54 lane reverted.
    key === "host_mode"
  );
}

// ---------------------------------------------------------------------------
// Flatten / unflatten (dotted-key projection of the nested settings tree)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True for a value that is a flattening LEAF (primitive | array | empty object). */
function isLeaf(v: unknown): boolean {
  if (!isPlainObject(v)) return true; // primitive or array
  return Object.keys(v).length === 0; // empty object is a terminal leaf
}

/**
 * Deep-flatten a settings object to a dotted-key → leaf-value map, preserving the
 * source key order (so an unflatten round-trip reproduces the original ordering).
 * `_help` is never flattened (it is presentation, not a config field).
 */
export function flattenSettings(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (prefix === "" && k === "_help") continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (isLeaf(v)) out[key] = v;
    else Object.assign(out, flattenSettings(v as Record<string, unknown>, key));
  }
  return out;
}

/**
 * Rebuild a nested object from a dotted-key map. Used by the reconciler to overlay
 * kept user values onto a clone of the default tree without disturbing key order.
 */
export function setDotted(target: Record<string, unknown>, dottedKey: string, value: unknown): void {
  const parts = dottedKey.split(".");
  let node = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isPlainObject(node[p])) node[p] = {};
    node = node[p] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

// ---------------------------------------------------------------------------
// Type inference + schema construction
// ---------------------------------------------------------------------------

function inferType(value: unknown): ConfigValueType {
  if (Array.isArray(value)) return "array";
  if (value === null) return "object"; // null leaves (initiative_default, loops, bridge_package) — nullable; structural validity is lenient
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

/**
 * F4 (Lsec) — security-sensitive ENUM fields declare `most_restrictive` (+ explicit
 * `enum_values`) so that `repair` of a MALFORMED reconciled value fails CLOSED: it
 * coerces to the safest value rather than the permissive `default` ("repair-default")
 * or the passive "security-hold". Order is most-restrictive → least. Marking these as
 * `enum` (vs the value-inferred "string") also makes an INVALID enum value — not just a
 * wrong type — count as malformed, so the fail-closed repair actually fires.
 *
 * NOTE: a value that EQUALS its default (e.g. a fresh `sync`) is always valid, and a
 * `user`-provenance value is never touched — so this only changes the malformed
 * RECONCILED-security path, exactly per the F4 finding.
 */
interface SecurityEnumOverride {
  enum_values: readonly string[];
  most_restrictive: string;
}
const SECURITY_ENUM_OVERRIDES: Record<string, SecurityEnumOverride> = {
  "security.bypass_permissions_policy": { enum_values: ["deny", "audit", "allow"], most_restrictive: "deny" },
  codex_skip_enforcement: { enum_values: ["warn", "block"], most_restrictive: "block" },
  "secrets_policy.fail_mode_durable": { enum_values: ["closed", "open"], most_restrictive: "closed" },
  "secrets_policy.fail_mode_telemetry": { enum_values: ["open", "closed"], most_restrictive: "closed" },
};

/**
 * F4 (Lsec) — security-sensitive NON-enum fields whose most-restrictive value isn't an
 * enum member. The autonomy allow-lists fail closed to `[]` (no auto-approval = the
 * safest posture): a MALFORMED reconciled value (e.g. a string/object instead of an
 * array) is actively repaired to `[]` rather than left corrupt via "security-hold".
 * Type stays value-inferred ("array"); only `most_restrictive` is added.
 */
const SECURITY_MOST_RESTRICTIVE_NONENUM: Record<string, unknown> = {
  auto_approve: [],
  "defaults.gates.auto_approve": [],
};

/**
 * rf-wi-01 (G1 codex-review fix) — NULLABLE enum fields: `null` is ALSO a valid value
 * (not just a schema default) alongside the enum members. `inferType(null)` would
 * otherwise classify these as type "object", under which `defaultIsValidValue`
 * requires `typeof value === "object"` — so a genuinely VALID enum string (e.g.
 * `host_mode: "read_only"`) would be misclassified as malformed and `reconcile
 * repair` would reset it back to `null` (P1 finding, reproduced: a user's real
 * `host_mode` setting got silently clobbered on repair).
 *
 * `most_restrictive` is an EXPLICIT enum member, NOT `null` (round-2 codex-review
 * P1 fix): `null` reads as "safest" in isolation, but for `host_mode` specifically
 * it is NOT — `tmux-backend.ts`'s `resolveTeamPaneHostMode` lifts an unset/null
 * host_mode to `"bypass_all"` for team panes (the #54 fix), so repairing a
 * malformed value to `null` would fail-OPEN, not fail-closed, on that path.
 * `"read_only"` is the genuinely most-restrictive HOST_MODES member regardless of
 * consumer (it never grants edit/bypass autonomy to any host).
 */
interface NullableEnumOverride {
  enum_values: readonly string[];
  most_restrictive: string;
}
const NULLABLE_ENUM_OVERRIDES: Record<string, NullableEnumOverride> = {
  host_mode: { enum_values: HOST_MODES, most_restrictive: "read_only" },
};

/**
 * The `guild.config_schema.v1` field registry, derived from the canonical DEFAULTS
 * tree. One ConfigFieldSpec per flattened leaf; `default` is the canonical value
 * (single source ⇒ no drift). Scope is "project" (today's settings.json target).
 *
 * Type is value-inferred (lenient — structural validity drives MISSING-fill +
 * never-clobber), EXCEPT the security-sensitive enum fields in SECURITY_ENUM_OVERRIDES,
 * which carry explicit enum_values + most_restrictive for the F4 fail-closed repair.
 * Rich enum validation for the other keys stays in read-guild-config's closed-key
 * validators (validateDefaults), which the reconciler does not replace.
 */
export const CONFIG_SCHEMA: ConfigFieldSpec[] = (() => {
  const flat = flattenSettings(DEFAULTS as unknown as Record<string, unknown>);
  return Object.entries(flat).map(([key, def]) => {
    const override = SECURITY_ENUM_OVERRIDES[key];
    const nullableEnum = NULLABLE_ENUM_OVERRIDES[key];
    const spec: ConfigFieldSpec = {
      key,
      type: override || nullableEnum ? "enum" : inferType(def),
      default: def,
      scope: "project",
      security_sensitive: isSecuritySensitiveKey(key),
    };
    if (override) {
      spec.enum_values = override.enum_values;
      spec.most_restrictive = override.most_restrictive;
    } else if (nullableEnum) {
      spec.enum_values = nullableEnum.enum_values;
      spec.nullable = true;
      spec.most_restrictive = nullableEnum.most_restrictive;
    } else if (key in SECURITY_MOST_RESTRICTIVE_NONENUM) {
      spec.most_restrictive = SECURITY_MOST_RESTRICTIVE_NONENUM[key];
    }
    return spec;
  });
})();

/** Lookup a field spec by dotted key. */
export function getFieldSpec(key: string): ConfigFieldSpec | undefined {
  return CONFIG_SCHEMA.find((s) => s.key === key);
}
