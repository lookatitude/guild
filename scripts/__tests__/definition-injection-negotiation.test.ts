/**
 * scripts/__tests__/definition-injection-negotiation.test.ts
 *
 * Conformance for the ADDITIVE definition-injection path (decision cap-loc-D11,
 * spec S7). Assertion ids map to the wave-5 conformance matrix §S7.
 *
 * The two NEVER-TRIM assertions live here:
 *
 *   A7.6 (B4)  the definition rides in the FIELD, and `prompt` does NOT contain
 *              the definition body. Without the negative half this passes on
 *              today's prompt-text smuggling and proves nothing changed.
 *
 *   A7.7 (B8)  an undeclared port REFUSES **and the substrate's spawn is NEVER
 *              INVOKED**. Asserting only the returned status passes even if a
 *              stripped lane was launched — which is the exact silent-omission
 *              failure the additive path exists to prevent.
 */

import {
  EXECUTION_OPERATIONS,
  EXECUTION_OUTCOME_STATUSES,
  EXECUTION_REASON_CODES,
  EXECUTION_TRANSPORT_CONTRACT_VERSION,
  isExecutionContractCompatible,
  resolveInjectionSupport,
  type DefinitionRefLike,
  type ExecutionSpawnRequest,
  type ExecutionTransportPort,
  type PaneSpecLike,
} from "../../src/modules/dispatch/workflows/execution-transport-ports";

const DEF_BODY = "You are the plugin-runtime-architect. Adopt these boundaries.";

const REF: DefinitionRefLike = {
  schema_version: "guild.project_definition_ref.v1",
  project_id: "plugin",
  layer: "project-guild",
  kind: "agent",
  id: "plugin-runtime-architect",
  relative_path: ".guild/agents/plugin-runtime-architect.md",
  content_hash: `sha256:${"a".repeat(64)}`,
  source_commit: "7dea43a",
  specialist_profile_hash: "c".repeat(64),
  specialist_type_hash: "d".repeat(64),
  skills: [],
};

function pane(over: Partial<PaneSpecLike> = {}): PaneSpecLike {
  return {
    name: "lane-1",
    scope: "build",
    runId: "run-x",
    slug: "s",
    prompt: "Do the work.",
    hostKind: "claude",
    ...over,
  };
}

/** A port that declares injection support. */
const declaring = { supports_definition_injection: true } as Pick<
  ExecutionTransportPort,
  "supports_definition_injection"
>;

/** A legacy port — the field is simply absent, as on every port shipped before D11. */
const legacy = {} as Pick<ExecutionTransportPort, "supports_definition_injection">;

// ── A7.1–A7.4 — the frozen vocabularies are UNCHANGED ───────────────────────

describe("A7.1-A7.4 — no closed vocabulary was widened", () => {
  it("A7.1 EXECUTION_OPERATIONS is still exactly the seven", () => {
    expect([...EXECUTION_OPERATIONS]).toEqual([
      "spawn",
      "send",
      "wait",
      "interrupt",
      "close",
      "connect",
      "probe",
    ]);
  });

  it("A7.2 contract major is still 1 and compatibility is EXACT equality", () => {
    expect(EXECUTION_TRANSPORT_CONTRACT_VERSION).toBe(1);
    expect(isExecutionContractCompatible(1)).toBe(true);
    expect(isExecutionContractCompatible(2)).toBe(false);
    expect(isExecutionContractCompatible(0)).toBe(false);
  });

  // CODEX-REVIEW FIX (round 1, MEDIUM): these previously asserted only LENGTH plus
  // a couple of members, so swapping one code for another while keeping the count
  // would have passed — which does not substantiate "the closed vocabulary is
  // unchanged". Compare the COMPLETE ORDERED SETS, as A7.1 already does.
  it("A7.3 EXECUTION_REASON_CODES is EXACTLY unchanged — a new code means escalate, not accommodate", () => {
    expect([...EXECUTION_REASON_CODES]).toEqual([
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
    ]);
  });

  it("A7.4 EXECUTION_OUTCOME_STATUSES is EXACTLY unchanged", () => {
    expect([...EXECUTION_OUTCOME_STATUSES]).toEqual([
      "succeeded",
      "failed",
      "cancelled",
      "timed_out",
      "unsupported",
    ]);
  });
});

// ── A7.5 — absent declaration means FALSE ───────────────────────────────────

describe("A7.5 — supports_definition_injection is fail-closed", () => {
  it("absent ⇒ refuse", () => {
    const v = resolveInjectionSupport({ definition_ref: REF }, legacy);
    expect(v.kind).toBe("refuse");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["truthy string", "yes"],
    ["1", 1],
    ["false", false],
  ])("%s ⇒ refuse (strict === true required)", (_l, val) => {
    const port = { supports_definition_injection: val } as never;
    expect(resolveInjectionSupport({ definition_ref: REF }, port).kind).toBe("refuse");
  });

  it("=== true ⇒ carry", () => {
    expect(resolveInjectionSupport({ definition_ref: REF }, declaring).kind).toBe("carry");
  });
});

// ── A7.7 / B8 — NEVER-TRIM: refuse AND never invoke the substrate ───────────

describe("A7.7 (B8) NEVER-TRIM — undeclared port refuses and the spawn is NEVER invoked", () => {
  /**
   * A minimal runtime that does what the real dispatch facade must do: consult
   * the negotiation BEFORE touching the substrate. The spy proves non-invocation.
   */
  function dispatch(
    request: ExecutionSpawnRequest,
    port: Pick<ExecutionTransportPort, "supports_definition_injection">,
    substrateSpawn: jest.Mock
  ) {
    const verdict = resolveInjectionSupport(request, port);
    if (verdict.kind === "refuse") {
      return { status: verdict.status, reason_code: verdict.reason_code };
    }
    substrateSpawn(request);
    return { status: "succeeded" as const, reason_code: null };
  }

  it("returns unsupported / capability_absent", () => {
    const spy = jest.fn();
    const out = dispatch({ handle_id: "h", definition_ref: REF }, legacy, spy);
    expect(out.status).toBe("unsupported");
    expect(out.reason_code).toBe("capability_absent");
  });

  it("NEVER invokes the substrate's spawn — asserting the return value alone is NOT enough", () => {
    const spy = jest.fn();
    dispatch({ handle_id: "h", definition_ref: REF }, legacy, spy);
    expect(spy).toHaveBeenCalledTimes(0); // ← the assertion that makes additive safe
  });

  it("does NOT strip definition_ref and continue", () => {
    const spy = jest.fn();
    dispatch({ handle_id: "h", definition_ref: REF }, legacy, spy);
    // If a stripped lane had launched, the spy would hold a request without the ref.
    expect(spy.mock.calls).toHaveLength(0);
  });

  it("a declaring port DOES spawn, carrying the ref intact", () => {
    const spy = jest.fn();
    const out = dispatch({ handle_id: "h", definition_ref: REF }, declaring, spy);
    expect(out.status).toBe("succeeded");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].definition_ref).toEqual(REF);
  });
});

// ── A7.6 / B4 — NEVER-TRIM: the FIELD carries it, the prompt does not ───────

describe("A7.6 (B4) NEVER-TRIM — definition rides in the field, NOT in prompt text", () => {
  it("the pane carries definition_ref as a FIELD", () => {
    const p = pane({ definition_ref: REF });
    expect(p.definition_ref).toEqual(REF);
  });

  it("NEGATIVE HALF: prompt does not contain the definition body", () => {
    const p = pane({ definition_ref: REF });
    // Without this assertion the test passes on today's prompt-text smuggling.
    expect(p.prompt).not.toContain(DEF_BODY);
    expect(p.prompt).not.toContain(REF.relative_path);
  });

  it("detects the regression: a pane that smuggles the body in prompt FAILS the negative half", () => {
    const smuggled = pane({ prompt: `Adopt this definition:\n${DEF_BODY}` });
    // Demonstrates the assertion has teeth — this is what today's behaviour looks like.
    expect(smuggled.prompt).toContain(DEF_BODY);
    expect(smuggled.definition_ref).toBeUndefined();
  });

  it("A7.9 pane parity: a pane-borne ref is negotiated too (the D9 hole)", () => {
    // Checking only request.definition_ref would leave the pane path unprotected.
    const req: ExecutionSpawnRequest = { handle_id: "h", pane: pane({ definition_ref: REF }) };
    expect(resolveInjectionSupport(req, legacy).kind).toBe("refuse");
    expect(resolveInjectionSupport(req, declaring).kind).toBe("carry");
  });
});

// ── A7.10 — full backward compatibility ─────────────────────────────────────

describe("A7.10 — no definition_ref ⇒ every existing port behaves exactly as today", () => {
  it("a bare request on a legacy port is not_requested", () => {
    expect(resolveInjectionSupport({ handle_id: "h" } as ExecutionSpawnRequest, legacy)).toEqual({
      kind: "not_requested",
    });
  });

  it("a pane without a ref on a legacy port is not_requested", () => {
    const req: ExecutionSpawnRequest = { handle_id: "h", pane: pane() };
    expect(resolveInjectionSupport(req, legacy)).toEqual({ kind: "not_requested" });
  });

  it("absence is ALWAYS fine; presence-without-declaration is ALWAYS refused", () => {
    // The intentional asymmetry: there is no third answer and no best-effort path.
    expect(resolveInjectionSupport({ handle_id: "h" } as ExecutionSpawnRequest, legacy).kind).toBe(
      "not_requested"
    );
    expect(resolveInjectionSupport({ definition_ref: REF }, legacy).kind).toBe("refuse");
  });
});

// ── purity ──────────────────────────────────────────────────────────────────

describe("resolveInjectionSupport is pure and total", () => {
  it("never throws on odd input", () => {
    expect(() => resolveInjectionSupport({} as never, {} as never)).not.toThrow();
    expect(() => resolveInjectionSupport({ pane: undefined } as never, {} as never)).not.toThrow();
  });

  it("is deterministic", () => {
    const a = resolveInjectionSupport({ definition_ref: REF }, declaring);
    const b = resolveInjectionSupport({ definition_ref: REF }, declaring);
    expect(a).toEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REAL-PATH CONFORMANCE (codex adversarial review round 1, CRITICAL-1)
//
// Everything above this line exercises `resolveInjectionSupport` through a
// TEST-LOCAL facade. Codex correctly refused that as proof: it demonstrates the
// helper, not the wiring, and `port.spawn(request)` remained directly callable.
//
// These tests drive REAL SHIPPED TRANSPORTS. If the guard is ever removed from
// the production spawn path, these go red — the isolation tests above would not.
// ═══════════════════════════════════════════════════════════════════════════

import {
  PaneExecutionTransport,
  InProcessExecutionTransport,
  recordingObservationSink,
} from "../../src/modules/dispatch/workflows/execution-transport-adapters";
import { ClaudePaneAdapter } from "../lib/pane-adapter";
import { portHonoredInjection } from "../../src/modules/dispatch/workflows/execution-transport-ports";

const REAL_PANE: PaneSpecLike = {
  name: "architect",
  scope: "build",
  runId: "run-real",
  slug: "s",
  prompt: "Do the work.",
  hostKind: "claude",
};

function realPaneTransport(spawnSpy?: jest.Mock) {
  const run = spawnSpy ?? jest.fn(() => ({ status: 0, stdout: "", stderr: "" }));
  return {
    run,
    transport: new PaneExecutionTransport({
      adapter: new ClaudePaneAdapter({ run: () => ({ status: 0, stdout: "", stderr: "" }) }),
      run: run as never,
    }),
  };
}

describe("REAL PATH — a shipped transport refuses a bundle it did not declare", () => {
  it("PaneExecutionTransport.spawn REFUSES a request-borne definition_ref", () => {
    const { transport } = realPaneTransport();
    const out = transport.spawn({ handle_id: "h", host_kind: "claude", pane: REAL_PANE, definition_ref: REF });
    expect(out.status).toBe("unsupported");
    expect(out.reason_code).toBe("capability_absent");
  });

  it("PaneExecutionTransport.spawn REFUSES a pane-borne definition_ref (the D9 hole)", () => {
    const { transport } = realPaneTransport();
    const out = transport.spawn({
      handle_id: "h",
      host_kind: "claude",
      pane: { ...REAL_PANE, definition_ref: REF },
    });
    expect(out.status).toBe("unsupported");
    expect(out.reason_code).toBe("capability_absent");
  });

  it("NEVER-TRIM: the real substrate runner is NEVER invoked on refusal", () => {
    const spy = jest.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    const { transport } = realPaneTransport(spy);
    transport.spawn({ handle_id: "h", host_kind: "claude", pane: REAL_PANE, definition_ref: REF });
    // Asserting only the returned status would pass even if a stripped lane launched.
    expect(spy).toHaveBeenCalledTimes(0);
  });

  it("a bundle-free spawn still succeeds — full backward compatibility on the real path", () => {
    const { transport } = realPaneTransport();
    const out = transport.spawn({ handle_id: "h", host_kind: "claude", pane: REAL_PANE });
    expect(out.status).toBe("succeeded");
  });

  it("InProcessExecutionTransport refuses too — the guard is on the BASE class, so every transport inherits it", () => {
    const transport = new InProcessExecutionTransport({
      backend: { launch: () => ({ ok: true, sessions: [] }) } as never,
    });
    const out = transport.spawn({ handle_id: "h", definition_ref: REF, payload: {} });
    expect(out.status).toBe("unsupported");
    expect(out.reason_code).toBe("capability_absent");
  });

  it("emits the refusal to the observation sink (it is an observed fact, not a silent return)", () => {
    const sink = recordingObservationSink();
    const transport = new PaneExecutionTransport({
      adapter: new ClaudePaneAdapter({ run: () => ({ status: 0, stdout: "", stderr: "" }) }),
      run: (() => ({ status: 0, stdout: "", stderr: "" })) as never,
      sink,
    });
    transport.spawn({ handle_id: "h", host_kind: "claude", pane: REAL_PANE, definition_ref: REF });
    expect(sink.records.some((r) => r.reason_code === "capability_absent")).toBe(true);
  });

  it("conflicting refs on request AND pane are refused as invalid_request, never resolved by precedence", () => {
    const { transport } = realPaneTransport();
    const other = { ...REF, content_hash: `sha256:${"b".repeat(64)}` };
    const out = transport.spawn({
      handle_id: "h",
      host_kind: "claude",
      pane: { ...REAL_PANE, definition_ref: other },
      definition_ref: REF,
    });
    expect(out.status).toBe("unsupported");
    expect(out.reason_code).toBe("invalid_request");
  });
});

// ── CRITICAL-2 — declaring support is an OBLIGATION, and it is checkable ────

describe("portHonoredInjection — declaring true does not prove carriage", () => {
  it("detects a port that declared support and STRIPPED the bundle", () => {
    const original = { definition_ref: REF };
    const forwardedStripped = { definition_ref: undefined };
    expect(portHonoredInjection(original, forwardedStripped)).toBe(false);
  });

  it("detects a port that SWAPPED the bundle for a different one", () => {
    const other = { ...REF, content_hash: `sha256:${"c".repeat(64)}` };
    expect(portHonoredInjection({ definition_ref: REF }, { definition_ref: other })).toBe(false);
  });

  it.each([
    ["specialist_profile_hash", "e".repeat(64)],
    ["specialist_type_hash", "f".repeat(64)],
  ])("detects a port that changed only %s", (field, value) => {
    const changed = { ...REF, [field]: value } as DefinitionRefLike;
    expect(portHonoredInjection({ definition_ref: REF }, { definition_ref: changed })).toBe(false);
  });

  it("detects a port that dropped the request entirely", () => {
    expect(portHonoredInjection({ definition_ref: REF }, undefined)).toBe(false);
  });

  it("passes when the ref is forwarded intact", () => {
    expect(portHonoredInjection({ definition_ref: REF }, { definition_ref: REF })).toBe(true);
  });

  it("accepts a request→pane relocation as honored (same bytes, either slot)", () => {
    expect(
      portHonoredInjection({ definition_ref: REF }, { pane: pane({ definition_ref: REF }) })
    ).toBe(true);
  });

  it("is vacuously true when nothing was requested", () => {
    expect(portHonoredInjection({}, {})).toBe(true);
  });
});

// ── Codex adversarial review ROUND 2 — regression coverage ─────────────────

describe("CRITICAL-1 fix — the guard cannot be forgotten (template method)", () => {
  // A transport author implements only the substrate half (`spawnGuarded`). Under
  // the old shape they had to remember to call `guardInjection()` first, and
  // forgetting it shipped the hole silently. The base class now owns `spawn`, so a
  // transport is guarded even though its own code never mentions injection.

  it("a transport that never mentions injection still refuses a bundle", () => {
    // InProcessExecutionTransport's spawnGuarded contains no injection logic at
    // all — its refusal comes entirely from the base-owned template method.
    const transport = new InProcessExecutionTransport({
      backend: { launch: () => ({ ok: true, sessions: [] }) } as never,
    });
    const out = transport.spawn({ handle_id: "h", definition_ref: REF, payload: {} });
    expect(out.status).toBe("unsupported");
    expect(out.reason_code).toBe("capability_absent");
  });

  it("the base class exposes spawn — subclasses override spawnGuarded, never spawn", () => {
    // If a subclass ever re-overrides `spawn` directly it bypasses the guard, so
    // pin the shape: `spawn` is defined on the BASE prototype, not the subclass.
    const base = Object.getPrototypeOf(PaneExecutionTransport.prototype);
    expect(Object.prototype.hasOwnProperty.call(base, "spawn")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(PaneExecutionTransport.prototype, "spawn")).toBe(
      false
    );
  });
});

describe("HIGH-3 fix — refsConflict compares schema_version", () => {
  it("two refs differing ONLY by schema_version are a conflict", () => {
    const v2 = { ...REF, schema_version: "guild.project_definition_ref.v2" };
    const req: ExecutionSpawnRequest = {
      handle_id: "h",
      definition_ref: REF,
      pane: pane({ definition_ref: v2 }),
    };
    const v = resolveInjectionSupport(req, declaring);
    expect(v.kind).toBe("refuse");
    expect(v.kind === "refuse" && v.reason_code).toBe("invalid_request");
  });
});

describe("HIGH-4 fix — portHonoredInjection rejects INTERNAL conflicts", () => {
  const other = { ...REF, content_hash: `sha256:${"d".repeat(64)}` };

  it("rejects when the FORWARDED request carries two different refs", () => {
    // The old `??` pick returned true here: request slot correct, pane slot swapped.
    expect(
      portHonoredInjection(
        { definition_ref: REF },
        { definition_ref: REF, pane: pane({ definition_ref: other }) }
      )
    ).toBe(false);
  });

  it("rejects when the ORIGINAL request itself was internally conflicting", () => {
    expect(
      portHonoredInjection(
        { definition_ref: REF, pane: pane({ definition_ref: other }) },
        { definition_ref: REF }
      )
    ).toBe(false);
  });

  it("still passes when both sides are internally consistent and agree", () => {
    expect(
      portHonoredInjection(
        { definition_ref: REF, pane: pane({ definition_ref: REF }) },
        { definition_ref: REF, pane: pane({ definition_ref: REF }) }
      )
    ).toBe(true);
  });
});
