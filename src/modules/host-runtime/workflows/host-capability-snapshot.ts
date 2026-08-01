/**
 * src/modules/host-runtime/workflows/host-capability-snapshot.ts
 *
 * `guild.host_capability_snapshot.v1` — the ADAPTER-side producer of the one
 * immutable capability snapshot a run is bound to.
 *
 * MH-03 / W1 of `multi-host-runtime-convergence`. Boundary: `host-adapters`.
 *
 * WHAT THIS FILE IS
 *   The single place a host's capability FACTS are read off the registry and
 *   frozen into the record shape the host-neutral core consumes. The core owns
 *   what a fact MEANS (`unsupported` vs `failed` vs `refused`); this file owns
 *   only producing the fact, which is the split the MH-01A capability taxonomy
 *   requires and the MH-02 core states in its own words: a capability fact is
 *   "PRODUCED by a host adapter (MH-03) ... only ever CONSUMED here".
 *
 * WHAT THIS FILE IS NOT
 *   It decides no lifecycle transition, evaluates no gate, renders no document,
 *   and executes no transport. It performs NO I/O and reads no clock: every fact
 *   comes from the frozen registry row plus explicitly supplied observations, so
 *   two captures of the same inputs are byte-identical by construction.
 *
 * THREE RULES, each of which a control in the MH-03 suite fails without
 *
 *   1. ONE SNAPSHOT PER HOST/RUN (CI-03). A store mints at most one snapshot per
 *      `(run_id, host_id)`. A repeat capture with the same inputs returns the
 *      IDENTICAL frozen object; a capture with DIFFERENT inputs is refused with
 *      `capability_snapshot_mismatch` rather than minting a second truth.
 *   2. NO OPTIMISTIC DEFAULT. Every id in the closed vocabulary gets an explicit
 *      fact in every snapshot. A capability is never absent-and-assumed-present,
 *      and an unknown host mints NO snapshot at all — it reports every id
 *      unsupported and returns `null`.
 *   3. AUTHENTICATION FAILS CLOSED (BR-07). A host whose registry row REQUIRES
 *      auth is `authenticated: false` until an observation says otherwise. A host
 *      whose row requires no auth has nothing to authenticate, so it is
 *      authenticated by the same declared fact — never by optimism.
 *
 * NAME DISAMBIGUATION (gap-audit C8). Three near-identical schema names exist and
 * are routinely confused for each other — an external audit read this one as a
 * typo for the others. They are three DIFFERENT artifacts:
 *
 *   guild.host_capabilities.v1         static design-time capability MATRIX row,
 *                                      authored per host; `host-capabilities-schema.ts`.
 *   guild.host_capability.v1           the per-host runtime MANIFEST probed onto disk
 *                                      at `.guild/hosts/<host-id>/capability.json`;
 *                                      `host-capability-manifest.ts`.
 *   guild.host_capability_snapshot.v1  THIS FILE — the per-(run_id, host_id) IMMUTABLE
 *                                      snapshot a single run is bound to, frozen from
 *                                      the registry row plus supplied observations.
 *
 * Matrix = what a host is declared to do. Manifest = what this installation found.
 * Snapshot = what THIS RUN is bound to and cannot change under it. Do not "correct"
 * one name to another; all three are live contract identifiers.
 *
 * Pure library module; there is no CLI entrypoint. Reached through the
 * host-runtime module's public index.
 */

import { createHash } from "node:crypto";

import { normalizeHostId } from "./host-id-namespace";
import { HOST_REGISTRY_ROWS, type HostId, type HostRegistryEntry } from "./host-registry-schema";
// TYPE-ONLY. The adapter boundary binds to the core's vocabulary at COMPILE time
// and holds no runtime edge to it, so the one-way dependency direction the MH-01A
// boundary contract declares (adapters -> core) cannot become a load-time cycle.
import type { NeutralReasonCode } from "../../lifecycle";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const HOST_CAPABILITY_SNAPSHOT_SCHEMA = "guild.host_capability_snapshot.v1";
export const HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA = "guild.host_capability_snapshot_result.v1";

// ---------------------------------------------------------------------------
// The closed capability vocabulary
// ---------------------------------------------------------------------------

/**
 * Every capability id an MH-03 adapter can produce a fact for, sorted so the
 * snapshot's fact order is canonical and a diff between two hosts is readable.
 *
 * The list is CLOSED on purpose: a snapshot that could omit an id would let a
 * consumer read "absent" as "fine", which is the exact confusion BR-07 forbids.
 * Every id maps to a pure reader over the frozen registry row below.
 */
export const HOST_CAPABILITY_IDS = Object.freeze([
  "host.artifacts.direct_filesystem",
  "host.artifacts.file_bus",
  "host.bootstrap.context_injection",
  "host.bootstrap.skill_autoload",
  "host.bootstrap.wrapper_injection",
  "host.commands.command_files",
  "host.commands.slash_commands",
  "host.dispatch.selectable",
  "host.hooks.post_tool_use",
  "host.hooks.pre_compact",
  "host.hooks.pre_tool_use",
  "host.hooks.session_start",
  "host.hooks.stop",
  "host.hooks.subagent_stop",
  "host.hooks.task_completed",
  "host.hooks.task_created",
  "host.hooks.teammate_idle",
  "host.hooks.user_prompt_submit",
  "host.interaction.native_questions",
  "host.mcp.http",
  "host.mcp.stdio",
  "host.models.tier_map",
  "host.package.install",
  "host.package.render",
  "host.package.update",
  "host.permissions.ask",
  "host.permissions.deny",
  "host.result_adapter",
  "host.sessions.resume_by_id",
  "host.structured_output.native_json",
] as const);

export type HostCapabilityId = (typeof HOST_CAPABILITY_IDS)[number];

/**
 * The readers. Each is a pure function of the frozen registry row, so a fact is
 * always traceable to a declared column rather than to adapter opinion.
 */
const CAPABILITY_READERS: Readonly<Record<HostCapabilityId, (entry: HostRegistryEntry) => boolean>> = {
  "host.artifacts.direct_filesystem": (entry) => entry.capabilities.artifacts.direct_filesystem,
  "host.artifacts.file_bus": (entry) => entry.capabilities.artifacts.file_bus,
  "host.bootstrap.context_injection": (entry) => {
    const injection = entry.capabilities.bootstrap.context_injection;
    return typeof injection === "string" && injection.length > 0 && injection !== "none";
  },
  "host.bootstrap.skill_autoload": (entry) => entry.capabilities.bootstrap.skill_autoload,
  "host.bootstrap.wrapper_injection": (entry) => entry.capabilities.bootstrap.wrapper_injection,
  "host.commands.command_files": (entry) => entry.capabilities.commands.command_files !== "none",
  "host.commands.slash_commands": (entry) => entry.capabilities.commands.slash_commands,
  "host.dispatch.selectable": (entry) => entry.dispatch_selectable,
  "host.hooks.post_tool_use": (entry) => entry.capabilities.hooks.post_tool_use,
  "host.hooks.pre_compact": (entry) => entry.capabilities.hooks.pre_compact,
  "host.hooks.pre_tool_use": (entry) => entry.capabilities.hooks.pre_tool_use,
  "host.hooks.session_start": (entry) => entry.capabilities.hooks.session_start,
  "host.hooks.stop": (entry) => entry.capabilities.hooks.stop,
  "host.hooks.subagent_stop": (entry) => entry.capabilities.hooks.subagent_stop,
  "host.hooks.task_completed": (entry) => entry.capabilities.hooks.task_completed,
  "host.hooks.task_created": (entry) => entry.capabilities.hooks.task_created,
  "host.hooks.teammate_idle": (entry) => entry.capabilities.hooks.teammate_idle,
  "host.hooks.user_prompt_submit": (entry) => entry.capabilities.hooks.user_prompt_submit,
  "host.interaction.native_questions": (entry) => entry.capabilities.interaction.native_questions,
  "host.mcp.http": (entry) => entry.capabilities.mcp.http,
  "host.mcp.stdio": (entry) => entry.capabilities.mcp.stdio,
  "host.models.tier_map": (entry) => {
    const models = entry.capabilities.models;
    return Boolean(models.cheap.model || models.mid.model || models.powerful.model);
  },
  // `installability` is the REGISTRY column, and it is the one that decides
  // whether an install is proven. A renderer that exists but was never installed
  // is `target`, which is render-capable and install-INCAPABLE — collapsing the
  // two is precisely the optimistic default this snapshot exists to prevent.
  "host.package.install": (entry) =>
    entry.installability === "native" && entry.capabilities.package.installable,
  "host.package.render": (entry) => entry.installability !== "none",
  "host.package.update": (entry) => entry.capabilities.package.update.apply !== "none",
  "host.permissions.ask": (entry) => entry.capabilities.permissions.ask,
  "host.permissions.deny": (entry) => entry.capabilities.permissions.deny,
  "host.result_adapter": (entry) => entry.result_adapter,
  "host.sessions.resume_by_id": (entry) => entry.capabilities.sessions.resume_by_id,
  "host.structured_output.native_json": (entry) => entry.capabilities.structured_output.native_json,
};

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * One capability fact. Structurally the core's `NeutralCapabilityFact`: the
 * adapter produces exactly the record the core consumes, with no translation
 * step that could drift.
 */
export interface HostCapabilityFact {
  readonly capability_id: string;
  readonly supported: boolean;
  readonly authenticated: boolean;
}

/**
 * Structurally the core's `NeutralCapabilitySnapshot`. These five keys and no
 * others: an extra adapter-private key would survive into the core's frozen
 * record and become part of a decision nobody declared.
 */
export interface HostCapabilitySnapshot {
  readonly schema_version: typeof HOST_CAPABILITY_SNAPSHOT_SCHEMA;
  readonly snapshot_hash: string;
  readonly host_id: string;
  readonly host_version: string;
  readonly capabilities: readonly HostCapabilityFact[];
}

/**
 * What the adapter actually OBSERVED about host authentication. `not_observed`
 * is the default and is never a soft `authenticated` (BR-07). Observing is the
 * caller's job precisely because observing requires I/O, which this file does
 * not do — that is what keeps the snapshot deterministic.
 */
export type HostAuthenticationObservation = "authenticated" | "unauthenticated" | "not_observed";

export interface HostCapabilitySnapshotRequest {
  readonly host: string;
  readonly runId: string;
  readonly hostVersion?: string;
  readonly authentication?: HostAuthenticationObservation;
}

export type HostCapabilitySnapshotDisposition = "succeeded" | "unsupported" | "refused";

export interface HostCapabilitySnapshotResult {
  readonly schema_version: typeof HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA;
  readonly disposition: HostCapabilitySnapshotDisposition;
  /** Exactly one core reason code for every non-succeeded disposition; null otherwise. */
  readonly reason_code: NeutralReasonCode | null;
  readonly host: string;
  readonly host_id: HostId | null;
  readonly run_id: string;
  readonly snapshot: HostCapabilitySnapshot | null;
  /** Always populated, including on success: the ids this host cannot do. */
  readonly unsupported_capability_ids: readonly string[];
  readonly assertions: readonly string[];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

const UNKNOWN_HOST_VERSION = "unknown";

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Canonical JSON: sorted keys, dropped `undefined`, significant array order. */
function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const kind = typeof value;
  if (kind === "number") return Number.isFinite(value as number) ? JSON.stringify(value) : "null";
  if (kind === "boolean" || kind === "string") return JSON.stringify(value);
  if (kind === "undefined" || kind === "function" || kind === "symbol") return "null";
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * The snapshot hash. Deliberately EXCLUDES `run_id`: two runs observing the same
 * host under the same facts must produce the same hash, or cross-run and
 * cross-host equivalence comparison would be defeated by run identity alone.
 */
function snapshotHash(hostId: HostId, hostVersion: string, facts: readonly HostCapabilityFact[]): string {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        schema_version: HOST_CAPABILITY_SNAPSHOT_SCHEMA,
        host_id: hostId,
        host_version: hostVersion,
        capabilities: facts.map((fact) => ({
          capability_id: fact.capability_id,
          supported: fact.supported,
          authenticated: fact.authenticated,
        })),
      })
    )
    .digest("hex");
  return `sha256:${digest}`;
}

/**
 * Whether a SUPPORTED capability is usable right now.
 *
 * A row that declares `requires_auth: false` has no credential to present, so
 * the declared registry fact settles it. A row that DOES require auth stays
 * false until an observation says otherwise — an unobserved credential is not a
 * working one.
 */
function authenticatedFor(
  entry: HostRegistryEntry,
  supported: boolean,
  observation: HostAuthenticationObservation
): boolean {
  if (!supported) return false;
  if (observation === "unauthenticated") return false;
  if (!entry.detection.requires_auth) return true;
  return observation === "authenticated";
}

function buildFacts(
  entry: HostRegistryEntry,
  observation: HostAuthenticationObservation
): readonly HostCapabilityFact[] {
  return HOST_CAPABILITY_IDS.map((capabilityId) => {
    const supported = CAPABILITY_READERS[capabilityId](entry);
    return {
      capability_id: capabilityId,
      supported,
      authenticated: authenticatedFor(entry, supported, observation),
    };
  });
}

function unsupportedResult(request: HostCapabilitySnapshotRequest): HostCapabilitySnapshotResult {
  return deepFreeze({
    schema_version: HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA,
    disposition: "unsupported",
    reason_code: "capability_absent",
    host: request.host,
    host_id: null,
    run_id: request.runId,
    snapshot: null,
    unsupported_capability_ids: [...HOST_CAPABILITY_IDS],
    assertions: [
      "an unrecognized host has no capability truth to snapshot",
      "no snapshot is minted and no capability is assumed present",
      "no fallback is implied and no side effect occurs",
    ],
  }) as HostCapabilitySnapshotResult;
}

// ---------------------------------------------------------------------------
// The per-run store (CI-03: exactly one snapshot per host/run)
// ---------------------------------------------------------------------------

export interface HostCapabilitySnapshotStore {
  capture(request: HostCapabilitySnapshotRequest): HostCapabilitySnapshotResult;
  /** Drop every snapshot bound to a run. A closed run's identity is not reusable state. */
  release(runId: string): void;
  size(): number;
}

interface StoredSnapshot {
  readonly result: HostCapabilitySnapshotResult;
  readonly inputHash: string;
}

/**
 * Create an isolated snapshot store. Callers that need determinism across
 * independent runs (tests, a long-lived daemon, a fan-out over hosts) should own
 * a store rather than share the process-wide default below.
 */
export function createHostCapabilitySnapshotStore(): HostCapabilitySnapshotStore {
  const minted = new Map<string, StoredSnapshot>();

  function keyFor(runId: string, hostId: HostId): string {
    return `${runId}\u0000${hostId}`;
  }

  return {
    capture(request: HostCapabilitySnapshotRequest): HostCapabilitySnapshotResult {
      const hostId = normalizeHostId(String(request.host ?? ""));
      const entry = hostId ? HOST_REGISTRY_ROWS[hostId] : undefined;
      if (!hostId || !entry) return unsupportedResult(request);

      const hostVersion = request.hostVersion ?? UNKNOWN_HOST_VERSION;
      const observation = request.authentication ?? "not_observed";
      const inputHash = canonicalJson({ host_id: hostId, host_version: hostVersion, authentication: observation });
      const key = keyFor(request.runId, hostId);

      const existing = minted.get(key);
      if (existing !== undefined) {
        if (existing.inputHash === inputHash) return existing.result;
        // CI-03: a run is bound to ONE snapshot for its whole life. A second,
        // different capability truth for the same run is a drift the caller must
        // resolve — never a silent re-mint, which would make an outcome
        // attributable to a snapshot nobody evaluated.
        return deepFreeze({
          schema_version: HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA,
          disposition: "refused",
          reason_code: "capability_snapshot_mismatch",
          host: request.host,
          host_id: hostId,
          run_id: request.runId,
          snapshot: null,
          unsupported_capability_ids: [],
          assertions: [
            "exactly one capability snapshot binds a run",
            "the bound snapshot is returned unchanged and is not replaced",
            "no second snapshot is minted and no side effect occurs",
          ],
        }) as HostCapabilitySnapshotResult;
      }

      const facts = buildFacts(entry, observation);
      const snapshot = deepFreeze({
        schema_version: HOST_CAPABILITY_SNAPSHOT_SCHEMA,
        snapshot_hash: snapshotHash(hostId, hostVersion, facts),
        host_id: hostId,
        host_version: hostVersion,
        capabilities: facts,
      }) as HostCapabilitySnapshot;

      const result = deepFreeze({
        schema_version: HOST_CAPABILITY_SNAPSHOT_RESULT_SCHEMA,
        disposition: "succeeded",
        reason_code: null,
        host: request.host,
        host_id: hostId,
        run_id: request.runId,
        snapshot,
        unsupported_capability_ids: facts.filter((fact) => !fact.supported).map((fact) => fact.capability_id),
        assertions: [
          "every declared capability id carries an explicit fact",
          "an unsupported capability is reported, never defaulted to supported",
          "the snapshot is immutable and bound to exactly one host and run",
        ],
      }) as HostCapabilitySnapshotResult;

      minted.set(key, { result, inputHash });
      return result;
    },

    release(runId: string): void {
      const prefix = `${runId}\u0000`;
      // Collect first, then delete: `forEach` avoids a collection spread, which
      // this repository's default TypeScript target (it ships no tsconfig)
      // rejects, and deleting during iteration is best avoided regardless.
      const doomed: string[] = [];
      minted.forEach((_stored, key) => {
        if (key.startsWith(prefix)) doomed.push(key);
      });
      doomed.forEach((key) => minted.delete(key));
    },

    size(): number {
      return minted.size;
    },
  };
}

/**
 * The process-wide default store. Provided because a run's snapshot must be the
 * SAME snapshot across every adapter call in that run, and most callers do not
 * thread a store. Anything needing isolation should create its own.
 */
const DEFAULT_STORE = createHostCapabilitySnapshotStore();

export function captureHostCapabilitySnapshot(
  request: HostCapabilitySnapshotRequest
): HostCapabilitySnapshotResult {
  return DEFAULT_STORE.capture(request);
}

export function releaseHostCapabilitySnapshots(runId: string): void {
  DEFAULT_STORE.release(runId);
}
