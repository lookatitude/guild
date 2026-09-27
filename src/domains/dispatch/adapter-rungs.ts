/**
 * The closed adapter rung matrix as policy (KTD5, KTD28).
 *
 * A host family declares seven rungs. This module decides what each rung means
 * for a dispatch; the rows themselves live in src/adapters/adapter.lock.json and
 * reach a domain only as plain data a composition root passes in (KTD4).
 *
 * Two laws:
 *  - An INFERRED cell is treated as `missing`. Unverified never guesses upward.
 *  - A missing rung has exactly one stated behaviour, and every one is recorded
 *    as a loss. A loss nobody can read is the silent degradation KTD28 forbids.
 */

import { deepFreeze, frozenList } from "../kernel";
import { emitTraceEvent, makeDegradationEvent } from "../telemetry";

export const ADAPTER_RUNG_NAMES = frozenList([
  "spawn",
  "hooks",
  "skills",
  "commands",
  "mcp",
  "compaction",
  "tool_projection",
] as const);
export type AdapterRungName = (typeof ADAPTER_RUNG_NAMES)[number];

export const ADAPTER_RUNG_VALUES = frozenList([
  "native",
  "wrapped",
  "bridged",
  "emulated",
  "skip-recorded",
  "missing",
] as const);
export type AdapterRungValue = (typeof ADAPTER_RUNG_VALUES)[number];

export const ADAPTER_RUNG_EVIDENCE = frozenList(["verified", "inferred"] as const);
export type AdapterRungEvidence = (typeof ADAPTER_RUNG_EVIDENCE)[number];

export interface AdapterRungCell {
  rung: AdapterRungValue;
  evidence: AdapterRungEvidence;
  /** Required when `evidence` is `verified`: where the proof lives. */
  verified_by: string | null;
}

export interface AdapterRungRow {
  family: string;
  rungs: Readonly<Record<AdapterRungName, AdapterRungCell>>;
}

/** The one behaviour each rung falls back to when it is missing (KTD28 table). */
export const MISSING_RUNG_BEHAVIOUR = deepFreeze({
  spawn: "lead_only: bind the parent as lead; no worker process, no extra model",
  hooks: "verify.after_edit runs wrapped when a check command exists, else skip-recorded",
  skills: "AGENTS.md + using-guild only; assembler bodies are Read when a command names them",
  commands: "a typed verb becomes a prompt that names the assembler",
  mcp: "in-process wiki/trace retrieval; the MCP path is skip-recorded; no third MCP id",
  compaction: "skip-recorded; disk files are still written and the next session rehydrates",
  tool_projection: "isolated spawn refused; lead_only in the parent with the isolation loss recorded",
} satisfies Record<AdapterRungName, string>);

/** Rungs that deliver the capability for real. `emulated` fakes it, so it does not count. */
const DELIVERING: ReadonlySet<AdapterRungValue> = new Set(["native", "wrapped", "bridged"]);

const CELL_KEYS = new Set(["rung", "evidence", "verified_by"]);

/** Closed-shape validator. Returns the row or null; never throws. */
export function validateAdapterRungRow(value: unknown): AdapterRungRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((k) => k !== "family" && k !== "rungs")) return null;
  if (typeof row.family !== "string" || row.family.length === 0) return null;
  const rungs = row.rungs;
  if (!rungs || typeof rungs !== "object" || Array.isArray(rungs)) return null;
  const keys = Object.keys(rungs);
  if (keys.length !== ADAPTER_RUNG_NAMES.length) return null;
  for (const name of ADAPTER_RUNG_NAMES) {
    const cell = (rungs as Record<string, unknown>)[name];
    if (!cell || typeof cell !== "object" || Array.isArray(cell)) return null;
    const c = cell as Record<string, unknown>;
    if (Object.keys(c).some((k) => !CELL_KEYS.has(k))) return null;
    if (!(ADAPTER_RUNG_VALUES as readonly unknown[]).includes(c.rung)) return null;
    if (!(ADAPTER_RUNG_EVIDENCE as readonly unknown[]).includes(c.evidence)) return null;
    const by = c.verified_by ?? null;
    if (c.evidence === "verified" && (typeof by !== "string" || by.length === 0)) return null;
    if (c.evidence === "inferred" && by !== null) return null;
  }
  return deepFreeze(row as unknown as AdapterRungRow);
}

/** Inferred cells fail closed (KTD5): they are read as `missing`. */
export function effectiveRung(cell: AdapterRungCell | undefined): AdapterRungValue {
  if (!cell || cell.evidence !== "verified") return "missing";
  return cell.rung;
}

export interface RungLoss {
  rung: AdapterRungName;
  declared: AdapterRungValue | null;
  evidence: AdapterRungEvidence | null;
  effective: AdapterRungValue;
  behaviour: string;
}

export interface RungPlan {
  family: string | null;
  /** `lead_only` when the host cannot spawn OR cannot project a reduced tool set. */
  spawn: "isolated" | "lead_only";
  tool_projection: "projected" | "refused";
  after_edit: "native" | "wrapped" | "skip-recorded";
  skills: "native" | "read_when_named";
  commands: "native" | "prompt_names_assembler";
  mcp: "mcp" | "in_process";
  compaction: "native" | "skip-recorded";
  losses: readonly RungLoss[];
}

/**
 * Resolve what a dispatch on this family may do. `row === null` is an unknown
 * host: every rung is missing, so nothing is guessed (KTD22, KTD5).
 */
export function resolveRungPlan(
  row: AdapterRungRow | null,
  opts: { verify_check_available: boolean },
): RungPlan {
  const losses: RungLoss[] = [];
  const eff = (name: AdapterRungName): AdapterRungValue => {
    const cell = row?.rungs[name];
    const value = effectiveRung(cell);
    if (!DELIVERING.has(value)) {
      losses.push({
        rung: name,
        declared: cell?.rung ?? null,
        evidence: cell?.evidence ?? null,
        effective: value,
        behaviour: MISSING_RUNG_BEHAVIOUR[name],
      });
    }
    return value;
  };
  const spawn = eff("spawn");
  const projection = eff("tool_projection");
  const hooks = eff("hooks");
  const skills = eff("skills");
  const commands = eff("commands");
  const mcp = eff("mcp");
  const compaction = eff("compaction");
  const canSpawn = DELIVERING.has(spawn);
  const canProject = DELIVERING.has(projection);
  return deepFreeze({
    family: row?.family ?? null,
    spawn: canSpawn && canProject ? "isolated" : "lead_only",
    tool_projection: canProject ? "projected" : "refused",
    after_edit: hooks === "native" ? "native" : DELIVERING.has(hooks) || opts.verify_check_available ? "wrapped" : "skip-recorded",
    skills: DELIVERING.has(skills) ? "native" : "read_when_named",
    commands: DELIVERING.has(commands) ? "native" : "prompt_names_assembler",
    mcp: DELIVERING.has(mcp) ? "mcp" : "in_process",
    compaction: compaction === "native" ? "native" : "skip-recorded",
    losses,
  } satisfies RungPlan);
}

/** One recorded-loss entry per rung loss, in the TaskCell projection's shape. */
export function rungLossesAsRecordedLosses(
  plan: RungPlan,
): { capability: string; mapping: string; loss: string }[] {
  return plan.losses.map((l) => ({
    capability: `adapter.${l.rung}`,
    mapping: l.effective,
    loss:
      `${plan.family ?? "unknown host"} ${l.rung} rung ` +
      `${l.declared === null ? "absent" : `${l.declared} (${l.evidence})`} — ${l.behaviour}`,
  }));
}

/**
 * Record every loss on the run's KTD16 event log as a `guild.trace.degradation.v1`
 * line (surface `host-capability`). Returns how many lines landed, so a caller
 * can tell a recorded loss from a dropped one.
 */
export function recordRungLosses(input: {
  runDir: string;
  run_id: string;
  plan: RungPlan;
  lane_id?: string;
  ts?: string;
}): number {
  const ts = input.ts ?? new Date().toISOString();
  let written = 0;
  for (const loss of input.plan.losses) {
    const event = makeDegradationEvent({
      ts,
      run_id: input.run_id,
      lane_id: input.lane_id ?? "",
      surface: "host-capability",
      reason: `adapter rung ${loss.rung} is ${loss.effective} on ${input.plan.family ?? "an unknown host"} (KTD28)`,
      attempted: `${loss.rung}: ${loss.declared === null ? "absent" : `${loss.declared} (${loss.evidence})`}`,
      fallback: loss.behaviour,
      severity: "warn",
    });
    if (emitTraceEvent(event, input.runDir)) written += 1;
  }
  return written;
}
