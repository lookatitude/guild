/**
 * scripts/lib/adapter-fallback-ladders.ts
 *
 * P1-L0 FOUNDATION — C3: the **per-host fallback-ladder rung table** for the four
 * runtime-adapter surfaces, plus the degradation-receipt shape.
 *
 * Contract authority (SoT):
 *   .guild/spec/universal-host-p1.md §11 (runtime adapters + minimum-loss ladder)
 *   .guild/plan/universal-host-p1.md §Foundation-contract specifications C3
 *   docs/knowledge/decisions/universal-host-p1-l0-foundation-contracts.md (ADR-addendum)
 *
 * WHY (minimum-loss rule): each adapter surface degrades through an explicit chain
 * `native > wrapped > bridged > emulated > degraded` and records the chosen rung in a
 * receipt. Routing reads the table, never the host name. Claude/Codex rungs are
 * concrete; `.agents`/pi/antigravity rungs are INFERRED until live-host verification.
 *
 * CONTRACT: pure types + the frozen rung table + a pure `resolveRung()` + a receipt
 * factory + validators. No I/O, no clock, never throws. L11 (tooling-engineer) builds
 * the runtime adapters against this; Ltest asserts SC-8.
 *
 * Owned by plugin-architect (P1-L0).
 */

import { HostId, HOST_IDS } from "./host-registry-schema";

// ---------------------------------------------------------------------------
// Rungs + surfaces
// ---------------------------------------------------------------------------

/** The minimum-loss ladder, strongest → weakest. Lower index = less loss. */
export const RUNGS = ["native", "wrapped", "bridged", "emulated", "degraded"] as const;
export type Rung = (typeof RUNGS)[number];

/** The four adapter surfaces P1 fills. */
export const ADAPTER_SURFACES = ["interaction", "session", "semantic_tool", "browser"] as const;
export type AdapterSurface = (typeof ADAPTER_SURFACES)[number];

/** Loss rank for a rung (0 = native/no-loss … 4 = degraded/total-loss). */
export function rungLoss(r: Rung): number {
  return RUNGS.indexOf(r);
}

// ---------------------------------------------------------------------------
// The rung table (verbatim from the gated C3 contract)
//   .agents / pi / antigravity rungs are INFERRED (see INFERRED set below).
// ---------------------------------------------------------------------------

export const FALLBACK_LADDER_TABLE: Record<AdapterSurface, Record<HostId, Rung>> = {
  interaction: {
    claude: "native", // AskUserQuestion
    codex: "wrapped", // CLI prompt
    ".agents": "bridged", // file-bus ⓘ
    pi: "wrapped", // pi -p ⓘ
    antigravity: "wrapped", // ⓘ
  },
  session: {
    claude: "native", // session id/resume
    codex: "wrapped", // run-dir state
    ".agents": "emulated", // re-bootstrap ⓘ
    pi: "emulated", // ⓘ
    antigravity: "emulated", // ⓘ
  },
  semantic_tool: {
    claude: "native", // tool names
    codex: "bridged", // name map
    ".agents": "bridged", // name map ⓘ
    pi: "emulated", // shell equiv ⓘ
    antigravity: "bridged", // ⓘ
  },
  browser: {
    claude: "bridged", // chrome-devtools MCP
    codex: "bridged", // MCP
    ".agents": "degraded", // none ⓘ
    pi: "degraded", // ⓘ
    antigravity: "native", // agy browser ⓘ
  },
};

/**
 * The (surface, host) cells whose rung is INFERRED (not live-verified). L11 / live-host
 * verification confirm these. Every `.agents`/pi/antigravity cell is INFERRED; claude
 * and codex cells are concrete.
 */
export const INFERRED_HOSTS = new Set<HostId>([".agents", "pi", "antigravity"]);

export function isInferredRung(surface: AdapterSurface, host: HostId): boolean {
  return INFERRED_HOSTS.has(host);
}

// ---------------------------------------------------------------------------
// Resolution + degradation receipt
// ---------------------------------------------------------------------------

/** A degradation receipt — written whenever a surface resolves a rung for a host. */
export interface DegradationReceipt {
  schema_version: "guild.degradation_receipt.v1";
  surface: AdapterSurface;
  host: HostId | string;
  rung: Rung;
  /** True when the chosen rung is below `native` (i.e. some loss was recorded). */
  degraded: boolean;
  /** True when the rung is an INFERRED (off-box) value. */
  inferred: boolean;
  reason: string;
}

/**
 * Resolve the rung for a (surface, host) and produce a degradation receipt. An UNKNOWN
 * host degrades to `degraded` and records — never silently assumes a capability.
 * Deterministic; never throws.
 */
export function resolveRung(surface: AdapterSurface, host: HostId | string): DegradationReceipt {
  const known = (HOST_IDS as readonly string[]).includes(host);
  if (!known) {
    return {
      schema_version: "guild.degradation_receipt.v1",
      surface,
      host,
      rung: "degraded",
      degraded: true,
      inferred: false,
      reason: `unknown host "${host}" — no ladder entry; degraded + recorded (minimum-loss rule)`,
    };
  }
  const hid = host as HostId;
  const rung = FALLBACK_LADDER_TABLE[surface][hid];
  const inferred = isInferredRung(surface, hid);
  return {
    schema_version: "guild.degradation_receipt.v1",
    surface,
    host: hid,
    rung,
    degraded: rungLoss(rung) > 0,
    inferred,
    reason: `${surface}@${hid} resolves to "${rung}"${inferred ? " (INFERRED — verify at live-host availability)" : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const RUNG_SET = new Set<string>(RUNGS);
const SURFACE_SET = new Set<string>(ADAPTER_SURFACES);

/** Validate a degradation receipt. Never throws. */
export function validateDegradationReceipt(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["degradation receipt must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  if (o["schema_version"] !== "guild.degradation_receipt.v1") {
    errors.push(`schema_version must be "guild.degradation_receipt.v1"; got ${JSON.stringify(o["schema_version"])}`);
  }
  if (typeof o["surface"] !== "string" || !SURFACE_SET.has(o["surface"] as string)) {
    errors.push(`surface must be one of ${ADAPTER_SURFACES.join("|")}; got ${JSON.stringify(o["surface"])}`);
  }
  if (typeof o["host"] !== "string" || (o["host"] as string).trim() === "") {
    errors.push("host must be a non-empty string");
  }
  if (typeof o["rung"] !== "string" || !RUNG_SET.has(o["rung"] as string)) {
    errors.push(`rung must be one of ${RUNGS.join("|")}; got ${JSON.stringify(o["rung"])}`);
  }
  if (typeof o["degraded"] !== "boolean") errors.push("degraded must be a boolean");
  if (typeof o["inferred"] !== "boolean") errors.push("inferred must be a boolean");
  if (typeof o["reason"] !== "string" || (o["reason"] as string).trim() === "") {
    errors.push("reason must be a non-empty string");
  }
  return { valid: errors.length === 0, errors };
}

/** Validate the full ladder table: every surface × every host id present + a valid rung. */
export function validateLadderTableComplete(): ValidationResult {
  const errors: string[] = [];
  for (const surface of ADAPTER_SURFACES) {
    const row = FALLBACK_LADDER_TABLE[surface];
    if (!row) {
      errors.push(`missing surface row ${surface}`);
      continue;
    }
    for (const host of HOST_IDS) {
      const rung = row[host];
      if (!rung || !RUNG_SET.has(rung)) {
        errors.push(`ladder[${surface}][${host}] must be a valid rung; got ${JSON.stringify(rung)}`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
