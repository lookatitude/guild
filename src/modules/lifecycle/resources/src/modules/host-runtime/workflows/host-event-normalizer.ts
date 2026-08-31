/**
 * src/modules/host-runtime/workflows/host-event-normalizer.ts
 *
 * `guild.host_event_normalization.v1` — host-native event bindings.
 *
 * MH-03 / W1 of `multi-host-runtime-convergence`. Boundary: `host-adapters`.
 *
 * WHO OWNS WHAT
 *   The host-neutral core OWNS the normalized event vocabulary and its version
 *   compatibility rules; this file owns the NATIVE-to-normalized binding and
 *   nothing else. That split is the frozen contract's own wording
 *   (`vocabulary_owner: host-neutral-core`, `native_mapping_owner: host-adapters`),
 *   and it is why the binding table below is typed against the core's
 *   `NeutralEventName` union: adding a target the core does not declare is a
 *   COMPILE error rather than a runtime surprise.
 *
 *   The type import is deliberately TYPE-ONLY. The adapter side must bind to the
 *   core's vocabulary, but it must not create a runtime edge into a module that
 *   already depends on this one — a type-only import is erased, so the binding is
 *   checked by the compiler and costs nothing at load time.
 *
 * WHAT IT REFUSES, AND WHY REFUSING IS THE POINT
 *   A host-native name with no declared image is REFUSED with `unknown_event`.
 *   It is never mapped by resemblance, and it is never dropped: a normalizer that
 *   silently discarded an event it did not recognize would make "the lifecycle
 *   saw everything the host emitted" unfalsifiable. Two shipped Claude hook
 *   events have NO honest image in the normative vocabulary and are declared as
 *   such, in the table, with the reason written next to them — an explicit
 *   `null` beats an omission, because an omission cannot be reviewed.
 *
 * WHAT THIS FILE IS NOT
 *   It holds no lifecycle state, evaluates no gate, renders nothing, and
 *   executes nothing. It performs no I/O and reads no clock.
 *
 * Pure library module; reached through the host-runtime module's public index.
 */

import { normalizeHostId } from "./host-id-namespace";
import { HOST_REGISTRY_ROWS, type HostId, type HostRegistryEntry } from "./host-registry-schema";
import type { NeutralEventName, NeutralReasonCode } from "../../lifecycle";

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const HOST_EVENT_NORMALIZATION_SCHEMA = "guild.host_event_normalization.v1";
export const HOST_EVENT_NORMALIZATION_RESULT_SCHEMA = "guild.host_event_normalization_result.v1";
export const NORMALIZED_HOST_EVENT_SCHEMA = "guild.normalized_host_event.v1";

/** The normative vocabulary version every binding below targets. */
export const NORMALIZED_EVENT_VOCABULARY_VERSION = "guild.normalized_event.v2";

// ---------------------------------------------------------------------------
// Event sources
// ---------------------------------------------------------------------------

/**
 * Where a host's events actually come from.
 *
 *   native_hooks      the host itself emits events Guild binds (Claude today)
 *   wrapper           the host has no hook surface; the guild-run wrapper is the
 *                     producer, so the native vocabulary is the WRAPPER's
 *   instruction_file  a file surface with no runtime event stream at all
 *   none              no event surface, and none reachable (app/connector hosts)
 */
export type HostEventSourceKind = "native_hooks" | "wrapper" | "instruction_file" | "none";

export interface HostNativeEventBinding {
  /** The host-native (or wrapper-native) event name, exactly as the producer spells it. */
  readonly native_event: string;
  /** The normative image, or `null` when no honest image exists. */
  readonly normalized_event: NeutralEventName | null;
  readonly rationale: string;
}

/**
 * The Claude Code hook surface, one entry per event bound in the shipped
 * `hooks/hooks.json`. The suite pins this list against that file, so a hook
 * added or removed there cannot silently leave the adapter unbound.
 */
export const CLAUDE_NATIVE_EVENT_BINDINGS: readonly HostNativeEventBinding[] = Object.freeze([
  Object.freeze({
    native_event: "PostToolUse",
    normalized_event: "tool.after" as NeutralEventName,
    rationale: "fires after a tool call completes",
  }),
  Object.freeze({
    native_event: "PreCompact",
    normalized_event: "context.compact" as NeutralEventName,
    rationale: "fires before the host compacts its context window",
  }),
  Object.freeze({
    native_event: "PreToolUse",
    normalized_event: "tool.before" as NeutralEventName,
    rationale: "fires before a tool call is admitted",
  }),
  Object.freeze({
    native_event: "SessionStart",
    normalized_event: "session.start" as NeutralEventName,
    rationale: "fires once when the host session opens",
  }),
  Object.freeze({
    native_event: "Stop",
    normalized_event: "run.stop" as NeutralEventName,
    rationale:
      "Guild's state model is run-centric, so the host's session stop is the run stop the core names",
  }),
  Object.freeze({
    native_event: "SubagentStop",
    normalized_event: null,
    rationale:
      "a subagent finishing is not a task collection: the normative vocabulary has no subagent " +
      "lifecycle name, and reusing the task-collection name would report a collection that never " +
      "happened. Declared unmapped rather than approximated.",
  }),
  Object.freeze({
    native_event: "TaskCompleted",
    normalized_event: "task.collect" as NeutralEventName,
    rationale: "the shipped task-completion producer the normative vocabulary was chosen to keep distinct",
  }),
  Object.freeze({
    native_event: "TaskCreated",
    normalized_event: "task.dispatch" as NeutralEventName,
    rationale: "the shipped task-creation producer the normative vocabulary was chosen to keep distinct",
  }),
  Object.freeze({
    native_event: "TeammateIdle",
    normalized_event: null,
    rationale:
      "teammate idleness is a scheduling signal, not a lifecycle transition; the normative " +
      "vocabulary declares no image for it. Declared unmapped rather than approximated.",
  }),
  Object.freeze({
    native_event: "UserPromptSubmit",
    normalized_event: "prompt.submit" as NeutralEventName,
    rationale: "fires when the operator submits a prompt",
  }),
]);

/**
 * The guild-run wrapper surface. Hosts without a hook surface get their events
 * from the wrapper Guild launches them under, so the wrapper's names are their
 * native vocabulary.
 *
 * HONESTY NOTE: unlike the Claude table above — every entry of which is a hook
 * literally bound in the shipped `hooks/hooks.json` — these names are a DECLARED
 * MH-03 contract that the execution transports (MH-04) must emit against. They
 * are not observed shipped literals, and this file does not claim they are.
 */
export const WRAPPER_NATIVE_EVENT_BINDINGS: readonly HostNativeEventBinding[] = Object.freeze([
  Object.freeze({
    native_event: "guild.wrapper.context_compact",
    normalized_event: "context.compact" as NeutralEventName,
    rationale: "the wrapper reports a context reduction it performed on the host's behalf",
  }),
  Object.freeze({
    native_event: "guild.wrapper.prompt_submit",
    normalized_event: "prompt.submit" as NeutralEventName,
    rationale: "the wrapper hands the host an operator prompt",
  }),
  Object.freeze({
    native_event: "guild.wrapper.run_resume",
    normalized_event: "run.resume" as NeutralEventName,
    rationale: "the wrapper re-enters an existing run",
  }),
  Object.freeze({
    native_event: "guild.wrapper.run_stop",
    normalized_event: "run.stop" as NeutralEventName,
    rationale: "the wrapper observes the host process closing the run",
  }),
  Object.freeze({
    native_event: "guild.wrapper.session_start",
    normalized_event: "session.start" as NeutralEventName,
    rationale: "the wrapper opens the host process for this run",
  }),
  Object.freeze({
    native_event: "guild.wrapper.task_collect",
    normalized_event: "task.collect" as NeutralEventName,
    rationale: "the wrapper collects a finished task run",
  }),
  Object.freeze({
    native_event: "guild.wrapper.task_dispatch",
    normalized_event: "task.dispatch" as NeutralEventName,
    rationale: "the wrapper dispatches a task run onto the host",
  }),
  Object.freeze({
    native_event: "guild.wrapper.tool_after",
    normalized_event: "tool.after" as NeutralEventName,
    rationale: "the wrapper observes a completed tool call",
  }),
  Object.freeze({
    native_event: "guild.wrapper.tool_before",
    normalized_event: "tool.before" as NeutralEventName,
    rationale: "the wrapper observes a tool call about to run",
  }),
]);

/**
 * Native binding tables keyed by host FAMILY. A host advertising a hook surface
 * with no table here is NOT treated as `native_hooks`: pretending to know a
 * vocabulary nobody declared is how an adapter starts guessing.
 */
const NATIVE_BINDINGS_BY_FAMILY: Readonly<Record<string, readonly HostNativeEventBinding[]>> = Object.freeze({
  claude: CLAUDE_NATIVE_EVENT_BINDINGS,
});

export interface HostEventSource {
  readonly schema_version: typeof HOST_EVENT_NORMALIZATION_SCHEMA;
  readonly host_id: HostId | null;
  readonly kind: HostEventSourceKind;
  readonly bindings: readonly HostNativeEventBinding[];
}

function advertisesNativeHooks(entry: HostRegistryEntry): boolean {
  return Object.values(entry.capabilities.hooks).some(Boolean);
}

const NO_SOURCE: HostEventSource = Object.freeze({
  schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
  host_id: null,
  kind: "none",
  bindings: Object.freeze([]) as readonly HostNativeEventBinding[],
});

/** Classify a host's event surface. Pure; never throws. */
export function hostEventSource(host: string): HostEventSource {
  const hostId = normalizeHostId(String(host ?? ""));
  const entry = hostId ? HOST_REGISTRY_ROWS[hostId] : undefined;
  if (!hostId || !entry) return NO_SOURCE;

  const familyBindings = NATIVE_BINDINGS_BY_FAMILY[entry.family];
  if (advertisesNativeHooks(entry) && familyBindings !== undefined) {
    return Object.freeze({
      schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
      host_id: hostId,
      kind: "native_hooks" as const,
      bindings: familyBindings,
    });
  }
  if (entry.surface_kind === "app") {
    return Object.freeze({
      schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
      host_id: hostId,
      kind: "none" as const,
      bindings: Object.freeze([]) as readonly HostNativeEventBinding[],
    });
  }
  if (entry.surface_kind === "file" || entry.adapter_binding === "agents-file") {
    return Object.freeze({
      schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
      host_id: hostId,
      kind: "instruction_file" as const,
      bindings: Object.freeze([]) as readonly HostNativeEventBinding[],
    });
  }
  return Object.freeze({
    schema_version: HOST_EVENT_NORMALIZATION_SCHEMA,
    host_id: hostId,
    kind: "wrapper" as const,
    bindings: WRAPPER_NATIVE_EVENT_BINDINGS,
  });
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export interface NormalizedHostEvent {
  readonly schema_version: typeof NORMALIZED_HOST_EVENT_SCHEMA;
  readonly name: NeutralEventName;
  readonly vocabulary_version: typeof NORMALIZED_EVENT_VOCABULARY_VERSION;
  /**
   * Adapter-owned provenance. It travels BESIDE the neutral name, never inside
   * it, which is what lets two host-native producers share one normative image
   * without the core ever seeing a host-specific shape.
   */
  readonly host_native: {
    readonly host_id: HostId;
    readonly native_event: string;
    readonly source_kind: HostEventSourceKind;
  };
}

export type HostEventNormalizationDisposition = "succeeded" | "unsupported" | "refused";

export interface HostEventNormalizationResult {
  readonly schema_version: typeof HOST_EVENT_NORMALIZATION_RESULT_SCHEMA;
  readonly disposition: HostEventNormalizationDisposition;
  readonly reason_code: NeutralReasonCode | null;
  readonly host_id: HostId | null;
  readonly native_event: string;
  readonly source_kind: HostEventSourceKind;
  readonly event: NormalizedHostEvent | null;
  /** Named alternatives when a decision could not be made; empty otherwise. */
  readonly candidates: readonly string[];
  readonly assertions: readonly string[];
}

function refusal(
  hostId: HostId | null,
  nativeEvent: string,
  sourceKind: HostEventSourceKind,
  disposition: "unsupported" | "refused",
  reasonCode: NeutralReasonCode,
  assertions: readonly string[]
): HostEventNormalizationResult {
  return Object.freeze({
    schema_version: HOST_EVENT_NORMALIZATION_RESULT_SCHEMA,
    disposition,
    reason_code: reasonCode,
    host_id: hostId,
    native_event: nativeEvent,
    source_kind: sourceKind,
    event: null,
    candidates: Object.freeze([]) as readonly string[],
    assertions: Object.freeze([...assertions]) as readonly string[],
  }) as HostEventNormalizationResult;
}

/**
 * Bind one host-native event to the normative vocabulary.
 *
 * Four typed answers and no fifth: the host has no event surface
 * (`unsupported`), the native name is not declared for this host (`refused`),
 * the native name is declared to have NO honest image (`refused`), or it
 * normalizes (`succeeded`). Never throws.
 */
export function normalizeHostEvent(host: string, nativeEvent: string): HostEventNormalizationResult {
  const native = String(nativeEvent ?? "");
  const source = hostEventSource(host);

  if (source.host_id === null) {
    return refusal(null, native, source.kind, "unsupported", "capability_absent", [
      "an unrecognized host advertises no event surface",
      "no normalized event is produced and none is inferred",
    ]);
  }

  if (source.kind === "none" || source.kind === "instruction_file") {
    return refusal(source.host_id, native, source.kind, "unsupported", "capability_absent", [
      "the host exposes no runtime event surface for Guild to bind",
      "the absence is reported, not filled with a default event",
    ]);
  }

  const binding = source.bindings.find((candidate) => candidate.native_event === native);
  if (binding === undefined) {
    return refusal(source.host_id, native, source.kind, "refused", "unknown_event", [
      "the host-native event vocabulary is closed",
      "an unrecognized native event is refused, never silently dropped",
      "no normative name is chosen by resemblance",
    ]);
  }

  if (binding.normalized_event === null) {
    return refusal(source.host_id, native, source.kind, "refused", "unknown_event", [
      "the native event is DECLARED to have no normative image",
      "no substitute normative name is offered",
    ]);
  }

  return Object.freeze({
    schema_version: HOST_EVENT_NORMALIZATION_RESULT_SCHEMA,
    disposition: "succeeded",
    reason_code: null,
    host_id: source.host_id,
    native_event: native,
    source_kind: source.kind,
    event: Object.freeze({
      schema_version: NORMALIZED_HOST_EVENT_SCHEMA,
      name: binding.normalized_event,
      vocabulary_version: NORMALIZED_EVENT_VOCABULARY_VERSION,
      host_native: Object.freeze({
        host_id: source.host_id,
        native_event: native,
        source_kind: source.kind,
      }),
    }) as NormalizedHostEvent,
    candidates: Object.freeze([]) as readonly string[],
    assertions: Object.freeze([
      "the normalized name is a member of the normative vocabulary",
      "host-native provenance travels beside the normalized name, never inside it",
    ]) as readonly string[],
  }) as HostEventNormalizationResult;
}
