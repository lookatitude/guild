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
  reconcile as reconcileReference,
  defaultIsValidValue,
} from "./config-reconcile-contract";
import { CONFIG_SCHEMA, flattenSettings, setDotted } from "./config-schema";
import { DEFAULTS, HELP } from "../read-guild-config";

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
  const isValid = (spec: Parameters<typeof defaultIsValidValue>[0], value: unknown): boolean =>
    JSON.stringify(value) === JSON.stringify(spec.default) || defaultIsValidValue(spec, value);
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

/** A compact human-readable summary of a reconcile run (for the CLI). */
export function summarizeReconcile(r: ReconcileRunResult): string {
  const counts = r.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.status] = (acc[f.status] ?? 0) + 1;
    return acc;
  }, {});
  const parts = Object.entries(counts).map(([s, n]) => `${s}:${n}`);
  return `reconcile ${r.mode} — ${parts.join(", ") || "no fields"}; ${r.changed ? "wrote" : "no-write"} ${r.settings_path}`;
}
