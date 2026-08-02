/**
 * src/modules/capability/workflows/routing-rollout.ts
 *
 * ADR rollout flags for dynamic-host-model-routing (closed keys,
 * `.guild/settings.json`) + the M2 activation gate. Lane T6 (rework round 2).
 *
 * ADR (§Rollout flags / §Milestones):
 *   - each flag is independent; an explicit off always wins; flags never
 *     rewrite legacy bytes (flag reading and rollback are PURE; NOTHING in
 *     this module writes — gateM2 performs READ-ONLY artifact loads);
 *   - M0 legs (identity_v2, binding_enforce, discovery, inspect,
 *     teams.proposal_v2) default ON; shadow defaults OFF (on from M1
 *     graduation); enabled defaults OFF (M2 opt-in);
 *   - M2 cannot activate unless M0 (inspection evidence) and M1 (at least one
 *     comparable content-hashed shadow comparison) are evidenced — and
 *     "evidenced" means gateM2 LOADS each referenced artifact from the bound
 *     run's own tree and validates schema + content hash + run binding
 *     (T6-R1-F3). A missing, unparseable, out-of-tree, schema-invalid,
 *     hash-mismatched, or wrong-run artifact is NOT evidence; an unverifiable
 *     run binding voids ALL evidence. The gate fails closed with an honest
 *     reason and there is no injectable "active" object anywhere;
 *   - rollback = flags off; it disables v2 routing for FUTURE decisions and
 *     never corrupts legacy settings or already-persisted run snapshots
 *     (nothing here writes).
 */

import * as fs from "fs";
import * as path from "path";

import { readRunBindingRecord } from "../../lifecycle";
import { selfReferentialHash } from "../../teams";

export const ROUTING_FLAG_KEYS = [
  "model_routing.identity_v2",
  "model_routing.binding_enforce",
  "model_routing.discovery",
  "model_routing.inspect",
  "model_routing.shadow",
  "model_routing.enabled",
  "teams.proposal_v2",
] as const;

export type RoutingFlagKey = (typeof ROUTING_FLAG_KEYS)[number];
export type RoutingFlagValue = "on" | "off";
export type RoutingFlags = Record<RoutingFlagKey, RoutingFlagValue>;

/** ADR defaults: M0 legs on; shadow (M1) and enabled (M2) off. */
export const ROUTING_FLAG_DEFAULTS: Readonly<RoutingFlags> = Object.freeze({
  "model_routing.identity_v2": "on",
  "model_routing.binding_enforce": "on",
  "model_routing.discovery": "on",
  "model_routing.inspect": "on",
  "model_routing.shadow": "off",
  "model_routing.enabled": "off",
  "teams.proposal_v2": "on",
});

export interface RoutingFlagReadResult {
  flags: RoutingFlags;
  /** Closed-key + closed-value violations, recorded honestly (never a crash). */
  rejects: string[];
}

/** The nested settings groups the closed keys live in. */
const FLAG_GROUPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  model_routing: [
    "identity_v2",
    "binding_enforce",
    "discovery",
    "inspect",
    "shadow",
    "enabled",
  ],
  teams: ["proposal_v2"],
});

/**
 * Read the rollout flags from a raw `.guild/settings.json` object. Closed-key,
 * closed-value: a malformed value or an unknown key under a flag group records
 * a reject and the flag keeps its ADR default — reading never throws and never
 * invents an enablement. `teams` may carry other (non-flag) keys; only
 * `model_routing` is a fully closed group here.
 */
export function readRoutingFlags(settings: unknown): RoutingFlagReadResult {
  const flags: RoutingFlags = { ...ROUTING_FLAG_DEFAULTS };
  const rejects: string[] = [];

  if (settings !== undefined && settings !== null && (typeof settings !== "object" || Array.isArray(settings))) {
    rejects.push("settings root is not an object — using ADR defaults for every rollout flag");
    return { flags, rejects };
  }
  const root = (settings ?? {}) as Record<string, unknown>;

  for (const [group, keys] of Object.entries(FLAG_GROUPS)) {
    const groupValue = root[group];
    if (groupValue === undefined || groupValue === null) continue;
    if (typeof groupValue !== "object" || Array.isArray(groupValue)) {
      rejects.push(`settings.${group} is not an object — ${group}.* flags keep their defaults`);
      continue;
    }
    const groupObj = groupValue as Record<string, unknown>;
    for (const [k, v] of Object.entries(groupObj)) {
      if (!keys.includes(k)) {
        // model_routing is a closed group; teams carries non-flag keys too.
        if (group === "model_routing") {
          rejects.push(`unknown key under closed group: ${group}.${k}`);
        }
        continue;
      }
      const flagKey = `${group}.${k}` as RoutingFlagKey;
      if (v === "on" || v === "off") {
        flags[flagKey] = v;
      } else {
        rejects.push(
          `${flagKey}: expected "on" | "off", got ${JSON.stringify(v)} — keeping default "${ROUTING_FLAG_DEFAULTS[flagKey]}"`
        );
      }
    }
  }

  return { flags, rejects };
}

// ── M2 activation gate (ADR §M2: cannot activate unless M0/M1 evidenced) ────

/**
 * REFERENCES to on-record evidence — never the evidence itself. gateM2 loads
 * every referenced artifact from the bound run's own tree and validates it;
 * a caller cannot inject "evidenced" or "active" values (T6-R1-F3).
 */
export interface M2EvidenceRefs {
  /** Repo root: the run tree lives at `<root>/.guild/runs/<run_id>`. */
  root: string;
  run_id: string;
  /** M0: run-dir-relative paths of persisted guild.model_inspection.v1 reports. */
  m0: { inspection_report_refs: string[] };
  /** M1: run-dir-relative paths of persisted guild.shadow_comparison.v1 records. */
  m1: { shadow_comparison_refs: string[] };
}

export type M2Gate =
  | { active: true; reason: string }
  | { active: false; reason: string };

/** Resolve a run-dir-relative ref, refusing any path that escapes the run dir. */
function resolveInRunDir(runDir: string, ref: string): string | null {
  const abs = path.resolve(runDir, ref);
  return abs === runDir || abs.startsWith(runDir + path.sep) ? abs : null;
}

function loadJson(absPath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(absPath, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Fail-closed M2 gate (READ-ONLY). Active ONLY when:
 *   - `model_routing.enabled` is on (the flag alone is never enough);
 *   - the run's OWN minted binding record loads and schema-validates
 *     (an absent/malformed binding voids all evidence — nothing in an
 *     unauthorized run tree can gate v2 routing on);
 *   - M0: ≥1 referenced artifact loads from INSIDE the run dir as a
 *     guild.model_inspection.v1 report with state "ok" bound to this run;
 *   - M1: ≥1 referenced artifact loads as a guild.shadow_comparison.v1 record
 *     bound to this run, `comparable: true`, whose `comparison_hash`
 *     RECOMPUTES over the record's own content (team-contracts §1) — the gate
 *     binds to a real comparison, never to a hash-shaped string.
 * Anything else → inactive with an honest reason.
 */
/**
 * Load every REFERENCED M0 artifact that verifies as evidence: inside the run
 * dir, parseable, `guild.model_inspection.v1`, `state: "ok"`, bound to this
 * run — and only when the run's own minted binding record loads (evidence in
 * an unbound tree proves nothing, so it is not returned at all).
 *
 * READ-ONLY. This is the single definition of "a verified M0 report": `gateM2`
 * counts these, and the dispatch module sources its resolver inputs from these
 * same objects. Returns `[]` for every unverifiable input — never throws.
 */
export function loadVerifiedM0Reports(
  evidence: M2EvidenceRefs | null | undefined
): Array<Record<string, unknown>> {
  if (!evidence || typeof evidence.root !== "string" || typeof evidence.run_id !== "string") {
    return [];
  }
  const binding = readRunBindingRecord({ root: evidence.root, run_id: evidence.run_id });
  if (binding.status !== "ok") return [];
  const runDir = path.resolve(evidence.root, ".guild", "runs", evidence.run_id);
  const refs = Array.isArray(evidence.m0?.inspection_report_refs)
    ? evidence.m0.inspection_report_refs
    : [];
  const out: Array<Record<string, unknown>> = [];
  for (const ref of refs) {
    if (typeof ref !== "string") continue;
    const abs = resolveInRunDir(runDir, ref);
    if (!abs) continue;
    const report = loadJson(abs);
    if (!report) continue;
    if (report["schema_version"] !== "guild.model_inspection.v1") continue;
    if (report["state"] !== "ok") continue;
    if (report["run_id"] !== evidence.run_id) continue;
    out.push(report);
  }
  return out;
}

export function gateM2(flags: RoutingFlags, evidence: M2EvidenceRefs | null | undefined): M2Gate {
  if (flags["model_routing.enabled"] !== "on") {
    return { active: false, reason: "model_routing.enabled is off (M2 is opt-in)" };
  }
  if (!evidence || typeof evidence.root !== "string" || typeof evidence.run_id !== "string") {
    return {
      active: false,
      reason: "M0 not evidenced: no evidence refs supplied — v2 routing stays off",
    };
  }
  const binding = readRunBindingRecord({ root: evidence.root, run_id: evidence.run_id });
  if (binding.status !== "ok") {
    return {
      active: false,
      reason:
        `run binding ${binding.status} for ${evidence.run_id}: evidence in an unbound ` +
        `run tree proves nothing — v2 routing stays off`,
    };
  }
  const runDir = path.resolve(evidence.root, ".guild", "runs", evidence.run_id);

  const m0Refs = Array.isArray(evidence.m0?.inspection_report_refs)
    ? evidence.m0.inspection_report_refs
    : [];
  // ONE implementation of "a verified M0 report": the gate counts what
  // loadVerifiedM0Reports returns, and every other consumer (e.g. the dispatch
  // module's resolver-input sourcing) reads the SAME verified objects — there
  // is no parallel re-validation anywhere.
  const m0Valid = loadVerifiedM0Reports(evidence).length;
  if (m0Valid === 0) {
    return {
      active: false,
      reason:
        `M0 not evidenced: 0 of ${m0Refs.length} inspection ref(s) loaded as a valid ` +
        `guild.model_inspection.v1 report bound to ${evidence.run_id} — v2 routing stays off`,
    };
  }

  const m1Refs = Array.isArray(evidence.m1?.shadow_comparison_refs)
    ? evidence.m1.shadow_comparison_refs
    : [];
  let m1Valid = 0;
  for (const ref of m1Refs) {
    if (typeof ref !== "string") continue;
    const abs = resolveInRunDir(runDir, ref);
    if (!abs) continue;
    const cmp = loadJson(abs);
    if (!cmp) continue;
    if (cmp["schema_version"] !== "guild.shadow_comparison.v1") continue;
    if (cmp["run_id"] !== evidence.run_id) continue;
    if (cmp["comparable"] !== true) continue;
    const storedHash = cmp["comparison_hash"];
    if (typeof storedHash !== "string" || !/^[0-9a-f]{64}$/.test(storedHash)) continue;
    if (selfReferentialHash(cmp, "comparison_hash") !== storedHash) continue;
    m1Valid += 1;
  }
  if (m1Valid === 0) {
    return {
      active: false,
      reason:
        `M1 not evidenced: 0 of ${m1Refs.length} shadow-comparison ref(s) loaded as a ` +
        `comparable, hash-verified guild.shadow_comparison.v1 record bound to ` +
        `${evidence.run_id} — v2 routing stays off`,
    };
  }
  return {
    active: true,
    reason:
      `M2 active: opt-in flag on; M0 evidenced (${m0Valid} verified inspection report(s)); ` +
      `M1 evidenced (${m1Valid} verified comparable shadow comparison(s))`,
  };
}

/**
 * Rollback leg (ADR: every milestone independently reversible). PURE — returns
 * a new flag set with v2 routing legs off; never touches disk, so legacy
 * settings bytes and already-persisted run snapshots are structurally safe.
 */
export function rollbackV2Routing(flags: RoutingFlags): RoutingFlags {
  return { ...flags, "model_routing.shadow": "off", "model_routing.enabled": "off" };
}
