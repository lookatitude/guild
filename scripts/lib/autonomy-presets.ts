/**
 * scripts/lib/autonomy-presets.ts
 *
 * P2 Wave-3 / LW3-2 (ADR step 18 / AC21) — **named autonomy presets**
 * (`guild.autonomy_preset.v1`), ADDITIVE + behavior-preserving.
 *
 * A preset expands to a **`host_mode` + `guild_gates` slice ONLY**. `auto_approve` is
 * deliberately NOT a preset-writable axis (the bypass path is closed): any autonomy a
 * preset grants is expressed SOLELY through an EXPLICIT per-gate `guild_gates` grant.
 *
 * Contract authority (SoT — consumed, NEVER re-spelled):
 *   .guild/spec/universal-host-p2-wave3.md SC-W3-2 (presets, AC21 invariant, never-clobber, fail-closed)
 *   scripts/lib/permission-policy-schema.ts (P1-L0) — HostMode / GuildGate / GateType,
 *     the ORTHOGONALITY predicate `gateRequired`, `gatesPermittedToSkip`, ALWAYS_ASK_HARD_SET.
 *   scripts/lib/config-reconcile-contract.ts (P1-L0) — MaterializedField + `mayReconcileWrite`.
 *   scripts/lib/config-schema.ts (P1-L9) — `isSecuritySensitiveKey`.
 *   docs/knowledge/decisions/universal-host-plugin-architecture.md §"Autonomy presets".
 *
 * THE AC21 INVARIANT (load-bearing): for EVERY preset, each protected gate — plan, qa,
 * release, ops, security, destructive — stays NON-auto-continue UNLESS `guild_gates`
 * EXPLICITLY names that specific gate. A preset that would auto-continue a protected gate
 * without an explicit per-gate grant is REJECTED (`validateAutonomyPreset`). The
 * always-ask hard set (release/ops/security/destructive) can NEVER be granted autonomy —
 * naming one of those with an autonomy-leaning value fails CLOSED.
 *
 * WHY this can't drift: `presetGateRequired` reuses the very `gateRequired` predicate that
 * generated the C2 baseline golden (host_mode is structurally never consulted), so a host
 * `bypass_all` preset (the `bypass` preset) cannot lift a single Guild gate — host autonomy
 * NEVER implies gate autonomy.
 *
 * Default-path safety: the preset target keys (`host_mode`, `permissions.guild_gates.*`)
 * are NOT in the canonical DEFAULTS tree — absent ⇒ today's behavior byte-identical. A
 * preset is opt-in; selecting one writes ONLY these keys (provenance "user"), MINIMAL-DIFF
 * (a key whose preset value already equals the effective current/default value is a NO-OP
 * and is NOT written — so a DEFAULT-EQUIVALENT preset is byte-identical to no-preset,
 * writes:[]), never-clobbering sibling user values and asserting fail-closed that no
 * security-sensitive key is touched.
 *
 * CONTRACT: pure data + pure validators/expanders + a pure write-planner. No I/O, no clock
 * (`now` is supplied by the caller), never throws. Wiring the runtime reader to honor these
 * keys is a SEPARATE lane (no default-path change this wave). The CLI/command surface is
 * unchanged (no `commands/*.md` this wave).
 *
 * Owned by command-builder (LW3-2).
 */

import {
  type HostMode,
  HOST_MODES,
  type GuildGate,
  GUILD_GATES,
  type GateType,
  GATE_TYPES,
  ALWAYS_ASK_HARD_SET,
  gateRequired,
  gatesPermittedToSkip,
} from "./permission-policy-schema";

import {
  type MaterializedField,
  type ConfigScope,
  mayReconcileWrite,
} from "./config-reconcile-contract";

import { isSecuritySensitiveKey } from "./config-schema";

// ---------------------------------------------------------------------------
// Schema (guild.autonomy_preset.v1)
// ---------------------------------------------------------------------------

export const AUTONOMY_PRESET_SCHEMA_VERSION = "guild.autonomy_preset.v1" as const;

/** The three named presets. NOT extensible by config this wave (closed set ⇒ auditable). */
export const AUTONOMY_PRESET_NAMES = ["conservative", "standard", "bypass"] as const;
export type AutonomyPresetName = (typeof AUTONOMY_PRESET_NAMES)[number];

/**
 * A named autonomy preset. It carries EXACTLY two axes:
 *   - `host_mode`   — the HOST autonomy axis (tool/edit/sandbox). Drives host launch flags ONLY.
 *   - `guild_gates` — an EXPLICIT per-gate-type grant map. A gate ABSENT from the map ⇒ "ask"
 *                     (non-auto-continue). This is the ONLY axis that can grant gate autonomy.
 *
 * There is intentionally NO `auto_approve` field: the coarse bypass axis is removed so a
 * preset can never silently auto-approve a phase. Any autonomy is expressed per-gate, by name.
 */
export interface AutonomyPreset {
  schema_version: typeof AUTONOMY_PRESET_SCHEMA_VERSION;
  name: AutonomyPresetName;
  description: string;
  /** HOST autonomy axis. Orthogonal to the gate decision — never lifts a Guild gate. */
  host_mode: HostMode;
  /** EXPLICIT per-gate grants. Absent gate ⇒ "ask". `auto_approve` is intentionally absent. */
  guild_gates: Partial<Record<GateType, GuildGate>>;
}

// ---------------------------------------------------------------------------
// The shipped preset definitions
// ---------------------------------------------------------------------------

/**
 * The three canonical presets.
 *
 *  - `conservative` — ask at every host action AND every Guild gate. Equivalent to the
 *    DEFAULT posture (host_mode "ask", no gate grants) — an explicit opt-in that reproduces
 *    today's behavior.
 *  - `standard` — host may accept edits autonomously; the two SAFE Guild gates (plan, qa)
 *    auto-proceed. release/ops/security/destructive ALWAYS ask.
 *  - `bypass` — host runs in bypass/YOLO autonomy, but the gate posture is IDENTICAL to
 *    `standard`: only plan/qa auto-proceed; every protected/hard gate still asks. This is the
 *    whole point of the closed bypass path — a host bypass NEVER implies a gate bypass.
 */
export const AUTONOMY_PRESETS: Record<AutonomyPresetName, AutonomyPreset> = {
  conservative: {
    schema_version: AUTONOMY_PRESET_SCHEMA_VERSION,
    name: "conservative",
    description:
      "Ask at every host action and every Guild gate. Equivalent to the default posture (opt-in).",
    host_mode: "ask",
    guild_gates: {}, // no grants ⇒ every gate asks
  },
  standard: {
    schema_version: AUTONOMY_PRESET_SCHEMA_VERSION,
    name: "standard",
    description:
      "Host may accept edits autonomously; the safe Guild gates (plan, qa) auto-proceed. " +
      "release/ops/security/destructive always ask.",
    host_mode: "accept_edits",
    guild_gates: { plan: "auto-safe", qa: "auto-safe" },
  },
  bypass: {
    schema_version: AUTONOMY_PRESET_SCHEMA_VERSION,
    name: "bypass",
    description:
      "Host runs in bypass/YOLO autonomy; Guild gate posture is UNCHANGED from standard — " +
      "only plan/qa auto-proceed, every protected/hard gate still asks. Host bypass never implies gate bypass.",
    host_mode: "bypass_all",
    guild_gates: { plan: "auto-safe", qa: "auto-safe" },
  },
};

// ---------------------------------------------------------------------------
// Gate-decision reuse (orthogonality predicate — host_mode never consulted)
// ---------------------------------------------------------------------------

/**
 * host_mode is irrelevant to the gate decision (the orthogonality invariant). We pass a
 * fixed sentinel so any future code that tries to read host_mode here is a visible change.
 */
const HOST_MODE_IRRELEVANT: HostMode = "ask";

/**
 * Whether a Guild gate of `gate_type` is REQUIRED under this preset. The per-gate grant
 * (absent ⇒ "ask") is fed to the very `gateRequired` predicate that powers the live policy,
 * so the always-ask hard set is enforced by construction (a hard gate is ALWAYS required).
 *
 * @returns true ⇒ the gate must run (asks); false ⇒ explicitly granted to auto-continue.
 */
export function presetGateRequired(preset: AutonomyPreset, gate_type: GateType): boolean {
  const g: GuildGate = preset.guild_gates[gate_type] ?? "ask";
  return gateRequired(HOST_MODE_IRRELEVANT, g, gate_type);
}

/** One gate's resolved posture under a preset. */
export interface PresetGateExpansion {
  gate_type: GateType;
  /** The per-gate guild_gates value (absent grant materializes as "ask"). */
  guild_gates: GuildGate;
  /** Whether the gate is required (asks). false ⇒ auto-continues. */
  required: boolean;
  /** Whether this gate is EXPLICITLY named in the preset's grant map. */
  explicitly_named: boolean;
}

/** The full expansion of a preset: its host_mode + the 6-gate posture. */
export interface PresetExpansion {
  name: AutonomyPresetName;
  host_mode: HostMode;
  gates: PresetGateExpansion[];
}

/** Expand a preset to its host_mode + every gate's resolved posture (deterministic). */
export function expandPreset(preset: AutonomyPreset): PresetExpansion {
  const gates: PresetGateExpansion[] = GATE_TYPES.map((gate_type) => ({
    gate_type,
    guild_gates: preset.guild_gates[gate_type] ?? "ask",
    required: presetGateRequired(preset, gate_type),
    explicitly_named: Object.prototype.hasOwnProperty.call(preset.guild_gates, gate_type),
  }));
  return { name: preset.name, host_mode: preset.host_mode, gates };
}

// ---------------------------------------------------------------------------
// Validation — structural + THE AC21 INVARIANT (fail-closed)
// ---------------------------------------------------------------------------

export interface PresetValidation {
  valid: boolean;
  errors: string[];
}

const HOST_MODE_SET = new Set<string>(HOST_MODES);
const GUILD_GATE_SET = new Set<string>(GUILD_GATES);
const GATE_TYPE_SET = new Set<string>(GATE_TYPES);
const PRESET_NAME_SET = new Set<string>(AUTONOMY_PRESET_NAMES);

/** A guild_gates value is "autonomy-leaning" iff it permits ANY gate type to skip. */
function isAutonomyLeaning(value: GuildGate): boolean {
  return gatesPermittedToSkip(value).size > 0;
}

/**
 * Validate an autonomy preset — STRUCTURE + the AC21 invariant. Never throws.
 *
 * Structural:
 *   - schema_version / name / host_mode / guild_gates well-typed and in their enums;
 *   - guild_gates is a plain object whose keys ⊆ GATE_TYPES and values ∈ GUILD_GATES;
 *   - NO disallowed axis (an `auto_approve` key — or any security-sensitive key — on the
 *     preset is REJECTED: the bypass path is closed).
 *
 * AC21 (the teeth), evaluated over EVERY protected gate (= every GATE_TYPE):
 *   (1) if the gate WOULD auto-continue (`!presetGateRequired`) but is NOT explicitly named
 *       in `guild_gates` ⇒ REJECT ("would auto-continue without an explicit grant");
 *   (2) FAIL-CLOSED on the always-ask hard set: naming a hard gate (release/ops/security/
 *       destructive) with an autonomy-leaning value ⇒ REJECT (hard gates may only be named
 *       with ask/ask-on-block/never-auto). The runtime predicate already keeps them required;
 *       rejecting the GRANT surfaces the foot-gun instead of silently no-op'ing it.
 */
export function validateAutonomyPreset(preset: unknown): PresetValidation {
  // Fail-closed wrapper: a getter / Proxy trap on hostile input must NEVER let validation
  // pass by throwing past it. Any throw ⇒ invalid (codex G-lane FINDING-3).
  try {
    return validateAutonomyPresetInner(preset);
  } catch {
    return { valid: false, errors: ["autonomy preset validation threw on hostile input (fail-closed)"] };
  }
}

function validateAutonomyPresetInner(preset: unknown): PresetValidation {
  const errors: string[] = [];

  if (typeof preset !== "object" || preset === null || Array.isArray(preset)) {
    return { valid: false, errors: ["autonomy preset must be a non-null object"] };
  }
  const o = preset as Record<string, unknown>;

  if (o["schema_version"] !== AUTONOMY_PRESET_SCHEMA_VERSION) {
    errors.push(`schema_version must be "${AUTONOMY_PRESET_SCHEMA_VERSION}"; got ${JSON.stringify(o["schema_version"])}`);
  }
  if (typeof o["name"] !== "string" || !PRESET_NAME_SET.has(o["name"] as string)) {
    errors.push(`name must be one of ${AUTONOMY_PRESET_NAMES.join("|")}; got ${JSON.stringify(o["name"])}`);
  }
  if (typeof o["host_mode"] !== "string" || !HOST_MODE_SET.has(o["host_mode"] as string)) {
    errors.push(`host_mode must be one of ${HOST_MODES.join("|")}; got ${JSON.stringify(o["host_mode"])}`);
  }

  // Closed-axis guard: a preset may carry ONLY {schema_version,name,description,host_mode,guild_gates}.
  // Any extra key — most importantly `auto_approve` or a security-sensitive key — fails closed.
  // getOwnPropertyNames (NOT Object.keys) so a NON-enumerable own `auto_approve` / security
  // key cannot smuggle past the closed-axis guard (codex G-lane FINDING-2).
  const ALLOWED_KEYS = new Set(["schema_version", "name", "description", "host_mode", "guild_gates"]);
  for (const k of Object.getOwnPropertyNames(o)) {
    if (!ALLOWED_KEYS.has(k)) {
      errors.push(
        k === "auto_approve" || isSecuritySensitiveKey(k)
          ? `preset must not carry the security/bypass axis "${k}" (auto_approve is not preset-writable)`
          : `preset has an unknown key "${k}"`
      );
    }
  }

  const gg = o["guild_gates"];
  if (typeof gg !== "object" || gg === null || Array.isArray(gg)) {
    errors.push("guild_gates must be a non-null object (per-gate grant map)");
    // Can't run AC21 without a well-formed grant map.
    return { valid: errors.length === 0, errors };
  }
  // getOwnPropertyNames so a NON-enumerable own grant key is validated too — the AC21 loop
  // + the write planner both read grants via hasOwnProperty, which sees non-enumerable own
  // props; the validation enumeration MUST match or a malformed grant slips through (codex
  // G-lane FINDING-1).
  const grants = gg as Record<string, unknown>;
  for (const k of Object.getOwnPropertyNames(grants)) {
    const v = grants[k];
    if (!GATE_TYPE_SET.has(k)) errors.push(`guild_gates key "${k}" is not a gate type (${GATE_TYPES.join("|")})`);
    if (typeof v !== "string" || !GUILD_GATE_SET.has(v)) {
      errors.push(`guild_gates["${k}"] must be one of ${GUILD_GATES.join("|")}; got ${JSON.stringify(v)}`);
    }
  }

  // If host_mode or grant values are malformed, the AC21 expansion below would be unsound — bail.
  if (errors.length > 0) return { valid: false, errors };

  const typed = o as unknown as AutonomyPreset;

  // THE AC21 INVARIANT — over every protected gate.
  for (const gate_type of GATE_TYPES) {
    const explicitlyNamed = Object.prototype.hasOwnProperty.call(typed.guild_gates, gate_type);
    const wouldAuto = !presetGateRequired(typed, gate_type);

    // (1) auto-continue requires an explicit per-gate grant.
    if (wouldAuto && !explicitlyNamed) {
      errors.push(
        `AC21: protected gate "${gate_type}" would auto-continue without an explicit guild_gates grant`
      );
    }

    // (2) fail-closed on the always-ask hard set.
    if (explicitlyNamed && ALWAYS_ASK_HARD_SET.has(gate_type)) {
      const value = typed.guild_gates[gate_type] as GuildGate;
      if (isAutonomyLeaning(value)) {
        errors.push(
          `AC21: always-ask hard gate "${gate_type}" cannot be granted autonomy (value "${value}"); ` +
            `hard gates may only be named with ask/ask-on-block/never-auto (fail-closed)`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Validate every shipped preset. Returns the per-preset results. */
export function validateAllPresets(): Record<AutonomyPresetName, PresetValidation> {
  const out = {} as Record<AutonomyPresetName, PresetValidation>;
  for (const name of AUTONOMY_PRESET_NAMES) out[name] = validateAutonomyPreset(AUTONOMY_PRESETS[name]);
  return out;
}

// ---------------------------------------------------------------------------
// Config-slice write planner (never-clobber + fail-closed on security keys)
// ---------------------------------------------------------------------------

/** The settings key for the global host-autonomy override a preset writes. */
export const PRESET_HOST_MODE_KEY = "host_mode";

/** The (additive) per-gate guild_gates settings key namespace a preset writes. */
export function presetGuildGateKey(gate_type: GateType): string {
  return `permissions.guild_gates.${gate_type}`;
}

/**
 * The EFFECTIVE DEFAULT value of each preset-writable key when it is ABSENT from the
 * current materialized config. These keys are NOT in the canonical DEFAULTS tree (see the
 * module header) — absent ⇒ today's behavior: host autonomy "ask" and every gate "ask".
 * The write planner uses these to detect a NO-OP write (preset value == effective current
 * value) so a default-equivalent preset is byte-identical to no-preset (writes:[]).
 */
export const PRESET_KEY_DEFAULTS = {
  host_mode: "ask" as HostMode,
  guild_gate: "ask" as GuildGate,
} as const;

export interface PresetWritePlan {
  preset: AutonomyPresetName;
  scope: ConfigScope;
  /** The fields to write (provenance "user"). Empty when rejected. */
  writes: MaterializedField[];
  /** Keys NOT written because the current value is user-set (never-clobber). */
  skipped_user_keys: string[];
  /** True ⇒ the preset is invalid or would touch a security key — NOTHING is written. */
  rejected: boolean;
  errors: string[];
}

/**
 * Plan the config write for selecting a preset, PURELY (no I/O, no clock).
 *
 * The plan writes ONLY the `host_mode` key + the EXPLICITLY-named `permissions.guild_gates.*`
 * keys, each with provenance "user" (a preset selection is a user choice, so a later
 * `reconcile sync` never clobbers it). It:
 *   - REJECTS (writes nothing) if the preset fails `validateAutonomyPreset` (AC21);
 *   - FAILS CLOSED if any candidate key is security-sensitive (defensive — the preset shape
 *     forbids it, but a mutated input must never slip a security key through);
 *   - NEVER-CLOBBERS: a candidate whose current materialized value is user-set is skipped
 *     (recorded in `skipped_user_keys`), never overwritten.
 *
 * @param current the existing materialized config (key → MaterializedField).
 * @param now     RFC3339 UTC stamp for written fields (caller-supplied — determinism).
 */
export function planPresetWrite(
  preset: AutonomyPreset,
  current: Record<string, MaterializedField>,
  scope: ConfigScope,
  now: string
): PresetWritePlan {
  // Fail-closed wrapper around the ENTIRE body — including the `preset.name` read — so a
  // hostile getter/Proxy on ANY field (codex G-lane FINDING-NEW-1: `name`) can never throw
  // past the planner; any throw ⇒ rejected, nothing written.
  try {
    const base: PresetWritePlan = {
      preset: preset.name,
      scope,
      writes: [],
      skipped_user_keys: [],
      rejected: false,
      errors: [],
    };

    const validation = validateAutonomyPreset(preset);
    if (!validation.valid) {
      return { ...base, rejected: true, errors: validation.errors };
    }

    // Candidate slice — host_mode + the explicitly-named guild_gates grants ONLY. Each
    // candidate carries the EFFECTIVE DEFAULT for its key (used for the no-op-write skip).
    const candidates: { key: string; value: unknown; default: unknown }[] = [
      { key: PRESET_HOST_MODE_KEY, value: preset.host_mode, default: PRESET_KEY_DEFAULTS.host_mode },
    ];
    for (const gate_type of GATE_TYPES) {
      if (Object.prototype.hasOwnProperty.call(preset.guild_gates, gate_type)) {
        candidates.push({
          key: presetGuildGateKey(gate_type),
          value: preset.guild_gates[gate_type],
          default: PRESET_KEY_DEFAULTS.guild_gate,
        });
      }
    }

    // Fail-closed: a preset must NEVER write a security-sensitive key.
    const securityHits = candidates.filter((c) => isSecuritySensitiveKey(c.key));
    if (securityHits.length > 0) {
      return {
        ...base,
        rejected: true,
        errors: securityHits.map((c) => `fail-closed: preset would write security-sensitive key "${c.key}"`),
      };
    }

    const writes: MaterializedField[] = [];
    const skipped: string[] = [];
    for (const c of candidates) {
      // MINIMAL-DIFF (codex re-gate MUST-FIX): the EFFECTIVE current value is the existing
      // materialized value, or the behavioral default when the key is absent. If the preset
      // value already equals it, writing is a NO-OP — skip it entirely (neither written nor
      // recorded as a user-clobber). This is what makes a DEFAULT-EQUIVALENT preset (e.g.
      // conservative → host_mode:ask) byte-identical to no-preset (writes:[]).
      const existing = current[c.key];
      const effective = existing !== undefined ? existing.value : c.default;
      if (Object.is(c.value, effective)) continue; // no-op — nothing to change

      if (!mayReconcileWrite(existing)) {
        skipped.push(c.key); // user-set AND differs ⇒ never-clobber
        continue;
      }
      writes.push({ key: c.key, value: c.value, provenance: "user", last_reconciled_at: now });
    }

    return { ...base, writes, skipped_user_keys: skipped };
  } catch {
    // Best-effort label (read defensively — must not re-throw); rejection is what matters.
    let label: AutonomyPresetName = "conservative";
    try {
      const n = (preset as { name?: unknown })?.name;
      if (typeof n === "string" && (AUTONOMY_PRESET_NAMES as readonly string[]).includes(n)) {
        label = n as AutonomyPresetName;
      }
    } catch {
      /* ignore — keep the safe default label */
    }
    return {
      preset: label,
      scope,
      writes: [],
      skipped_user_keys: [],
      rejected: true,
      errors: ["preset write planning threw on hostile input (fail-closed)"],
    };
  }
}

/** Convenience lookup by name (undefined for an unknown name). */
export function getPreset(name: string): AutonomyPreset | undefined {
  return (AUTONOMY_PRESET_NAMES as readonly string[]).includes(name)
    ? AUTONOMY_PRESETS[name as AutonomyPresetName]
    : undefined;
}
