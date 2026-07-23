/**
 * hooks/lib/__tests__/g3-marker-blockable.test.ts
 *
 * rf-wi-03 (G3) — the GUARD half of the structured dispatch marker.
 *
 * Red-first proof of two defects:
 *   2. The universal producer marker (`GUILD_DISPATCH_PRODUCER`) is not read
 *      anywhere: a shipped-specialist dispatch whose only identity anchor is the
 *      line-1 producer marker resolves NO specialist, and a marker-only env is
 *      not treated as structured lane evidence.
 *   3. The backend-degradation guard can only RECORD prompt-only lane drift — a
 *      lane that carries NO structured producer marker cannot be blocked even
 *      when the operator asks for it, because the guard has no `blockUnmarked`
 *      rung.
 */

import { resolveDispatchAttribution } from "../dispatch-attribution";
import {
  buildAllowMessage,
  buildDenyMessage,
  classifyLaneEvidence,
  hasProducerMarker,
  hasStructuredCarrier,
  PRODUCER_MARKER_ENV,
  resolveBackendDegradation,
  TEAM_AGENT_MODE,
} from "../backend-degradation";

const RUN_ID = "run-x";

/** A shipped specialist's brief: the line-1 producer marker is the only anchor. */
const SHIPPED_BRIEF =
  "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=advisor\n" +
  "You are the `advisor` teammate for run-id `run-x`. Your lane scope: `review`.";

/** A hand-rolled drift lane: handoff block, but NO producer marker anywhere. */
const HANDOFF_BLOCK = `---
HANDOFF PROTOCOL (mandatory — single channel, strict fenced-JSON)

Your final action is writing your handoff receipt to the receipt file.
Receipt path (absolute): /repo/.guild/runs/run-x/handoffs/devops-wi-1.md
---`;
const HANDROLLED_LANE = {
  subagent_type: "general-purpose",
  prompt: `Implement the gate scripts for wi-30.\n\n${HANDOFF_BLOCK}`,
};

function attrOf(input: Record<string, unknown>) {
  const a = resolveDispatchAttribution(input);
  if (a === null) throw new Error("expected Agent-shaped tool_input");
  return a;
}

describe("G3 — universal line-1 producer marker is an identity anchor", () => {
  it("resolves the specialist from the line-1 producer marker alone", () => {
    const input = { subagent_type: "advisor", prompt: SHIPPED_BRIEF };
    expect(attrOf(input).specialist).toBe("advisor");
  });

  it("marks the marker-bearing prompt as a Guild lane signature", () => {
    const input = { subagent_type: "advisor", prompt: SHIPPED_BRIEF };
    expect(attrOf(input).hasLaneSignature).toBe(true);
  });

  it("tolerates extra k=v tokens before role= in the marker", () => {
    const input = {
      subagent_type: "advisor",
      prompt: "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 run=run-x role=advisor\nwork",
    };
    expect(attrOf(input).specialist).toBe("advisor");
  });

  it("REJECTS a malformed role token (no partial attribution)", () => {
    const input = {
      subagent_type: "general-purpose",
      prompt: "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=advisor/garbage\nwork",
    };
    // role= is not a clean token → the marker does not attribute a role.
    expect(attrOf(input).specialist).toBeUndefined();
  });
});

describe("G3 — the producer marker is structured lane evidence", () => {
  it("hasProducerMarker reads the dispatch-env marker", () => {
    const input = {
      subagent_type: "advisor",
      prompt: "Do the work.",
      env: { [PRODUCER_MARKER_ENV]: "guild.dispatch.v1" },
    };
    expect(hasProducerMarker(input)).toBe(true);
  });

  it("a marker-only env is a STRUCTURED carrier", () => {
    const input = {
      subagent_type: "advisor",
      prompt: "Do the work.",
      env: { [PRODUCER_MARKER_ENV]: "guild.dispatch.v1" },
    };
    expect(hasStructuredCarrier(input)).toBe(true);
    expect(classifyLaneEvidence(input, attrOf(input), input.prompt, RUN_ID)).toBe("structured");
  });

  it("a BOGUS marker value is NOT a producer marker (no forged structured evidence)", () => {
    const bogus = {
      subagent_type: "advisor",
      prompt: "Do the work.",
      env: { [PRODUCER_MARKER_ENV]: "not-a-real-token" },
    };
    expect(hasProducerMarker(bogus)).toBe(false);
    expect(hasStructuredCarrier(bogus)).toBe(false);
  });

  it("tolerates a future marker version prefix", () => {
    const v2 = {
      subagent_type: "advisor",
      prompt: "Do the work.",
      env: { [PRODUCER_MARKER_ENV]: "guild.dispatch.v2" },
    };
    expect(hasProducerMarker(v2)).toBe(true);
  });

  it("a hand-rolled lane with no marker is NOT structured (still prompt_only)", () => {
    expect(hasProducerMarker(HANDROLLED_LANE)).toBe(false);
    expect(
      classifyLaneEvidence(HANDROLLED_LANE, attrOf(HANDROLLED_LANE), HANDROLLED_LANE.prompt, RUN_ID),
    ).toBe("prompt_only");
  });
});

describe("G3 — prompt-only drift is BLOCKABLE when blockUnmarked is engaged", () => {
  const facts = (over: Partial<Parameters<typeof resolveBackendDegradation>[0]> = {}) => ({
    toolInput: HANDROLLED_LANE as unknown,
    attr: attrOf(HANDROLLED_LANE),
    prompt: HANDROLLED_LANE.prompt,
    runId: RUN_ID,
    agentMode: TEAM_AGENT_MODE as string | null,
    substrate: "tmux" as const,
    overrideEngaged: false,
    isLead: true,
    runFresh: true,
    blockUnmarked: false,
    ...over,
  });

  it("DEFAULT (blockUnmarked off) still only RECORDS prompt-only drift", () => {
    const r = resolveBackendDegradation(facts());
    expect(r.decision).toBe("allow_recorded");
    expect(r.evidence).toBe("prompt_only");
  });

  it("blockUnmarked engaged → DENIES an unmarked prompt-only lane", () => {
    const r = resolveBackendDegradation(facts({ blockUnmarked: true }));
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("team_substrate_available");
  });

  it("blockUnmarked + override → allow_override (auditable, not silent)", () => {
    const r = resolveBackendDegradation(facts({ blockUnmarked: true, overrideEngaged: true }));
    expect(r.decision).toBe("allow_override");
  });

  it("blockUnmarked does NOT touch team+NO-substrate (launcher downgrades that)", () => {
    const r = resolveBackendDegradation(facts({ blockUnmarked: true, substrate: "none" }));
    expect(r.decision).toBe("allow_recorded");
    expect(r.reason).toBe("team_substrate_unavailable");
  });

  it("the prompt-only DENY message names the missing producer marker", () => {
    const m = buildDenyMessage("team_substrate_available", "devops", "general-purpose", "tmux", "prompt_only");
    expect(m).toContain(PRODUCER_MARKER_ENV);
    expect(m).toContain("GUILD_BLOCK_UNMARKED_LANES");
    expect(m).toContain("Blocking this dispatch");
  });

  it("the prompt-only OVERRIDE message says OVERRIDDEN, not 'recorded, not blocked'", () => {
    const m = buildAllowMessage(
      "team_substrate_available",
      "devops",
      "general-purpose",
      "tmux",
      "prompt_only",
      "allow_override",
    );
    expect(m).toContain("OVERRIDDEN");
    expect(m).not.toContain("recorded, not blocked");
  });

  it("a MARKED lane is unaffected by blockUnmarked (it is structured)", () => {
    const marked = {
      subagent_type: "general-purpose",
      prompt: SHIPPED_BRIEF,
      env: { GUILD_SPECIALIST: "advisor", GUILD_TASK_ID: "wi-1", [PRODUCER_MARKER_ENV]: "guild.dispatch.v1" },
    };
    // structured evidence already denies under team+substrate; blockUnmarked is a
    // no-op for it — the point is it is NOT reclassified or double-counted.
    const r = resolveBackendDegradation(
      facts({ toolInput: marked, attr: attrOf(marked), prompt: SHIPPED_BRIEF, blockUnmarked: true }),
    );
    expect(r.evidence).toBe("structured");
    expect(r.decision).toBe("deny");
  });
});
