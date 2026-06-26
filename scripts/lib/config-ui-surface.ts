/**
 * scripts/lib/config-ui-surface.ts
 *
 * init-config-goal lane L4 (§E11 / §E12 / V10) — the host-adapter CONFIG-UI
 * presentation core for the CLI / `.agents`-file host families.
 *
 * §E11 (render/edit surface). Given the RESOLVED Guild config + the resolver's
 * per-key inheritance `sources` map, this builds the NATIVE settings surface a
 * CLI/agents-file host renders: config GROUPS → KEYS, each carrying its
 * CONFIG_UI_METADATA (label / control / scope-support / safety-class /
 * confirmation-strength / native component) PLUS the resolved VALUE and the LAYER
 * (`source`) it won from. It also embeds the existing `config-render.ts`
 * `HostConfigRender` (Surface "config" — the host-native model/permission/role
 * projection, reused verbatim — R: never re-spell the renderer).
 *
 * §E12 (persistence path). The surface owns RENDER + EDIT-PLANNING ONLY — it does
 * NO file mutation (V10). `planConfigUiEdit` validates a proposed edit (known key,
 * scope ∈ scope_support) and computes the confirmation the metadata DECLARES for the
 * key's safety class; the actual write is delegated by the command layer to the
 * plugin config API (`config-cmd set` → read-modify-write, validate-before-write,
 * never-clobber, immediate reload). NO `fs` here.
 *
 * App/connector hosts have NO native config surface in this build (L0 OPEN blocker):
 * `buildHostConfigUiSurface` returns `blocked: true` (mirrors `hostOpenPreflight`'s
 * `action:"blocked"` for a non-`CLI_NATIVE_HOSTS` id) — never a false-native render.
 *
 * CONTRACT: PURE. No I/O, no clock (the caller supplies `renderedAt`). Never throws —
 * the two throw-capable steps are guarded: `displayValue` falls back to
 * {@link UNRENDERABLE_VALUE} on an unserializable value, and a throwing embedded
 * `renderHostConfig` is caught and surfaced structurally (`native_render:null` +
 * `render_error`) instead of propagating. Hostile input yields a degraded surface, never
 * an exception. Module: config. Owned by command-builder (L4).
 */

import {
  CONFIG_UI_METADATA,
  getUiMeta,
  type ConfigUiMeta,
  type ConfigScope,
  type ConfirmationStrength,
  CONFIRMATION_ORDER,
} from "./config-ui-metadata";
import { CONFIG_SCHEMA } from "./config-schema";
import { CLI_NATIVE_HOSTS } from "./host-open-preflight";
import {
  HOST_REGISTRY_ROWS,
  type HostId,
} from "./host-registry-schema";
import {
  renderHostConfig,
  type HostConfigRender,
  type RenderConfigLike,
  type ConfigSource,
} from "./config-render";
import type { PermissionDecision } from "./permission-policy-schema";

// ---------------------------------------------------------------------------
// Deterministic group ordering for the rendered panels
// ---------------------------------------------------------------------------

/**
 * The fixed display order of the CONFIG_UI_METADATA groups. Any group that appears
 * in the metadata but is missing here is appended (alphabetically) so a future group
 * is never silently dropped from the surface.
 */
export const CONFIG_UI_GROUP_ORDER: readonly string[] = [
  "startup",
  "host_roles",
  "models",
  "knowledge_recall",
  "team_gates",
  "wiki_quality",
  "indexing",
  "cross_host_runtime",
  "safety_platform",
  "workspace",
];

/** Stable key order = the canonical CONFIG_SCHEMA flatten order (never re-sorts). */
const SCHEMA_KEY_ORDER: readonly string[] = CONFIG_SCHEMA.map((s) => s.key);
const SCHEMA_KEY_INDEX: ReadonlyMap<string, number> = new Map(
  SCHEMA_KEY_ORDER.map((k, i) => [k, i] as const)
);

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

/** The masked stand-in shown for a `replace_only` / secret value (never echo). */
export const SECRET_MASK = "‹redacted — replace-only›" as const;

/** One key's rendered row in the native settings surface (§E11). */
export interface ConfigUiKeyView {
  /** Flattened dotted config key (CONFIG_SCHEMA / CONFIG_UI_METADATA key). */
  readonly key: string;
  readonly group: string;
  readonly label: string;
  readonly control: ConfigUiMeta["control"];
  readonly scope_support: readonly ConfigScope[];
  readonly host_visibility: ConfigUiMeta["host_visibility"];
  readonly editability: ConfigUiMeta["editability"];
  readonly safety_class: ConfigUiMeta["safety_class"];
  readonly confirmation_strength: ConfirmationStrength;
  /** Host-native component hint for this host (host_profiles map → default fallback). */
  readonly native_component: string;
  readonly deprecated: boolean;
  /**
   * The resolved value, ready to display. A `replace_only`/secret key is NEVER echoed:
   * its value is masked to {@link SECRET_MASK} and `redacted` is true.
   */
  readonly value: string;
  /** True iff `value` is the secret mask (the raw value is never present here). */
  readonly redacted: boolean;
  /** The inheritance layer this key won from (or "builtin" when unresolved). */
  readonly source: ConfigSource;
  /** True iff the key was absent from the resolved config (display fell back to default). */
  readonly unset: boolean;
}

/** One rendered group panel: a labelled bucket of key rows. */
export interface ConfigUiGroupView {
  readonly group: string;
  readonly keys: readonly ConfigUiKeyView[];
}

/** The full native settings surface for ONE host (§E11). */
export interface HostConfigUiSurface {
  readonly schema_version: "guild.host_config_ui.v1";
  readonly host_id: string;
  readonly family: string;
  readonly surface_kind: "cli" | "app" | "file";
  readonly provenance: "verified" | "inferred";
  /**
   * True for an app/connector host (∉ CLI_NATIVE_HOSTS) — no native config surface in
   * this build (L0 OPEN blocker). When blocked, `groups` is empty and `native_render`
   * is null; the adapter reports the advisory, never a false-native edit path.
   */
  readonly blocked: boolean;
  /** Advisory code mirroring hostOpenPreflight (`ready` for CLI hosts, `host_unsupported` when blocked). */
  readonly advisory: "ready" | "host_unsupported";
  /** Grouped, ordered key rows (empty when blocked). */
  readonly groups: readonly ConfigUiGroupView[];
  /** Total visible key count across groups. */
  readonly key_count: number;
  /**
   * The reused `config-render.ts` host-native config projection (models / permission
   * decisions / role pins / fail-closed redactions). Null when blocked. This is the
   * SAME object `config show --render` emits — the surface never re-derives it.
   * Null when blocked OR when the embedded render threw (see `render_error`).
   */
  readonly native_render: HostConfigRender | null;
  /**
   * Present (and `native_render` is null) ONLY when the embedded `renderHostConfig`
   * threw on hostile input — a STRUCTURED error surface instead of a thrown exception,
   * so the module honors its "never throws" contract. Absent on success and when blocked.
   */
  readonly render_error?: string;
  readonly _rendered_at: string;
}

// ---------------------------------------------------------------------------
// Value + source resolution (pure)
// ---------------------------------------------------------------------------

/** Read a dotted path out of the resolved config object. Defensive (never throws). */
export function getByPath(config: Record<string, unknown>, dottedKey: string): unknown {
  const parts = dottedKey.split(".");
  let cursor: unknown = config;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * The inheritance layer that scopes `dottedKey`: the key itself, else the nearest
 * dotted-prefix ancestor the resolver tracked (settings-resolver records at
 * top-level-key granularity), else "builtin".
 */
export function sourceForKey(
  dottedKey: string,
  sources: Record<string, ConfigSource> | undefined
): ConfigSource {
  if (!sources) return "builtin";
  const parts = dottedKey.split(".");
  for (let i = parts.length; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(".");
    const src = sources[prefix];
    if (src) return src;
  }
  return "builtin";
}

/**
 * The placeholder shown when a value cannot be serialized (circular ref, BigInt,
 * a throwing `toJSON`/getter). Keeps {@link displayValue} total — it NEVER throws,
 * so the surface contract ("Never throws") holds even on hostile input.
 */
export const UNRENDERABLE_VALUE = "(unrenderable)" as const;

/** Render a resolved value for display (objects/arrays JSON-compacted; null/undefined explicit). */
function displayValue(v: unknown): string {
  if (v === undefined) return "(unset)";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    // JSON.stringify throws on circular refs / BigInt / a throwing toJSON — guard it
    // so a single hostile value can never blow up the whole render (V10 purity claim).
    try {
      const json = JSON.stringify(v);
      // stringify returns undefined for a value that serializes to nothing (e.g. a function).
      return json === undefined ? UNRENDERABLE_VALUE : json;
    } catch {
      return UNRENDERABLE_VALUE;
    }
  }
  try {
    return String(v);
  } catch {
    return UNRENDERABLE_VALUE;
  }
}

/** Is the key visible to this host given its host_visibility allow-list? */
function visibleToHost(meta: ConfigUiMeta, host: string): boolean {
  if (meta.host_visibility === "all") return true;
  return meta.host_visibility.includes(host);
}

/** The host-native component hint for a key on `host`: host-specific map entry, else default. */
function nativeComponentFor(meta: ConfigUiMeta, host: string): string {
  return meta.native_component_map[host] ?? meta.native_component_map["default"] ?? meta.control;
}

// ---------------------------------------------------------------------------
// One key's rendered row
// ---------------------------------------------------------------------------

function buildKeyView(
  key: string,
  meta: ConfigUiMeta,
  host: string,
  config: Record<string, unknown>,
  sources: Record<string, ConfigSource> | undefined
): ConfigUiKeyView {
  const raw = getByPath(config, key);
  const unset = raw === undefined;
  // Never echo a secret / replace_only value — mask it regardless of presence.
  const redacted = meta.editability === "replace_only" || meta.safety_class === "secret";
  const value = redacted ? SECRET_MASK : displayValue(raw);
  return {
    key,
    group: meta.group,
    label: meta.label,
    control: meta.control,
    scope_support: meta.scope_support,
    host_visibility: meta.host_visibility,
    editability: meta.editability,
    safety_class: meta.safety_class,
    confirmation_strength: meta.confirmation_strength,
    native_component: nativeComponentFor(meta, host),
    deprecated: meta.deprecated,
    value,
    redacted,
    source: sourceForKey(key, sources),
    unset,
  };
}

// ---------------------------------------------------------------------------
// buildHostConfigUiSurface — the §E11 render entry point
// ---------------------------------------------------------------------------

export interface BuildSurfaceInput {
  /** The host id the surface renders for (registry id, e.g. "claude-code-cli"). */
  readonly host: string;
  /** The fully-resolved Guild config (settings-resolver `config`). */
  readonly config: RenderConfigLike & Record<string, unknown>;
  /** The resolver's per-key inheritance `sources` map (drives the layer column + render guard). */
  readonly sources?: Record<string, ConfigSource>;
  /** Resolved phase-permission block, forwarded to the reused `renderHostConfig` (optional). */
  readonly permissions?: Record<string, PermissionDecision>;
  /** ISO render timestamp — the caller MUST supply it (the surface never reads the clock). */
  readonly renderedAt: string;
  /** Forwarded render options (redactionPatterns / failMode / sourceVersion) for the embedded render. */
  readonly renderOptions?: {
    redactionPatterns?: string[];
    failMode?: "closed" | "open";
    sourceVersion?: string;
  };
  /** Restrict the surface to a single group (e.g. "models"); omit for all groups. */
  readonly groupFilter?: string;
}

/**
 * Build the native settings surface for one host. App/connector hosts (∉ CLI_NATIVE_HOSTS)
 * return `blocked:true` with no groups — never a false-native edit path. Pure; never throws.
 */
export function buildHostConfigUiSurface(input: BuildSurfaceInput): HostConfigUiSurface {
  const { host, config, sources, permissions, renderedAt } = input;
  const registryRow = HOST_REGISTRY_ROWS[host as HostId];

  // App/connector (or unknown) host → blocked, mirroring hostOpenPreflight (L0 OPEN blocker).
  if (!CLI_NATIVE_HOSTS.has(host)) {
    return {
      schema_version: "guild.host_config_ui.v1",
      host_id: host,
      family: registryRow?.family ?? "unknown",
      surface_kind: registryRow?.surface_kind ?? "app",
      provenance: registryRow?.provenance ?? "inferred",
      blocked: true,
      advisory: "host_unsupported",
      groups: [],
      key_count: 0,
      native_render: null,
      _rendered_at: renderedAt,
    };
  }

  // CLI/agents-file host → full native surface.
  // Group the visible keys (CONFIG_SCHEMA order within each group, fixed group order).
  const byGroup = new Map<string, ConfigUiKeyView[]>();
  for (const [key, meta] of Object.entries(CONFIG_UI_METADATA)) {
    if (input.groupFilter && meta.group !== input.groupFilter) continue;
    if (!visibleToHost(meta, host)) continue;
    const view = buildKeyView(key, meta, host, config, sources);
    const bucket = byGroup.get(meta.group);
    if (bucket) bucket.push(view);
    else byGroup.set(meta.group, [view]);
  }

  // Order the buckets: known groups first (fixed order), then any extra group alphabetically.
  const orderedGroupNames = [
    ...CONFIG_UI_GROUP_ORDER.filter((g) => byGroup.has(g)),
    ...[...byGroup.keys()].filter((g) => !CONFIG_UI_GROUP_ORDER.includes(g)).sort(),
  ];

  const groups: ConfigUiGroupView[] = [];
  let keyCount = 0;
  for (const g of orderedGroupNames) {
    const rows = (byGroup.get(g) ?? []).sort(
      (a, b) =>
        (SCHEMA_KEY_INDEX.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
        (SCHEMA_KEY_INDEX.get(b.key) ?? Number.MAX_SAFE_INTEGER)
    );
    keyCount += rows.length;
    groups.push({ group: g, keys: rows });
  }

  // Reuse config-render.ts verbatim for the host-native config projection (Surface "config").
  // Guard it: a hostile config could make the embedded render throw — surface that as a
  // STRUCTURED error (native_render:null + render_error) rather than throwing out of a module
  // whose contract is "never throws".
  let native_render: HostConfigRender | null;
  let render_error: string | undefined;
  try {
    native_render = renderHostConfig(host as HostId, {
      config,
      permissions,
      sources,
      options: {
        renderedAt,
        sourceVersion: input.renderOptions?.sourceVersion,
        redactionPatterns: input.renderOptions?.redactionPatterns,
        failMode: input.renderOptions?.failMode,
      },
    });
  } catch (e) {
    native_render = null;
    render_error = e instanceof Error ? e.message : String(e);
  }

  return {
    schema_version: "guild.host_config_ui.v1",
    host_id: host,
    family: registryRow.family,
    surface_kind: registryRow.surface_kind,
    provenance: registryRow.provenance,
    blocked: false,
    advisory: "ready",
    groups,
    key_count: keyCount,
    native_render,
    ...(render_error !== undefined ? { render_error } : {}),
    _rendered_at: renderedAt,
  };
}

// ---------------------------------------------------------------------------
// Edit planning (§E12) — confirmation-strength gate, NO file mutation (V10)
// ---------------------------------------------------------------------------

function confirmationRank(c: ConfirmationStrength): number {
  return CONFIRMATION_ORDER.indexOf(c);
}

/**
 * Confirmations that the host's NORMAL settings-write confirmation already covers
 * (`config set` always asks). For these the explicit `--confirm` token is optional;
 * for `advanced`/`danger`/`strongest` the operator MUST supply a confirmation that
 * meets-or-exceeds the declared strength.
 */
const IMPLICITLY_CONFIRMED: ReadonlySet<ConfirmationStrength> = new Set<ConfirmationStrength>([
  "none",
  "normal",
]);

/** The confirmation strength a given key's edit DECLARES (from CONFIG_UI_METADATA). */
export function requiredConfirmationFor(key: string): ConfirmationStrength | undefined {
  return getUiMeta(key)?.confirmation_strength;
}

/** A planned edit — what the command layer needs to decide whether to delegate the write. */
export interface ConfigUiEditPlan {
  /** True iff the edit is well-formed AND the confirmation requirement is met. */
  readonly ok: boolean;
  readonly key: string;
  readonly scope: ConfigScope;
  /** The confirmation the metadata declares for this key (the floor the operator must meet). */
  readonly required_confirmation: ConfirmationStrength;
  /** Whether an explicit confirmation token is required at all (false for none/normal keys). */
  readonly confirmation_required: boolean;
  /** Whether the supplied confirmation satisfies the requirement. */
  readonly confirmation_satisfied: boolean;
  readonly editability: ConfigUiMeta["editability"];
  readonly safety_class: ConfigUiMeta["safety_class"];
  /** Present when `ok` is false — why the edit cannot proceed (caller must NOT write). */
  readonly reason?: string;
}

export interface PlanEditInput {
  readonly key: string;
  readonly scope: ConfigScope;
  /** The `--confirm <strength>` token the operator supplied, if any. */
  readonly providedConfirmation?: ConfirmationStrength;
}

/**
 * Plan (but NEVER execute) a config edit (§E12). Validates the key is a known
 * CONFIG_UI_METADATA key and the target scope is in its `scope_support`, then computes
 * whether the supplied confirmation meets the declared confirmation-strength. The caller
 * delegates the actual write to the plugin config API ONLY when `ok` is true — this
 * function performs NO file mutation (V10).
 */
export function planConfigUiEdit(input: PlanEditInput): ConfigUiEditPlan {
  const { key, scope, providedConfirmation } = input;
  const meta = getUiMeta(key);

  if (!meta) {
    return {
      ok: false,
      key,
      scope,
      required_confirmation: "normal",
      confirmation_required: false,
      confirmation_satisfied: false,
      editability: "editable",
      safety_class: "normal",
      reason: `unknown config key "${key}" — not in the CONFIG_UI_METADATA table`,
    };
  }

  const required = meta.confirmation_strength;
  const confirmationRequired = !IMPLICITLY_CONFIRMED.has(required);

  if (!meta.scope_support.includes(scope)) {
    return {
      ok: false,
      key,
      scope,
      required_confirmation: required,
      confirmation_required: confirmationRequired,
      confirmation_satisfied: false,
      editability: meta.editability,
      safety_class: meta.safety_class,
      reason: `scope "${scope}" is not supported for "${key}" — valid scopes: ${meta.scope_support.join(", ")}`,
    };
  }

  let confirmationSatisfied: boolean;
  if (!confirmationRequired) {
    confirmationSatisfied = true; // covered by the host's normal always-ask settings write
  } else {
    confirmationSatisfied =
      providedConfirmation !== undefined &&
      confirmationRank(providedConfirmation) >= confirmationRank(required);
  }

  const reason =
    confirmationRequired && !confirmationSatisfied
      ? `key "${key}" (${meta.safety_class}) requires a "${required}" confirmation — re-run with --confirm ${required}`
      : undefined;

  return {
    ok: confirmationSatisfied,
    key,
    scope,
    required_confirmation: required,
    confirmation_required: confirmationRequired,
    confirmation_satisfied: confirmationSatisfied,
    editability: meta.editability,
    safety_class: meta.safety_class,
    reason,
  };
}

/** Parse a raw `--confirm` token into a ConfirmationStrength, or undefined if not a valid token. */
export function parseConfirmation(token: string | undefined): ConfirmationStrength | undefined {
  if (token === undefined) return undefined;
  return (CONFIRMATION_ORDER as readonly string[]).includes(token)
    ? (token as ConfirmationStrength)
    : undefined;
}
