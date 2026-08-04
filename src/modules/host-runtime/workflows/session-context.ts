/**
 * src/modules/host-runtime/workflows/session-context.ts
 *
 * guild.session_context.v1 — immutable, adapter-injected identity for exactly
 * one Guild run (frozen contract 2026-07-30, run
 * run-20260730-131020-dynamic-host-model-routing; normative text under that
 * run's contracts/ dir).
 *
 * Written once at run start, restored VERBATIM on resume, never mutated.
 * There is NO workspace-global mutable "current host".
 *
 * §3 unknown-safety: unset/malformed/unrecognized host input resolves
 * family "unknown" / trust "asserted" / confidence "low" — it never defaults
 * to claude (or any family). "unknown" is terminal: consumers branch on it
 * honestly (degrade independence, refuse strong claims), never repair it.
 *
 * §4 precedence ≠ trust: envelope/GUILD_HOST_ID wins resolution order but
 * stays `asserted` until a native-adapter/handshake mechanism verifies it.
 * A verification that CONTRADICTS the asserted value keeps the verified value
 * and records the rejected assertion in identity.evidence.
 */

import * as crypto from "crypto";
import * as fsReal from "fs";
import * as path from "path";

import { resolveAuthorHost, type HostFamily } from "./provider-detect";
import type { RunBindingRecord } from "../../lifecycle";

// ── Closed enums (§1) ────────────────────────────────────────────────────────

export type SessionHostFamily = HostFamily | "agents";

export type HostSurface =
  | "cli"
  | "app"
  | "web"
  | "api"
  | "connector"
  | "file"
  | "unknown";

export type IdentitySource =
  | "invocation_envelope"
  | "env_guild_host_id"
  | "native_adapter"
  | "host_handshake"
  | "none";

export type IdentityTrust = "asserted" | "verified";
export type IdentityConfidence = "high" | "medium" | "low";

export type TargetProviderKind =
  | "anthropic_api"
  | "anthropic_subscription"
  | "openai_api"
  | "chatgpt_subscription"
  | "gateway_bedrock"
  | "gateway_vertex"
  | "gateway_foundry"
  | "other_gateway"
  | "unknown";

export type AuthMode = "subscription" | "api_key" | "oauth" | "managed" | "unknown";

// ── Record shape (§1) ────────────────────────────────────────────────────────

export interface SessionHostBlock {
  family: SessionHostFamily;
  /** EXACTLY ONE closed-enum value; composites are schema-invalid (§2). */
  surface: HostSurface;
  adapter_id: string;
  adapter_version: string;
}

export interface SessionIdentityBlock {
  source: IdentitySource;
  trust: IdentityTrust;
  confidence: IdentityConfidence;
  /** Redacted, human-auditable basis — never secrets. */
  evidence: string;
}

export interface ExecutionTargetBlock {
  target_id: string;
  provider_kind: TargetProviderKind;
  auth_mode: AuthMode;
  /** Non-reversible digest (§6) — NEVER a raw account id/email/key. */
  account_fingerprint: string;
  /** Non-reversible digest — NEVER a raw URL with credentials. */
  endpoint_fingerprint: string;
  /** Digest of the observable org scope, or the literal "unknown" (§6). */
  org_fingerprint: string;
  tool_version: string;
}

export interface GuildSessionContextV1 {
  schema_version: "guild.session_context.v1";
  run_id: string;
  started_at: string;
  host: SessionHostBlock;
  identity: SessionIdentityBlock;
  execution_target: ExecutionTargetBlock;
  /** Only when the host exposes it; else null — never guessed (§1). */
  active_model: string | null;
  run_binding: {
    binding_ref: string;
    state: "open" | "closed";
  };
}

// ── Identity inputs (§4 precedence) ──────────────────────────────────────────

/**
 * Identity injected by the adapter that actually started the run
 * (precedence step 2 — trust `verified`).
 */
export interface NativeAdapterIdentity {
  family: SessionHostFamily;
  surface: HostSurface;
  adapter_id: string;
  adapter_version: string;
  /** Redacted basis, e.g. "host-set env CLAUDECODE=1 in the spawned process". */
  evidence: string;
}

/** Post-start probe the host answers authoritatively (step 3 — `verified`). */
export interface HostHandshakeIdentity {
  family: SessionHostFamily;
  surface?: HostSurface;
  evidence: string;
}

export interface BuildSessionContextInput {
  run_id: string;
  /** Caller-supplied RFC3339 timestamp — this module never reads a clock. */
  started_at: string;
  /** Explicit invocation-envelope host field (precedence step 1a). */
  envelope_host?: string;
  /** Env map for GUILD_HOST_ID (step 1b). Pass process.env at real call sites. */
  env?: Record<string, string | undefined>;
  /** Precedence step 2. */
  native_adapter?: NativeAdapterIdentity | null;
  /** Precedence step 3. */
  handshake?: HostHandshakeIdentity | null;
  /** Known execution-target facts; every omitted field records "unknown". */
  execution_target?: Partial<ExecutionTargetBlock>;
  /** Only when the host exposes it — never guessed. */
  active_model?: string | null;
  run_binding: { binding_ref: string; state: "open" | "closed" };
}

const UNKNOWN_TARGET: ExecutionTargetBlock = {
  target_id: "unknown",
  provider_kind: "unknown",
  auth_mode: "unknown",
  account_fingerprint: "unknown",
  endpoint_fingerprint: "unknown",
  org_fingerprint: "unknown",
  tool_version: "unknown",
};

/**
 * Build the immutable session context from adapter-injected inputs.
 * Pure and deterministic: no clock, no ambient env reads, no fs.
 */
export function buildSessionContext(input: BuildSessionContextInput): GuildSessionContextV1 {
  const asserted =
    input.envelope_host !== undefined && input.envelope_host !== ""
      ? { value: input.envelope_host, source: "invocation_envelope" as const }
      : input.env?.["GUILD_HOST_ID"]
        ? { value: input.env["GUILD_HOST_ID"] as string, source: "env_guild_host_id" as const }
        : null;

  const verified = input.native_adapter
    ? { id: input.native_adapter, source: "native_adapter" as const }
    : input.handshake
      ? { id: input.handshake, source: "host_handshake" as const }
      : null;

  let host: SessionHostBlock;
  let identity: SessionIdentityBlock;

  if (asserted) {
    // §3: the asserted string maps through the unknown-safe resolver — an
    // unrecognized value stays "unknown", never a repaired family.
    const assertedFamily: SessionHostFamily = resolveAuthorHost(asserted.value);
    if (verified && verified.id.family !== assertedFamily) {
      // §4 conflict rule: keep the verified value, record the rejected assertion.
      host = blockFromVerified(verified.id);
      identity = {
        source: verified.source,
        trust: "verified",
        confidence: "high",
        evidence:
          `${verified.id.evidence}; asserted host "${asserted.value}" ` +
          `(${asserted.source}) REJECTED: contradicted by ${verified.source} evidence`,
      };
    } else if (verified) {
      host = blockFromVerified(verified.id);
      identity = {
        source: verified.source,
        trust: "verified",
        confidence: "high",
        evidence: `${verified.id.evidence}; confirms asserted host "${asserted.value}" (${asserted.source})`,
      };
    } else {
      host = {
        family: assertedFamily,
        surface: "unknown",
        adapter_id: "unknown",
        adapter_version: "unknown",
      };
      identity = {
        source: asserted.source,
        trust: "asserted",
        confidence: assertedFamily === "unknown" ? "low" : "medium",
        evidence: `caller-asserted host "${asserted.value}" via ${asserted.source}; unverified`,
      };
    }
  } else if (verified) {
    host = blockFromVerified(verified.id);
    identity = {
      source: verified.source,
      trust: "verified",
      confidence: "high",
      evidence: verified.id.evidence,
    };
  } else {
    // §4 step 4 / §3: nothing present → terminal unknown, never a default.
    host = { family: "unknown", surface: "unknown", adapter_id: "unknown", adapter_version: "unknown" };
    identity = {
      source: "none",
      trust: "asserted",
      confidence: "low",
      evidence: "no identity source present (envelope, env, adapter, handshake all absent)",
    };
  }

  return {
    schema_version: "guild.session_context.v1",
    run_id: input.run_id,
    started_at: input.started_at,
    host,
    identity,
    execution_target: { ...UNKNOWN_TARGET, ...(input.execution_target ?? {}) },
    active_model: input.active_model ?? null,
    run_binding: { ...input.run_binding },
  };
}

function blockFromVerified(id: NativeAdapterIdentity | HostHandshakeIdentity): SessionHostBlock {
  const asAdapter = id as Partial<NativeAdapterIdentity>;
  return {
    family: id.family,
    surface: id.surface ?? "unknown",
    adapter_id: asAdapter.adapter_id ?? "unknown",
    adapter_version: asAdapter.adapter_version ?? "unknown",
  };
}

// ── Fingerprints (§6) ────────────────────────────────────────────────────────

/**
 * Non-reversible salted digest for account/endpoint/org identity. The salt is
 * machine-local and never shared; raw values never appear in any catalog,
 * cache, receipt, log, or diagnostic.
 */
export function makeFingerprint(raw: string, salt: string): string {
  return "fp-" + crypto.createHash("sha256").update(`${salt}\n${raw}`, "utf8").digest("hex");
}

/**
 * Machine-local fingerprint salt, persisted under the share-excluded catalog
 * index dir (.guild/indexes/model-catalog/ — module-map §3: runtime-local,
 * never committed/shared). Created on first use with crypto randomness.
 */
export function loadOrCreateFingerprintSalt(root: string): string {
  const p = path.join(root, ".guild", "indexes", "model-catalog", ".fp-salt");
  if (fsReal.existsSync(p)) return fsReal.readFileSync(p, "utf8").trim();
  const salt = crypto.randomBytes(32).toString("hex");
  fsReal.mkdirSync(path.dirname(p), { recursive: true });
  fsReal.writeFileSync(p, salt + "\n", { encoding: "utf8", mode: 0o600 });
  return salt;
}

// ── Persistence: write-once at start, verbatim restore on resume (§1, §5) ────

export interface SessionContextFs {
  mkdirp(absPath: string): void;
  writeFile(absPath: string, contents: string): void;
  readFile(absPath: string): string | null;
  exists(absPath: string): boolean;
}

function realFs(): SessionContextFs {
  return {
    mkdirp: (p) => fsReal.mkdirSync(p, { recursive: true }),
    writeFile: (p, c) => fsReal.writeFileSync(p, c, "utf8"),
    readFile: (p) => (fsReal.existsSync(p) ? fsReal.readFileSync(p, "utf8") : null),
    exists: (p) => fsReal.existsSync(p),
  };
}

export function sessionContextPath(root: string, runId: string): string {
  return path.join(root, ".guild", "runs", runId, "session-context.json");
}

/**
 * Write the run's session context exactly once. A second write with identical
 * content is a no-op (idempotent re-entry); ANY differing content throws —
 * the context is immutable and a run's record is never overwritten (resume
 * never re-detects into an existing run, §5).
 */
export function writeSessionContext(
  root: string,
  ctx: GuildSessionContextV1,
  fs?: SessionContextFs
): void {
  const f = fs ?? realFs();
  const p = sessionContextPath(root, ctx.run_id);
  const serialized = JSON.stringify(ctx, null, 2) + "\n";
  const existing = f.readFile(p);
  if (existing !== null) {
    if (existing === serialized) return;
    throw new Error(
      `session-context: refusing to overwrite the frozen record for ${ctx.run_id} ` +
        `— session_context is written once at run start and never mutated`
    );
  }
  f.mkdirp(path.dirname(p));
  f.writeFile(p, serialized);
}

/** Read the frozen record, or null when absent/invalid (non-throwing probe). */
export function loadSessionContext(
  root: string,
  runId: string,
  fs?: SessionContextFs
): GuildSessionContextV1 | null {
  const f = fs ?? realFs();
  const raw = f.readFile(sessionContextPath(root, runId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as GuildSessionContextV1;
    if (parsed.schema_version !== "guild.session_context.v1") return null;
    if (parsed.run_id !== runId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resume path: restore THAT run's frozen session context + target snapshot
 * verbatim. Throws when the record is missing or belongs to another run —
 * resume never re-detects and never substitutes a different run's context.
 */
export function restoreSessionContext(
  root: string,
  runId: string,
  fs?: SessionContextFs
): GuildSessionContextV1 {
  const ctx = loadSessionContext(root, runId, fs);
  if (ctx === null) {
    throw new Error(
      `session-context: no frozen record for ${runId} — resume restores the ` +
        `run's own snapshot; it never re-detects into an existing run`
    );
  }
  return ctx;
}

// ── Hook-facing note (T3b) ───────────────────────────────────────────────────
//
// Hooks CONSUME this record read-only via loadSessionContext(root, run_id)
// where run_id comes from the verified hook binding envelope (see
// lifecycle/workflows/run-binding.ts — HOOK_BINDING_ENV_* + verifyRunBinding).
// Hooks never build, write, or mutate a session context, and never resolve
// identity from a sentinel or a claude default: an absent/invalid record is
// handled as family "unknown" (honest degrade), not repaired.

export type { RunBindingRecord };
