/**
 * scripts/lib/installer-contract.ts
 *
 * P2 Wave-3 / SC-W3-4 / AC24 (step 19, PRE-CUTOVER) — the multi-host installer
 * **contract + per-host receipt model**: `guild.install_receipt.v1` + the
 * `guild.installer_plan.v1` contract.
 *
 * Contract authority (SoT):
 *   .guild/spec/universal-host-p2-wave3.md SC-W3-4
 *   .guild/plan/universal-host-p2-wave3.md LW3-4
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §step 19 (installer)
 *
 * WHAT this lane ships (and ONLY this):
 *   1. `guild.install_receipt.v1` — the per-host receipt an install WOULD emit,
 *      recording the PRESENCE/posture of the four AC24 facets:
 *        bootstrap-context · resolved-config · permission-mode · result-normalization.
 *   2. `guild.installer_plan.v1` — the installer contract: per host (from the L1
 *      `guild.host_registry.v1` rows) the install + update/reconcile STEP DESCRIPTIONS
 *      plus the receipt that host would emit.
 *   3. Fail-closed validators for both.
 *
 * EXECUTION-BAN (F-1, load-bearing):
 *   This module is PURE. It DESCRIBES install + reconcile steps; it NEVER executes an
 *   installer, performs a reconcile WRITE, installs a generated `dist/`, or changes the
 *   install channel. The plan and every receipt carry the explicit zero-side-effect
 *   markers `executed:false` + `side_effects:"none"` so a test can assert ZERO
 *   live-surface mutation + zero install/reconcile side effect. The reconcile step
 *   descriptions REFERENCE the `check|sync|repair` modes (config-reconcile-contract.ts)
 *   but only as prose — no reconcile runs here.
 *
 * PARITY: the plan is proven against the CURRENT canonical package (the committed
 *   Claude surface), NOT a new install channel — `parity_target:"current-canonical"`.
 *   The live AC24 wrapper/install PROOF is DEFERRED with the post-v2.0.0 cutover.
 *
 * DETERMINISM: no `Date.now()` / `Math.random()`. Callers supply `renderedAt` +
 *   `sourceVersion`, mirroring per-host-packaging.ts / config-render.ts.
 *
 * Owned by tooling-engineer (LW3-4); consumed by LW3-7a sign-off + Ltest.
 */

import type {
  HostRegistryEntry,
  HostId,
  HostFamilyId,
  Installability,
} from "./host-registry-schema";

// ---------------------------------------------------------------------------
// Schema identifiers
// ---------------------------------------------------------------------------

export const INSTALL_RECEIPT_SCHEMA = "guild.install_receipt.v1" as const;
export const INSTALLER_PLAN_SCHEMA = "guild.installer_plan.v1" as const;

/** The four AC24 receipt facets, named verbatim from SC-W3-4. */
export const RECEIPT_FACET_KEYS = [
  "bootstrap_context",
  "resolved_config",
  "permission_mode",
  "result_normalization",
] as const;
export type ReceiptFacetKey = (typeof RECEIPT_FACET_KEYS)[number];

// ---------------------------------------------------------------------------
// Receipt facet descriptors
// ---------------------------------------------------------------------------

/**
 * One AC24 facet's presence + posture in the receipt a host WOULD emit. A facet that
 * the host cannot express is recorded with `present:false` + a `mechanism:"none"` AND
 * mirrored into the receipt's `_unsupported[]` (render-or-degrade — never silently
 * omitted, mirroring per-host-packaging.ts / config-render.ts).
 */
export interface ReceiptFacet {
  /** Whether the install WOULD establish this facet for the host. */
  present: boolean;
  /**
   * The mechanism/posture string (e.g. "instruction_file" for bootstrap-context,
   * "ask"/"bypass" for permission-mode, "result_adapter"/"bounded_repair" for
   * result-normalization). "none" when the facet is unsupported/degraded.
   */
  mechanism: string;
  /** Whether this fact is verified on a live host or INFERRED off-box (row provenance). */
  provenance: "verified" | "inferred";
}

/** The four AC24 facets, keyed exactly by RECEIPT_FACET_KEYS. */
export type InstallReceiptFacets = Record<ReceiptFacetKey, ReceiptFacet>;

/** A facet the host could not establish — surfaced, never silently dropped. */
export interface UnsupportedFacet {
  facet: ReceiptFacetKey;
  reason: string;
}

// ---------------------------------------------------------------------------
// guild.install_receipt.v1
// ---------------------------------------------------------------------------

/**
 * The per-host receipt an install WOULD emit (the WOULD-EMIT shape, never an executed
 * install). PRE-CUTOVER: `executed:false` + `side_effects:"none"` are load-bearing
 * execution-ban markers (F-1).
 */
export interface GuildInstallReceiptV1 {
  schema_version: typeof INSTALL_RECEIPT_SCHEMA;
  host_id: HostId;
  family: HostFamilyId;
  surface_kind: "cli" | "app" | "file";
  /** Can a Guild package be installed for this host (registry `installability` column). */
  installability: Installability;
  /** Execution-ban (F-1): this receipt is derived from the plan, never an executed install. */
  executed: false;
  /** Execution-ban (F-1): no install/reconcile side effect was performed to produce this. */
  side_effects: "none";
  /** The four AC24 facets (bootstrap-context / resolved-config / permission-mode / result-normalization). */
  facets: InstallReceiptFacets;
  /** Facets the host cannot establish (render-or-degrade). Present only when non-empty. */
  _unsupported?: UnsupportedFacet[];
  /** Row-level provenance (verified on a live host, or INFERRED off-box). */
  provenance: "verified" | "inferred";
  /** Caller-supplied render timestamp (the module never reads the clock). */
  _rendered_at: string;
  /** Source manifest version, for traceability. */
  _source_version: string;
}

// ---------------------------------------------------------------------------
// guild.installer_plan.v1 — the contract (install + reconcile STEP DESCRIPTIONS)
// ---------------------------------------------------------------------------

/**
 * One installer/reconcile step DESCRIPTION. `writes` documents the REAL-install write
 * semantics (so the contract is honest about which steps would mutate disk in a live
 * install) — it does NOT mean this module writes anything. The whole plan is
 * execution-banned (see GuildInstallerPlanV1.executed / .side_effects).
 */
export interface InstallerStep {
  /** 1-based ordinal within its phase (install vs reconcile). */
  order: number;
  /** Stable step id (e.g. "detect", "stage-package", "set-permission-mode", "emit-receipt"). */
  id: string;
  /** Human-readable description of what a real installer would do at this step. */
  description: string;
  /** Real-install write semantics: would this step mutate disk in a LIVE install? */
  writes: boolean;
}

/** The plan for one host: install steps + reconcile steps + the receipt it would emit. */
export interface HostInstallerPlan {
  host_id: HostId;
  family: HostFamilyId;
  surface_kind: "cli" | "app" | "file";
  installability: Installability;
  /**
   * The host-native package format this host's install stages (from the registry row's
   * `capabilities.package.manifest_format`, e.g. "claude-plugin"). Surfaced as a
   * structured field — not just buried in step prose — so a parity test can compare it
   * against the CURRENT canonical package on disk (SC-W3-4 parity proof).
   */
  manifest_format: string;
  /** Install step descriptions (detect → stage → render-config → permission → normalize → emit). */
  install_steps: InstallerStep[];
  /** Update/reconcile step descriptions (check → sync → repair → re-emit), DESCRIBED only. */
  reconcile_steps: InstallerStep[];
  /** The receipt this host WOULD emit (PRE-CUTOVER WOULD-EMIT shape). */
  receipt: GuildInstallReceiptV1;
}

/**
 * The multi-host installer contract. PLAN-ONLY: it describes per-host steps + receipts,
 * proven against the CURRENT canonical package — it is NEVER executed and NEVER wired as
 * a new install channel this wave (F-1 execution-ban; deferred with the cutover).
 */
export interface GuildInstallerPlanV1 {
  schema_version: typeof INSTALLER_PLAN_SCHEMA;
  /** PLAN-ONLY discriminator: describes steps, never runs them. */
  mode: "plan";
  /** Execution-ban (F-1). */
  executed: false;
  /** Execution-ban (F-1). */
  side_effects: "none";
  /** Proven against the current canonical package, NOT a new install channel. */
  parity_target: "current-canonical";
  hosts: HostInstallerPlan[];
  _rendered_at: string;
  _source_version: string;
}

// ---------------------------------------------------------------------------
// Build options
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** ISO-8601 timestamp for provenance (the caller MUST supply — never the clock). */
  renderedAt: string;
  /** Source manifest version (e.g. the plugin.json version) for traceability. */
  sourceVersion: string;
}

// ---------------------------------------------------------------------------
// Facet derivation — pure, from a host-registry row
// ---------------------------------------------------------------------------

/**
 * Derive the four AC24 receipt facets from a `guild.host_registry.v1` row. Every facet
 * is honest about degradation: a host that cannot express a facet gets `present:false`
 * + `mechanism:"none"`, and the caller mirrors it into `_unsupported[]`.
 */
export function deriveReceiptFacets(entry: HostRegistryEntry): InstallReceiptFacets {
  const prov = entry.provenance;
  const caps = entry.capabilities;

  // bootstrap-context — how the host receives Guild's bootstrap context. Every host has
  // SOME injection mechanism (instruction_file at worst), so this is always present.
  const bootstrap_context: ReceiptFacet = {
    present: true,
    mechanism: caps.bootstrap.skill_autoload
      ? `skill_autoload+${caps.bootstrap.context_injection}`
      : caps.bootstrap.context_injection,
    provenance: prov,
  };

  // resolved-config — Guild always resolves + renders a host-native config
  // (config-render.ts guild.host_config_render.v1). Present for every host row.
  const resolved_config: ReceiptFacet = {
    present: true,
    mechanism: "guild.host_config_render.v1",
    provenance: prov,
  };

  // permission-mode — present iff the host can express a permission posture. Posture:
  // bypass (auto-approve) > ask (prompt) > deny-only; "none" when the host has none.
  const p = caps.permissions;
  const permPresent = p.ask || p.deny || p.bypass_prompts;
  const permMechanism = !permPresent
    ? "none"
    : p.bypass_prompts
    ? "bypass"
    : p.ask
    ? "ask"
    : "deny";
  const permission_mode: ReceiptFacet = {
    present: permPresent,
    mechanism: permMechanism,
    provenance: prov,
  };

  // result-normalization — present iff a cross-review result adapter exists OR the host
  // can normalize structured output natively / via bounded repair.
  const so = caps.structured_output;
  const normPresent = entry.result_adapter || so.native_json || so.schema_validation || so.repair_prompt;
  const normMechanism = !normPresent
    ? "none"
    : entry.result_adapter
    ? "result_adapter"
    : so.native_json
    ? "native_json"
    : so.schema_validation
    ? "schema_validation"
    : "bounded_repair";
  const result_normalization: ReceiptFacet = {
    present: normPresent,
    mechanism: normMechanism,
    provenance: prov,
  };

  return { bootstrap_context, resolved_config, permission_mode, result_normalization };
}

const FACET_UNSUPPORTED_REASON: Record<ReceiptFacetKey, string> = {
  bootstrap_context: "host exposes no bootstrap-context injection mechanism",
  resolved_config: "host config could not be resolved/rendered for this host row",
  permission_mode: "host cannot express a permission mode (no ask/deny/bypass posture)",
  result_normalization:
    "host has no result-normalization path (no cross-review adapter and no native/repair structured output)",
};

// ---------------------------------------------------------------------------
// Receipt builder — pure
// ---------------------------------------------------------------------------

/**
 * Build the `guild.install_receipt.v1` a host WOULD emit, derived purely from its
 * registry row. Always carries the execution-ban markers. Unsupported facets are
 * surfaced in `_unsupported[]`, never silently omitted.
 */
export function buildInstallReceipt(
  entry: HostRegistryEntry,
  opts: BuildOptions
): GuildInstallReceiptV1 {
  const facets = deriveReceiptFacets(entry);

  const unsupported: UnsupportedFacet[] = [];
  for (const key of RECEIPT_FACET_KEYS) {
    if (!facets[key].present) {
      unsupported.push({ facet: key, reason: FACET_UNSUPPORTED_REASON[key] });
    }
  }

  const receipt: GuildInstallReceiptV1 = {
    schema_version: INSTALL_RECEIPT_SCHEMA,
    host_id: entry.host_id,
    family: entry.family,
    surface_kind: entry.surface_kind,
    installability: entry.installability,
    executed: false,
    side_effects: "none",
    facets,
    provenance: entry.provenance,
    _rendered_at: opts.renderedAt,
    _source_version: opts.sourceVersion,
  };
  if (unsupported.length > 0) receipt._unsupported = unsupported;
  return receipt;
}

// ---------------------------------------------------------------------------
// Step-description builders — pure
// ---------------------------------------------------------------------------

/**
 * Derive the install step DESCRIPTIONS for one host from its registry row. `writes`
 * documents the real-install write semantics; the descriptions are never executed here.
 */
export function buildInstallSteps(entry: HostRegistryEntry): InstallerStep[] {
  const caps = entry.capabilities;
  const bin = entry.detection.bin;
  const facets = deriveReceiptFacets(entry);
  const steps: InstallerStep[] = [];
  let order = 1;
  const push = (id: string, description: string, writes: boolean) =>
    steps.push({ order: order++, id, description, writes });

  push(
    "detect",
    bin === null
      ? `Detect the ${entry.host_id} surface (file target — no CLI bin; recognized by surface presence).`
      : `Detect the ${entry.host_id} host by probing the \`${bin}\` binary on PATH` +
          (entry.detection.requires_auth
            ? ` and running the \`${entry.detection.auth_probe}\` auth probe.`
            : `.`),
    false
  );

  push(
    "verify-installability",
    entry.installability === "none"
      ? `Installability is "none" — no package surface for ${entry.host_id}; install is NOT offered.`
      : `Installability is "${entry.installability}" — ` +
          (entry.installability === "native"
            ? `a proven install path exists.`
            : `a renderer exists but the live install is unproven (target; flips to native when its AC passes).`),
    false
  );

  if (entry.installability !== "none") {
    push(
      "stage-package",
      `Render + stage the host-native package (manifest format "${caps.package.manifest_format}") from the canonical inventory.`,
      true
    );
    push(
      "bootstrap-context",
      `Establish bootstrap-context via "${facets.bootstrap_context.mechanism}".`,
      true
    );
    push(
      "render-config",
      `Resolve + render the host-native config (${facets.resolved_config.mechanism}); reconcile fills MISSING keys only — never clobbers a user value.`,
      true
    );
    push(
      "set-permission-mode",
      facets.permission_mode.present
        ? `Set the install permission mode to "${facets.permission_mode.mechanism}".`
        : `Host cannot express a permission mode — degraded (no prompt layer).`,
      facets.permission_mode.present
    );
    push(
      "wire-result-normalization",
      facets.result_normalization.present
        ? `Wire result-normalization via "${facets.result_normalization.mechanism}".`
        : `No result-normalization path — degraded (results pass through unnormalized).`,
      false
    );
  }

  push("emit-receipt", `Emit the guild.install_receipt.v1 recording the four facets above.`, true);
  return steps;
}

/**
 * Derive the update/reconcile step DESCRIPTIONS for one host. These DESCRIBE the
 * `check|sync|repair` reconcile modes (config-reconcile-contract.ts) — they are never
 * executed and perform no reconcile write here (F-1).
 */
export function buildReconcileSteps(entry: HostRegistryEntry): InstallerStep[] {
  const steps: InstallerStep[] = [];
  let order = 1;
  const push = (id: string, description: string, writes: boolean) =>
    steps.push({ order: order++, id, description, writes });

  push(
    "reconcile-check",
    `reconcile check: report config/package drift for ${entry.host_id} — write NOTHING (read-only diagnostic).`,
    false
  );
  push(
    "reconcile-sync",
    `reconcile sync: fill MISSING keys to their schema default; NEVER overwrite a user-set value.`,
    true
  );
  push(
    "reconcile-repair",
    `reconcile repair: coerce a MALFORMED value to a schema-valid one; fail CLOSED on security keys (never weaken to a permissive default); keep VALID user choices.`,
    true
  );
  push(
    "re-emit-receipt",
    `Re-emit the guild.install_receipt.v1 reflecting the reconciled state.`,
    true
  );
  return steps;
}

// ---------------------------------------------------------------------------
// Plan builders — pure
// ---------------------------------------------------------------------------

/** Build the per-host plan (install steps + reconcile steps + would-emit receipt). */
export function buildHostInstallerPlan(
  entry: HostRegistryEntry,
  opts: BuildOptions
): HostInstallerPlan {
  return {
    host_id: entry.host_id,
    family: entry.family,
    surface_kind: entry.surface_kind,
    installability: entry.installability,
    manifest_format: entry.capabilities.package.manifest_format,
    install_steps: buildInstallSteps(entry),
    reconcile_steps: buildReconcileSteps(entry),
    receipt: buildInstallReceipt(entry, opts),
  };
}

/**
 * Build the full multi-host installer contract from the registry rows. PLAN-ONLY +
 * execution-banned; proven against the current canonical package.
 */
export function buildInstallerPlan(
  entries: HostRegistryEntry[],
  opts: BuildOptions
): GuildInstallerPlanV1 {
  return {
    schema_version: INSTALLER_PLAN_SCHEMA,
    mode: "plan",
    executed: false,
    side_effects: "none",
    parity_target: "current-canonical",
    hosts: entries.map((e) => buildHostInstallerPlan(e, opts)),
    _rendered_at: opts.renderedAt,
    _source_version: opts.sourceVersion,
  };
}

// ---------------------------------------------------------------------------
// Validators — fail-closed + STRICT (unknown-key rejection) + hostile-input safe
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const SURFACE_SET = new Set<string>(["cli", "app", "file"]);
const INSTALLABILITY_SET = new Set<string>(["native", "target", "none"]);
const PROVENANCE_SET = new Set<string>(["verified", "inferred"]);
const FACET_KEY_SET = new Set<string>(RECEIPT_FACET_KEYS);

// Strict allow-lists — every object level rejects any key NOT in its set (FIX 1).
const RECEIPT_KEYS = new Set<string>([
  "schema_version", "host_id", "family", "surface_kind", "installability",
  "executed", "side_effects", "facets", "_unsupported", "provenance",
  "_rendered_at", "_source_version",
]);
const FACET_OBJ_KEYS = new Set<string>(["present", "mechanism", "provenance"]);
const UNSUPPORTED_KEYS = new Set<string>(["facet", "reason"]);
const PLAN_KEYS = new Set<string>([
  "schema_version", "mode", "executed", "side_effects", "parity_target",
  "hosts", "_rendered_at", "_source_version",
]);
const HOST_PLAN_KEYS = new Set<string>([
  "host_id", "family", "surface_kind", "installability", "manifest_format",
  "install_steps", "reconcile_steps", "receipt",
]);
const STEP_KEYS = new Set<string>(["order", "id", "description", "writes"]);

// ── Hostile-input-safe primitives (FIX 2) ───────────────────────────────────
// The validators must NEVER throw, even on a Proxy with a throwing trap, a
// getter that throws, or a value whose toString()/toJSON() throws. All property
// access, key enumeration, and stringification routes through these.

/** Sentinel returned by safeGet when a property access throws (a throwing getter/Proxy trap). */
const THREW: unique symbol = Symbol("threw");

/** Property read that never throws — a throwing getter/trap yields the THREW sentinel. */
function safeGet(o: object, key: string): unknown {
  try {
    return (o as Record<string, unknown>)[key];
  } catch {
    return THREW;
  }
}

/** JSON.stringify that never throws (a throwing toJSON/toString yields a placeholder). */
function safeStringify(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? "undefined" : s;
  } catch {
    return "(unstringifiable)";
  }
}

/**
 * ALL own keys (string + symbol, ENUMERABLE AND NON-ENUMERABLE) that never throws — a
 * hostile ownKeys trap yields null (⇒ reject). Uses `Reflect.ownKeys` so a
 * `Object.defineProperty(o,'x',{enumerable:false})` smuggled key cannot bypass the
 * strict-schema check (Object.keys would miss it).
 */
function safeOwnKeys(o: object): Array<string | symbol> | null {
  try {
    return Reflect.ownKeys(o);
  } catch {
    return null;
  }
}

/** Strict-schema guard: reject any own key (incl. non-enumerable / symbol) not in `allowed`. */
function rejectUnknownKeys(label: string, o: object, allowed: ReadonlySet<string>, errors: string[]): void {
  const keys = safeOwnKeys(o);
  if (keys === null) {
    errors.push(`${label}: object keys could not be enumerated (hostile input)`);
    return;
  }
  for (const k of keys) {
    if (typeof k === "symbol" || !allowed.has(k)) {
      errors.push(`${label}: unknown key ${safeStringify(typeof k === "symbol" ? k.toString() : k)} is not permitted (strict schema)`);
    }
  }
}

function isPlainObject(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateFacet(label: string, value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be a present object`);
    return;
  }
  rejectUnknownKeys(label, value, FACET_OBJ_KEYS, errors);
  const present = safeGet(value, "present");
  if (typeof present !== "boolean") errors.push(`${label}.present must be a boolean`);
  const mechanism = safeGet(value, "mechanism");
  if (typeof mechanism !== "string" || mechanism.trim() === "") {
    errors.push(`${label}.mechanism must be a non-empty string`);
  }
  const provenance = safeGet(value, "provenance");
  if (typeof provenance !== "string" || !PROVENANCE_SET.has(provenance)) {
    errors.push(`${label}.provenance must be verified|inferred`);
  }
}

/** Inner receipt validator — may use safe primitives; the public wrapper guarantees no-throw. */
function validateInstallReceiptInner(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push("install receipt must be a non-null object");
    return;
  }
  const o = value;
  rejectUnknownKeys("receipt", o, RECEIPT_KEYS, errors);

  if (safeGet(o, "schema_version") !== INSTALL_RECEIPT_SCHEMA) {
    errors.push(`schema_version must be "${INSTALL_RECEIPT_SCHEMA}"; got ${safeStringify(safeGet(o, "schema_version"))}`);
  }
  const host_id = safeGet(o, "host_id");
  if (typeof host_id !== "string" || host_id.trim() === "") errors.push("host_id must be a non-empty string");
  const family = safeGet(o, "family");
  if (typeof family !== "string" || family.trim() === "") errors.push("family must be a non-empty string");
  const surface_kind = safeGet(o, "surface_kind");
  if (typeof surface_kind !== "string" || !SURFACE_SET.has(surface_kind)) {
    errors.push(`surface_kind must be cli|app|file; got ${safeStringify(surface_kind)}`);
  }
  const installability = safeGet(o, "installability");
  if (typeof installability !== "string" || !INSTALLABILITY_SET.has(installability)) {
    errors.push(`installability must be native|target|none; got ${safeStringify(installability)}`);
  }

  // Execution-ban markers — fail closed if either is wrong (F-1).
  if (safeGet(o, "executed") !== false) {
    errors.push(`executed must be the literal false (PRE-CUTOVER execution-ban); got ${safeStringify(safeGet(o, "executed"))}`);
  }
  if (safeGet(o, "side_effects") !== "none") {
    errors.push(`side_effects must be "none" (PRE-CUTOVER execution-ban); got ${safeStringify(safeGet(o, "side_effects"))}`);
  }

  const provenance = safeGet(o, "provenance");
  if (typeof provenance !== "string" || !PROVENANCE_SET.has(provenance)) {
    errors.push(`provenance must be verified|inferred; got ${safeStringify(provenance)}`);
  }
  const renderedAt = safeGet(o, "_rendered_at");
  if (typeof renderedAt !== "string" || renderedAt.trim() === "") {
    errors.push("_rendered_at must be a non-empty string (caller-supplied)");
  }
  const sourceVersion = safeGet(o, "_source_version");
  if (typeof sourceVersion !== "string" || sourceVersion.trim() === "") {
    errors.push("_source_version must be a non-empty string");
  }

  // The four named facets — all required.
  const facets = safeGet(o, "facets");
  if (!isPlainObject(facets)) {
    errors.push("facets must be a present object carrying all four AC24 facets");
  } else {
    rejectUnknownKeys("facets", facets, FACET_KEY_SET, errors);
    for (const key of RECEIPT_FACET_KEYS) {
      const fk = safeOwnKeys(facets);
      if (fk === null || !fk.includes(key)) {
        errors.push(`facets.${key} is required (AC24 facet)`);
      } else {
        validateFacet(`facets.${key}`, safeGet(facets, key), errors);
      }
    }
  }

  // _unsupported (optional) — when present, each entry names a known facet.
  const u = safeGet(o, "_unsupported");
  if (u !== undefined && u !== THREW) {
    if (!Array.isArray(u)) {
      errors.push("_unsupported must be an array when present");
    } else {
      u.forEach((e, i) => {
        if (!isPlainObject(e)) {
          errors.push(`_unsupported[${i}] must be an object`);
          return;
        }
        rejectUnknownKeys(`_unsupported[${i}]`, e, UNSUPPORTED_KEYS, errors);
        const facet = safeGet(e, "facet");
        if (typeof facet !== "string" || !FACET_KEY_SET.has(facet)) {
          errors.push(`_unsupported[${i}].facet must be one of ${RECEIPT_FACET_KEYS.join("|")}`);
        }
        const reason = safeGet(e, "reason");
        if (typeof reason !== "string" || reason.trim() === "") {
          errors.push(`_unsupported[${i}].reason must be a non-empty string`);
        }
      });
    }
  } else if (u === THREW) {
    errors.push("_unsupported accessor threw (hostile input)");
  }
}

/**
 * Fail-closed validator for a `guild.install_receipt.v1`. STRICT (rejects unknown keys at
 * every object level) and hostile-input safe (NEVER throws — a throwing getter/Proxy/toJSON
 * yields `{valid:false}`, not an exception). Asserts the discriminator, the execution-ban
 * markers (executed:false / side_effects:"none"), and the four named facets.
 */
export function validateInstallReceipt(value: unknown): ValidationResult {
  const errors: string[] = [];
  try {
    validateInstallReceiptInner(value, errors);
  } catch (err) {
    return {
      valid: false,
      errors: [`install receipt validation threw: ${err instanceof Error ? err.message : "(unknown)"}`],
    };
  }
  return { valid: errors.length === 0, errors };
}

function validateSteps(label: string, value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return;
  }
  if (value.length === 0) {
    errors.push(`${label} must be non-empty (a host plan must describe at least one step)`);
  }
  value.forEach((s, i) => {
    if (!isPlainObject(s)) {
      errors.push(`${label}[${i}] must be an object`);
      return;
    }
    rejectUnknownKeys(`${label}[${i}]`, s, STEP_KEYS, errors);
    const order = safeGet(s, "order");
    if (typeof order !== "number" || !Number.isInteger(order)) {
      errors.push(`${label}[${i}].order must be an integer`);
    }
    const id = safeGet(s, "id");
    if (typeof id !== "string" || id.trim() === "") {
      errors.push(`${label}[${i}].id must be a non-empty string`);
    }
    const description = safeGet(s, "description");
    if (typeof description !== "string" || description.trim() === "") {
      errors.push(`${label}[${i}].description must be a non-empty string`);
    }
    if (typeof safeGet(s, "writes") !== "boolean") {
      errors.push(`${label}[${i}].writes must be a boolean`);
    }
  });
}

/** Inner plan validator — recurses into every host plan's steps + receipt. */
function validateInstallerPlanInner(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push("installer plan must be a non-null object");
    return;
  }
  const o = value;
  rejectUnknownKeys("plan", o, PLAN_KEYS, errors);

  if (safeGet(o, "schema_version") !== INSTALLER_PLAN_SCHEMA) {
    errors.push(`schema_version must be "${INSTALLER_PLAN_SCHEMA}"; got ${safeStringify(safeGet(o, "schema_version"))}`);
  }
  if (safeGet(o, "mode") !== "plan") {
    errors.push(`mode must be the literal "plan" (PLAN-ONLY); got ${safeStringify(safeGet(o, "mode"))}`);
  }
  if (safeGet(o, "executed") !== false) {
    errors.push(`executed must be the literal false (execution-ban); got ${safeStringify(safeGet(o, "executed"))}`);
  }
  if (safeGet(o, "side_effects") !== "none") {
    errors.push(`side_effects must be "none" (execution-ban); got ${safeStringify(safeGet(o, "side_effects"))}`);
  }
  if (safeGet(o, "parity_target") !== "current-canonical") {
    errors.push(
      `parity_target must be "current-canonical" (no new install channel this wave); got ${safeStringify(safeGet(o, "parity_target"))}`
    );
  }
  const renderedAt = safeGet(o, "_rendered_at");
  if (typeof renderedAt !== "string" || renderedAt.trim() === "") {
    errors.push("_rendered_at must be a non-empty string (caller-supplied)");
  }
  const sourceVersion = safeGet(o, "_source_version");
  if (typeof sourceVersion !== "string" || sourceVersion.trim() === "") {
    errors.push("_source_version must be a non-empty string");
  }

  const hosts = safeGet(o, "hosts");
  if (!Array.isArray(hosts)) {
    errors.push("hosts must be an array");
  } else if (hosts.length === 0) {
    errors.push("hosts must be non-empty (a contract must cover at least one host)");
  } else {
    hosts.forEach((h, i) => {
      if (!isPlainObject(h)) {
        errors.push(`hosts[${i}] must be an object`);
        return;
      }
      rejectUnknownKeys(`hosts[${i}]`, h, HOST_PLAN_KEYS, errors);
      const host_id = safeGet(h, "host_id");
      if (typeof host_id !== "string" || host_id.trim() === "") {
        errors.push(`hosts[${i}].host_id must be a non-empty string`);
      }
      const manifest_format = safeGet(h, "manifest_format");
      if (typeof manifest_format !== "string" || manifest_format.trim() === "") {
        errors.push(`hosts[${i}].manifest_format must be a non-empty string`);
      }
      validateSteps(`hosts[${i}].install_steps`, safeGet(h, "install_steps"), errors);
      validateSteps(`hosts[${i}].reconcile_steps`, safeGet(h, "reconcile_steps"), errors);
      const r = validateInstallReceipt(safeGet(h, "receipt"));
      if (!r.valid) for (const e of r.errors) errors.push(`hosts[${i}].receipt.${e}`);
    });
  }
}

/**
 * Fail-closed validator for a `guild.installer_plan.v1`. STRICT (rejects unknown keys at
 * every object level — plan, host plan, step) and hostile-input safe (NEVER throws).
 * Asserts the PLAN-ONLY + execution-ban markers (mode:"plan" / executed:false /
 * side_effects:"none"), the parity target, and recurses into every host plan.
 */
export function validateInstallerPlan(value: unknown): ValidationResult {
  const errors: string[] = [];
  try {
    validateInstallerPlanInner(value, errors);
  } catch (err) {
    return {
      valid: false,
      errors: [`installer plan validation threw: ${err instanceof Error ? err.message : "(unknown)"}`],
    };
  }
  return { valid: errors.length === 0, errors };
}

/** Type guard — narrows after passing validation. */
export function isInstallReceipt(value: unknown): value is GuildInstallReceiptV1 {
  return validateInstallReceipt(value).valid;
}

/** Type guard — narrows after passing validation. */
export function isInstallerPlan(value: unknown): value is GuildInstallerPlanV1 {
  return validateInstallerPlan(value).valid;
}
