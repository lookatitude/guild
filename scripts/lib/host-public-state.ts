/**
 * scripts/lib/host-public-state.ts
 *
 * verified-multi-host-support L5 (AC-RUN-2/3) — the TWO-FIELD honesty state model.
 * The ONE place the aspirational `target_state`, the evidence-derived
 * `current_public_state`, and the internal `verification_status` axis are defined,
 * plus the committed smoke-receipt schema (identity split from freshness, ADR §6.2)
 * and the host-support gate (ADR §5.3). PURE — no I/O, no clock, no spawn. The
 * committed-store read (fs) lives in `host-smoke-store.ts`; the write path in
 * `scripts/host-smoke.ts`; both consume this module. L7 (wave-4b) owns the
 * anti-vacuity gate TESTS; this module makes the gate correct + testable.
 *
 * Contract authority (SoT):
 *   .guild/wiki/decisions/verified-multi-host-support.md §5 (two-field model + gate),
 *   §6 (evidence store + identity/freshness receipt schema).
 *
 * PURITY: `computeSmokeDigest` uses node:crypto sha256 (deterministic, no clock/PID/
 * nonce); staleness parses caller-supplied date strings (never Date.now()). Fully
 * unit-testable.
 */

import { createHash } from "node:crypto";
import { HOST_REGISTRY_ROWS, type HostId } from "./host-registry-schema";

// ---------------------------------------------------------------------------
// The two enums — the public column and the internal axis
// ---------------------------------------------------------------------------

/**
 * The ONLY state docs/website surface. 4-bucket public taxonomy (ADR §5.1). There
 * is NO `native > wrapped > bridged` order — the verified_* values are PARALLEL
 * per-bucket categories. `PUBLIC_STATES` has NO `degraded`/`inferred`/`target`
 * member (R3 — planned degradation is never public).
 */
export const PUBLIC_STATES = [
  "native",
  "verified_wrapped",
  "verified_bridged",
  "unsupported",
] as const;
export type PublicState = (typeof PUBLIC_STATES)[number];

/** The three verified public categories (used by the gate). `unsupported` is honest, never verified. */
export const VERIFIED_PUBLIC_STATES = ["native", "verified_wrapped", "verified_bridged"] as const;
function isVerifiedPublic(state: PublicState): boolean {
  return (VERIFIED_PUBLIC_STATES as readonly string[]).includes(state);
}

/**
 * The internal diagnostic + fraud-check axis (ADR §5.1). NEVER surfaced publicly
 * (R3). TOTAL for all 16 hosts.
 *   - verified            — a valid committed verified receipt exists (the promotion source).
 *   - inferred            — a NON-target inferred row (installability != "target" yet columns inferred).
 *   - target              — a target-installable host lacking a receipt (checked BEFORE inferred).
 *   - no_receipt          — an in-cell `verified` claim with no evidence (flagged, never public).
 *   - degraded            — a per-cell degraded final state.
 *   - unavailable         — refuse cell / otherwise.
 *   - enqueue_only        — refuse cell.
 *   - manual_instruction  — refuse cell.
 */
export const VERIFICATION_STATUS = [
  "verified",
  "inferred",
  "target",
  "no_receipt",
  "degraded",
  "unavailable",
  "enqueue_only",
  "manual_instruction",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUS)[number];

// ---------------------------------------------------------------------------
// Bucket classification (drives both derivations)
// ---------------------------------------------------------------------------

/**
 * The five host buckets that drive derivation. Derived PURELY from the registry
 * row (surface_kind + host id), never from a name allow-list:
 *   - refuse         — app/connector surface (surface_kind "app").
 *   - keep-native-cli— claude-code-cli (the reference native host).
 *   - wrapped-cli    — every other CLI surface (codex/pi/antigravity + the 4 new-CLI).
 *   - bridged-file   — any file surface: agents-file AND the IDE rows (kiro/qoder/trae),
 *                      which share surface_kind "file".
 */
export type HostBucket = "refuse" | "keep-native-cli" | "wrapped-cli" | "bridged-file";

/** Minimal row shape the derivations read (a subset of HostSupportRow). */
export interface DerivableRow {
  host_id: HostId;
  surface_kind: "cli" | "app" | "file";
  installability: string;
  registry_provenance: string;
  /** The per-cell aggregate SupportState (verified|degraded|unavailable|enqueue_only|manual_instruction). */
  final_state: string;
}

export function bucketForRow(row: DerivableRow): HostBucket {
  if (row.surface_kind === "app") return "refuse";
  if (row.host_id === "claude-code-cli") return "keep-native-cli";
  if (row.surface_kind === "file") return "bridged-file";
  return "wrapped-cli";
}

/** The verified public state a bucket reaches WHEN a valid receipt promotes it. */
export function verifiedStateForBucket(bucket: HostBucket): PublicState {
  switch (bucket) {
    case "keep-native-cli":
      return "native";
    case "wrapped-cli":
      return "verified_wrapped";
    case "bridged-file":
      return "verified_bridged";
    case "refuse":
      return "unsupported";
  }
}

// ---------------------------------------------------------------------------
// Committed smoke-receipt schema — identity split from freshness (ADR §6.2)
// ---------------------------------------------------------------------------

export const SMOKE_RECEIPT_SCHEMA = "guild.host_smoke_receipt.v1";

/** One concern check inside a receipt. Part of the digested identity. */
export interface SmokeCheck {
  concern: string;
  state: string;
  evidence: string;
}

/**
 * The DETERMINISTIC identity block — the ONLY thing `smoke_digest` covers. NO
 * captured_at/guild_version/nonce/PID/hostname. A different `host_version` is a
 * different attestation (new identity → new digest).
 */
export interface SmokeReceiptIdentity {
  host_id: string;
  /** A STABLE operator label — never hostname/IP/user. */
  box_id: string;
  host_version: string;
  public_state_claimed: PublicState;
  verification_status_claimed: VerificationStatus;
  checks: SmokeCheck[];
}

/** The VOLATILE freshness block — NOT digested (ADR §6.2). */
export interface SmokeReceiptFreshness {
  /** DAY granularity, e.g. "2026-07-04". */
  captured_at: string;
  guild_version: string;
}

export interface HostSmokeReceipt {
  schema_version: typeof SMOKE_RECEIPT_SCHEMA;
  identity: SmokeReceiptIdentity;
  smoke_digest: string;
  freshness: SmokeReceiptFreshness;
}

/**
 * Canonicalize a value to a deterministic JSON string with recursively sorted
 * object keys. No clock/PID/nonce. Used for the digest and for byte-stable writes.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * sha256 over the canonicalized identity block ONLY (keys sorted; no volatile fields).
 *
 * The full 64-hex sha256 is grouped into 16-char runs joined by `-`. This is NOT
 * information loss — every hex char is preserved — it is a scan-clean FORMAT: a bare
 * 64-hex run trips the shared `redact()` high-entropy heuristic (`\b[0-9a-f]{40,}\b`),
 * and a content-integrity digest is not a secret, but we CONSUME the single-source
 * `redact` (ADR §6.4) and never fork it, so the committed receipt must be scan-clean.
 * Grouping caps every run at 16 hex (< 40) while keeping the digest deterministic +
 * verifiable (recompute yields the identical grouped string).
 */
export function computeSmokeDigest(identity: SmokeReceiptIdentity): string {
  const hex = createHash("sha256").update(canonicalize(identity)).digest("hex");
  return (hex.match(/.{1,16}/g) as string[]).join("-");
}

export interface ReceiptValidation {
  valid: boolean;
  errors: string[];
}

/** Structural + digest validation of a committed receipt. Never throws. */
export function validateSmokeReceipt(value: unknown): ReceiptValidation {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { valid: false, errors: ["smoke receipt must be a non-null object"] };
  }
  const o = value as Record<string, unknown>;
  if (o["schema_version"] !== SMOKE_RECEIPT_SCHEMA) {
    errors.push(`schema_version must be "${SMOKE_RECEIPT_SCHEMA}"; got ${JSON.stringify(o["schema_version"])}`);
  }
  const id = o["identity"];
  if (typeof id !== "object" || id === null || Array.isArray(id)) {
    errors.push("identity must be a present object");
  } else {
    const i = id as Record<string, unknown>;
    if (typeof i["host_id"] !== "string") errors.push("identity.host_id must be a string");
    if (typeof i["box_id"] !== "string" || (i["box_id"] as string).length === 0) {
      errors.push("identity.box_id must be a non-empty string");
    }
    if (typeof i["host_version"] !== "string") errors.push("identity.host_version must be a string");
    if (typeof i["public_state_claimed"] !== "string" || !(PUBLIC_STATES as readonly string[]).includes(i["public_state_claimed"] as string)) {
      errors.push(`identity.public_state_claimed must be a PublicState; got ${JSON.stringify(i["public_state_claimed"])}`);
    }
    if (typeof i["verification_status_claimed"] !== "string" || !(VERIFICATION_STATUS as readonly string[]).includes(i["verification_status_claimed"] as string)) {
      errors.push(`identity.verification_status_claimed must be a VerificationStatus; got ${JSON.stringify(i["verification_status_claimed"])}`);
    }
    if (!Array.isArray(i["checks"])) errors.push("identity.checks must be an array");
    else {
      i["checks"].forEach((c, idx) => {
        if (typeof c !== "object" || c === null) errors.push(`identity.checks[${idx}] must be an object`);
        else {
          const cc = c as Record<string, unknown>;
          if (typeof cc["concern"] !== "string") errors.push(`identity.checks[${idx}].concern must be a string`);
          if (typeof cc["state"] !== "string") errors.push(`identity.checks[${idx}].state must be a string`);
          if (typeof cc["evidence"] !== "string") errors.push(`identity.checks[${idx}].evidence must be a string`);
        }
      });
    }
  }
  const fr = o["freshness"];
  if (typeof fr !== "object" || fr === null || Array.isArray(fr)) {
    errors.push("freshness must be a present object");
  } else {
    const f = fr as Record<string, unknown>;
    if (typeof f["captured_at"] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f["captured_at"] as string)) {
      errors.push("freshness.captured_at must be a YYYY-MM-DD string");
    }
    if (typeof f["guild_version"] !== "string") errors.push("freshness.guild_version must be a string");
  }
  // Digest must recompute over the identity block ONLY.
  if (errors.length === 0) {
    const expected = computeSmokeDigest(id as unknown as SmokeReceiptIdentity);
    if (o["smoke_digest"] !== expected) {
      errors.push(`smoke_digest mismatch: identity recompute ${expected} !== stored ${JSON.stringify(o["smoke_digest"])}`);
    }
  } else if (typeof o["smoke_digest"] !== "string") {
    errors.push("smoke_digest must be a string");
  }
  return { valid: errors.length === 0, errors };
}

/** Days between two YYYY-MM-DD strings (b − a). Pure; parses caller-supplied strings. */
function dayDelta(aIso: string, bIso: string): number {
  const a = Date.parse(`${aIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${bIso.slice(0, 10)}T00:00:00Z`);
  return (b - a) / 86_400_000;
}

export const RECEIPT_MAX_AGE_DAYS = 180;

/** Receipt-age-ONLY staleness (ADR §6.3): stale iff (generatedAt − captured_at) > 180d. */
export function isReceiptStale(receipt: HostSmokeReceipt, generatedAt: string, maxAgeDays = RECEIPT_MAX_AGE_DAYS): boolean {
  return dayDelta(receipt.freshness.captured_at, generatedAt) > maxAgeDays;
}

/**
 * A `valid-verified-receipt` for (host, bucket): schema+digest valid AND
 * verification_status_claimed === "verified" AND the claimed public state is exactly
 * this bucket's verified value AND identity.host_id === host. A mis-bucketed receipt
 * (wrapped host claiming verified_bridged) is rejected here (ADR §5.3).
 */
export function isValidVerifiedReceipt(receipt: unknown, host: HostId, bucket: HostBucket): boolean {
  const v = validateSmokeReceipt(receipt);
  if (!v.valid) return false;
  const r = receipt as HostSmokeReceipt;
  if (r.identity.host_id !== host) return false;
  if (r.identity.verification_status_claimed !== "verified") return false;
  return r.identity.public_state_claimed === verifiedStateForBucket(bucket);
}

/** The outcome of selecting a host's committed receipts for the row. */
export interface ReceiptSelection {
  /** A valid-verified receipt was found (freshest non-stale preferred). */
  has_valid_receipt: boolean;
  /** The chosen receipt (freshest non-stale, else freshest stale), or null. */
  chosen: HostSmokeReceipt | null;
  /** The chosen receipt is past the age horizon (still counts as evidence). */
  stale: boolean;
  /** Two non-stale boxes attest DIFFERENT public states → the matrix FAILS (not a silent pick). */
  conflict: string | null;
}

/**
 * Select among a host's committed box receipts (ADR §6.3): keep only
 * valid-verified receipts; if two NON-STALE ones disagree on public_state_claimed →
 * conflict; otherwise prefer the freshest non-stale, falling back to a stale one
 * (annotated). PURE — receipts are passed in; the fs read is in host-smoke-store.ts.
 */
export function selectValidReceipt(
  host: HostId,
  bucket: HostBucket,
  receipts: HostSmokeReceipt[],
  generatedAt: string,
): ReceiptSelection {
  const valid = receipts.filter((r) => isValidVerifiedReceipt(r, host, bucket));
  if (valid.length === 0) {
    return { has_valid_receipt: false, chosen: null, stale: false, conflict: null };
  }
  const nonStale = valid.filter((r) => !isReceiptStale(r, generatedAt));
  const distinctNonStale = new Set(nonStale.map((r) => r.identity.public_state_claimed));
  if (distinctNonStale.size > 1) {
    return {
      has_valid_receipt: false,
      chosen: null,
      stale: false,
      conflict: `conflicting non-stale receipts for ${host}: ${[...distinctNonStale].sort().join(" vs ")}`,
    };
  }
  const pool = nonStale.length > 0 ? nonStale : valid;
  // Freshest by captured_at (lexicographic on YYYY-MM-DD == chronological).
  const chosen = [...pool].sort((a, b) => (a.freshness.captured_at < b.freshness.captured_at ? 1 : -1))[0];
  return { has_valid_receipt: true, chosen, stale: nonStale.length === 0, conflict: null };
}

// ---------------------------------------------------------------------------
// Derivations — both TOTAL functions (ADR §5.2)
// ---------------------------------------------------------------------------

/**
 * derive-verification-status (ADR §5.2, precedence top wins):
 *   refuse → the refuse cell status; valid receipt → verified (promotion source,
 *   independent of registry provenance); in-cell verified w/o receipt → no_receipt;
 *   installability "target" → target (BEFORE inferred); provenance "inferred" →
 *   inferred; final_state "degraded" → degraded; else unavailable.
 */
export function deriveVerificationStatus(
  row: DerivableRow,
  bucket: HostBucket,
  hasValidReceipt: boolean,
): VerificationStatus {
  if (bucket === "refuse") {
    // The refuse cell status IS the aggregate final_state (enqueue_only |
    // manual_instruction | unavailable) — taken from the app-host cell.
    if (row.final_state === "enqueue_only") return "enqueue_only";
    if (row.final_state === "manual_instruction") return "manual_instruction";
    return "unavailable";
  }
  if (hasValidReceipt) return "verified";
  if (row.final_state === "verified") return "no_receipt";
  if (row.installability === "target") return "target";
  if (row.registry_provenance === "inferred") return "inferred";
  if (row.final_state === "degraded") return "degraded";
  return "unavailable";
}

/**
 * derive-current-public-state (ADR §5.2): refuse → unsupported; verified status →
 * the bucket's verified value; else → unsupported (the public column NEVER shows
 * inferred/target/degraded — R3).
 */
export function deriveCurrentPublicState(
  host: HostId,
  bucket: HostBucket,
  verificationStatus: VerificationStatus,
): PublicState {
  if (bucket === "refuse") return "unsupported";
  if (verificationStatus === "verified") return verifiedStateForBucket(bucket);
  return "unsupported";
}

// ---------------------------------------------------------------------------
// The target-state manifest (`guild.host_expected_state.v1`, ADR §1.2)
// ---------------------------------------------------------------------------

export interface HostExpectedState {
  /** The ASPIRATIONAL public state (a GOAL, not a claim). */
  target_state: PublicState;
  /**
   * The highest public state ACTUALLY reached, committed ATOMICALLY with the first
   * valid verified receipt (`null` until then). Load-bearing for the regression +
   * floor-coupling checks (§5.3 (b)/(c)). CI never invents it.
   */
  achieved_floor: PublicState | null;
}

/**
 * The SoT AC-RUN-3 enforces. `target_state` per ADR §1.2; `achieved_floor` starts
 * `null` and is set in the SAME change as the first valid receipt.
 *
 * On THIS operator box (2026-07-04) the reference hosts committed valid receipts, so
 * their floors are set atomically here (L5b + L5): claude-code-cli (`claude` 2.1.201) →
 * `native` via the native plugin-load attestation (manifest + wired hooks/dist + skills +
 * commands); codex-cli (`codex` 0.142.2) → `verified_wrapped` via the wrapped-CLI smoke
 * (bin + version + stored-auth + wrapper dry-run); pi-cli (`pi` 0.79.3) and antigravity-cli
 * (`agy` 1.0.8) → `verified_wrapped`. github-copilot is NOT promoted: `gh` is present but
 * the `gh copilot` extension (the `gh_auth` probe's second half) is ABSENT on this box,
 * so an honest smoke cannot attest it → it stays a `target` (floor null). Every other host
 * lacks a reachable binary/editor here → honest `target`/`unsupported` (a PASS, ADR §5.3).
 */
export const HOST_EXPECTED_STATE: Record<HostId, HostExpectedState> = {
  "claude-code-cli": { target_state: "native", achieved_floor: "native" },
  "codex-cli": { target_state: "verified_wrapped", achieved_floor: "verified_wrapped" },
  "pi-cli": { target_state: "verified_wrapped", achieved_floor: "verified_wrapped" },
  "antigravity-cli": { target_state: "verified_wrapped", achieved_floor: "verified_wrapped" },
  "agents-file": { target_state: "verified_bridged", achieved_floor: null },
  "cursor": { target_state: "verified_wrapped", achieved_floor: null },
  "github-copilot": { target_state: "verified_wrapped", achieved_floor: null },
  "opencode": { target_state: "verified_wrapped", achieved_floor: null },
  "rovo-dev": { target_state: "verified_wrapped", achieved_floor: null },
  "kiro": { target_state: "verified_bridged", achieved_floor: null },
  "qoder": { target_state: "verified_bridged", achieved_floor: null },
  "trae": { target_state: "verified_bridged", achieved_floor: null },
  "claude-code-app": { target_state: "unsupported", achieved_floor: null },
  "claude-code-web": { target_state: "unsupported", achieved_floor: null },
  "codex-app": { target_state: "unsupported", achieved_floor: null },
  "claude-ai-connector": { target_state: "unsupported", achieved_floor: null },
};

// ---------------------------------------------------------------------------
// The AC-RUN-3 gate — enforces HONESTY, not universal verification (ADR §5.3)
// ---------------------------------------------------------------------------

/** The row fields the gate reads (a subset of HostSupportRow). */
export interface GateableRow {
  host_id: HostId;
  current_public_state: PublicState;
  verification_status: VerificationStatus;
  achieved_floor: PublicState | null;
  has_valid_receipt: boolean;
  receipt_conflict?: string | null;
}

export interface GateResult {
  valid: boolean;
  errors: string[];
}

/**
 * The two-field host-support gate (ADR §5.3). Fails ONLY on:
 *   (a) anti-fraud   — a verified_* current_public_state without a valid verified receipt.
 *   (b) regression   — current_public_state drops below a committed achieved_floor.
 *   (c) floor-couple — a verified_* current_public_state whose achieved_floor is
 *                      null or mismatched.
 *   (conflict)       — two non-stale boxes attest different states.
 * It does NOT fail an honest target host still `unsupported` pending operator-box
 * verification.
 *
 * The floor is read from each row's `achieved_floor` — the generator stamps it FROM
 * `HOST_EXPECTED_STATE[host]` (§5.2), so this is the committed manifest floor. Reading
 * the row keeps the gate a PURE function of its `rows` argument (L7 injects synthetic
 * rows without also mutating the module manifest) AND still catches the real
 * "operator committed a receipt but forgot to set the floor" case — that host's row
 * echoes the still-null manifest floor, so (c) fires.
 */
export function hostSupportGate(rows: GateableRow[]): GateResult {
  const errors: string[] = [];
  for (const row of rows) {
    const cps = row.current_public_state;
    const cpsVerified = isVerifiedPublic(cps);
    const floor = row.achieved_floor;

    // (conflict) — a divergent non-stale multi-box attestation never resolves silently.
    if (row.receipt_conflict) {
      errors.push(`${row.host_id}: receipt conflict — ${row.receipt_conflict}`);
    }

    // (a) anti-fraud.
    if (cpsVerified && !(row.has_valid_receipt && row.verification_status === "verified")) {
      errors.push(
        `${row.host_id}: (a) claims verified public state "${cps}" without a valid verified receipt ` +
          `(has_valid_receipt=${row.has_valid_receipt}, verification_status=${row.verification_status})`,
      );
    }

    // (b) regression below a committed floor.
    if (floor && isVerifiedPublic(floor) && cps !== floor) {
      errors.push(
        `${row.host_id}: (b) regression — current_public_state "${cps}" is below committed achieved_floor "${floor}"`,
      );
    }

    // (c) floor-coupling — a verified public state REQUIRES a matching committed floor.
    if (cpsVerified && floor !== cps) {
      errors.push(
        `${row.host_id}: (c) verified public state "${cps}" requires achieved_floor "${cps}"; got ${JSON.stringify(floor)}`,
      );
    }
  }
  return { valid: errors.length === 0, errors };
}

/** The 16 host ids the manifest + derivations are total over (echoes the registry). */
export const EXPECTED_HOSTS = Object.keys(HOST_REGISTRY_ROWS) as HostId[];
