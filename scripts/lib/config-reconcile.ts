/**
 * scripts/lib/config-reconcile.ts
 *
 * P1-L9 — the runtime config reconciler: `reconcile check|sync|repair`, the
 * never-clobber materializer behind the L0 `config-reconcile-contract.ts` decision
 * reference. `config init` becomes `reconcile sync`.
 *
 *   - check   read-only drift report; writes nothing.
 *   - sync    fill MISSING keys to their schema default; NEVER overwrite a user value.
 *   - repair  additionally coerce a MALFORMED default/reconciled value to default;
 *             still NEVER clobbers a VALID or a user value.
 *
 * DESIGN (drift-free + byte-identical, SC-6):
 *   - Decisions come from the L0 pure `reconcile()` over CONFIG_SCHEMA (config-schema.ts,
 *     derived from the one canonical DEFAULTS tree).
 *   - Materialization starts from a deep clone of DEFAULTS and overlays the resolved
 *     value of every field, then serializes `{...merged, _help: HELP}` exactly as
 *     `scaffold()` does — so `reconcile sync` on a FRESH repo is byte-identical to
 *     today's `config init` output (the captured golden).
 *   - Provenance lives in a SIDECAR (`settings.provenance.json`) so `settings.json`
 *     itself stays byte-clean. A value present in settings.json with NO sidecar record
 *     is treated as `user` (hand-authored ⇒ never clobbered).
 *   - Unknown (non-schema) user keys are preserved (never-clobber covers them too).
 *
 * Owned by tooling-engineer (P1-L9). CLI surface wired in config-cmd.ts. The
 * commands/*.md `config init`→`reconcile sync` doc rewire is a command-builder followup.
 */

import * as nodeFs from "fs";
import * as path from "path";
import {
  type MaterializedField,
  type ReconcileMode,
  type ReconcileResult,
  advanceResolverModeOnApproval,
  reconcile as reconcileReference,
  defaultIsValidValue,
} from "./config-reconcile-contract";
import { CONFIG_SCHEMA, flattenSettings, setDotted } from "./config-schema";
import { DEFAULTS, HELP } from "../read-guild-config";
// S5: semantic validity for capability.* (canonical shared entrypoint — R-DIST).
import {
  CAPABILITY_AUTO_CREATE_POLICIES,
  CAPABILITY_RESOLVER_MODES,
  isValidCapabilityValue,
  type CapabilityAutoCreatePolicy,
  type CapabilityResolverMode,
} from "./shared/config-defaults";

// ---------------------------------------------------------------------------
// Injectable IO (CI-safe + test-injectable; production uses node fs)
// ---------------------------------------------------------------------------

export interface ReconcileIO {
  readFileText(p: string): string | null; // null when absent/unreadable
  writeFileText(p: string, text: string): void;
  ensureDir(p: string): void;
}

export function defaultReconcileIO(): ReconcileIO {
  return {
    readFileText: (p) => {
      try {
        return nodeFs.readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    writeFileText: (p, text) => nodeFs.writeFileSync(p, text, "utf8"),
    ensureDir: (p) => nodeFs.mkdirSync(p, { recursive: true }),
  };
}

// ---------------------------------------------------------------------------
// Provenance sidecar
// ---------------------------------------------------------------------------

interface ProvenanceRecord {
  provenance: MaterializedField["provenance"];
  last_reconciled_at: string | null;
}
type ProvenanceMap = Record<string, ProvenanceRecord>;

export interface ReconcileRunResult extends ReconcileResult {
  /** Absolute path of the settings.json acted on. */
  settings_path: string;
  /** True when the settings.json (or sidecar) was actually written. */
  changed: boolean;
}

function settingsPathFor(cwd: string): string {
  return path.join(cwd, ".guild", "settings.json");
}
function provenancePathFor(cwd: string): string {
  return path.join(cwd, ".guild", "settings.provenance.json");
}

function parseJsonObject(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function deepCloneDefaults(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(DEFAULTS)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// reconcileConfig — the runtime entrypoint
// ---------------------------------------------------------------------------

export interface ReconcileOptions {
  cwd: string;
  mode: ReconcileMode;
  /** RFC3339 UTC stamp for written fields (caller-supplied — deterministic). */
  now: string;
  io?: ReconcileIO;
}

/**
 * Run a reconcile pass. `check` writes nothing. `sync`/`repair` write a byte-clean
 * settings.json (DEFAULTS-shaped, user values preserved) plus a provenance sidecar.
 * Pure decision logic delegated to the L0 `reconcile()` reference (SC-6 contract-test).
 */
export function reconcileConfig(opts: ReconcileOptions): ReconcileRunResult {
  const io = opts.io ?? defaultReconcileIO();
  const settingsPath = settingsPathFor(opts.cwd);
  const provenancePath = provenancePathFor(opts.cwd);

  const existingObj = parseJsonObject(io.readFileText(settingsPath));
  const sidecar = (parseJsonObject(io.readFileText(provenancePath)) as ProvenanceMap | null) ?? {};

  // Flatten existing settings to dotted leaves (excluding _help). Absent ⇒ {}.
  const flatExisting = existingObj ? flattenSettings({ ...existingObj }) : {};

  // Build the current MaterializedField map. A present value with no sidecar record is
  // `user` (hand-authored ⇒ immutable to the reconciler).
  const current: Record<string, MaterializedField> = {};
  for (const [key, value] of Object.entries(flatExisting)) {
    const rec = sidecar[key];
    current[key] = {
      key,
      value,
      provenance: rec?.provenance ?? "user",
      last_reconciled_at: rec?.last_reconciled_at ?? null,
    };
  }

  // L0 decision reference (the SC-6 contract the runtime must match). A value that
  // deep-equals its own schema default is ALWAYS valid — this correctly classifies the
  // nullable/empty-object leaves (initiative_default:null, loops:null, {} maps) that the
  // structural type check alone would mis-flag as malformed.
  const isValid = (spec: Parameters<typeof defaultIsValidValue>[0], value: unknown): boolean => {
    // S5: `capability.*` needs a SEMANTIC check. defaultIsValidValue is structural —
    // it accepts any finite number and any array — so an out-of-range budget or a
    // duplicated starter role survived `repair` (adversarial-review finding). Consulted
    // FIRST so the range/slug contract is what decides, not the shape.
    const semantic = isValidCapabilityValue(spec.key, value);
    if (semantic !== undefined) return semantic;
    return JSON.stringify(value) === JSON.stringify(spec.default) || defaultIsValidValue(spec, value);
  };
  const result = reconcileReference(CONFIG_SCHEMA, current, opts.mode, opts.now, isValid);

  if (opts.mode === "check") {
    return { ...result, settings_path: settingsPath, changed: false };
  }

  // ── Materialize (sync | repair) ─────────────────────────────────────────────
  const merged = deepCloneDefaults();
  for (const f of result.findings) {
    setDotted(merged, f.key, f.resolved_value); // missing→default (already present); user→kept; ok→value; repair→default
  }
  // Preserve unknown (non-schema) user keys — never-clobber covers them too.
  const schemaKeys = new Set(CONFIG_SCHEMA.map((s) => s.key));
  for (const [key, value] of Object.entries(flatExisting)) {
    if (!schemaKeys.has(key)) setDotted(merged, key, value);
  }

  const nextSettingsText = JSON.stringify({ ...merged, _help: HELP }, null, 2) + "\n";

  // Rebuild the provenance sidecar from the findings (+ now stamp on written fields).
  const nextProvenance: ProvenanceMap = {};
  for (const f of result.findings) {
    const wasWritten = f.action === "fill-default" || f.action === "repair-default";
    nextProvenance[f.key] = {
      provenance: f.resolved_provenance,
      last_reconciled_at: wasWritten ? opts.now : (sidecar[f.key]?.last_reconciled_at ?? null),
    };
  }
  const nextProvenanceText = JSON.stringify(nextProvenance, null, 2) + "\n";

  // Idempotency: only write when content actually changes.
  const prevSettingsText = io.readFileText(settingsPath);
  const prevProvenanceText = io.readFileText(provenancePath);
  const settingsChanged = prevSettingsText !== nextSettingsText;
  const provenanceChanged = prevProvenanceText !== nextProvenanceText;

  if (settingsChanged || provenanceChanged) {
    io.ensureDir(path.dirname(settingsPath));
    if (settingsChanged) io.writeFileText(settingsPath, nextSettingsText);
    if (provenanceChanged) io.writeFileText(provenancePath, nextProvenanceText);
  }

  return {
    ...result,
    settings_path: settingsPath,
    changed: settingsChanged || provenanceChanged,
  };
}

// ---------------------------------------------------------------------------
// S5 / cap-loc-D04 — the production resolver-mode advance (approval → config write)
// ---------------------------------------------------------------------------

/** D04's advance target: an approved proposal moves the project to `project-local`. */
export const RESOLVER_ADVANCE_TARGET: CapabilityResolverMode = "project-local";

export interface ResolverAdvanceRunResult {
  advanced: boolean;
  /**
   * The contract's own reason (`advanced` | `policy_never` | `user_pinned` |
   * `already_at_target`) or a caller-side refusal this runtime adds:
   * `settings_absent` (no readable .guild/settings.json — an un-initialized
   * project is never implicitly config-scaffolded by an adoption),
   * `policy_malformed` / `target_invalid` (fail closed, never advance on a value
   * the schema does not recognize), `write_failed: <detail>` (persistence
   * failed, EVERY write rolled back — disk is byte-identical to before), or
   * `write_failed_partial: <detail>` (persistence failed AND the rollback also
   * failed — settings may carry the new mode without reconciled provenance;
   * reported truthfully with `changed: true`, never as a clean no-op).
   */
  reason: string;
  settings_path: string;
  /** True iff any config byte on disk differs from before the call. */
  changed: boolean;
}

/**
 * THE production resolver-mode advance path (FIC45-A4-B1).
 *
 * `advanceResolverModeOnApproval` in the L0 contract is pure — it decides, it
 * cannot persist. This runtime wrapper is the single place that binds the
 * decision to real config bytes: it reads the materialized
 * `capability.resolver_mode` (+ provenance sidecar, absent record ⇒ `user`,
 * exactly as `reconcileConfig` materializes it), routes through the contract's
 * one advance function, and persists the returned field to `.guild/settings.json`
 * plus `.guild/settings.provenance.json`.
 *
 * Called from `applyAdoptionPlan` after an approved plan has durably applied —
 * the D04 "approved capability proposal" transition — and from nowhere else.
 * Every refusal is a reported reason, never a throw: an adoption that has
 * already committed must not be failed retroactively by its config side-effect.
 */
export function applyResolverModeAdvanceOnApproval(opts: {
  cwd: string;
  /** RFC3339 UTC stamp (caller-supplied — the adoption's own `adoptedAt`). */
  now: string;
  target?: string;
  io?: ReconcileIO;
}): ResolverAdvanceRunResult {
  const io = opts.io ?? defaultReconcileIO();
  const settingsPath = settingsPathFor(opts.cwd);
  const done = (advanced: boolean, reason: string, changed: boolean): ResolverAdvanceRunResult => ({
    advanced,
    reason,
    settings_path: settingsPath,
    changed,
  });

  const target = opts.target ?? RESOLVER_ADVANCE_TARGET;
  if (!CAPABILITY_RESOLVER_MODES.includes(target as CapabilityResolverMode)) {
    return done(false, "target_invalid", false);
  }

  const prevSettingsText = io.readFileText(settingsPath);
  const existingObj = parseJsonObject(prevSettingsText);
  if (existingObj === null || prevSettingsText === null) return done(false, "settings_absent", false);

  const provenancePath = provenancePathFor(opts.cwd);
  const prevProvenanceText = io.readFileText(provenancePath);
  const sidecar = (parseJsonObject(prevProvenanceText) as ProvenanceMap | null) ?? {};
  const flatExisting = flattenSettings({ ...existingObj });

  const MODE_KEY = "capability.resolver_mode";
  const modeValue = flatExisting[MODE_KEY];
  const modeRec = sidecar[MODE_KEY];
  const current: MaterializedField | undefined =
    modeValue === undefined
      ? undefined
      : {
          key: MODE_KEY,
          value: modeValue,
          // Same materialization rule as reconcileConfig: a value with no sidecar
          // record is hand-authored ⇒ `user` ⇒ never clobbered.
          provenance: modeRec?.provenance ?? "user",
          last_reconciled_at: modeRec?.last_reconciled_at ?? null,
        };

  const policyRaw =
    flatExisting["capability.auto_create_policy"] ??
    CONFIG_SCHEMA.find((s) => s.key === "capability.auto_create_policy")?.default;
  if (!CAPABILITY_AUTO_CREATE_POLICIES.includes(policyRaw as CapabilityAutoCreatePolicy)) {
    // Fail closed: the contract only refuses on the literal "never", so a
    // malformed policy must be stopped HERE or garbage would authorize an advance.
    return done(false, "policy_malformed", false);
  }

  const outcome = advanceResolverModeOnApproval({
    current,
    autoCreatePolicy: policyRaw as string,
    target,
    now: opts.now,
  });
  if (!outcome.advanced || outcome.field === null) {
    return done(false, outcome.reason, false);
  }

  // ── Persist, atomically-or-rolled-back (codex A5 G-lane round 1, item 1) ──
  // The two files are one logical write: `project-local` landing in settings
  // WITHOUT its `reconciled` sidecar record would later materialize as `user`
  // (pinned forever). So the second-write failure path must restore the first
  // write, and a failed restore must be REPORTED as partial — never as a clean
  // "changed: false" no-op.
  setDotted(existingObj, MODE_KEY, outcome.field.value);
  const nextSettingsText = `${JSON.stringify(existingObj, null, 2)}\n`;
  const nextSidecar: ProvenanceMap = {
    ...sidecar,
    [MODE_KEY]: {
      provenance: outcome.field.provenance,
      last_reconciled_at: outcome.field.last_reconciled_at,
    },
  };
  const nextProvenanceText = `${JSON.stringify(nextSidecar, null, 2)}\n`;

  try {
    io.ensureDir(path.dirname(settingsPath));
    io.writeFileText(settingsPath, nextSettingsText);
    io.writeFileText(provenancePath, nextProvenanceText);
    return done(true, outcome.reason, true);
  } catch (err) {
    const detail = (err as Error).message;
    // Roll back ONLY what actually diverged (verified by read, not assumed from
    // intent) — re-writing an untouched file through a failing writer would turn
    // a clean rollback into a spurious partial. Then report from the REAL end
    // state: `changed` is a disk fact here, never an inference.
    let rollbackFailure: string | null = null;
    try {
      if (io.readFileText(settingsPath) !== prevSettingsText) {
        io.writeFileText(settingsPath, prevSettingsText);
      }
      if (io.readFileText(provenancePath) !== prevProvenanceText && prevProvenanceText !== null) {
        io.writeFileText(provenancePath, prevProvenanceText);
      }
    } catch (rollbackErr) {
      rollbackFailure = (rollbackErr as Error).message;
    }
    const settingsRestored = io.readFileText(settingsPath) === prevSettingsText;
    const provenanceRestored = io.readFileText(provenancePath) === prevProvenanceText;
    if (settingsRestored && provenanceRestored) {
      return done(false, `write_failed: ${detail}`, false);
    }
    return done(
      false,
      `write_failed_partial: ${detail}${rollbackFailure !== null ? `; rollback failed: ${rollbackFailure}` : ""}`,
      true,
    );
  }
}

/** A compact human-readable summary of a reconcile run (for the CLI). */
export function summarizeReconcile(r: ReconcileRunResult): string {
  const counts = r.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.status] = (acc[f.status] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(counts).map(([s, n]) => `${s}:${n}`);
  return `reconcile ${r.mode} — ${parts.join(", ") || "no fields"}; ${r.changed ? "wrote" : "no-write"} ${r.settings_path}`;
}
