/**
 * src/modules/dispatch/workflows/execution-transport-ports.ts
 *
 * MH-04 — `guild.execution.transports.v1`: the PUBLIC, VERSIONED execution port
 * contract for the `execution-transports` boundary.
 *
 * Contract (BY POINTER): the multi-host runtime boundary contract
 * (`multi-host-runtime-convergence.runtime-boundary`, MH-01A) —
 *   boundary `execution-transports` owns "PaneAdapter mechanics", "local process
 *   and generic CLI execution", "tmux execution", "remote execution", "wrapper and
 *   launcher invocation", "cancellation, timeout enforcement, process collection,
 *   and session recovery mechanics", and "transport-level facts and errors";
 *   it EXCLUDES "host capability truth", "lifecycle transition decisions", "policy
 *   decisions", "receipt interpretation", "support-state promotion", and "review or
 *   verification verdicts".
 *
 * The two rules this file exists to make unfakeable:
 *
 *   BR-04 — a transport MUST NOT decide lifecycle state, support claims, policy,
 *     review independence, gate outcomes, or receipt semantics. Concretely: no
 *     construction in this file can produce a `refused` disposition or a policy
 *     reason code. A transport reports what the substrate DID; the neutral core
 *     decides what that MEANS.
 *
 *   BR-07 — an absent observation is never success. Every operation on every
 *     transport returns exactly one member of a CLOSED outcome vocabulary —
 *     succeeded · failed · cancelled · timed_out · unsupported — so "the call
 *     returned nothing" is not a reachable state.
 *
 * Layering: this module imports ONLY the public lifecycle index
 * (`guild.runtime.contracts.v1`, MH-02) for the neutral outcome envelope. It
 * imports no host adapter, no tmux/ssh/pane implementation, and no launcher.
 * The concrete substrates are reached through the STRUCTURAL seam types at the
 * bottom of this file (`PaneAdapterLike`, `TeamBackendLike`, `RemoteTransportLike`),
 * which the shipped classes satisfy structurally — that is what lets MH-04 wrap
 * the shipped transports in bounded adapters instead of duplicating host branches.
 */

import {
  neutralOutcome,
  type NeutralDisposition,
  type NeutralOutcome,
  type NeutralOutcomeBinding,
  type NeutralReasonCode,
} from "../../lifecycle";

// ── Identity ─────────────────────────────────────────────────────────────────

export const EXECUTION_TRANSPORT_SCHEMA_VERSION = "guild.execution.transports.v1";

/**
 * Contract MAJOR. A port pinned to a different major is REFUSED by the runtime
 * registry rather than silently downgraded (the transport-side half of the
 * "pinned consumer rejects an incompatible major" rule).
 */
export const EXECUTION_TRANSPORT_CONTRACT_VERSION = 1;

export function isExecutionContractCompatible(major: unknown): boolean {
  return (
    typeof major === "number" &&
    Number.isInteger(major) &&
    major === EXECUTION_TRANSPORT_CONTRACT_VERSION
  );
}

// ── Closed vocabularies ──────────────────────────────────────────────────────

/**
 * The closed operation set. `spawn`/`send`/`wait`/`interrupt`/`close` are the
 * lane lifecycle mechanics; `connect`/`probe` are the remote ones. EVERY port
 * answers ALL SEVEN — a port that cannot perform one answers `unsupported`, which
 * is an explicit typed outcome, never a missing method or a thrown error.
 */
export const EXECUTION_OPERATIONS = [
  "spawn",
  "send",
  "wait",
  "interrupt",
  "close",
  "connect",
  "probe",
] as const;
export type ExecutionOperation = (typeof EXECUTION_OPERATIONS)[number];

/** The closed outcome set: success, failure, cancellation, timeout, unsupported. */
export const EXECUTION_OUTCOME_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "unsupported",
] as const;
export type ExecutionOutcomeStatus = (typeof EXECUTION_OUTCOME_STATUSES)[number];

/**
 * Transport-level reason codes. Every non-succeeded outcome carries exactly one,
 * so a caller can always tell "this substrate cannot do that" (`operation_unsupported`)
 * from "the substrate is not installed" (`transport_unavailable`) from "it was tried
 * and failed" (`*_failed`) from "the caller stopped it" (`cancelled_by_caller`) from
 * "the deadline passed" (`deadline_exceeded`).
 *
 * There is deliberately NO policy code here. Policy denial belongs to the neutral
 * core (BR-04); a transport that could emit one would be deciding gate policy.
 */
export const EXECUTION_REASON_CODES = [
  "operation_unsupported",
  "transport_unavailable",
  "capability_absent",
  "authentication_failed",
  "invalid_request",
  "contract_version_unsupported",
  "spawn_failed",
  "send_failed",
  "wait_failed",
  "interrupt_failed",
  "close_failed",
  "remote_unreachable",
  "cancelled_by_caller",
  "deadline_exceeded",
] as const;
export type ExecutionReasonCode = (typeof EXECUTION_REASON_CODES)[number];

/**
 * The substrates this boundary implements, plus `runtime` for facade-level
 * outcomes (transport resolution and substrate selection) that belong to no single
 * substrate. `pane` covers BOTH the bespoke PaneAdapters and the generic
 * wrapped-CLI adapter — one bounded adapter, not one branch per host.
 */
export const EXECUTION_TRANSPORT_IDS = [
  "pane",
  "in-process",
  "serial",
  "tmux",
  "remote",
  "runtime",
] as const;
export type ExecutionTransportId = (typeof EXECUTION_TRANSPORT_IDS)[number];

function includes(list: readonly string[], value: unknown): boolean {
  return typeof value === "string" && list.indexOf(value) !== -1;
}

export function isExecutionOperation(value: unknown): value is ExecutionOperation {
  return includes(EXECUTION_OPERATIONS, value);
}

export function isExecutionOutcomeStatus(value: unknown): value is ExecutionOutcomeStatus {
  return includes(EXECUTION_OUTCOME_STATUSES, value);
}

export function isExecutionReasonCode(value: unknown): value is ExecutionReasonCode {
  return includes(EXECUTION_REASON_CODES, value);
}

export function isExecutionTransportId(value: unknown): value is ExecutionTransportId {
  return includes(EXECUTION_TRANSPORT_IDS, value);
}

// ── Normalization into the public neutral contract (BR-04) ───────────────────

/**
 * Status → neutral disposition.
 *
 * `cancelled` and `timed_out` both normalize to `failed`, NOT to `refused`:
 * `refused` is the neutral core's word for a policy or gate denial, and a
 * transport may never claim one. The exact transport status is never lost — it is
 * carried verbatim on `facts.transport_status` of both the transport outcome and
 * the neutral envelope, so the core can distinguish "the operator stopped it" from
 * "the deadline passed" from "it broke" without a transport ever telling the core
 * what that means for the lifecycle.
 */
export const EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION: Readonly<
  Record<ExecutionOutcomeStatus, NeutralDisposition>
> = Object.freeze({
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "failed",
  timed_out: "failed",
  unsupported: "unsupported",
} as Record<ExecutionOutcomeStatus, NeutralDisposition>);

/**
 * Transport reason → neutral reason. `authentication_failed` maps through
 * faithfully rather than collapsing into `capability_absent`: an auth failure is
 * NOT an absent capability, and reporting it as unsupported would license a silent
 * fallback the contract forbids.
 */
export const EXECUTION_REASON_TO_NEUTRAL_REASON: Readonly<
  Record<ExecutionReasonCode, NeutralReasonCode>
> = Object.freeze({
  operation_unsupported: "capability_absent",
  transport_unavailable: "execution_failed",
  capability_absent: "capability_absent",
  authentication_failed: "authentication_failed",
  invalid_request: "execution_failed",
  contract_version_unsupported: "capability_absent",
  spawn_failed: "execution_failed",
  send_failed: "execution_failed",
  wait_failed: "execution_failed",
  interrupt_failed: "execution_failed",
  close_failed: "execution_failed",
  remote_unreachable: "execution_failed",
  cancelled_by_caller: "execution_failed",
  deadline_exceeded: "execution_failed",
} as Record<ExecutionReasonCode, NeutralReasonCode>);

// ── Host-error normalization ─────────────────────────────────────────────────

/** Published bound on any transport-authored detail string. */
export const EXECUTION_DETAIL_MAX_LENGTH = 240;

const REDACTIONS: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[redacted]",
  },
  // NAME=value / NAME: value where NAME looks like a credential holder.
  {
    pattern: /(\b[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]*\s*[=:]\s*)(\S+)/gi,
    replacement: "$1[redacted]",
  },
  { pattern: /(\bBearer\s+)(\S+)/gi, replacement: "$1[redacted]" },
  // scheme://user:secret@host
  { pattern: /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi, replacement: "$1[redacted]$3" },
];

/**
 * Strip credential-shaped substrings out of a transport detail before it reaches
 * the evidence trail. Bounded and mechanical — it removes what it recognizes and
 * never claims the result is exhaustively sanitized.
 */
export function redactExecutionDetail(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** The normalized, host-agnostic form of a thrown or returned substrate error. */
export interface ExecutionTransportError {
  readonly reason_code: ExecutionReasonCode;
  readonly message: string;
  readonly truncated: boolean;
}

function describeUnknown(err: unknown): string {
  if (err === null || err === undefined) return "unknown transport error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name || "unknown transport error";
  if (typeof err === "object") {
    try {
      const json = JSON.stringify(err);
      if (typeof json === "string" && json.length > 0) return json;
    } catch {
      /* fall through to the primitive description */
    }
    return "non-serializable transport error";
  }
  return String(err);
}

/**
 * Normalize ANY substrate failure into the closed transport-error record.
 *
 * This is the seal on "host-specific errors never leak into neutral policy": the
 * result carries exactly three fields, so a Node `errno`/`syscall`/`code`, a stack
 * trace, an ssh diagnostic object, or a tmux error class cannot ride into the
 * neutral envelope. The message is redacted and bounded.
 */
export function normalizeExecutionError(
  err: unknown,
  reason_code: ExecutionReasonCode
): ExecutionTransportError {
  if (!isExecutionReasonCode(reason_code)) {
    throw new Error(
      `normalizeExecutionError: unknown reason code ${JSON.stringify(reason_code)}`
    );
  }
  const redacted = redactExecutionDetail(describeUnknown(err));
  const truncated = redacted.length > EXECUTION_DETAIL_MAX_LENGTH;
  const message = truncated
    ? `${redacted.slice(0, EXECUTION_DETAIL_MAX_LENGTH - 1)}…`
    : redacted;
  return Object.freeze({ reason_code, message, truncated });
}

// ── The typed outcome ────────────────────────────────────────────────────────

export type ExecutionFactValue = string | number | boolean | null;

export interface ExecutionOutcome<T = undefined> {
  readonly schema_version: typeof EXECUTION_TRANSPORT_SCHEMA_VERSION;
  readonly contract_version: number;
  readonly operation: ExecutionOperation;
  readonly transport_id: ExecutionTransportId;
  readonly status: ExecutionOutcomeStatus;
  /** Exactly one for every non-succeeded status; null otherwise. */
  readonly reason_code: ExecutionReasonCode | null;
  /** Redacted, bounded, host-agnostic. Never a host error object. */
  readonly detail: string | null;
  readonly value: T | null;
  readonly facts: Readonly<Record<string, ExecutionFactValue>>;
  /** The public MH-02 envelope this transport fact normalizes into. */
  readonly outcome: NeutralOutcome;
}

export interface ExecutionOutcomeInput<T> {
  readonly operation: ExecutionOperation;
  readonly transport_id: ExecutionTransportId;
  readonly status: ExecutionOutcomeStatus;
  readonly reason_code?: ExecutionReasonCode | null;
  readonly detail?: string | null;
  readonly value?: T | null;
  readonly facts?: Readonly<Record<string, ExecutionFactValue>>;
  readonly assertions?: readonly string[];
  readonly binding?: NeutralOutcomeBinding;
}

/**
 * Freeze the outcome record itself. `facts` is frozen separately, and `outcome`
 * arrives already deep-frozen from the neutral core; `value` is deliberately NOT
 * frozen, because it may be a live handle or a transport port the caller uses.
 */
function freezeOutcomeRecord<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  return value;
}

/**
 * The ONLY way this boundary produces a result. It refuses to build a record that
 * would be ambiguous: a `succeeded` outcome may not carry a reason code, and no
 * other status may omit one. Unknown operations, transports, statuses, and reason
 * codes are rejected rather than passed through, so the vocabulary stays closed at
 * runtime and not merely in the type system.
 */
export function executionOutcome<T = undefined>(
  input: ExecutionOutcomeInput<T>
): ExecutionOutcome<T> {
  if (!isExecutionOperation(input.operation)) {
    throw new Error(`executionOutcome: unknown operation ${JSON.stringify(input.operation)}`);
  }
  if (!isExecutionTransportId(input.transport_id)) {
    throw new Error(
      `executionOutcome: unknown transport id ${JSON.stringify(input.transport_id)}`
    );
  }
  if (!isExecutionOutcomeStatus(input.status)) {
    throw new Error(`executionOutcome: unknown status ${JSON.stringify(input.status)}`);
  }

  const reason = input.reason_code === undefined ? null : input.reason_code;
  if (input.status === "succeeded") {
    if (reason !== null) {
      throw new Error(
        `executionOutcome: status "succeeded" must not carry a reason_code (got ${JSON.stringify(reason)})`
      );
    }
  } else {
    if (reason === null) {
      throw new Error(
        `executionOutcome: status ${JSON.stringify(input.status)} requires a reason_code`
      );
    }
    if (!isExecutionReasonCode(reason)) {
      throw new Error(`executionOutcome: unknown reason code ${JSON.stringify(reason)}`);
    }
  }

  const detail = input.detail === undefined || input.detail === null ? null : redactExecutionDetail(input.detail);
  const facts: Record<string, ExecutionFactValue> = {
    ...(input.facts ?? {}),
    transport_id: input.transport_id,
    transport_operation: input.operation,
    transport_status: input.status,
    execution_reason_code: reason,
  };

  const neutral = neutralOutcome({
    // A transport operation is a CAPABILITY-level fact about a substrate, never a
    // lifecycle or policy verdict — hence `guild.capability_outcome.v1`.
    type: "guild.capability_outcome.v1",
    disposition: EXECUTION_STATUS_TO_NEUTRAL_DISPOSITION[input.status],
    reason_code: reason === null ? null : EXECUTION_REASON_TO_NEUTRAL_REASON[reason],
    assertions: input.assertions ?? [],
    binding: input.binding,
    facts,
  });

  return freezeOutcomeRecord({
    schema_version: EXECUTION_TRANSPORT_SCHEMA_VERSION,
    contract_version: EXECUTION_TRANSPORT_CONTRACT_VERSION,
    operation: input.operation,
    transport_id: input.transport_id,
    status: input.status,
    reason_code: reason,
    detail,
    value: input.value === undefined ? null : input.value,
    facts: Object.freeze(facts),
    outcome: neutral,
  }) as ExecutionOutcome<T>;
}

/** The canonical "this substrate cannot do that" result (MHRC-UNS-001). */
export function unsupportedExecutionOutcome<T = undefined>(
  transport_id: ExecutionTransportId,
  operation: ExecutionOperation,
  detail: string
): ExecutionOutcome<T> {
  return executionOutcome<T>({
    operation,
    transport_id,
    status: "unsupported",
    reason_code: "operation_unsupported",
    detail,
    assertions: [
      "the requested operation is absent on this substrate",
      "no fallback is implied",
      "no side effect occurred",
    ],
  });
}

/** Build a `failed` outcome from a thrown substrate error without leaking it. */
export function failedExecutionOutcome<T = undefined>(
  transport_id: ExecutionTransportId,
  operation: ExecutionOperation,
  err: unknown,
  reason_code: ExecutionReasonCode,
  facts: Readonly<Record<string, ExecutionFactValue>> = {}
): ExecutionOutcome<T> {
  const normalized = normalizeExecutionError(err, reason_code);
  return executionOutcome<T>({
    operation,
    transport_id,
    status: "failed",
    reason_code: normalized.reason_code,
    detail: normalized.message,
    facts: { ...facts, detail_truncated: normalized.truncated },
  });
}

// ── Handles + requests ───────────────────────────────────────────────────────

/** A rendered invocation: the command line and env a substrate would execute. */
export interface ExecutionInvocation {
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
}

export interface ExecutionHandle {
  readonly transport_id: ExecutionTransportId;
  readonly handle_id: string;
  readonly host_id: string | null;
  readonly host_kind: string | null;
  readonly invocation: ExecutionInvocation | null;
}

/**
 * A pinned definition bundle riding with a spawn (`guild.project_definition_ref.v1`,
 * cap-loc-D05). Structural, not an import: this module stays free of contract
 * imports, and the shipped ref satisfies this shape.
 *
 * CARRIED, NOT INTERPRETED. The transport moves these bytes and binds their hash
 * into the receipt; it never reads the definition's meaning. Profession semantics
 * belong to the capability service (BR-04: a transport that interpreted them would
 * be deciding policy).
 */
export interface DefinitionRefLike {
  readonly schema_version: string;
  readonly project_id: string;
  /**
   * The owning layer. Added when `guild.project_definition_ref.v1` gained it, and
   * the reason this line has a comment is that it was MISSED for a whole amendment.
   *
   * This shape is a deliberate STRUCTURAL duplicate of the contract (see above: the
   * module stays free of contract imports), which means a type check can never link
   * the two — the contract's own type graph does not reach here. So the amendment
   * shipped, every construction site inside the contract was updated, and this stayed
   * layerless with its suite green.
   *
   * The duplication is kept because the boundary rule is right; the DRIFT is what was
   * wrong. `definition-ref-conformance.test.ts` now imports both shapes and fails the
   * build if the contract grows a field this does not have, or if `refsConflict`
   * stops comparing one. A future field cannot repeat this silently.
   */
  readonly layer: string;
  readonly kind: string;
  readonly id: string;
  readonly relative_path: string;
  readonly content_hash: string;
  readonly source_commit: string | null;
  readonly skills: readonly {
    readonly id: string;
    readonly relative_path: string;
    readonly content_hash: string;
  }[];
}

/** The pane fields the transports read. Structurally satisfied by `PaneSpec`. */
export interface PaneSpecLike {
  readonly name: string;
  readonly scope: string;
  readonly runId: string;
  readonly slug: string;
  readonly prompt: string;
  readonly hostKind: string;
  readonly taskId?: string;
  readonly capability_scope?: readonly string[];
  readonly specialist?: string;
  /**
   * ADDITIVE (cap-loc-D11 / D9): the pinned definition bundle, carried as a FIELD.
   *
   * Before this, the pane path had `prompt` and nothing else — so a project-local
   * definition rode as PROMPT TEXT: unhashed, unverifiable, and invisible to the
   * transport. The plan's cross-backend conformance row ("definition survives
   * in-process / team / tmux / serial / remote") therefore failed BY CONSTRUCTION
   * on tmux and remote. This field is that fix.
   *
   * Optional, exactly like `capability_scope` and `specialist` above — the same
   * additive shape already precedented under contract major 1.
   */
  readonly definition_ref?: DefinitionRefLike;
}

export interface ExecutionSpawnRequest {
  readonly handle_id: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly host_id?: string;
  readonly host_kind?: string;
  /** Present for the PaneAdapter / wrapper / remote seams. */
  readonly pane?: PaneSpecLike;
  /** Present for the in-process and serial seams: the team launch request. */
  readonly payload?: unknown;
  /**
   * ADDITIVE (cap-loc-D11): the pinned definition + skill bundle for this lane.
   *
   * WHY THIS IS A FIELD AND NOT AN OPERATION. `EXECUTION_OPERATIONS` is a closed
   * seven-name set and `isExecutionContractCompatible` is EXACT equality, so an
   * eighth operation would be a major bump — a flag-day fork across six transport
   * ids, both dual-homed trees, the registry, the adapters, and 16 host rows.
   * Injection is also not a lifecycle mechanic: the seven describe how you start,
   * feed, await, stop, and reach a lane; this describes what a lane is started
   * WITH. Modelling it as an operation would be a category error that permanently
   * widens a vocabulary the contract went to trouble to close.
   *
   * SAFETY IS NEGOTIATED, NOT VERSIONED. An optional field a port could ignore
   * would silently omit the definition — the one outcome the plan forbids
   * ("unsupported hosts explicitly defer/refuse — never silently omit the
   * method"). So a port must DECLARE support via
   * `ExecutionTransportPort.supports_definition_injection`, and the runtime
   * REFUSES rather than strips when it has not. See `resolveInjectionSupport`.
   */
  readonly definition_ref?: DefinitionRefLike;
}

export interface ExecutionWaitOptions {
  readonly timeout_ms: number;
  /** Bound on liveness polls, so a wait can never spin unbounded. */
  readonly poll_limit?: number;
}

export interface RemoteExecutionTargetLike {
  readonly hostId: string;
  readonly hostKind: string;
  readonly endpoint: string;
  readonly loginShell?: string;
}

export interface RemoteProbeFacts {
  readonly present: readonly string[];
  readonly missing: readonly string[];
}

/**
 * The result of checking an untrusted remote probe response against the contract.
 *
 * Deliberately ONE record rather than a discriminated union: this file is
 * compiled by consumers under both strict and non-strict TypeScript, and
 * discriminated-union narrowing silently stops working without `strictNullChecks`.
 * A fail-closed validator whose result stops narrowing is a validator that stops
 * validating, so the shape is checkable either way.
 */
export interface RemoteProbeValidation {
  readonly ok: boolean;
  /** The validated, copied, frozen facts — null whenever `ok` is false. */
  readonly value: RemoteProbeFacts | null;
  /** Why the response was rejected — null when `ok` is true. */
  readonly detail: string | null;
}

interface RemoteProbeFieldRead {
  /** The copied strings — null whenever the field failed validation. */
  readonly value: string[] | null;
  readonly detail: string | null;
}

/**
 * Read one probe array out of an UNTRUSTED remote response.
 *
 * Every access is guarded because the source is host-authored data, not a
 * validated record: a partial response omits the field, a hostile one answers
 * with a throwing getter or an array-shaped Proxy whose element reads explode.
 * The elements are COPIED, so a source that changes what it returns between
 * reads cannot alter the value the boundary already published.
 */
function readRemoteProbeField(
  source: unknown,
  key: "present" | "missing"
): RemoteProbeFieldRead {
  const reject = (detail: string): RemoteProbeFieldRead => ({ value: null, detail });
  let raw: unknown;
  try {
    raw = (source as Record<string, unknown>)[key];
  } catch {
    return reject(`remote probe result threw while reading "${key}"`);
  }
  let isArray = false;
  try {
    isArray = Array.isArray(raw);
  } catch {
    return reject(`remote probe result "${key}" threw during array inspection`);
  }
  if (!isArray) {
    return reject(`remote probe result "${key}" is not an array`);
  }
  let length: unknown;
  try {
    length = (raw as unknown[]).length;
  } catch {
    return reject(`remote probe result "${key}" threw while reading its length`);
  }
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
    return reject(`remote probe result "${key}" has no usable length`);
  }
  const out: string[] = [];
  for (let index = 0; index < length; index++) {
    let element: unknown;
    try {
      element = (raw as unknown[])[index];
    } catch {
      return reject(`remote probe result "${key}[${index}]" threw on access`);
    }
    // A hole in a sparse array reads as `undefined` and is rejected here — an
    // absent element is NOT an empty capability name.
    if (typeof element !== "string") {
      return reject(`remote probe result "${key}[${index}]" is not a string`);
    }
    out.push(element);
  }
  return { value: out, detail: null };
}

/**
 * Fail-closed validation of a COMPLETE remote probe response (MHRC-UNS-001).
 *
 * A remote transport is an injected host seam, so what its `probe()` returns is
 * untrusted transport data. Nothing downstream may read `present`/`missing`
 * before this has accepted the whole record: a partial, non-array, sparse,
 * non-string, throwing-getter or Proxy response is a broken response contract,
 * and the boundary reports that as a typed failure rather than letting a
 * property-access exception escape as a host error.
 */
export function validateRemoteProbeFacts(value: unknown): RemoteProbeValidation {
  const reject = (detail: string): RemoteProbeValidation => ({ ok: false, value: null, detail });
  if (value === null || value === undefined) {
    return reject("remote probe returned no result record");
  }
  if (typeof value !== "object" && typeof value !== "function") {
    return reject(`remote probe returned a ${typeof value}, not a result record`);
  }
  let isArray = false;
  try {
    isArray = Array.isArray(value);
  } catch {
    return reject("remote probe result threw during array inspection");
  }
  if (isArray) {
    return reject("remote probe returned an array, not a result record");
  }
  const present = readRemoteProbeField(value, "present");
  if (present.value === null) {
    return reject(present.detail ?? 'remote probe result "present" is invalid');
  }
  const missing = readRemoteProbeField(value, "missing");
  if (missing.value === null) {
    return reject(missing.detail ?? 'remote probe result "missing" is invalid');
  }
  return {
    ok: true,
    value: Object.freeze({
      present: Object.freeze(present.value) as readonly string[],
      missing: Object.freeze(missing.value) as readonly string[],
    }),
    detail: null,
  };
}

// ── The port ─────────────────────────────────────────────────────────────────

/**
 * `ExecutionTransportPort` — the single execution seam. Synchronous, matching the
 * shipped `spawnSync`-based substrates, so an adapter is a thin bounded wrapper
 * rather than a re-architecture.
 *
 * Every method returns a closed `ExecutionOutcome` and NEVER throws: a substrate
 * that explodes is normalized into a `failed` outcome, and a substrate that has no
 * such operation returns `unsupported`.
 */
export interface ExecutionTransportPort {
  readonly schema_version: typeof EXECUTION_TRANSPORT_SCHEMA_VERSION;
  readonly contract_version: number;
  readonly transport_id: ExecutionTransportId;
  supports(operation: ExecutionOperation): boolean;
  /**
   * ADDITIVE (cap-loc-D11): does this port carry a pinned definition bundle?
   *
   * ABSENT ⇒ FALSE. Fail-closed, and that default is the whole safety argument:
   * an un-updated port REFUSES a bundle-carrying spawn rather than ignoring the
   * field and launching a stripped lane. That is what lets injection ship
   * additively under contract major 1 instead of forcing a version fork.
   *
   * Deliberately NOT a member of `EXECUTION_OPERATIONS`, and `supports()` keeps
   * its exact signature and its closed seven-name domain (see
   * `ExecutionSpawnRequest.definition_ref` for why injection is not an operation).
   */
  readonly supports_definition_injection?: boolean;
  spawn(request: ExecutionSpawnRequest): ExecutionOutcome<ExecutionHandle>;
  send(handle: ExecutionHandle, payload: string): ExecutionOutcome<undefined>;
  wait(handle: ExecutionHandle, options: ExecutionWaitOptions): ExecutionOutcome<undefined>;
  interrupt(handle: ExecutionHandle, reason: string): ExecutionOutcome<undefined>;
  close(handle: ExecutionHandle): ExecutionOutcome<undefined>;
  connect(target: RemoteExecutionTargetLike): ExecutionOutcome<undefined>;
  probe(
    target: RemoteExecutionTargetLike,
    binaries: readonly string[]
  ): ExecutionOutcome<RemoteProbeFacts>;
}

// ── Injected substrate seams (test + host injection points) ──────────────────

export interface ExecutionRunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type ExecutionRunFn = (
  cmd: string,
  args: string[],
  opts?: Record<string, unknown>
) => ExecutionRunResult;

/** Injected clock. Deadlines are evaluated against this, never `Date.now()`. */
export interface ExecutionClock {
  now(): number;
}

/**
 * The observation sink (`ObservationSinkPort` in the boundary contract). Declared
 * structurally so this boundary owes observability a RECORD, not an import: a
 * transport publishes typed facts; the observability spine owns durability,
 * ordering, and reconciliation.
 */
export interface ExecutionObservationSink {
  record(outcome: ExecutionOutcome<unknown>): void;
}

// ── Structural seams onto the shipped substrates ─────────────────────────────

/** Structurally satisfied by every shipped `PaneAdapter`, bespoke or wrapped. */
export interface PaneAdapterLike {
  readonly hostKind: string;
  readonly adapterVersion: string;
  preflight(): { ok: boolean; message: string };
  command(spec: PaneSpecLike): string;
  env(spec: PaneSpecLike): Record<string, string>;
  expectedOutputs(): string[];
}

export interface TeamLaunchRequestLike {
  readonly slug: string;
  readonly runId: string;
  readonly cwd: string;
  readonly specialists: readonly unknown[];
  readonly targetName: string;
  readonly mode: string;
  readonly dryRun: boolean;
  /**
   * Optional run-scoping the shipped backends already accept. Declared here so a
   * RUN-SCOPED launch fits the versioned request without the caller reaching past
   * the port — the narrow evolution the dispatch seam needed (see `TeamDispatchPort`).
   */
  readonly orchestratorHostKind?: string;
  readonly teamPath?: string;
}

export interface TeamLaunchResultLike {
  readonly kind: string;
  readonly ok: boolean;
  readonly plannedCommands: readonly string[];
  readonly orchestratorPaneId: string | null;
  readonly teammatePaneIds: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
  readonly dispatchPlan?: readonly unknown[];
  readonly parallelism?: number;
}

/** Structurally satisfied by `InProcessTeamBackend` and `SerialBackend`. */
export interface TeamBackendLike {
  readonly kind: string;
  isAvailable(): boolean;
  launch(request: TeamLaunchRequestLike, opts?: unknown): TeamLaunchResultLike;
}

export interface RemotePaneHandleLike {
  readonly remoteId: string;
}

/** Structurally satisfied by `MockTransport` and `SshRemoteTransport`. */
export interface RemoteTransportLike {
  readonly kind: string;
  connect(host: RemoteExecutionTargetLike): { ok: boolean; message: string };
  probe(host: RemoteExecutionTargetLike, binaries: string[]): RemoteProbeFacts;
  spawn(
    host: RemoteExecutionTargetLike,
    spec: PaneSpecLike,
    command: string
  ): RemotePaneHandleLike;
  teardown(): void;
}

// ── Run-scoped team dispatch: the production launcher's execution seam ───────
//
// `spawn(payload)` alone had no typed room for a RUN-SCOPED launch: the shipped
// substrates answer a whole team dispatch with planned commands, pane ids, notes
// and a declarative dispatch plan, and the tmux substrate additionally owns an
// addressable session namespace (availability, target collision, per-host
// preflight, current session identity). This is that room — evolved NARROWLY,
// inside the versioned contract, and nowhere else:
//
//   * every method still returns exactly one closed `ExecutionOutcome`;
//   * the closed OPERATION vocabulary does not grow — a dispatch read reports as
//     `probe` and the launch itself as `spawn`, because a port may not invent an
//     eighth operation;
//   * nothing here decides a lifecycle transition, a gate outcome, a receipt
//     meaning or a support promotion (BR-04). `preflight()` reports what the host
//     probes said and `collision()` reports whether a name is taken; whether that
//     should abort a run stays the caller's decision, never the transport's.

export interface TeamDispatchTarget {
  readonly target_name: string;
  /** tmux distinguishes a session namespace from a window namespace. */
  readonly scope: "session" | "window";
}

export const TEAM_DISPATCH_SCOPES = ["session", "window"] as const;

export function isTeamDispatchScope(value: unknown): value is "session" | "window" {
  return includes(TEAM_DISPATCH_SCOPES, value);
}

export interface TeamDispatchCollision {
  readonly target_name: string;
  readonly scope: "session" | "window";
  readonly exists: boolean;
}

export interface TeamDispatchPreflightFailure {
  readonly specialist: string;
  readonly host_kind: string;
  readonly message: string;
}

export interface TeamDispatchPreflight {
  readonly ok: boolean;
  readonly failures: readonly TeamDispatchPreflightFailure[];
}

export interface TeamDispatchSession {
  readonly session_name: string | null;
}

/** The typed result of a run-scoped launch. */
export interface TeamDispatchLaunch {
  readonly kind: string;
  readonly ok: boolean;
  readonly planned_commands: readonly string[];
  /** Verbatim from the substrate — `""` when it opened no orchestrator pane. */
  readonly orchestrator_pane_id: string | null;
  readonly teammate_pane_ids: Readonly<Record<string, string>>;
  readonly notes: readonly string[];
  readonly dispatch_plan: readonly unknown[] | null;
  readonly parallelism: number | null;
  /** The exact substrate command that failed, when the substrate names one. */
  readonly failed_command: string | null;
  /** That command's own stderr, redacted but NOT truncated, for operator UX. */
  readonly failure_detail: string | null;
}

/**
 * `TeamDispatchPort` — an `ExecutionTransportPort` that also performs run-scoped
 * team dispatch. A substrate that owns no session namespace answers
 * `collision`/`preflight`/`sessionIdentity` with the closed `unsupported`
 * outcome rather than faking a session it does not have.
 */
export interface TeamDispatchPort extends ExecutionTransportPort {
  readonly dispatch_kind: string;
  /** Is the substrate itself present? Never probed implicitly by `launch`. */
  available(): ExecutionOutcome<undefined>;
  collision(target: TeamDispatchTarget): ExecutionOutcome<TeamDispatchCollision>;
  preflight(request: TeamLaunchRequestLike): ExecutionOutcome<TeamDispatchPreflight>;
  launch(request: TeamLaunchRequestLike): ExecutionOutcome<TeamDispatchLaunch>;
  sessionIdentity(): ExecutionOutcome<TeamDispatchSession>;
}

const TEAM_DISPATCH_METHODS = [
  "available",
  "collision",
  "preflight",
  "launch",
  "sessionIdentity",
] as const;

/**
 * Fail-closed narrowing from a resolved transport port to a dispatch port. A
 * caller that resolved a transport which cannot dispatch must get a typed refusal,
 * never an unchecked cast — so this returns false unless the WHOLE surface is
 * present and the contract identity matches.
 */
export function isTeamDispatchPort(value: unknown): value is TeamDispatchPort {
  if (value === null || typeof value !== "object") return false;
  const port = value as Record<string, unknown>;
  if (port["schema_version"] !== EXECUTION_TRANSPORT_SCHEMA_VERSION) return false;
  if (!isExecutionContractCompatible(port["contract_version"])) return false;
  if (!isExecutionTransportId(port["transport_id"])) return false;
  if (typeof port["dispatch_kind"] !== "string") return false;
  for (const method of TEAM_DISPATCH_METHODS) {
    if (typeof port[method] !== "function") return false;
  }
  return true;
}

/** Fail-closed structural check for an in-process/serial launch payload. */
export function isTeamLaunchRequestLike(value: unknown): value is TeamLaunchRequestLike {
  if (value === null || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o["slug"] === "string" &&
    typeof o["runId"] === "string" &&
    typeof o["cwd"] === "string" &&
    typeof o["targetName"] === "string" &&
    typeof o["mode"] === "string" &&
    typeof o["dryRun"] === "boolean" &&
    Array.isArray(o["specialists"])
  );
}

// ── Substrate selection: the launcher seam ───────────────────────────────────
//
// This is the decision the launcher used to make inline, in host branches. It
// lives HERE, behind the injected runtime dependency, because the launcher may not
// decide which substrate a run gets (MHRC-MOD-003: "host branching is absent from
// core and generic launchers"). The launcher now only READS host facts through the
// probe below and reports what this table decided.

export const EXECUTION_DISPATCH_MODES = ["team", "agent", "subagent"] as const;
export type ExecutionDispatchMode = (typeof EXECUTION_DISPATCH_MODES)[number];

/**
 * Host FACTS, lazily read. Each member is a probe, not a value, so the ladder
 * performs exactly the probes it needs and in the same order the shipped launcher
 * did — an explicit pin still spawns no `tmux -V` subprocess.
 */
export interface ExecutionCapabilityProbe {
  insideMultiplexer(): boolean;
  multiplexerAvailable(): boolean;
  independentAgents(): boolean;
}

export interface ExecutionSubstrateRequest {
  readonly requested_mode: ExecutionDispatchMode | "auto" | null;
  readonly dry_run: boolean;
}

export interface ExecutionSubstrateSelection {
  readonly schema_version: typeof EXECUTION_TRANSPORT_SCHEMA_VERSION;
  readonly contract_version: number;
  readonly dispatch_mode: ExecutionDispatchMode;
  /** The transport that serves this mode, or null when dispatch leaves this seam. */
  readonly transport_id: ExecutionTransportId | null;
  readonly reason: string;
  readonly degraded_from: ExecutionDispatchMode | null;
  /** Operator-facing text the caller MAY print; the decision is already made. */
  readonly warning: string | null;
}

const TEAM_PINNED_NO_TMUX_WARNING =
  "[agent-team-launcher] WARN: agent_mode=team pinned but tmux is not available — " +
  "falling back to subagent. Install tmux or use agent_mode=auto.\n";

function selection(
  dispatch_mode: ExecutionDispatchMode,
  transport_id: ExecutionTransportId | null,
  reason: string,
  degraded_from: ExecutionDispatchMode | null = null,
  warning: string | null = null
): ExecutionSubstrateSelection {
  return Object.freeze({
    schema_version: EXECUTION_TRANSPORT_SCHEMA_VERSION,
    contract_version: EXECUTION_TRANSPORT_CONTRACT_VERSION,
    dispatch_mode,
    transport_id,
    reason,
    degraded_from,
    warning,
  });
}

/**
 * The substrate ladder, as a pure function of an explicit request plus lazily
 * probed host facts.
 *
 *   explicit team    → team, degrading to subagent when tmux is absent on a real run
 *   explicit agent   → agent
 *   explicit subagent→ subagent
 *   auto             → inside a multiplexer → team in-session
 *                    → multiplexer installed → team new-session
 *                    → host has independent agents → agent
 *                    → otherwise → subagent
 *
 * The reason strings are the launcher's shipped vocabulary, moved verbatim, so the
 * rewire is a relocation of the DECISION and not a change to observable behavior.
 */
export function selectExecutionSubstrate(
  request: ExecutionSubstrateRequest,
  probe: ExecutionCapabilityProbe
): ExecutionSubstrateSelection {
  const requested = request.requested_mode ?? "auto";

  if (requested === "team") {
    // A dry run reports intent; only a real run degrades on a missing multiplexer.
    if (!request.dry_run && !probe.multiplexerAvailable()) {
      return selection(
        "subagent",
        null,
        "agent_mode=team pinned but tmux unavailable → subagent fallback",
        "team",
        TEAM_PINNED_NO_TMUX_WARNING
      );
    }
    return selection("team", "tmux", "explicit agent_mode=team");
  }

  if (requested === "agent") {
    return selection("agent", "in-process", "explicit agent_mode=agent");
  }

  if (requested === "subagent") {
    return selection("subagent", null, "explicit agent_mode=subagent");
  }

  if (probe.insideMultiplexer()) {
    return selection("team", "tmux", "auto: $TMUX set → team in-session");
  }
  if (probe.multiplexerAvailable()) {
    return selection("team", "tmux", "auto: tmux installed → team new-session");
  }
  if (probe.independentAgents()) {
    return selection("agent", "in-process", "auto: host supports independent agents → agent");
  }
  return selection(
    "subagent",
    null,
    "auto: no tmux, no independent-agent support → subagent"
  );
}

// ── The injected HostRuntime execution dependency ────────────────────────────

/**
 * The core-facing execution slice of the `HostRuntime` facade
 * (`guild.runtime.host.v1`). A caller receives this; it never constructs a
 * transport by branching on a host itself.
 */
export interface HostExecutionRuntime {
  readonly schema_version: typeof EXECUTION_TRANSPORT_SCHEMA_VERSION;
  readonly contract_version: number;
  readonly transport_ids: readonly ExecutionTransportId[];
  /**
   * Choose the substrate for a dispatch. Reported as a `probe` operation on the
   * `runtime` facade: it reads capability facts and decides nothing about
   * lifecycle state or gate policy.
   */
  selectSubstrate(
    request: ExecutionSubstrateRequest,
    probe: ExecutionCapabilityProbe
  ): ExecutionOutcome<ExecutionSubstrateSelection>;
  /** Bind to a registered transport, or return `unsupported` — never a fallback. */
  transportFor(transport_id: string): ExecutionOutcome<ExecutionTransportPort>;
}

// ── Definition-injection negotiation (cap-loc-D11) ───────────────────────────

/**
 * The verdict on whether a spawn request carrying a pinned definition bundle may
 * proceed on a given port.
 *
 * THE RULE THIS ENCODES: **refuse, never strip.** A runtime asked to dispatch a
 * bundle-carrying spawn to a port that has not declared injection support returns
 * `unsupported` / `capability_absent` — it does NOT drop `definition_ref` and
 * launch a lane without it. Silent omission is the one outcome the plan forbids
 * ("unsupported hosts explicitly defer/refuse — never silently omit the method"),
 * and it is the failure a major-version bump would otherwise be needed to prevent.
 *
 * This is DETERMINISTIC CODE on the real dispatch path, not a documented
 * convention: a rule of this kind expressed only in prose is not enforced.
 */
export type InjectionVerdict =
  /** No bundle on the request — every existing port behaves exactly as before. */
  | { readonly kind: "not_requested" }
  /** Bundle present and the port declared support: carry it. */
  | { readonly kind: "carry" }
  /** Bundle present, support not declared: REFUSE. Never a stripped spawn. */
  | {
      readonly kind: "refuse";
      readonly status: ExecutionOutcomeStatus;
      readonly reason_code: ExecutionReasonCode;
    };

/**
 * Do the request-borne and pane-borne refs agree?
 *
 * CODEX-REVIEW FIX (adversarial round 1, HIGH): presence was negotiated as a
 * single boolean, so a request carrying TWO DIFFERENT refs — one on the request,
 * one on the pane — returned `carry` with no defined precedence. A transport that
 * reads only one location would then silently discard the other, which is the
 * silent-omission failure this whole design exists to prevent, reintroduced one
 * level up.
 *
 * Fail-closed: a conflict is `invalid_request`, never a precedence guess. If both
 * are present they must be the SAME ref (compared on the fields that identify the
 * bytes — a differing `content_hash` or `relative_path` is a different definition).
 */
function refsConflict(a?: DefinitionRefLike, b?: DefinitionRefLike): boolean {
  if (a === undefined || b === undefined) return false;
  if (a === b) return false;
  return (
    a.schema_version !== b.schema_version ||
    a.project_id !== b.project_id ||
    a.layer !== b.layer ||
    a.kind !== b.kind ||
    a.id !== b.id ||
    a.relative_path !== b.relative_path ||
    a.content_hash !== b.content_hash ||
    a.source_commit !== b.source_commit ||
    a.skills.length !== b.skills.length ||
    a.skills.some((s, i) => {
      const o = b.skills[i];
      return (
        o === undefined ||
        s.id !== o.id ||
        s.relative_path !== o.relative_path ||
        s.content_hash !== o.content_hash
      );
    })
  );
}

/**
 * Decide whether `request.definition_ref` may ride on `port`. PURE — no I/O, no
 * clock, never throws.
 *
 * Note the asymmetry, which is intentional: absence of a bundle is always fine
 * (`not_requested` — full backward compatibility), while presence of a bundle
 * without a declaration is always a refusal. There is no third answer and no
 * "best effort" path.
 *
 * `supports_definition_injection` is read as a STRICT `=== true`: `undefined`,
 * `null`, a truthy non-boolean, or any other value all mean "not declared". A
 * port must opt in explicitly and unambiguously.
 */
export function resolveInjectionSupport(
  request: Pick<ExecutionSpawnRequest, "definition_ref" | "pane">,
  port: Pick<ExecutionTransportPort, "supports_definition_injection">
): InjectionVerdict {
  // A bundle may arrive on the request itself OR on the pane (the pane path is
  // the one that previously had no field at all — gap-audit D9). Either presence
  // demands a declaration; checking only the request would leave the pane path
  // silently unprotected, which is exactly the hole this closes.
  const onRequest = request.definition_ref;
  const onPane = request.pane?.definition_ref;
  const requested = onRequest !== undefined || onPane !== undefined;
  if (!requested) return { kind: "not_requested" };

  // CODEX-REVIEW FIX (round 1, HIGH): two DIFFERENT refs is a malformed request,
  // not a precedence question. Checked BEFORE the support check so a conflicting
  // request is refused even on a declaring port.
  if (refsConflict(onRequest, onPane)) {
    return {
      kind: "refuse",
      status: "unsupported",
      reason_code: "invalid_request",
    };
  }

  if (port.supports_definition_injection === true) return { kind: "carry" };

  return {
    kind: "refuse",
    status: "unsupported",
    reason_code: "capability_absent",
  };
}

/**
 * The PORT-SIDE obligation that `supports_definition_injection: true` asserts.
 *
 * CODEX-REVIEW FIX (round 1, CRITICAL-2): declaring support proves an assertion,
 * not carriage — a port could declare `true` and still drop the bundle in its
 * serializer, remote protocol, or substrate hand-off. The contract cannot make
 * that impossible, so it makes it CHECKABLE: a port that declares support MUST
 * satisfy this predicate against the request it actually handed on.
 *
 * Conformance (matrix A7.6 / B4) runs this against EVERY REAL transport adapter,
 * not a test-local facade — that is the difference between proving the helper and
 * proving the wiring.
 *
 * @param original  the spawn request the runtime negotiated
 * @param forwarded what the port actually passed to the substrate
 */
export function portHonoredInjection(
  original: Pick<ExecutionSpawnRequest, "definition_ref" | "pane">,
  forwarded: Pick<ExecutionSpawnRequest, "definition_ref" | "pane"> | undefined
): boolean {
  // CODEX-REVIEW FIX (round 2, HIGH-4): pick-one-with-`??` hid an internal
  // conflict. If `forwarded.definition_ref` were correct but
  // `forwarded.pane.definition_ref` had been swapped, the old check returned true
  // — approving a request carrying two different definitions, which is exactly the
  // ambiguity `resolveInjectionSupport` refuses on the way in. Reject internal
  // conflicts on BOTH sides first, then compare the canonical refs.
  if (refsConflict(original.definition_ref, original.pane?.definition_ref)) return false;
  const wanted = original.definition_ref ?? original.pane?.definition_ref;
  if (wanted === undefined) return true; // nothing to honor
  if (forwarded === undefined) return false; // dropped the whole request
  if (refsConflict(forwarded.definition_ref, forwarded.pane?.definition_ref)) return false;
  const got = forwarded.definition_ref ?? forwarded.pane?.definition_ref;
  if (got === undefined) return false; // STRIPPED — the failure this detects
  return !refsConflict(wanted, got); // and not swapped for a different one
}
