/**
 * scripts/__tests__/mh-03-host-adapter-boundary.test.ts
 *
 * MH-03 / W1 of `multi-host-runtime-convergence` — the capability-bounded host
 * adapter boundary (`guild.host_adapter_boundary.v1`).
 *
 * RED-FIRST. Every assertion here is written against the PUBLIC surfaces only:
 *   - `src/modules/host-runtime` (the MH-03 boundary under test)
 *   - `src/modules/lifecycle`   (the accepted MH-02 neutral core; public index only)
 *   - `scripts/lib/host-adapter-factory` (the REAL host entry points)
 *
 * The five acceptance claims each have their own describe block, and each block
 * carries at least one control that FAILS if the claim is only nominally true.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  // MH-03 boundary
  HOST_ADAPTER_BOUNDARY_SCHEMA,
  HOST_ADAPTER_BOUNDARY_MAJOR,
  HOST_ADAPTER_CONTRACT_VERSION,
  HOST_ADAPTER_OWNED_CONCERNS,
  HOST_ADAPTER_NOT_OWNED_CONCERNS,
  HOST_ADAPTER_OPERATIONS,
  HOST_ADAPTER_REASON_CODES,
  HOST_ENTRY_POINTS,
  bindHostRuntimeAdapter,
  type HostAdapter,
  hostRuntimeBoundaryOwnership,
  reconcileHostRegistryWithCoreClaimVocabulary,
  resolveHostEntryPoint,
  // MH-03 capability snapshot
  HOST_CAPABILITY_IDS,
  HOST_CAPABILITY_SNAPSHOT_SCHEMA,
  captureHostCapabilitySnapshot,
  createHostCapabilitySnapshotStore,
  releaseHostCapabilitySnapshots,
  // MH-03 event normalization
  CLAUDE_NATIVE_EVENT_BINDINGS,
  HOST_EVENT_NORMALIZATION_SCHEMA,
  WRAPPER_NATIVE_EVENT_BINDINGS,
  hostEventSource,
  normalizeHostEvent,
  // pre-existing public host-runtime surface
  HOST_IDS,
  HOST_REGISTRY_ROWS,
  type HostId,
} from "../../src/modules/host-runtime";

import {
  NEUTRAL_EVENT_NAMES,
  NEUTRAL_RECOGNIZED_ADAPTER_MAJOR,
  NEUTRAL_RECOGNIZED_HOST_IDS,
  evaluateNeutralCapability,
  freezeNeutralCapabilitySnapshot,
  isNeutralEventName,
  isNeutralReasonCode,
  mapLegacyNeutralEventName,
  neutralAdmissionContextSnapshotHash,
  neutralCapabilitySnapshotHash,
  neutralInitialLifecycleState,
  type NeutralCapabilitySnapshot,
  type NeutralGate,
  type NeutralPolicy,
} from "../../src/modules/lifecycle";

import { createHostAdapter as createRealHostAdapter } from "../lib/host-adapter-factory";
import { createHostAdapter as createFailClosedDefaultAdapter } from "../lib/host-adapter-contract";

const PLUGIN_ROOT = path.resolve(__dirname, "../..");

const MH03_SOURCES = [
  "src/modules/host-runtime/workflows/host-adapter-boundary.ts",
  "src/modules/host-runtime/workflows/host-capability-snapshot.ts",
  "src/modules/host-runtime/workflows/host-event-normalizer.ts",
];

const NEUTRAL_CORE_SOURCES = [
  "src/modules/lifecycle/workflows/neutral-runtime-contracts.ts",
  "src/modules/lifecycle/workflows/neutral-gate-policy.ts",
  "src/modules/lifecycle/workflows/neutral-lifecycle-machine.ts",
  "src/modules/lifecycle/workflows/neutral-conformance-core.ts",
  "src/modules/lifecycle/workflows/neutral-core-boundary.ts",
];

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relPath), "utf8");
}

/**
 * Source with comments removed. A rationale comment naming a shipped host event
 * is documentation; a CODE literal is a host shape entering the module. Only the
 * second is a boundary violation, so the purity scans read code, not prose.
 */
function readCode(relPath: string): string {
  return readSource(relPath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const POLICY: NeutralPolicy = {
  policy_version: "mh-03-test-policy.v1",
  denied_operations: [],
  approval_required_operations: [],
};

const GATES: readonly NeutralGate[] = [
  { gate_id: "mh-03-gate", phase: "build", operation_class: "read_only", required_conditions: [] },
];

// ---------------------------------------------------------------------------
// Acceptance 1 — one immutable capability snapshot per host/run, with EXPLICIT
// unsupported capability results rather than optimistic defaults.
// ---------------------------------------------------------------------------

describe("MH-03 acceptance 1 — immutable per host/run capability snapshot", () => {
  test("the closed capability vocabulary is non-empty, unique, and sorted", () => {
    expect(HOST_CAPABILITY_IDS.length).toBeGreaterThan(10);
    expect(new Set(HOST_CAPABILITY_IDS).size).toBe(HOST_CAPABILITY_IDS.length);
    expect([...HOST_CAPABILITY_IDS]).toEqual([...HOST_CAPABILITY_IDS].sort());
  });

  test("a snapshot carries an EXPLICIT fact for every capability id — none omitted", () => {
    const store = createHostCapabilitySnapshotStore();
    const captured = store.capture({ host: "claude-code-cli", runId: "run-a", hostVersion: "2.3.2" });
    expect(captured.disposition).toBe("succeeded");
    const snapshot = captured.snapshot;
    expect(snapshot).not.toBeNull();
    expect(snapshot!.schema_version).toBe(HOST_CAPABILITY_SNAPSHOT_SCHEMA);
    expect(snapshot!.capabilities.map((fact) => fact.capability_id)).toEqual([...HOST_CAPABILITY_IDS]);
    for (const fact of snapshot!.capabilities) {
      expect(typeof fact.supported).toBe("boolean");
      expect(typeof fact.authenticated).toBe("boolean");
    }
  });

  test("ONE snapshot per host/run: a repeat capture returns the SAME frozen object", () => {
    const store = createHostCapabilitySnapshotStore();
    const first = store.capture({ host: "claude-code-cli", runId: "run-b", hostVersion: "2.3.2" });
    const second = store.capture({ host: "claude", runId: "run-b", hostVersion: "2.3.2" });
    expect(first.snapshot).not.toBeNull();
    expect(Object.is(first.snapshot, second.snapshot)).toBe(true);
    expect(Object.isFrozen(first.snapshot)).toBe(true);
    expect(Object.isFrozen(first.snapshot!.capabilities)).toBe(true);
    expect(Object.isFrozen(first.snapshot!.capabilities[0])).toBe(true);
    expect(store.size()).toBe(1);
  });

  test("a SECOND, DIFFERENT snapshot for the same host/run is refused, not minted", () => {
    const store = createHostCapabilitySnapshotStore();
    const first = store.capture({ host: "codex-cli", runId: "run-c", hostVersion: "1.0.0" });
    const drift = store.capture({ host: "codex-cli", runId: "run-c", hostVersion: "9.9.9" });
    expect(first.disposition).toBe("succeeded");
    expect(drift.disposition).toBe("refused");
    expect(drift.reason_code).toBe("capability_snapshot_mismatch");
    expect(drift.snapshot).toBeNull();
    expect(store.size()).toBe(1);
  });

  test("deterministic: identical inputs in two independent stores produce an identical hash", () => {
    const left = createHostCapabilitySnapshotStore().capture({
      host: "codex-cli",
      runId: "run-d",
      hostVersion: "1.0.0",
      authentication: "authenticated",
    });
    const right = createHostCapabilitySnapshotStore().capture({
      host: "codex-cli",
      runId: "run-d",
      hostVersion: "1.0.0",
      authentication: "authenticated",
    });
    expect(Object.is(left.snapshot, right.snapshot)).toBe(false);
    expect(left.snapshot!.snapshot_hash).toBe(right.snapshot!.snapshot_hash);
    expect(left.snapshot!.snapshot_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(left.snapshot)).toBe(JSON.stringify(right.snapshot));
  });

  test("UNSUPPORTED CONTROL: an unknown host mints NO snapshot and reports every id unsupported", () => {
    const captured = createHostCapabilitySnapshotStore().capture({
      host: "totally-unknown-host",
      runId: "run-e",
    });
    expect(captured.disposition).toBe("unsupported");
    expect(captured.reason_code).toBe("capability_absent");
    expect(captured.snapshot).toBeNull();
    expect(captured.host_id).toBeNull();
    expect([...captured.unsupported_capability_ids]).toEqual([...HOST_CAPABILITY_IDS]);
  });

  test("no optimistic defaults: an app host's absent surfaces are EXPLICITLY unsupported", () => {
    const captured = createHostCapabilitySnapshotStore().capture({
      host: "claude-code-app",
      runId: "run-f",
    });
    expect(captured.disposition).toBe("succeeded");
    const facts = new Map(captured.snapshot!.capabilities.map((fact) => [fact.capability_id, fact]));
    expect(facts.get("host.hooks.session_start")!.supported).toBe(false);
    expect(facts.get("host.package.install")!.supported).toBe(false);
    expect(facts.get("host.dispatch.selectable")!.supported).toBe(false);
    // and the ids are present rather than silently absent
    expect(captured.unsupported_capability_ids.length).toBeGreaterThan(0);
    expect(captured.unsupported_capability_ids).toContain("host.hooks.session_start");
  });

  test("authentication is fail-closed: unobserved auth is NEVER reported as authenticated", () => {
    const unobserved = createHostCapabilitySnapshotStore().capture({ host: "codex-cli", runId: "run-g" });
    const supported = unobserved.snapshot!.capabilities.filter((fact) => fact.supported);
    expect(supported.length).toBeGreaterThan(0);
    expect(supported.every((fact) => fact.authenticated === false)).toBe(true);

    const observed = createHostCapabilitySnapshotStore().capture({
      host: "codex-cli",
      runId: "run-g",
      authentication: "authenticated",
    });
    expect(observed.snapshot!.capabilities.some((fact) => fact.supported && fact.authenticated)).toBe(true);

    const failed = createHostCapabilitySnapshotStore().capture({
      host: "codex-cli",
      runId: "run-g",
      authentication: "unauthenticated",
    });
    expect(failed.snapshot!.capabilities.every((fact) => fact.authenticated === false)).toBe(true);
  });

  test("the process-wide default store also holds one snapshot per host/run and can be released", () => {
    const first = captureHostCapabilitySnapshot({ host: "pi-cli", runId: "run-shared" });
    const again = captureHostCapabilitySnapshot({ host: "pi-cli", runId: "run-shared" });
    expect(Object.is(first.snapshot, again.snapshot)).toBe(true);
    releaseHostCapabilitySnapshots("run-shared");
    const reminted = captureHostCapabilitySnapshot({ host: "pi-cli", runId: "run-shared" });
    expect(Object.is(first.snapshot, reminted.snapshot)).toBe(false);
    expect(reminted.snapshot!.snapshot_hash).toBe(first.snapshot!.snapshot_hash);
    releaseHostCapabilitySnapshots("run-shared");
  });

  test("the snapshot is accepted by the MH-02 core unchanged and binds a lifecycle run", () => {
    const captured = createHostCapabilitySnapshotStore().capture({
      host: "claude-code-cli",
      runId: "run-h",
      hostVersion: "2.3.2",
      authentication: "authenticated",
    });
    const snapshot = captured.snapshot as unknown as NeutralCapabilitySnapshot;
    expect(freezeNeutralCapabilitySnapshot(snapshot)).toEqual(snapshot);
    expect(typeof neutralCapabilitySnapshotHash(snapshot)).toBe("string");

    const context = { snapshot, policy: POLICY, gates: GATES };
    expect(neutralAdmissionContextSnapshotHash(context)).toBe(snapshot.snapshot_hash);
    const state = neutralInitialLifecycleState({
      run_id: "run-h",
      capability_snapshot_hash: snapshot.snapshot_hash,
      phase: "build",
      admission_context: context,
    });
    expect(state.capability_snapshot_hash).toBe(snapshot.snapshot_hash);
  });

  test("an explicitly unsupported fact makes the CORE answer `unsupported`, never a default", () => {
    const captured = createHostCapabilitySnapshotStore().capture({
      host: "claude-code-app",
      runId: "run-i",
      authentication: "authenticated",
    });
    const snapshot = captured.snapshot as unknown as NeutralCapabilitySnapshot;
    const outcome = evaluateNeutralCapability(
      {
        operation_id: "op-1",
        operation: "render_package",
        required_capability: "host.package.install",
        operation_class: "read_only",
        satisfied_conditions: [],
        approval_supplied: false,
      },
      snapshot
    );
    expect(outcome.disposition).toBe("unsupported");
    expect(outcome.reason_code).toBe("capability_absent");
    // The id is DECLARED and false — not merely missing from the snapshot.
    expect(outcome.facts.capability_declared).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acceptance 2 — normalize host events into the accepted neutral vocabulary
// WITHOUT importing Claude-specific shapes into the lifecycle core.
// ---------------------------------------------------------------------------

describe("MH-03 acceptance 2 — host event normalization into guild.normalized_event.v2", () => {
  test("every declared normalized target is a member of the CORE's v2 vocabulary", () => {
    const declared = [...CLAUDE_NATIVE_EVENT_BINDINGS, ...WRAPPER_NATIVE_EVENT_BINDINGS];
    expect(declared.length).toBeGreaterThan(0);
    for (const binding of declared) {
      if (binding.normalized_event === null) continue;
      expect(isNeutralEventName(binding.normalized_event)).toBe(true);
      expect(NEUTRAL_EVENT_NAMES).toContain(binding.normalized_event);
    }
  });

  test("every SHIPPED Claude hook event in hooks/hooks.json is DECLARED — mapped or explicitly not", () => {
    const shipped = Object.keys(JSON.parse(readSource("hooks/hooks.json")).hooks ?? {}).sort();
    expect(shipped.length).toBeGreaterThan(0);
    const declared = CLAUDE_NATIVE_EVENT_BINDINGS.map((binding) => binding.native_event).sort();
    expect(declared).toEqual(shipped);
  });

  test("Claude natives normalize to the exact v2 names", () => {
    const cases: ReadonlyArray<[string, string]> = [
      ["SessionStart", "session.start"],
      ["UserPromptSubmit", "prompt.submit"],
      ["PreToolUse", "tool.before"],
      ["PostToolUse", "tool.after"],
      ["PreCompact", "context.compact"],
      ["Stop", "run.stop"],
      ["TaskCreated", "task.dispatch"],
      ["TaskCompleted", "task.collect"],
    ];
    for (const [native, normalized] of cases) {
      const result = normalizeHostEvent("claude-code-cli", native);
      expect(result.schema_version).toBe("guild.host_event_normalization_result.v1");
      expect(result.disposition).toBe("succeeded");
      expect(result.reason_code).toBeNull();
      expect(result.event!.name).toBe(normalized);
      expect(result.event!.vocabulary_version).toBe("guild.normalized_event.v2");
      expect(result.event!.host_native).toEqual({
        host_id: "claude-code-cli",
        native_event: native,
        source_kind: "native_hooks",
      });
    }
  });

  test("a DECLARED-UNMAPPED native refuses and names no substitute", () => {
    for (const native of ["SubagentStop", "TeammateIdle"]) {
      const result = normalizeHostEvent("claude-code-cli", native);
      expect(result.disposition).toBe("refused");
      expect(result.reason_code).toBe("unknown_event");
      expect(result.event).toBeNull();
      expect(result.candidates).toEqual([]);
    }
  });

  test("an UNDECLARED native refuses — the native vocabulary is closed", () => {
    const result = normalizeHostEvent("claude-code-cli", "TotallyMadeUpEvent");
    expect(result.disposition).toBe("refused");
    expect(result.reason_code).toBe("unknown_event");
    expect(result.event).toBeNull();
  });

  test("a superseded v1 NEUTRAL name is not accepted as a native, and the CORE owns the mapping", () => {
    expect(normalizeHostEvent("claude-code-cli", "tool.pre").disposition).toBe("refused");
    expect(normalizeHostEvent("claude-code-cli", "task.transition").disposition).toBe("refused");
    // The v1 -> v2 decision stays with MH-02, and MH-03 does not re-implement it.
    expect(mapLegacyNeutralEventName("tool.pre").reason_code).toBe("event_vocabulary_superseded");
    expect(mapLegacyNeutralEventName("task.transition").reason_code).toBe("event_vocabulary_ambiguous");
    for (const source of MH03_SOURCES) {
      expect(readSource(source)).not.toMatch(/tool\.pre|session\.resume\b|task\.transition/);
    }
  });

  test("wrapped-CLI and Codex hosts normalize through the wrapper vocabulary", () => {
    for (const host of ["codex-cli", "cursor", "github-copilot", "opencode", "rovo-dev", "pi-cli"]) {
      expect(hostEventSource(host).kind).toBe("wrapper");
      const started = normalizeHostEvent(host, "guild.wrapper.session_start");
      expect(started.disposition).toBe("succeeded");
      expect(started.event!.name).toBe("session.start");
      expect(started.event!.host_native.source_kind).toBe("wrapper");
      // A Claude hook name is NOT a wrapper native.
      expect(normalizeHostEvent(host, "SessionStart").disposition).toBe("refused");
    }
  });

  test("UNSUPPORTED CONTROL: app hosts and instruction-file hosts have no event surface", () => {
    for (const host of ["claude-code-app", "claude-code-web", "codex-app", "claude-ai-connector"]) {
      expect(hostEventSource(host).kind).toBe("none");
      const result = normalizeHostEvent(host, "SessionStart");
      expect(result.disposition).toBe("unsupported");
      expect(result.reason_code).toBe("capability_absent");
      expect(result.event).toBeNull();
    }
    for (const host of ["agents-file", "kiro", "qoder", "trae"]) {
      expect(hostEventSource(host).kind).toBe("instruction_file");
      expect(normalizeHostEvent(host, "guild.wrapper.session_start").disposition).toBe("unsupported");
    }
  });

  test("UNSUPPORTED CONTROL: an unknown host normalizes nothing", () => {
    const result = normalizeHostEvent("totally-unknown-host", "SessionStart");
    expect(result.disposition).toBe("unsupported");
    expect(result.reason_code).toBe("capability_absent");
    expect(hostEventSource("totally-unknown-host").host_id).toBeNull();
  });

  test("the lifecycle core carries NO Claude-specific host shape", () => {
    const claudeShapes = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PreCompact",
      "SubagentStop",
      "TaskCreated",
      "TaskCompleted",
      "TeammateIdle",
      "hookSpecificOutput",
      "CLAUDE_PLUGIN_ROOT",
      ".claude",
    ];
    for (const source of NEUTRAL_CORE_SOURCES) {
      const code = readCode(source);
      for (const shape of claudeShapes) {
        expect(code.includes(shape)).toBe(false);
      }
      // and the core imports nothing from the adapter module
      expect(readSource(source)).not.toMatch(/from\s+["'][^"']*host-runtime/);
    }
  });

  test("the normalizer schema id is versioned and public", () => {
    expect(HOST_EVENT_NORMALIZATION_SCHEMA).toBe("guild.host_event_normalization.v1");
  });
});

// ---------------------------------------------------------------------------
// Acceptance 3 — bind REAL host entry points through PUBLIC adapter interfaces.
// ---------------------------------------------------------------------------

describe("MH-03 acceptance 3 — real host entry points bound through the public interface", () => {
  test("the boundary is public, versioned, and agrees with the core's adapter major", () => {
    expect(HOST_ADAPTER_BOUNDARY_SCHEMA).toBe("guild.host_adapter_boundary.v1");
    expect(HOST_ADAPTER_BOUNDARY_MAJOR).toBe(1);
    expect(HOST_ADAPTER_CONTRACT_VERSION).toBe("guild.host_adapter.v1.0.0");
    expect(HOST_ADAPTER_CONTRACT_VERSION).toMatch(/^guild\.host_adapter\.v(\d+)\.(\d+)\.(\d+)$/);
    expect(HOST_ADAPTER_BOUNDARY_MAJOR).toBe(NEUTRAL_RECOGNIZED_ADAPTER_MAJOR);
  });

  test("every registry host has a REAL entry point derived from its detection row", () => {
    expect(Object.keys(HOST_ENTRY_POINTS).sort()).toEqual([...HOST_IDS].sort());
    for (const hostId of HOST_IDS) {
      const entryPoint = HOST_ENTRY_POINTS[hostId];
      const row = HOST_REGISTRY_ROWS[hostId];
      expect(entryPoint.host_id).toBe(hostId);
      expect(entryPoint.bin).toBe(row.detection.bin);
      expect(entryPoint.subcommand).toBe(row.detection.subcommand ?? null);
      expect(entryPoint.requires_auth).toBe(row.detection.requires_auth);
      expect(entryPoint.auth_probe).toBe(row.detection.auth_probe);
      expect(entryPoint.surface_kind).toBe(row.surface_kind);
      expect(entryPoint.adapter_binding).toBe(row.adapter_binding);
      expect(entryPoint.dispatch_selectable).toBe(row.dispatch_selectable);
    }
    expect(HOST_ENTRY_POINTS["claude-code-cli"].bin).toBe("claude");
    expect(HOST_ENTRY_POINTS["codex-cli"].bin).toBe("codex");
    expect(HOST_ENTRY_POINTS["github-copilot"]).toMatchObject({
      bin: "gh",
      subcommand: "copilot",
      kind: "cli_subcommand",
    });
    expect(HOST_ENTRY_POINTS["rovo-dev"]).toMatchObject({ bin: "acli", subcommand: "rovodev" });
    expect(HOST_ENTRY_POINTS["claude-code-app"].kind).toBe("app_surface");
    expect(HOST_ENTRY_POINTS["kiro"].kind).toBe("instruction_file");
    expect(resolveHostEntryPoint("claude")).toBe(HOST_ENTRY_POINTS["claude-code-cli"]);
    expect(resolveHostEntryPoint("totally-unknown-host")).toBeNull();
  });

  test("the REAL Claude entry point binds through the public boundary", () => {
    const bound = bindHostRuntimeAdapter({
      host: "claude",
      runId: "bind-claude",
      provider: createRealHostAdapter,
      hostVersion: "2.3.2",
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("succeeded");
    const binding = bound.binding!;
    expect(binding.host_id).toBe("claude-code-cli");
    expect(binding.entry_point.bin).toBe("claude");
    expect(binding.boundary_version).toBe(HOST_ADAPTER_BOUNDARY_SCHEMA);
    expect(binding.snapshot.host_id).toBe("claude-code-cli");
    expect(binding.event_source).toBe("native_hooks");
    expect(binding.normalizeEvent("SessionStart").event!.name).toBe("session.start");

    // It is the REAL adapter, not the fail-closed default: only the concrete Claude
    // adapter reports an `ok` bootstrap carrying the SessionStart hook binding.
    const bootstrap = binding.adapter.bootstrap({ cwd: "/repo", runId: "bind-claude" });
    expect(bootstrap.status).toBe("ok");
    expect(bootstrap.value).toMatchObject({ hook_event: "SessionStart" });
    expect(createFailClosedDefaultAdapter("claude-code-cli").bootstrap().status).toBe("degraded");
  });

  test("the REAL Codex entry point binds through the public boundary", () => {
    const bound = bindHostRuntimeAdapter({
      host: "codex-plugin",
      runId: "bind-codex",
      provider: createRealHostAdapter,
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("succeeded");
    const binding = bound.binding!;
    expect(binding.host_id).toBe("codex-cli");
    expect(binding.entry_point).toMatchObject({ bin: "codex", kind: "cli_binary" });
    expect(binding.event_source).toBe("wrapper");
    const dispatch = binding.adapter.dispatch({ taskRun: { prompt: "hello" } });
    expect(dispatch.status).toBe("ok");
    expect(createFailClosedDefaultAdapter("codex-cli").dispatch({ taskRun: {} }).status).toBe("degraded");
  });

  test("the REAL app-host entry point binds through the public boundary", () => {
    const bound = bindHostRuntimeAdapter({
      host: "claude-code-app",
      runId: "bind-app",
      provider: createRealHostAdapter,
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("succeeded");
    const binding = bound.binding!;
    expect(binding.entry_point.kind).toBe("app_surface");
    expect(binding.event_source).toBe("none");
    expect(binding.adapter.bootstrap().value).toMatchObject({ guild_state_root: ".guild" });
    expect(createFailClosedDefaultAdapter("claude-code-app").bootstrap().value).not.toMatchObject({
      guild_state_root: ".guild",
    });
    expect(binding.normalizeEvent("SessionStart").disposition).toBe("unsupported");
  });

  test("the REAL wrapped-CLI entry points bind through the public boundary", () => {
    for (const host of ["cursor", "github-copilot", "opencode", "rovo-dev"] as const) {
      const bound = bindHostRuntimeAdapter({
        host,
        runId: `bind-${host}`,
        provider: createRealHostAdapter,
        snapshots: createHostCapabilitySnapshotStore(),
      });
      expect(bound.disposition).toBe("succeeded");
      const binding = bound.binding!;
      expect(binding.host_id).toBe(host);
      const preflight = binding.adapter.preflight({ runId: `bind-${host}` });
      expect(preflight.value).toMatchObject({ auth_probe: HOST_ENTRY_POINTS[host].auth_probe });
      expect(binding.adapter.bootstrap().value).toMatchObject({ skill_root: ".agents/skills/guild" });
      expect(createFailClosedDefaultAdapter(host).preflight().value).not.toMatchObject({
        auth_probe: HOST_ENTRY_POINTS[host].auth_probe,
      });
    }
  });

  test("UNSUPPORTED CONTROL: an unknown host binds nothing", () => {
    const bound = bindHostRuntimeAdapter({
      host: "totally-unknown-host",
      runId: "bind-unknown",
      provider: createRealHostAdapter,
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("unsupported");
    expect(bound.reason_code).toBe("capability_absent");
    expect(bound.binding).toBeNull();
  });

  test("IMPOSTOR CONTROL: a provider returning another host's adapter is refused", () => {
    const bound = bindHostRuntimeAdapter({
      host: "codex-cli",
      runId: "bind-impostor",
      provider: () => createRealHostAdapter("claude-code-cli"),
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("refused");
    expect(bound.reason_code).toBe("boundary_membership_mismatch");
    expect(bound.binding).toBeNull();
    expect(bound.facts).toMatchObject({ expected_host_id: "codex-cli", bound_host_id: "claude-code-cli" });
  });

  test("FAILURE CONTROL: a provider that throws fails closed rather than propagating", () => {
    const bound = bindHostRuntimeAdapter({
      host: "claude-code-cli",
      runId: "bind-throws",
      provider: () => {
        throw new Error("host binary exploded");
      },
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("failed");
    expect(bound.reason_code).toBe("execution_failed");
    expect(bound.binding).toBeNull();
  });

  test("every reason code the boundary can emit is a CORE reason code", () => {
    expect(HOST_ADAPTER_REASON_CODES.length).toBeGreaterThan(0);
    for (const code of HOST_ADAPTER_REASON_CODES) {
      expect(isNeutralReasonCode(code)).toBe(true);
    }
  });

  test("the host registry is reconciled against the core's closed claim vocabulary", () => {
    const report = reconcileHostRegistryWithCoreClaimVocabulary(NEUTRAL_RECOGNIZED_HOST_IDS);
    expect(report.matched).toEqual(["claude-code-cli", "codex-cli", "pi-cli"]);
    // KNOWN, PINNED divergence: the core claim vocabulary spells Antigravity
    // `antigravity`; the registry id is `antigravity-cli`. MH-09 owns closing it.
    expect(report.core_only).toEqual(["antigravity"]);
    expect(report.registry_only).toContain("antigravity-cli");
    expect(report.reconciled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Acceptance 4 — lifecycle state, gate policy, artifact semantics, document
// rendering, and transport execution stay OUTSIDE adapter ownership.
// ---------------------------------------------------------------------------

describe("MH-03 acceptance 4 — the boundary owns adapters and nothing else", () => {
  test("the ownership declaration names what the adapter boundary does NOT own", () => {
    const ownership = hostRuntimeBoundaryOwnership();
    expect(ownership.schema_version).toBe("guild.host_adapter_ownership.v1");
    expect([...ownership.owned]).toEqual([...HOST_ADAPTER_OWNED_CONCERNS]);
    expect([...ownership.not_owned]).toEqual([...HOST_ADAPTER_NOT_OWNED_CONCERNS]);
    for (const concern of [
      "lifecycle_state",
      "gate_policy",
      "artifact_semantics",
      "document_rendering",
      "transport_execution",
    ]) {
      expect(ownership.not_owned).toContain(concern);
      expect(typeof ownership.owners[concern]).toBe("string");
      expect(ownership.owners[concern]).not.toBe("host-adapters");
    }
  });

  test("MECHANICAL: the boundary sources decide no lifecycle transition and no gate", () => {
    const forbiddenCalls = [
      "neutralLifecycleTransition",
      "neutralInitialLifecycleState",
      "evaluateNeutralAdmission",
      "evaluateNeutralGate",
      "evaluateNeutralPolicy",
      "evaluateNeutralCapability",
    ];
    for (const source of MH03_SOURCES) {
      const text = readSource(source);
      for (const call of forbiddenCalls) {
        expect(text.includes(`${call}(`)).toBe(false);
      }
    }
  });

  test("MECHANICAL: the boundary sources reach no transport, document, or artifact module", () => {
    const forbiddenImports = [
      "pane-adapter",
      "modules/dispatch",
      "../../dispatch",
      "artifact-bus",
      "guild-artifact-paths",
      "child_process",
      "node:child_process",
    ];
    for (const source of MH03_SOURCES) {
      const text = readSource(source);
      for (const specifier of forbiddenImports) {
        expect(text.includes(specifier)).toBe(false);
      }
    }
  });

  test("MECHANICAL: the boundary imports the lifecycle core TYPE-ONLY, so no runtime edge exists", () => {
    for (const source of MH03_SOURCES) {
      const text = readSource(source);
      const lifecycleImports = text.match(/import[^;]*from\s+["'][^"']*lifecycle["']/g) ?? [];
      for (const statement of lifecycleImports) {
        expect(statement.startsWith("import type")).toBe(true);
      }
      // never a private reach into lifecycle internals
      expect(text).not.toMatch(/lifecycle\/workflows/);
    }
  });
});

// ---------------------------------------------------------------------------
// Acceptance 5 — determinism and fail-closed behaviour across the host set.
// ---------------------------------------------------------------------------

describe("MH-03 acceptance 5 — deterministic and fail-closed across the host set", () => {
  test("binding the same host twice in one run reuses the ONE snapshot", () => {
    const snapshots = createHostCapabilitySnapshotStore();
    const first = bindHostRuntimeAdapter({
      host: "claude-code-cli",
      runId: "det-1",
      provider: createRealHostAdapter,
      snapshots,
    });
    const second = bindHostRuntimeAdapter({
      host: "claude-code-cli",
      runId: "det-1",
      provider: createRealHostAdapter,
      snapshots,
    });
    expect(Object.is(first.binding!.snapshot, second.binding!.snapshot)).toBe(true);
    expect(snapshots.size()).toBe(1);
  });

  test("every registry host either binds or fails closed — no silent partial binding", () => {
    for (const hostId of HOST_IDS) {
      const bound = bindHostRuntimeAdapter({
        host: hostId,
        runId: `sweep-${hostId}`,
        provider: createRealHostAdapter,
        snapshots: createHostCapabilitySnapshotStore(),
      });
      expect(["succeeded", "unsupported", "refused", "failed"]).toContain(bound.disposition);
      if (bound.disposition === "succeeded") {
        expect(bound.reason_code).toBeNull();
        expect(bound.binding).not.toBeNull();
        expect(bound.binding!.snapshot.capabilities.length).toBe(HOST_CAPABILITY_IDS.length);
      } else {
        expect(bound.binding).toBeNull();
        expect(isNeutralReasonCode(bound.reason_code)).toBe(true);
      }
    }
  });

  test("two identical sweeps produce byte-identical snapshot hashes", () => {
    const hashes = (run: string): string[] =>
      HOST_IDS.map((hostId) => {
        const captured = createHostCapabilitySnapshotStore().capture({ host: hostId, runId: run });
        return `${hostId}=${captured.snapshot?.snapshot_hash ?? "none"}`;
      });
    expect(hashes("sweep-a")).toEqual(hashes("sweep-b"));
  });

  test("the boundary never throws for any string input", () => {
    const inputs = ["", " ", "claude", "CLAUDE", "../etc/passwd", "gemini", "kiro", " "];
    for (const host of inputs) {
      expect(() =>
        bindHostRuntimeAdapter({
          host,
          runId: "fuzz",
          provider: createRealHostAdapter,
          snapshots: createHostCapabilitySnapshotStore(),
        })
      ).not.toThrow();
      expect(() => normalizeHostEvent(host, "SessionStart")).not.toThrow();
      expect(() => createHostCapabilitySnapshotStore().capture({ host, runId: "fuzz" })).not.toThrow();
    }
  });

  test("host ids that only the LEGACY namespace knows still fail closed", () => {
    const bound = bindHostRuntimeAdapter({
      host: "gemini",
      runId: "sunset",
      provider: createRealHostAdapter,
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("unsupported");
    expect(bound.binding).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Acceptance 6 (MH-03-R2-B01) — a `succeeded` binding GUARANTEES an adapter.
//
// Round 2 handed the boundary a plain `{ host, hostId }` object and got
// `disposition: "succeeded"` back; the absence of the rest of the interface only
// surfaced later, in the caller, as `adapter.capabilities is not a function`. A
// success answer that does not guarantee an adapter is not a boundary — it just
// moves the crash somewhere with less context.
//
// So the shape check below is TOTAL and it is passive: every public member is
// verified as an OWN, callable data property, read through property DESCRIPTORS
// so that an accessor is rejected rather than invoked. That is what lets the
// matrix assert two things at once — every malformed provider fails closed, and
// no adapter operation runs while deciding that.
// ---------------------------------------------------------------------------

describe("MH-03 acceptance 6 — the boundary validates the COMPLETE adapter interface", () => {
  const CANONICAL: HostId = "claude-code-cli";

  /**
   * A conforming adapter whose every member records that it was invoked.
   *
   * Building the malformed cases by DAMAGING this adapter (rather than by
   * writing stubs) is what makes the "no operation ran" assertion meaningful:
   * each case is one mutation away from a fully working adapter, so an empty
   * call log is evidence of a passive check, not of a lifeless fixture.
   */
  function tripwire(calls: string[], host: string = CANONICAL): HostAdapter {
    const inner = createRealHostAdapter(host) as unknown as Record<string, (request: unknown) => unknown>;
    const adapter: Record<string, unknown> = { host: inner["host"], hostId: inner["hostId"] };
    for (const operation of HOST_ADAPTER_OPERATIONS) {
      adapter[operation] = (request: unknown): unknown => {
        calls.push(operation);
        return inner[operation](request);
      };
    }
    return adapter as unknown as HostAdapter;
  }

  function bindProvided(value: unknown, host: string = CANONICAL) {
    return bindHostRuntimeAdapter({
      host,
      runId: "shape-probe",
      provider: () => value as HostAdapter,
      snapshots: createHostCapabilitySnapshotStore(),
    });
  }

  interface ShapeCase {
    readonly name: string;
    /** Built per-case so each gets its own tripwire call log. */
    readonly build: (calls: string[]) => unknown;
    /** The requested host, when the case is about identity rather than shape. */
    readonly host?: string;
  }

  const MALFORMED_CASES: readonly ShapeCase[] = [
    // --- the exact round-2 probe -------------------------------------------
    { name: "the round-2 probe: matching identity strings and nothing else", build: () => ({ host: CANONICAL, hostId: CANONICAL }) },

    // --- null and primitives ------------------------------------------------
    { name: "null", build: () => null },
    { name: "undefined", build: () => undefined },
    { name: "a string that spells the host id", build: () => CANONICAL },
    { name: "a number", build: () => 42 },
    { name: "a boolean", build: () => true },
    { name: "a symbol", build: () => Symbol(CANONICAL) },
    { name: "a bigint", build: () => BigInt(7) },
    { name: "an array", build: () => [] },
    {
      name: "a function carrying the identity properties",
      build: () => Object.assign(function adapterish() {}, { host: CANONICAL, hostId: CANONICAL }),
    },
    { name: "an empty object", build: () => ({}) },
    { name: "a null-prototype object with identity only", build: () => Object.assign(Object.create(null), { host: CANONICAL, hostId: CANONICAL }) },

    // --- malformed identity members ----------------------------------------
    {
      name: "hostId is an object that stringifies to the host id",
      build: (calls) => Object.assign(tripwire(calls), { hostId: { toString: () => CANONICAL } }),
    },
    {
      name: "host is missing entirely",
      build: (calls) => {
        const adapter = tripwire(calls) as unknown as Record<string, unknown>;
        delete adapter["host"];
        return adapter;
      },
    },
    {
      name: "hostId is a throwing getter",
      build: (calls) => {
        const adapter = tripwire(calls);
        Object.defineProperty(adapter, "hostId", {
          get(): never {
            throw new Error("hostId getter detonated");
          },
          configurable: true,
        });
        return adapter;
      },
    },

    // --- exotic objects -----------------------------------------------------
    {
      name: "an object that INHERITS every method from a real adapter",
      build: (calls) =>
        Object.defineProperties(Object.create(tripwire(calls)), {
          host: { value: CANONICAL, enumerable: true },
          hostId: { value: CANONICAL, enumerable: true },
        }),
    },
    {
      name: "a proxy that synthesizes methods from a get trap and owns nothing",
      build: (calls) =>
        new Proxy(
          {},
          {
            get: (_target, key) => {
              if (key === "host" || key === "hostId") return CANONICAL;
              return (): null => {
                calls.push(String(key));
                return null;
              };
            },
          }
        ),
    },
    {
      name: "a proxy whose every trap throws",
      build: () =>
        new Proxy(
          {},
          {
            get(): never {
              throw new Error("get trap detonated");
            },
            getOwnPropertyDescriptor(): never {
              throw new Error("gopd trap detonated");
            },
            has(): never {
              throw new Error("has trap detonated");
            },
            ownKeys(): never {
              throw new Error("ownKeys trap detonated");
            },
          }
        ),
    },

    // --- identity mismatch --------------------------------------------------
    { name: "a real adapter for a DIFFERENT host", build: (calls) => tripwire(calls, "codex-cli") },
    {
      name: "a well-shaped adapter claiming an unknown host id",
      build: (calls) => Object.assign(tripwire(calls), { host: "not-a-host", hostId: "not-a-host" }),
    },
  ];

  /** One missing / non-callable / accessor-aliased case per public operation. */
  const PER_OPERATION_CASES: readonly ShapeCase[] = HOST_ADAPTER_OPERATIONS.flatMap((operation) => [
    {
      name: `${operation}() is missing`,
      build: (calls: string[]) => {
        const adapter = tripwire(calls) as unknown as Record<string, unknown>;
        delete adapter[operation];
        return adapter;
      },
    },
    {
      name: `${operation} is present but not callable`,
      build: (calls: string[]) => Object.assign(tripwire(calls), { [operation]: 42 }),
    },
    {
      name: `${operation} is a GETTER aliased to look like a method`,
      build: (calls: string[]) => {
        const adapter = tripwire(calls);
        Object.defineProperty(adapter, operation, {
          get: () => (): null => {
            calls.push(operation);
            return null;
          },
          configurable: true,
        });
        return adapter;
      },
    },
    {
      name: `${operation} is a throwing getter`,
      build: (calls: string[]) => {
        const adapter = tripwire(calls);
        Object.defineProperty(adapter, operation, {
          get(): never {
            throw new Error(`${operation} getter detonated`);
          },
          configurable: true,
        });
        return adapter;
      },
    },
  ]);

  const ALL_CASES = [...MALFORMED_CASES, ...PER_OPERATION_CASES];

  test.each(ALL_CASES.map((shapeCase) => [shapeCase.name, shapeCase] as const))(
    "fails closed for a provider returning %s",
    (_name, shapeCase) => {
      const calls: string[] = [];
      let value: unknown;
      expect(() => {
        value = shapeCase.build(calls);
      }).not.toThrow();

      let bound: ReturnType<typeof bindHostRuntimeAdapter> | undefined;
      // No provider or property-access exception may cross the boundary.
      expect(() => {
        bound = bindProvided(value, shapeCase.host ?? CANONICAL);
      }).not.toThrow();

      const result = bound!;
      expect(result.disposition).not.toBe("succeeded");
      expect(result.binding).toBeNull();
      expect(result.reason_code).not.toBeNull();
      // The refusal is spelled in the core's CLOSED vocabulary, not a private one.
      expect(isNeutralReasonCode(result.reason_code)).toBe(true);
      expect(HOST_ADAPTER_REASON_CODES).toContain(result.reason_code);
      // …and deciding that ran no adapter operation.
      expect(calls).toEqual([]);
    }
  );

  test("the matrix actually covers every public member of the interface", () => {
    // A shape check is only total if the matrix is: one damaged case per
    // operation, or a member could be dropped from both without a test noticing.
    for (const operation of HOST_ADAPTER_OPERATIONS) {
      expect(PER_OPERATION_CASES.filter((c) => c.name.startsWith(`${operation} `) || c.name.startsWith(`${operation}(`)).length).toBe(4);
    }
    expect(ALL_CASES.length).toBe(MALFORMED_CASES.length + HOST_ADAPTER_OPERATIONS.length * 4);
  });

  test("a VALID adapter still binds, and shape validation runs none of its operations", () => {
    const calls: string[] = [];
    const bound = bindHostRuntimeAdapter({
      host: CANONICAL,
      runId: "shape-positive",
      provider: () => tripwire(calls),
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("succeeded");
    expect(bound.reason_code).toBeNull();
    expect(bound.binding).not.toBeNull();
    // Validation is passive: no effectful adapter method was called to prove shape.
    expect(calls).toEqual([]);
  });

  test("the real factory adapter binds for every planner host after shape validation", () => {
    for (const hostId of HOST_IDS) {
      const bound = bindHostRuntimeAdapter({
        host: hostId,
        runId: `shape-sweep-${hostId}`,
        provider: createRealHostAdapter,
        snapshots: createHostCapabilitySnapshotStore(),
      });
      expect(bound.disposition).toBe("succeeded");
      expect(bound.binding).not.toBeNull();
    }
  });

  test("the fail-closed contract-local adapter is also shape-valid", () => {
    const bound = bindHostRuntimeAdapter({
      host: CANONICAL,
      runId: "shape-contract-default",
      provider: createFailClosedDefaultAdapter,
      snapshots: createHostCapabilitySnapshotStore(),
    });
    expect(bound.disposition).toBe("succeeded");
    expect(bound.binding).not.toBeNull();
  });

  test("a malformed provider result cannot reach a caller that trusts `succeeded`", () => {
    // The round-2 crash reproduced end to end: bind, then USE the binding the
    // way `hostAdapterRuntimeReceipt()` does. Fail-closed means the caller never
    // gets the chance.
    const bound = bindProvided({ host: CANONICAL, hostId: CANONICAL });
    expect(bound.disposition).not.toBe("succeeded");
    expect(() => {
      if (bound.disposition === "succeeded" && bound.binding !== null) {
        bound.binding.adapter.capabilities();
      }
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Public-surface fence: MH-03 is reachable only through the module index.
// ---------------------------------------------------------------------------

describe("MH-03 public surface", () => {
  test("the module index re-exports every MH-03 boundary symbol", () => {
    const index = readSource("src/modules/host-runtime/index.ts");
    for (const workflow of [
      "./workflows/host-adapter-boundary",
      "./workflows/host-capability-snapshot",
      "./workflows/host-event-normalizer",
    ]) {
      expect(index).toContain(workflow);
    }
  });

  test("the host-runtime manifest declares the lifecycle dependency it type-imports", () => {
    const manifest = JSON.parse(readSource("src/modules/host-runtime/module.manifest.json"));
    expect(manifest.depends_on).toContain("lifecycle");
  });
});
