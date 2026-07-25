/**
 * scripts/lib/config-render.ts
 *
 * P2-Wave-1 LW1-6 (SC-W1-8 / ADR step 14) — the **per-host config rendering core**.
 *
 * Renders the RESOLVED Guild config (including the P1 phase-permission block) into each
 * of the FIVE supported host native config shapes — strictly **via the host-registry
 * capability rows** (`host-registry-schema.ts` `HOST_REGISTRY_ROWS`), the SINGLE source
 * of truth. The renderer reads CAPABILITY COLUMNS, never the host NAME (R3: render
 * desync prevention). A field the host cannot express is stubbed + flagged in
 * `_unsupported` (render-or-degrade — the same house contract as per-host-packaging.ts),
 * never silently omitted.
 *
 * DISTINCT from `per-host-packaging.ts` (Surface 1): that renders the host-native
 * PACKAGE MANIFEST (plugin.json / TOML / pi-block). THIS renders the host-native
 * CONFIG (resolved settings + permission decisions + role pins) — Surface "config".
 *
 * SECURITY — FAIL CLOSED (SC-W1-8 / F-9 / R6). A shared host output must NEVER carry a
 * `local`-scope value or a secret:
 *   - LOCAL leak: any config key whose resolved `source` is `workspace-local` /
 *     `project-local` (i.e. it came from a gitignored settings.local.json) is WITHHELD
 *     from the shared render and recorded in `_redactions` (reason "local-scope").
 *   - SECRET leak: every string the renderer would emit is scanned against the canonical
 *     `SECRET_PATTERNS` (docs-hygiene/scan.ts — the SoT, NOT re-spelled here) plus any
 *     operator-supplied `redactionPatterns` (mirrors `secrets_policy.redaction_patterns`).
 *     A match is replaced with `<SECRET-REDACTED:label>` and recorded.
 *   The raw secret/local value is NEVER present in the returned object. When
 *   `failMode === "closed"` (the durable-artifact default) any detected leak sets
 *   `ok: false` + `blocked: true` so the I/O caller blocks the write.
 *
 * CONTRACT: PURE. No I/O, no clock, no Date.now()/Math.random(). The caller supplies
 * `renderedAt`. Never throws. Owned by tooling-engineer (LW1-6); the per-host render
 * golden is pinned by eval-engineer (LW1-8); the contract coherence + golden re-baseline
 * is signed off by plugin-architect (LW1-9).
 */

import * as path from "path";
import {
  HostId,
  HOST_IDS,
  HostRegistryEntry,
  HOST_REGISTRY_ROWS,
} from "./host-registry-schema";
import { PermissionDecision } from "./permission-policy-schema";

// Canonical secret patterns — the SoT lives in docs-hygiene/scan.ts; do NOT re-spell the
// regexes (mirrors dot-guild/scrub.ts Decision H.3). The `require.main === module` guard
// in scan.ts makes this import side-effect-free.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SECRET_PATTERNS } = require(
  path.resolve(__dirname, "../docs-hygiene/scan.ts")
) as { SECRET_PATTERNS: Array<[RegExp, string]> };

// ---------------------------------------------------------------------------
// Inheritance-layer source (mirrors settings-resolver.ts `Source`)
// ---------------------------------------------------------------------------

/** The inheritance layer a resolved key came from (settings-resolver.ts `Source`). */
export type ConfigSource =
  | "builtin"
  | "workspace"
  | "workspace-local"
  | "project"
  | "project-local"
  | "rigor"
  | "cli";

/** The local (gitignored) layers — values from these never enter a SHARED host output. */
export const LOCAL_SOURCES: ReadonlySet<ConfigSource> = new Set<ConfigSource>([
  "workspace-local",
  "project-local",
]);

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * The resolved-config subset the renderer reads. Deliberately loose (the resolver emits
 * a much larger object) — the renderer reads defensively and degrades on absence.
 */
export interface RenderConfigLike {
  /** models.tiers[tier][host] tier→host model map (read for the host's model slot). */
  models?: {
    tiers?: Record<string, Record<string, unknown>>;
  };
  /** security.bypass_permissions_policy — surfaced into the host permission block. */
  security?: { bypass_permissions_policy?: string };
  /** auto_approve tokens — surfaced as the host's autonomy posture. */
  auto_approve?: string[];
  /**
   * roles.{host,advisory,adversarial} — the per-run role pins (the LW1-6 schema
   * extension, SC-W1-7). Optional + forward-compatible: rendered when present, omitted
   * otherwise (so this core needs no schema change to ship).
   */
  roles?: Record<string, unknown>;
  /**
   * host_profiles[host_id] — per-host config-render overrides (the LW1-6 schema extension,
   * SC-W1-8). Closed entry shape `{ models?: {cheap?,mid?,powerful?}, enabled?: bool }`.
   * Applied per host below; a LOCAL-sourced override value is withheld (fail-closed).
   */
  host_profiles?: Record<string, unknown>;
  /** Any other resolved keys (read opportunistically; never required). */
  [key: string]: unknown;
}

export interface RenderConfigOptions {
  /** ISO 8601 render timestamp — the caller MUST supply this (renderer never reads the clock). */
  renderedAt: string;
  /** Source manifest/config version for traceability. Default "unknown". */
  sourceVersion?: string;
  /**
   * Operator redaction patterns (mirrors `secrets_policy.redaction_patterns`). Applied
   * as the FIRST stage, before the canonical SECRET_PATTERNS. Invalid regex strings are
   * skipped (never throw).
   */
  redactionPatterns?: string[];
  /**
   * Fail mode on a detected local/secret leak — mirrors `secrets_policy.fail_mode_durable`.
   * "closed" (default) ⇒ a leak sets ok:false + blocked:true (the I/O caller must block the
   * shared write). "open" ⇒ redact + record, but ok stays true (warn-and-proceed).
   */
  failMode?: "closed" | "open";
}

export interface RenderConfigInput {
  /** The fully-resolved Guild config (the settings-resolver `config`). */
  config: RenderConfigLike;
  /**
   * The resolved phase-permission block: `<phase>.<gate_type>` → PermissionDecision
   * (permission-policy-schema.ts `resolveBaselineGolden()` output). Optional — omitted
   * ⇒ no permission block is rendered.
   */
  permissions?: Record<string, PermissionDecision>;
  /**
   * Per-dotted-key inheritance-layer map (settings-resolver.ts `sources`). Drives the
   * LOCAL-scope fail-closed check. When SUPPLIED, local-only values are withheld and
   * `_local_guard` is "enforced". When ABSENT the renderer cannot certify scope, so
   * `_local_guard` is "unverified" and — under the durable `failMode:"closed"` default —
   * the render FAILS CLOSED (ok:false/blocked:true); pass a (possibly empty) map to
   * enforce, or `failMode:"open"` to warn-and-proceed. Secret scanning always runs.
   */
  sources?: Record<string, ConfigSource>;
  options: RenderConfigOptions;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** A field with no equivalent in the target host's config shape (render-or-degrade). */
export interface UnsupportedField {
  field: string;
  reason: string;
}

/** A value withheld from the shared output by the fail-closed guard. */
export interface RedactionRecord {
  /** The config field / location that triggered the redaction. */
  field: string;
  /** Why it was withheld. */
  reason: "local-scope" | "secret";
  /** For "secret": the matched pattern label. For "local-scope": the source layer. */
  detail: string;
}

/** The rendered host-native config object for one host. */
export interface HostConfigRender {
  schema_version: "guild.host_config_render.v1";
  host_id: HostId;
  family: string;
  surface_kind: "cli" | "app" | "file";
  /** Whether the host registry row is verified on a live host or INFERRED off-box. */
  provenance: "verified" | "inferred";
  /**
   * The host-native permission block — present only when the host can express permission
   * prompts (caps.permissions.ask). Keyed `<phase>.<gate_type>` → the resolved decision,
   * already encoding the orthogonality invariant (host_mode never lifts a guild gate).
   */
  permissions?: Record<string, PermissionDecision>;
  /** The host's tier→model map (config slot / host_profile override when present, else the registry row). */
  models?: { cheap: string | null; mid: string | null; powerful: string | null };
  /** Per-host render toggle from `host_profiles[host_id].enabled` — present only when set. */
  enabled?: boolean;
  /** Per-run role pins, rendered only when present in the resolved config (SC-W1-7). */
  roles?: Record<string, unknown>;
  /** Fields the host cannot express (render-or-degrade) — never silently omitted. */
  _unsupported?: UnsupportedField[];
  /** Values withheld by the fail-closed guard (local-scope / secret). */
  _redactions?: RedactionRecord[];
  /**
   * ok=false ⇒ the render carries a fail-closed violation (a leak was detected under
   * failMode "closed"). The leaking value is NEVER present in this object regardless.
   */
  ok: boolean;
  /** True iff a shared write of this render must be blocked (failMode "closed" + a leak). */
  blocked: boolean;
  /**
   * Whether the LOCAL-scope guard could actually run. "enforced" ⇒ a `sources` map was
   * supplied, so local-only values were detectable + withheld. "unverified" ⇒ NO `sources`
   * map was supplied, so the renderer CANNOT certify the absence of a local leak — under the
   * durable `failMode:"closed"` default this fails closed (ok:false/blocked:true), never a
   * silent fail-open. (F-9: a shared render must not silently pass when scope is unprovable.)
   */
  _local_guard: "enforced" | "unverified";
  _rendered_at: string;
  _source_version: string;
}

// ---------------------------------------------------------------------------
// Secret scanning (canonical patterns + operator patterns) — pure
// ---------------------------------------------------------------------------

/** Compile operator regex strings, skipping any that fail to compile. */
function compileOperatorPatterns(patterns: string[] | undefined): Array<[RegExp, string]> {
  if (!patterns || patterns.length === 0) return [];
  const out: Array<[RegExp, string]> = [];
  for (const p of patterns) {
    try {
      out.push([new RegExp(p, "g"), "operator-pattern"]);
    } catch {
      // invalid regex — skip (never throw)
    }
  }
  return out;
}

/**
 * Scan a single string for secrets. Returns the (possibly redacted) string and the set of
 * matched pattern labels. Operator patterns run first, then the canonical SECRET_PATTERNS.
 */
function scanSecret(
  value: string,
  operatorPatterns: Array<[RegExp, string]>
): { redacted: string; hits: string[] } {
  const hits: string[] = [];
  let out = value;
  for (const [re, label] of [...operatorPatterns, ...SECRET_PATTERNS]) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    if (g.test(out)) {
      hits.push(label);
      out = out.replace(
        new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"),
        `<SECRET-REDACTED:${label}>`
      );
    }
  }
  return { redacted: out, hits };
}

/**
 * Deep-walk a value, redacting any secret found in any string. Records each hit against
 * `fieldPath`. Returns a new value (pure — input never mutated).
 */
function redactDeep(
  value: unknown,
  fieldPath: string,
  operatorPatterns: Array<[RegExp, string]>,
  redactions: RedactionRecord[]
): unknown {
  if (typeof value === "string") {
    const { redacted, hits } = scanSecret(value, operatorPatterns);
    for (const label of hits) {
      redactions.push({ field: fieldPath, reason: "secret", detail: label });
    }
    return redacted;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => redactDeep(v, `${fieldPath}[${i}]`, operatorPatterns, redactions));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v, fieldPath ? `${fieldPath}.${k}` : k, operatorPatterns, redactions);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Local-scope guard — pure
// ---------------------------------------------------------------------------

/**
 * The LOCAL (gitignored) source that scopes `dottedKey`, checking the key and every
 * dotted prefix (so a local parent block scopes its children), or undefined if none.
 */
function localSourceOf(
  dottedKey: string,
  sources: Record<string, ConfigSource> | undefined
): ConfigSource | undefined {
  if (!sources) return undefined;
  const parts = dottedKey.split(".");
  for (let i = parts.length; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(".");
    const src = sources[prefix];
    if (src && LOCAL_SOURCES.has(src)) return src;
  }
  return undefined;
}

/**
 * DEEP local taint for `dottedKey`: a LOCAL source on the key itself, ANY ancestor (via
 * localSourceOf), OR ANY DESCENDANT. The descendant check matters because a value emitted
 * at `key` may carry a child the resolver tagged at finer granularity (e.g. an object-form
 * model tagged at `models.tiers.cheap.claude.model`, or a nested `roles.host.*`). Without
 * it a deeper local source would slip past a key-level guard (Codex G-lane round-3). Returns
 * the matching local source, or undefined.
 */
function localTaint(
  dottedKey: string,
  sources: Record<string, ConfigSource> | undefined
): ConfigSource | undefined {
  if (!sources) return undefined;
  const anc = localSourceOf(dottedKey, sources); // key + ancestors
  if (anc) return anc;
  const descPrefix = `${dottedKey}.`; // strict descendants
  for (const k of Object.keys(sources)) {
    if (k.startsWith(descPrefix)) {
      const src = sources[k];
      if (src && LOCAL_SOURCES.has(src)) return src;
    }
  }
  return undefined;
}

/**
 * True iff the dotted key or any ANCESTOR resolved from a LOCAL (gitignored) layer.
 * BLOCK-LEVEL semantics only (key + ancestors) — used to decide whether to withhold a
 * WHOLE block. Per-VALUE emission uses the deeper `localTaint` (which also walks
 * descendants), so shared siblings in a partially-local block are still kept.
 */
function isLocalScoped(dottedKey: string, sources: Record<string, ConfigSource> | undefined): boolean {
  return localSourceOf(dottedKey, sources) !== undefined;
}

/**
 * The rendered `permissions` block is DERIVED from top-level config keys (auto_approve +
 * security.bypass_permissions_policy + host_mode), so the resolver records THOSE keys'
 * sources — never `permissions.*`. A per-key guard over the permission decisions would
 * therefore miss a local-only feeder. This returns the first feeder whose source is LOCAL
 * (gitignored), or undefined — the whole derived block is withheld + failed-closed when
 * any feeder is local.
 *
 * rf-wi-01 (G1 codex-review fix, P1): `host_mode` now feeds the rendered `<phase>.
 * <gate_type>.host_mode` cell (config-cmd.ts resolvePermissionPolicy overlay) but was
 * missing here — a `host_mode` set ONLY in settings.local.json rendered into every
 * shared host shape with `ok:true`/no redaction, a real local-scope leak (F-9).
 */
const PERMISSION_FEEDER_KEYS = ["auto_approve", "security.bypass_permissions_policy", "host_mode"] as const;
function permissionFeederLocalSource(
  sources: Record<string, ConfigSource> | undefined
): string | undefined {
  for (const k of PERMISSION_FEEDER_KEYS) {
    const src = localTaint(k, sources);
    if (src) return `${k} (${src})`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-host model slot
// ---------------------------------------------------------------------------

/** The models.tiers host-slot key for a registry host_id, or null when none exists. */
function tierHostKey(hostId: HostId): string | null {
  return hostId;
}

/**
 * One tier's resolved model name for a host: the config slot if set, else the registry
 * caps row. SECURITY (SC-W1-8 / F-9): if the config slot value resolved from a LOCAL
 * (gitignored) layer it is WITHHELD from this shared host render BEFORE emission — a
 * `local-scope` redaction is recorded (so failMode "closed" blocks the write) and the
 * shared registry-row default is used instead. A local-only model override must never
 * appear in any rendered host shape.
 */
function modelForTier(
  config: RenderConfigLike,
  entry: HostRegistryEntry,
  tier: "cheap" | "mid" | "powerful",
  sources: Record<string, ConfigSource> | undefined,
  redactions: RedactionRecord[]
): string | null {
  const slot = tierHostKey(entry.host_id);
  if (slot) {
    const tierMap = config.models?.tiers?.[tier];
    const raw = tierMap ? (tierMap as Record<string, unknown>)[slot] : undefined;
    const m = normalizeModelValue(raw);
    if (m !== null) {
      const dotted = `models.tiers.${tier}.${slot}`;
      const localSrc = localTaint(dotted, sources);
      if (localSrc) {
        // Withhold the local-only override; fall through to the shared registry default.
        redactions.push({ field: dotted, reason: "local-scope", detail: localSrc });
      } else {
        return m;
      }
    }
  }
  // Fall back to the host's own capability-row model (the per-host SoT — shared, safe).
  const capModel = entry.capabilities.models?.[tier]?.model;
  return typeof capModel === "string" && capModel.trim() ? capModel : null;
}

/** The per-host profile entry from `host_profiles[host_id]`, or null. Defensive (never throws). */
function readHostProfile(config: RenderConfigLike, hostId: HostId): Record<string, unknown> | null {
  const hp = config.host_profiles;
  if (!hp || typeof hp !== "object" || Array.isArray(hp)) return null;
  const entry = (hp as Record<string, unknown>)[hostId];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return entry as Record<string, unknown>;
}

/** Normalize a tier→host value (string | {model} | null) to a model name or null. */
function normalizeModelValue(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const m = (v as Record<string, unknown>)["model"];
    if (typeof m === "string" && m.trim()) return m.trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Single-host render
// ---------------------------------------------------------------------------

/**
 * Render the resolved config into ONE host's native config shape, driven entirely by the
 * host's registry capability row. Pure; never throws.
 */
export function renderHostConfig(hostId: HostId, input: RenderConfigInput): HostConfigRender {
  const entry = HOST_REGISTRY_ROWS[hostId];
  const { config, permissions, sources, options } = input;
  const operatorPatterns = compileOperatorPatterns(options.redactionPatterns);
  const failMode = options.failMode ?? "closed";
  const sourceVersion = options.sourceVersion ?? "unknown";

  const unsupported: UnsupportedField[] = [];
  const redactions: RedactionRecord[] = [];
  const caps = entry.capabilities;

  const out: HostConfigRender = {
    schema_version: "guild.host_config_render.v1",
    host_id: hostId,
    family: entry.family,
    surface_kind: entry.surface_kind,
    provenance: entry.provenance,
    ok: true,
    blocked: false,
    _local_guard: sources ? "enforced" : "unverified",
    _rendered_at: options.renderedAt,
    _source_version: sourceVersion,
  };

  // ── permissions (the headline — SC-W1-8 / F-10) ─────────────────────────────
  // Render only when the host can express tool-permission prompts. The decisions already
  // encode the orthogonality invariant; we project them verbatim (after the leak guard).
  if (permissions && Object.keys(permissions).length > 0) {
    if (caps.permissions?.ask) {
      // SECURITY (SC-W1-8 / F-9): the permission decisions are DERIVED from the feeder
      // keys (auto_approve, security.bypass_permissions_policy). If ANY feeder resolved
      // from a LOCAL (gitignored) layer, the whole derived block is withheld from this
      // shared render and a local-scope redaction is recorded (fails closed below) — a
      // per-key guard over `permissions.*` would miss it (the source lives on the feeder).
      const feederLocal = permissionFeederLocalSource(sources);
      if (feederLocal) {
        redactions.push({ field: "permissions", reason: "local-scope", detail: `feeder ${feederLocal}` });
        // withhold: out.permissions stays unset
      } else {
        // security.bypass_permissions_policy is governed by the host's bypass capability:
        // a host that cannot bypass prompts can never honor an "allow" — flag the gap.
        const bypassPolicy = config.security?.bypass_permissions_policy;
        if (bypassPolicy === "allow" && !caps.permissions?.bypass_prompts) {
          unsupported.push({
            field: "security.bypass_permissions_policy",
            reason: `host "${hostId}" cannot bypass tool-permission prompts (caps.permissions.bypass_prompts=false); "allow" degrades to audited`,
          });
        }
        out.permissions = guardLocal("permissions", permissions, sources, redactions);
      }
    } else {
      unsupported.push({
        field: "permissions",
        reason: `host "${hostId}" has no native tool-permission prompt surface (caps.permissions.ask=false); Guild gates run as explicit lifecycle steps`,
      });
    }
  }

  // ── models (tier→model) ─────────────────────────────────────────────────────
  // SECURITY (SC-W1-8): modelForTier withholds any LOCAL-sourced slot value BEFORE it
  // reaches `out.models`, recording a local-scope redaction (which fails closed below).
  const models = {
    cheap: modelForTier(config, entry, "cheap", sources, redactions),
    mid: modelForTier(config, entry, "mid", sources, redactions),
    powerful: modelForTier(config, entry, "powerful", sources, redactions),
  };
  // host_profiles[host_id] override (LW1-6 / SC-W1-8): a per-host profile may override the
  // tier→model map and toggle `enabled`. A LOCAL-sourced override value is WITHHELD (fail
  // closed) and the registry/tiers-derived value is kept. Profile keys are validated upstream
  // (validateHostProfiles closed shape); we read defensively here.
  const profile = readHostProfile(config, hostId);
  if (profile) {
    if (typeof profile["enabled"] === "boolean") {
      // LOCAL-sourced `enabled` must not leak into a shared render — withhold + fail closed,
      // identical to the model-slot guard below (Codex G-lane round-2 regression fix).
      const enabledLocalSrc = localTaint(`host_profiles.${hostId}.enabled`, sources);
      if (enabledLocalSrc) {
        redactions.push({ field: `host_profiles.${hostId}.enabled`, reason: "local-scope", detail: enabledLocalSrc });
      } else {
        out.enabled = profile["enabled"] as boolean;
      }
    }
    const pm = profile["models"];
    if (pm && typeof pm === "object" && !Array.isArray(pm)) {
      for (const tier of ["cheap", "mid", "powerful"] as const) {
        const ov = (pm as Record<string, unknown>)[tier];
        if (typeof ov === "string" && ov.trim()) {
          const dotted = `host_profiles.${hostId}.models.${tier}`;
          const localSrc = localTaint(dotted, sources);
          if (localSrc) {
            redactions.push({ field: dotted, reason: "local-scope", detail: localSrc });
          } else {
            models[tier] = ov.trim();
          }
        }
      }
    }
  }
  if (models.cheap === null && models.mid === null && models.powerful === null) {
    unsupported.push({
      field: "models",
      reason: `no model is mapped for host "${hostId}" (no models.tiers slot and an empty capability-row model set)`,
    });
  } else {
    out.models = models;
  }

  // ── roles (per-run pins — SC-W1-7; forward-compatible) ──────────────────────
  if (config.roles && typeof config.roles === "object" && !Array.isArray(config.roles)) {
    if (Object.keys(config.roles).length > 0) {
      out.roles = guardLocal("roles", config.roles, sources, redactions) as Record<string, unknown>;
    }
  }

  // ── capability-driven degrade markers (render-or-degrade) ────────────────────
  const anyHook = caps.hooks && Object.values(caps.hooks).some(Boolean);
  if (!anyHook) {
    unsupported.push({
      field: "hooks",
      reason: `host "${hostId}" has no native hook event surface; lifecycle steps run as explicit skill invocations`,
    });
  }
  if (!caps.skills?.native_skills) {
    unsupported.push({
      field: "skills",
      reason: `host "${hostId}" has no native skill-autoload directory; skills are driven through the Guild skill tree`,
    });
  }

  // Attach _unsupported BEFORE the scan so it is covered too (its reasons are renderer-
  // authored + the hostId enum today, but scanning keeps "EVERY emitted string" literally
  // true and future-proofs against any reason that later interpolates caller data).
  if (unsupported.length > 0) out._unsupported = unsupported;

  // ── secret scan over every emitted string (fail-closed) ────────────────────────
  // Scan the rendered body (permissions/models/roles), the caller-supplied scalars
  // (_source_version — an operator sourceVersion could carry a secret — and _rendered_at), and
  // the _unsupported reasons. The raw secret is replaced in-place before it can leave this
  // function. The renderer's own `_redactions[]` records are scanned in a final terminating
  // pass below (a `field` can be a config KEY PATH and a caller could name a config key after a
  // secret), so NOTHING emitted escapes the scan. The discriminator/enum fields
  // (schema_version, host_id, family, surface_kind, provenance, _local_guard, ok, blocked) are
  // renderer-authored closed sets and carry no external data.
  if (out.permissions) out.permissions = redactDeep(out.permissions, "permissions", operatorPatterns, redactions) as Record<string, PermissionDecision>;
  if (out.models) out.models = redactDeep(out.models, "models", operatorPatterns, redactions) as HostConfigRender["models"];
  if (out.roles) out.roles = redactDeep(out.roles, "roles", operatorPatterns, redactions) as Record<string, unknown>;
  if (out._unsupported) out._unsupported = redactDeep(out._unsupported, "_unsupported", operatorPatterns, redactions) as UnsupportedField[];
  out._source_version = redactDeep(out._source_version, "_source_version", operatorPatterns, redactions) as string;
  out._rendered_at = redactDeep(out._rendered_at, "_rendered_at", operatorPatterns, redactions) as string;

  // Fail closed when the local-scope guard could not run (no sources map supplied): a shared
  // render must not silently pass when scope is unprovable (F-9). Recorded as a redaction so
  // the reason is visible; under failMode "closed" it flips ok/blocked below.
  if (failMode === "closed" && out._local_guard === "unverified") {
    redactions.push({
      field: "(sources)",
      reason: "local-scope",
      detail: "no sources map supplied — local-scope guard could not run (fail-closed)",
    });
  }

  // (out._unsupported was attached + scanned above — do NOT re-assign the raw array here.)
  if (redactions.length > 0) {
    // Final terminating pass: scan the renderer's own redaction records too — a `field` can
    // carry a config KEY PATH and a caller could name a config key after a secret. The hits go
    // to a THROWAWAY sink (never emitted, never re-scanned) so this pass terminates — no
    // infinite regress — while guaranteeing no raw secret survives anywhere in the output.
    const sink: RedactionRecord[] = [];
    out._redactions = redactDeep(redactions, "_redactions", operatorPatterns, sink) as RedactionRecord[];
    // Fail closed: any local/secret leak (or an unverifiable guard) blocks a shared write
    // under the durable default.
    if (failMode === "closed") {
      out.ok = false;
      out.blocked = true;
    }
  }

  return out;
}

/**
 * Withhold any LOCAL-scoped sub-value from a shared block. Walks one level of a keyed
 * object (e.g. roles, permissions), dropping entries whose resolved source is local and
 * recording each in `redactions`. Returns a new object (pure).
 */
function guardLocal<T extends Record<string, unknown>>(
  blockKey: string,
  block: T,
  sources: Record<string, ConfigSource> | undefined,
  redactions: RedactionRecord[]
): T {
  if (!sources) return block;
  // If the whole block is local-scoped, withhold it entirely.
  if (isLocalScoped(blockKey, sources)) {
    redactions.push({
      field: blockKey,
      reason: "local-scope",
      detail: sources[blockKey] ?? "local",
    });
    return {} as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(block)) {
    const dotted = `${blockKey}.${k}`;
    // Deep per-value check: withhold this entry if the key, an ancestor, OR any DESCENDANT
    // (e.g. a nested `roles.host.*`) resolved from a local layer — never leak a tainted value.
    const localSrc = localTaint(dotted, sources);
    if (localSrc) {
      redactions.push({ field: dotted, reason: "local-scope", detail: localSrc });
      continue;
    }
    out[k] = v;
  }
  return out as T;
}

// ---------------------------------------------------------------------------
// All-hosts render
// ---------------------------------------------------------------------------

/**
 * Render the resolved config into EVERY registered host native shape — all 16 `HOST_IDS`
 * (12 CLI-native hosts plus the 4 app/connector refuse hosts), keyed by host_id. Pure;
 * never throws. The single entry point the `config show --render` command (LW1-7) and the
 * per-host render golden (LW1-8) consume.
 */
export function renderAllHostConfigs(
  input: RenderConfigInput
): Record<HostId, HostConfigRender> {
  const out = {} as Record<HostId, HostConfigRender>;
  for (const hostId of HOST_IDS) {
    out[hostId] = renderHostConfig(hostId, input);
  }
  return out;
}
