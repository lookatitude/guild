/**
 * src/modules/host-runtime/workflows/host-adapter-boundary.ts
 *
 * `guild.host_adapter_boundary.v1` — the public, versioned MH-03 host-adapter
 * boundary.
 *
 * MH-03 / W1 of `multi-host-runtime-convergence`. Boundary: `host-adapters`.
 *
 * WHAT THIS FILE IS
 *   The one place a caller turns a host NAME into a bound, capability-snapshotted
 *   host runtime. It resolves the host identity, resolves the REAL entry point
 *   the registry declares for it (the binary, the subcommand, the instruction
 *   file, or the app surface), obtains the concrete adapter through the PUBLIC
 *   `HostAdapter` interface, verifies that the adapter it got back is actually
 *   the host's adapter, and hands back an immutable binding.
 *
 * WHY THE ADAPTER ARRIVES THROUGH A PROVIDER
 *   The concrete per-host adapters are runtime script surfaces; this module is a
 *   contract surface. Reaching down into them from here would invert the layering
 *   and drag pane, memory, and review surfaces into every consumer of the host
 *   registry. So the boundary takes a `HostAdapterProvider` — the real one is
 *   `scripts/lib/host-adapter-factory`'s `createHostAdapter` — and the binding is
 *   only as real as the provider passed in. That is not a loophole, because the
 *   boundary VERIFIES what it is handed: a value that does not implement the
 *   complete public interface is refused, a provider that returns another host's
 *   adapter is refused with `boundary_membership_mismatch`, and one that throws
 *   fails closed with `execution_failed`. An impostor cannot be bound.
 *
 *   The interface check is passive and total — see `inspectAdapterShape()`.
 *   `succeeded` is a promise that `binding.adapter` is usable, so it is made by
 *   inspecting every member rather than by trusting one identity string.
 *
 * WHAT THIS FILE DOES NOT OWN
 *   Lifecycle state, gate policy, artifact semantics, document rendering, and
 *   transport execution. `hostRuntimeBoundaryOwnership()` states that machine
 *   readably and names the real owner of each, and the MH-03 suite additionally
 *   scans these sources to prove no lifecycle transition is decided, no gate is
 *   evaluated, and no transport, document, or artifact surface is reached here.
 *
 * DETERMINISM
 *   No I/O, no clock, no process state. The only mutable state in the boundary
 *   is the per-run snapshot store, and its whole purpose is to make a run's
 *   capability truth singular (CI-03) rather than to vary.
 *
 * Pure library module; reached through the host-runtime module's public index.
 */

import { HOST_ADAPTER_OPERATIONS, type HostAdapter } from "./host-adapter-contract";
import { normalizeHostId } from "./host-id-namespace";
import {
  HOST_IDS,
  HOST_REGISTRY_ROWS,
  type AdapterBinding,
  type AuthProbe,
  type HostId,
} from "./host-registry-schema";
import {
  createHostCapabilitySnapshotStore,
  type HostAuthenticationObservation,
  type HostCapabilitySnapshot,
  type HostCapabilitySnapshotStore,
} from "./host-capability-snapshot";
import {
  hostEventSource,
  normalizeHostEvent,
  type HostEventNormalizationResult,
  type HostEventSourceKind,
} from "./host-event-normalizer";
import type { NeutralReasonCode } from "../../lifecycle";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const HOST_ADAPTER_BOUNDARY_SCHEMA = "guild.host_adapter_boundary.v1";

/**
 * The boundary MAJOR. It equals the host-adapter contract major the neutral core
 * recognizes; advancing one without the other is a deliberate, reviewable break
 * rather than a drift, and the MH-03 suite pins the two together.
 */
export const HOST_ADAPTER_BOUNDARY_MAJOR = 1;

/**
 * The adapter contract version, spelled in the exact form the core's conformance
 * evidence binds to (`guild.host_adapter.v<major>.<minor>.<patch>`).
 */
export const HOST_ADAPTER_CONTRACT_VERSION = "guild.host_adapter.v1.0.0";

export const HOST_ENTRY_POINT_SCHEMA = "guild.host_entry_point.v1";
export const HOST_RUNTIME_BINDING_SCHEMA = "guild.host_runtime_binding.v1";
export const HOST_RUNTIME_BINDING_RESULT_SCHEMA = "guild.host_runtime_binding_result.v1";
export const HOST_ADAPTER_OWNERSHIP_SCHEMA = "guild.host_adapter_ownership.v1";
export const HOST_CLAIM_RECONCILIATION_SCHEMA = "guild.host_claim_reconciliation.v1";

/**
 * Every reason code this boundary can emit. All of them are members of the
 * core's closed reason-code vocabulary — the adapter layer does not get its own
 * private dialect, because a receipt that mixes two vocabularies cannot be read
 * against one contract.
 */
export const HOST_ADAPTER_REASON_CODES: readonly NeutralReasonCode[] = Object.freeze([
  "boundary_membership_mismatch",
  "capability_absent",
  "capability_snapshot_mismatch",
  "execution_failed",
  "unknown_event",
]);

// ---------------------------------------------------------------------------
// Ownership fence
// ---------------------------------------------------------------------------

export const HOST_ADAPTER_OWNED_CONCERNS = [
  "host_identity_resolution",
  "host_entry_point_binding",
  "host_capability_snapshot",
  "host_native_event_normalization",
] as const;

export const HOST_ADAPTER_NOT_OWNED_CONCERNS = [
  "lifecycle_state",
  "gate_policy",
  "artifact_semantics",
  "document_rendering",
  "transport_execution",
] as const;

const CONCERN_OWNERS: Readonly<Record<string, string>> = Object.freeze({
  host_identity_resolution: "host-adapters",
  host_entry_point_binding: "host-adapters",
  host_capability_snapshot: "host-adapters",
  host_native_event_normalization: "host-adapters",
  lifecycle_state: "host-neutral-core",
  gate_policy: "host-neutral-core",
  artifact_semantics: "artifact-document-services",
  document_rendering: "artifact-document-services",
  transport_execution: "execution-transports",
});

export interface HostRuntimeBoundaryOwnership {
  readonly schema_version: typeof HOST_ADAPTER_OWNERSHIP_SCHEMA;
  readonly boundary_version: typeof HOST_ADAPTER_BOUNDARY_SCHEMA;
  readonly owned: readonly string[];
  readonly not_owned: readonly string[];
  readonly owners: Readonly<Record<string, string>>;
}

const OWNERSHIP: HostRuntimeBoundaryOwnership = Object.freeze({
  schema_version: HOST_ADAPTER_OWNERSHIP_SCHEMA,
  boundary_version: HOST_ADAPTER_BOUNDARY_SCHEMA,
  owned: Object.freeze([...HOST_ADAPTER_OWNED_CONCERNS]) as readonly string[],
  not_owned: Object.freeze([...HOST_ADAPTER_NOT_OWNED_CONCERNS]) as readonly string[],
  owners: CONCERN_OWNERS,
});

/** The machine-readable statement of what this boundary owns and what it does not. */
export function hostRuntimeBoundaryOwnership(): HostRuntimeBoundaryOwnership {
  return OWNERSHIP;
}

// ---------------------------------------------------------------------------
// Real host entry points
// ---------------------------------------------------------------------------

export type HostEntryPointKind = "cli_binary" | "cli_subcommand" | "instruction_file" | "app_surface";

/**
 * The REAL entry point Guild uses to reach a host, derived entirely from that
 * host's frozen registry detection row. No entry point is invented here: if the
 * registry says the binary is `gh` with subcommand `copilot`, that is what this
 * record says, and the MH-03 suite compares every field back to the row.
 */
export interface HostEntryPoint {
  readonly schema_version: typeof HOST_ENTRY_POINT_SCHEMA;
  readonly host_id: HostId;
  readonly kind: HostEntryPointKind;
  readonly surface_kind: "cli" | "app" | "file";
  readonly adapter_binding: AdapterBinding;
  readonly bin: string | null;
  readonly subcommand: string | null;
  readonly instruction_file: string | null;
  readonly requires_auth: boolean;
  readonly auth_probe: AuthProbe;
  readonly event_source: HostEventSourceKind;
  readonly dispatch_selectable: boolean;
}

/** The instruction file every file-surface host bootstraps from today. */
const DEFAULT_INSTRUCTION_FILE = "AGENTS.md";

function entryPointFor(hostId: HostId): HostEntryPoint {
  const row = HOST_REGISTRY_ROWS[hostId];
  const subcommand = row.detection.subcommand ?? null;
  const kind: HostEntryPointKind =
    row.surface_kind === "app"
      ? "app_surface"
      : row.surface_kind === "file" || row.adapter_binding === "agents-file"
        ? "instruction_file"
        : subcommand
          ? "cli_subcommand"
          : "cli_binary";
  return Object.freeze({
    schema_version: HOST_ENTRY_POINT_SCHEMA,
    host_id: hostId,
    kind,
    surface_kind: row.surface_kind,
    adapter_binding: row.adapter_binding,
    bin: row.detection.bin,
    subcommand,
    instruction_file:
      row.detection.marker?.agents_placement ?? (kind === "instruction_file" ? DEFAULT_INSTRUCTION_FILE : null),
    requires_auth: row.detection.requires_auth,
    auth_probe: row.detection.auth_probe,
    event_source: hostEventSource(hostId).kind,
    dispatch_selectable: row.dispatch_selectable,
  }) as HostEntryPoint;
}

/** One frozen entry point per registry host, keyed by canonical host id. */
export const HOST_ENTRY_POINTS: Readonly<Record<HostId, HostEntryPoint>> = Object.freeze(
  HOST_IDS.reduce(
    (accumulator, hostId) => {
      accumulator[hostId] = entryPointFor(hostId);
      return accumulator;
    },
    {} as Record<HostId, HostEntryPoint>
  )
);

/** Resolve a host name or legacy alias to its real entry point. Never throws. */
export function resolveHostEntryPoint(host: string): HostEntryPoint | null {
  const hostId = normalizeHostId(String(host ?? ""));
  return hostId ? HOST_ENTRY_POINTS[hostId] : null;
}

// ---------------------------------------------------------------------------
// Registry / core claim-vocabulary reconciliation
// ---------------------------------------------------------------------------

export interface HostClaimReconciliation {
  readonly schema_version: typeof HOST_CLAIM_RECONCILIATION_SCHEMA;
  readonly reconciled: boolean;
  readonly matched: readonly string[];
  /** Ids the core will accept in a conformance claim but the registry does not have. */
  readonly core_only: readonly string[];
  /** Registry ids the core's closed claim vocabulary will not accept. */
  readonly registry_only: readonly string[];
}

/**
 * Compare the adapter registry's host ids against the core's CLOSED conformance
 * claim vocabulary.
 *
 * The two lists are owned by different boundaries on purpose — discovery is an
 * adapter concern, and what a conformance claim may NAME is a core concern — so
 * they can legitimately differ. What they must never do is differ SILENTLY: an
 * id the registry can produce but a claim cannot name is a host that can be
 * driven and never certified. This function makes that difference a value a test
 * can pin, rather than something a reader has to notice.
 */
export function reconcileHostRegistryWithCoreClaimVocabulary(
  recognizedHostIds: readonly string[]
): HostClaimReconciliation {
  const registry = new Set<string>(HOST_IDS);
  const core = new Set<string>(recognizedHostIds);
  // Iterate the source ARRAYS rather than spreading the sets: this repository
  // ships no tsconfig, so a collection spread compiles only above the default
  // target. The sets are kept for O(1) membership, which is all they are for.
  const recognized = recognizedHostIds.filter((id, index) => recognizedHostIds.indexOf(id) === index);
  const matched = recognized.filter((id) => registry.has(id)).sort();
  const coreOnly = recognized.filter((id) => !registry.has(id)).sort();
  const registryOnly = (HOST_IDS as readonly string[]).filter((id) => !core.has(id)).sort();
  return Object.freeze({
    schema_version: HOST_CLAIM_RECONCILIATION_SCHEMA,
    reconciled: coreOnly.length === 0 && registryOnly.length === 0,
    matched: Object.freeze(matched) as readonly string[],
    core_only: Object.freeze(coreOnly) as readonly string[],
    registry_only: Object.freeze(registryOnly) as readonly string[],
  }) as HostClaimReconciliation;
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/**
 * How a caller supplies the concrete adapter. The real one is the host-adapter
 * factory; a test may supply another, and the boundary checks either the same
 * way.
 */
export type HostAdapterProvider = (host: string) => HostAdapter;

export interface HostRuntimeBindingRequest {
  readonly host: string;
  readonly runId: string;
  readonly provider: HostAdapterProvider;
  readonly hostVersion?: string;
  readonly authentication?: HostAuthenticationObservation;
  /** Supply a store to scope the one-snapshot-per-run rule; defaults to a boundary-local store. */
  readonly snapshots?: HostCapabilitySnapshotStore;
}

export interface HostRuntimeBinding {
  readonly schema_version: typeof HOST_RUNTIME_BINDING_SCHEMA;
  readonly boundary_version: typeof HOST_ADAPTER_BOUNDARY_SCHEMA;
  readonly adapter_contract_version: typeof HOST_ADAPTER_CONTRACT_VERSION;
  /** The REQUESTED host's canonical id, even when its adapter is a shared one. */
  readonly host_id: HostId;
  readonly run_id: string;
  readonly entry_point: HostEntryPoint;
  /** The concrete adapter, reached only through the public interface. */
  readonly adapter: HostAdapter;
  readonly snapshot: HostCapabilitySnapshot;
  readonly event_source: HostEventSourceKind;
  normalizeEvent(nativeEvent: string): HostEventNormalizationResult;
}

export type HostRuntimeBindingDisposition = "succeeded" | "unsupported" | "refused" | "failed";

export interface HostRuntimeBindingResult {
  readonly schema_version: typeof HOST_RUNTIME_BINDING_RESULT_SCHEMA;
  readonly disposition: HostRuntimeBindingDisposition;
  readonly reason_code: NeutralReasonCode | null;
  readonly host: string;
  readonly binding: HostRuntimeBinding | null;
  readonly assertions: readonly string[];
  readonly facts: Readonly<Record<string, unknown>>;
}

const BOUNDARY_STORE = createHostCapabilitySnapshotStore();

function bindingFailure(
  host: string,
  disposition: Exclude<HostRuntimeBindingDisposition, "succeeded">,
  reasonCode: NeutralReasonCode,
  assertions: readonly string[],
  facts: Readonly<Record<string, unknown>>
): HostRuntimeBindingResult {
  return Object.freeze({
    schema_version: HOST_RUNTIME_BINDING_RESULT_SCHEMA,
    disposition,
    reason_code: reasonCode,
    host,
    binding: null,
    assertions: Object.freeze([...assertions]) as readonly string[],
    facts: Object.freeze({ ...facts }),
  }) as HostRuntimeBindingResult;
}

/**
 * The host id whose adapter is legitimately expected back for a request.
 *
 * For a row whose `adapter_binding` is `agents-file`, the registry itself says
 * the host DEREFERENCES the universal instruction-file adapter, so receiving
 * that adapter is correct rather than an impostor. Every other row must get its
 * own adapter back.
 */
function expectedAdapterHostId(hostId: HostId): HostId {
  return HOST_REGISTRY_ROWS[hostId].adapter_binding === "agents-file" ? "agents-file" : hostId;
}

// ---------------------------------------------------------------------------
// Provider shape validation
// ---------------------------------------------------------------------------

/**
 * Read one OWN data property without running anything the provider controls.
 *
 * Descriptors are the whole trick. `candidate[key]` would INVOKE a getter, which
 * is both an effect this boundary promises not to cause and a place a malformed
 * provider can throw from. Reading the property SLOT instead means an accessor
 * is rejected rather than called, a member synthesized by a proxy `get` trap is
 * simply not there (the proxy owns nothing), and a trap that detonates is caught
 * rather than propagated. Absent and unreadable are deliberately the same
 * answer: both mean "this member cannot be relied on".
 */
function ownDataProperty(candidate: object, key: string): { present: boolean; value: unknown } {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
    if (descriptor === undefined) return { present: false, value: undefined };
    if (typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      return { present: false, value: undefined };
    }
    return { present: true, value: descriptor.value };
  } catch {
    return { present: false, value: undefined };
  }
}

interface AdapterShape {
  readonly valid: boolean;
  /** Interface members that are absent, unreadable, or the wrong kind. */
  readonly invalidMembers: readonly string[];
  /** The adapter's self-declared id, only when it is genuinely a string. */
  readonly hostId: string | null;
}

const SHAPE_NOT_AN_OBJECT = "<not an adapter object>";
const SHAPE_UNINSPECTABLE = "<adapter shape could not be inspected>";

/**
 * Verify that a provider's return value implements the COMPLETE public
 * `HostAdapter` interface, before it can be bound.
 *
 * This exists because a `succeeded` binding is a PROMISE to the caller that
 * `binding.adapter` is usable. Checking only `hostId` made that promise on the
 * strength of one string, so a plain `{ host, hostId }` object bound cleanly and
 * the missing interface surfaced later as `adapter.capabilities is not a
 * function` — the same failure, moved to a place with no boundary context and no
 * reason code.
 *
 * Every member is required to be an OWN, callable data property. Own, because a
 * method reached through a prototype chain or a `get` trap is not something this
 * object durably has. Data, because an accessor cannot be inspected without
 * running provider code. The operation list is the contract's own, so widening
 * the interface widens this check automatically. Nothing here calls an adapter
 * method: shape is proven by looking, never by trying.
 *
 * Total by construction — every path returns a verdict, and none throws.
 */
function inspectAdapterShape(candidate: unknown): AdapterShape {
  try {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { valid: false, invalidMembers: Object.freeze([SHAPE_NOT_AN_OBJECT]) as readonly string[], hostId: null };
    }

    const invalid: string[] = [];

    const host = ownDataProperty(candidate, "host");
    if (!host.present || typeof host.value !== "string" || host.value.length === 0) invalid.push("host");

    // `hostId` is declared `HostId | null`; null is a legitimate value that the
    // identity check below then refuses. An object that merely STRINGIFIES to a
    // host id is not, because coercion is how an impostor borrows a name.
    const declaredId = ownDataProperty(candidate, "hostId");
    const hostIdWellFormed = declaredId.present && (typeof declaredId.value === "string" || declaredId.value === null);
    if (!hostIdWellFormed) invalid.push("hostId");

    for (const operation of HOST_ADAPTER_OPERATIONS) {
      const member = ownDataProperty(candidate, operation);
      if (!member.present || typeof member.value !== "function") invalid.push(operation);
    }

    return {
      valid: invalid.length === 0,
      invalidMembers: Object.freeze([...invalid]) as readonly string[],
      hostId: typeof declaredId.value === "string" ? declaredId.value : null,
    };
  } catch {
    // A revoked proxy can make even `typeof`/`Array.isArray` throw. Unreadable
    // is refused, never trusted.
    return { valid: false, invalidMembers: Object.freeze([SHAPE_UNINSPECTABLE]) as readonly string[], hostId: null };
  }
}

/**
 * Bind a host to its real entry point and its immutable per-run capability
 * snapshot, through the public adapter interface.
 *
 * Four typed answers and no fifth. `succeeded` carries a binding and no reason
 * code; every other answer carries a reason code and no binding, so a caller can
 * never read a partial binding as a working one. Never throws.
 */
export function bindHostRuntimeAdapter(request: HostRuntimeBindingRequest): HostRuntimeBindingResult {
  const host = String(request.host ?? "");
  const hostId = normalizeHostId(host);
  if (hostId === null || HOST_REGISTRY_ROWS[hostId] === undefined) {
    return bindingFailure(
      host,
      "unsupported",
      "capability_absent",
      [
        "the host is not a member of the adapter registry",
        "no entry point is bound and no capability is assumed",
        "no fallback is implied and no side effect occurs",
      ],
      { requested_host: host, host_id: null }
    );
  }

  const store = request.snapshots ?? BOUNDARY_STORE;
  const captured = store.capture({
    host: hostId,
    runId: request.runId,
    hostVersion: request.hostVersion,
    authentication: request.authentication,
  });
  if (captured.disposition !== "succeeded" || captured.snapshot === null) {
    return bindingFailure(
      host,
      captured.disposition === "refused" ? "refused" : "unsupported",
      captured.reason_code ?? "capability_absent",
      [
        "a binding requires the run's one capability snapshot",
        "no adapter is reached when the snapshot cannot be established",
      ],
      { requested_host: host, host_id: hostId, snapshot_disposition: captured.disposition }
    );
  }

  let adapter: HostAdapter;
  try {
    adapter = request.provider(host);
  } catch (error) {
    return bindingFailure(
      host,
      "failed",
      "execution_failed",
      [
        "the adapter provider raised rather than returning an adapter",
        "the failure is reported as failed, never as unsupported",
        "no partial binding is returned",
      ],
      {
        requested_host: host,
        host_id: hostId,
        provider_error: error instanceof Error ? error.message : String(error),
      }
    );
  }

  // Shape BEFORE identity: an identity read on an unvalidated value is itself a
  // property access the provider can throw from, and a value that is not an
  // adapter cannot be an identity match either.
  const shape = inspectAdapterShape(adapter);
  if (!shape.valid) {
    return bindingFailure(
      host,
      "refused",
      "boundary_membership_mismatch",
      [
        "the provider returned a value that does not implement the public HostAdapter interface",
        "the interface was proven by inspection only: no adapter operation ran and no accessor was read",
        "no partial binding is returned and no side effect occurs",
      ],
      {
        requested_host: host,
        host_id: hostId,
        adapter_shape_valid: false,
        invalid_adapter_members: shape.invalidMembers,
      }
    );
  }

  const boundHostId = shape.hostId === null ? null : normalizeHostId(shape.hostId);
  const expected = expectedAdapterHostId(hostId);
  if (boundHostId === null || boundHostId !== expected) {
    return bindingFailure(
      host,
      "refused",
      "boundary_membership_mismatch",
      [
        "the adapter returned by the provider is not this host's adapter",
        "an adapter is bound only when its own identity matches the declared binding",
        "no side effect occurs",
      ],
      {
        requested_host: host,
        expected_host_id: expected,
        bound_host_id: boundHostId,
      }
    );
  }

  const entryPoint = HOST_ENTRY_POINTS[hostId];
  const binding = Object.freeze({
    schema_version: HOST_RUNTIME_BINDING_SCHEMA,
    boundary_version: HOST_ADAPTER_BOUNDARY_SCHEMA,
    adapter_contract_version: HOST_ADAPTER_CONTRACT_VERSION,
    host_id: hostId,
    run_id: request.runId,
    entry_point: entryPoint,
    adapter,
    snapshot: captured.snapshot,
    event_source: entryPoint.event_source,
    normalizeEvent(nativeEvent: string): HostEventNormalizationResult {
      return normalizeHostEvent(hostId, nativeEvent);
    },
  }) as HostRuntimeBinding;

  return Object.freeze({
    schema_version: HOST_RUNTIME_BINDING_RESULT_SCHEMA,
    disposition: "succeeded",
    reason_code: null,
    host,
    binding,
    assertions: Object.freeze([
      "the bound adapter implements every member of the public HostAdapter interface",
      "the bound adapter's own identity matches the requested host's declared binding",
      "the binding carries exactly one immutable capability snapshot for this run",
      "the entry point is the registry's declared host surface, not an inferred one",
    ]) as readonly string[],
    facts: Object.freeze({
      requested_host: host,
      host_id: hostId,
      bound_host_id: expected,
      adapter_shape_valid: true,
      entry_point_kind: entryPoint.kind,
      capability_snapshot_hash: captured.snapshot.snapshot_hash,
    }),
  }) as HostRuntimeBindingResult;
}
