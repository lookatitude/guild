/**
 * hooks/lib/__tests__/tier-dispatch.test.ts
 *
 * #60 — pure-function unit tests for the tier-dispatch decision matrix and its
 * helpers. The REAL hook path is covered by
 * ../../__tests__/pre-tool-use-tier-guard.test.ts; this file exercises the
 * decision function and the model-identity / config-reading helpers in
 * isolation so each edge is pinned without spawning a process.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildDispatchLine,
  buildTierDispatchEvent,
  CLAUDE_TIER_FALLBACK,
  modelFamily,
  modelMatchesConfigured,
  readConfiguredTierModels,
  readDispatchModel,
  resolveTierDispatch,
  safeModelName,
  tierOfModel,
  type TierModelMap,
} from "../tier-dispatch";
import type { DispatchAttribution } from "../dispatch-attribution";

const CLAUDE_MAP: TierModelMap = { ...CLAUDE_TIER_FALLBACK };

/** A structured (blockable) attribution — the composed-lane shape. */
function structuredAttr(over: Partial<DispatchAttribution> = {}): DispatchAttribution {
  return {
    subagentType: "general-purpose",
    isGeneric: true,
    specialist: "devops",
    taskId: "wi-1",
    isSpecialistLane: true,
    hasAdoptionPrompt: true,
    hasValidDefinition: true,
    hasConsistentIdentity: true,
    hasLaneSignature: true,
    ...over,
  };
}

/** tool_input with a structured GUILD_* env carrier (→ evidence "structured"). */
function structuredInput(over: Record<string, unknown> = {}): unknown {
  return {
    subagent_type: "general-purpose",
    prompt: "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n…",
    env: {
      GUILD_RUN_ID: "test-run",
      GUILD_SPECIALIST: "devops",
      GUILD_TASK_ID: "wi-1",
      GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
    },
    ...over,
  };
}

const baseFacts = {
  attr: structuredAttr(),
  prompt: "",
  runId: "test-run",
  tierModels: CLAUDE_MAP,
  overrideEngaged: false,
  runFresh: true,
};

describe("model identity", () => {
  it("recognizes the four Guild families in bare and qualified spellings", () => {
    expect(modelFamily("haiku")).toBe("haiku");
    expect(modelFamily("claude-sonnet-5")).toBe("sonnet");
    expect(modelFamily("claude-opus-4-8")).toBe("opus");
    expect(modelFamily("claude-fable-5")).toBe("fable");
    expect(modelFamily("some-local-llm")).toBeUndefined();
  });

  it("a bare configured alias accepts any dispatched model of that family", () => {
    // configured (map value) is bare → dispatched qualified id satisfies it.
    expect(modelMatchesConfigured("sonnet", "claude-sonnet-5")).toBe(true);
    expect(modelMatchesConfigured("opus", "claude-opus-4-8")).toBe(true);
    expect(modelMatchesConfigured("haiku", "opus")).toBe(false);
  });

  it("a QUALIFIED configured pin requires exactness (directional — round 2 P1)", () => {
    // configured is a qualified pin → a moving bare alias must NOT satisfy it,
    // nor a different qualified version. Only exact matches pass.
    expect(modelMatchesConfigured("claude-sonnet-5", "sonnet")).toBe(false);
    expect(modelMatchesConfigured("claude-sonnet-5", "claude-sonnet-4-5")).toBe(false);
    expect(modelMatchesConfigured("claude-sonnet-5", "claude-sonnet-5")).toBe(true);
  });

  it("reverse-maps a model to a tier only when unambiguous", () => {
    const dup: TierModelMap = { cheap: "haiku", mid: "opus", powerful: "opus" };
    expect(tierOfModel(dup, "opus")).toBeUndefined(); // mid AND powerful → ambiguous
    expect(tierOfModel(dup, "haiku")).toBe("cheap");
  });

  it("only matches exactly when neither side has a recognizable family", () => {
    expect(modelMatchesConfigured("some-local-llm", "some-local-llm")).toBe(true);
    expect(modelMatchesConfigured("some-local-llm", "other-llm")).toBe(false);
    expect(modelMatchesConfigured("", "haiku")).toBe(false);
  });

  it("maps a model back to its tier in a given map", () => {
    expect(tierOfModel(CLAUDE_MAP, "claude-opus-4-8")).toBe("powerful");
    expect(tierOfModel(CLAUDE_MAP, "sonnet")).toBe("mid");
    expect(tierOfModel(CLAUDE_MAP, "some-local-llm")).toBeUndefined();
  });

  it("bounds an unsafe model string and reports MISSING for empty", () => {
    expect(safeModelName("sonnet")).toBe("sonnet");
    expect(safeModelName("claude-opus-4-8")).toBe("claude-opus-4-8"); // legit id untouched
    expect(safeModelName("")).toBe("MISSING");
    expect(safeModelName("bad model\nline")).toBe("<unsafe>");
  });

  it("scrubs a token-shaped model that passes the char allowlist (round 3, P1)", () => {
    const scrubbed = safeModelName("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH");
    expect(scrubbed).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH");
  });

  it("reads a whitespace model param as absent, not as a decision", () => {
    expect(readDispatchModel({ model: "   " })).toBeUndefined();
    expect(readDispatchModel({ model: "haiku" })).toBe("haiku");
    expect(readDispatchModel({})).toBeUndefined();
  });
});

describe("readConfiguredTierModels", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-tier-cfg-"));
    fs.mkdirSync(path.join(tmp, ".guild"), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("falls back to the Claude ladder for a Claude host with no settings", () => {
    expect(readConfiguredTierModels(tmp, "claude-code-cli")).toEqual(CLAUDE_TIER_FALLBACK);
  });

  it("does NOT invent a ladder for a non-Claude host with no settings", () => {
    expect(readConfiguredTierModels(tmp, "codex-cli")).toEqual({
      cheap: null,
      mid: null,
      powerful: null,
    });
  });

  it("honors a project remap of a tier's model for the host", () => {
    fs.writeFileSync(
      path.join(tmp, ".guild", "settings.json"),
      JSON.stringify({ models: { tiers: { mid: { "claude-code-cli": "opus" } } } }),
    );
    const map = readConfiguredTierModels(tmp, "claude-code-cli");
    expect(map.mid).toBe("opus");
    // untouched tiers keep the Claude fallback (anti-vacuity: the remap is real).
    expect(map.cheap).toBe("haiku");
  });

  it("honors the {model:…} object form of a tier entry", () => {
    fs.writeFileSync(
      path.join(tmp, ".guild", "settings.json"),
      JSON.stringify({ models: { tiers: { powerful: { "claude-code-cli": { model: "opus-x" } } } } }),
    );
    expect(readConfiguredTierModels(tmp, "claude-code-cli").powerful).toBe("opus-x");
  });
});

describe("resolveTierDispatch — the decision matrix", () => {
  it("passes a model-present dispatch (no tier carrier) as model_present + ok", () => {
    const r = resolveTierDispatch({
      ...baseFacts,
      toolInput: structuredInput({ model: "haiku" }),
    });
    expect(r.decision).toBe("pass");
    expect(r.reason).toBe("model_present"); // no GUILD_TIER to verify scoring
    expect(r.recorded).toBe(true);
    expect(r.dispatchedTier).toBe("cheap");
    expect(r.evidence).toBe("structured");
  });

  it("marks a model + matching declared tier as scored_compliant", () => {
    const r = resolveTierDispatch({
      ...baseFacts,
      toolInput: structuredInput({
        model: "sonnet",
        env: {
          GUILD_RUN_ID: "test-run",
          GUILD_SPECIALIST: "devops",
          GUILD_TASK_ID: "wi-1",
          GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          GUILD_TIER: "mid",
        },
      }),
    });
    expect(r.decision).toBe("pass");
    expect(r.reason).toBe("scored_compliant");
    expect(r.expectedModel).toBe("sonnet");
  });

  it("DENIES structured evidence with no model param", () => {
    const r = resolveTierDispatch({ ...baseFacts, toolInput: structuredInput() });
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("missing_model");
    expect(r.model).toBe("MISSING");
  });

  it("RECORDS (never denies) prompt-only evidence with no model", () => {
    // No env carrier, but the prompt carries the handoff-protocol block for the
    // active run → evidence "prompt_only".
    const promptOnly = {
      subagent_type: "general-purpose",
      prompt:
        "HANDOFF PROTOCOL (mandatory — single channel, strict fenced-JSON)\n" +
        "Your final action is writing your handoff receipt to the receipt file.\n" +
        ".guild/runs/test-run/handoffs/devops-wi-1.md",
    };
    const r = resolveTierDispatch({
      ...baseFacts,
      attr: structuredAttr({ isSpecialistLane: false, hasLaneSignature: false }),
      toolInput: promptOnly,
      prompt: promptOnly.prompt,
    });
    expect(r.evidence).toBe("prompt_only");
    expect(r.decision).toBe("allow_recorded");
    expect(r.reason).toBe("missing_model");
  });

  it("applies the override only to a structured violation", () => {
    const r = resolveTierDispatch({
      ...baseFacts,
      toolInput: structuredInput(),
      overrideEngaged: true,
    });
    expect(r.decision).toBe("allow_override");
  });

  it("RECORDS (never denies) a declared tier / dispatched model mismatch", () => {
    // The hook is not the authoritative effective map, so a mismatch is recorded
    // loudly, not blocked — a false deny on a legitimate remap is worse.
    const r = resolveTierDispatch({
      ...baseFacts,
      toolInput: structuredInput({
        model: "opus",
        env: {
          GUILD_RUN_ID: "test-run",
          GUILD_SPECIALIST: "devops",
          GUILD_TASK_ID: "wi-1",
          GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          GUILD_TIER: "mid",
        },
      }),
    });
    expect(r.decision).toBe("allow_recorded");
    expect(r.reason).toBe("tier_model_mismatch");
    expect(r.declaredTier).toBe("mid");
    expect(r.dispatchedTier).toBe("powerful");
    expect(r.expectedModel).toBe("sonnet");
  });

  it("bounds an unsafe task id in the result (finding #3)", () => {
    const bad = resolveTierDispatch({
      ...baseFacts,
      attr: structuredAttr({ taskId: "has space\nnewline" }),
      toolInput: structuredInput(),
    });
    expect(bad.taskId).toBe("<unsafe>");
  });

  it("scrubs token-shaped specialist and subagent_type in the receipt (round 4, P1)", () => {
    const token = "sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ";
    const r = resolveTierDispatch({
      ...baseFacts,
      attr: structuredAttr({ specialist: token, subagentType: token }),
      toolInput: structuredInput({ model: "haiku" }),
    });
    const evt = buildTierDispatchEvent({
      runId: "test-run",
      ts: "2026-07-21T00:00:00.000Z",
      spanId: "span",
      result: r,
      detail: "clean",
    });
    expect(evt.specialist).not.toContain(token);
    expect(evt.subagent_type).not.toContain(token);
  });

  it("redacts the receipt detail before it lands in the shareable sink (finding #3)", () => {
    const r = resolveTierDispatch({ ...baseFacts, toolInput: structuredInput() });
    const evt = buildTierDispatchEvent({
      runId: "test-run",
      ts: "2026-07-21T00:00:00.000Z",
      spanId: "span",
      result: r,
      detail: "leaked token sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKK in detail",
    });
    expect(evt.detail).not.toContain("sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJKKKK");
  });

  it("RECORDS a declared tier when the dispatched model is unknown to the map", () => {
    const r = resolveTierDispatch({
      ...baseFacts,
      toolInput: structuredInput({
        model: "some-local-llm",
        env: {
          GUILD_RUN_ID: "test-run",
          GUILD_SPECIALIST: "devops",
          GUILD_TASK_ID: "wi-1",
          GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          GUILD_TIER: "cheap",
        },
      }),
    });
    expect(r.decision).toBe("allow_recorded");
    expect(r.reason).toBe("tier_unverifiable");
  });

  it("records a PRESENT-but-invalid GUILD_TIER as tier_unverifiable, not model_present", () => {
    const r = resolveTierDispatch({
      ...baseFacts,
      toolInput: structuredInput({
        model: "haiku",
        env: {
          GUILD_RUN_ID: "test-run",
          GUILD_SPECIALIST: "devops",
          GUILD_TASK_ID: "wi-1",
          GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          GUILD_TIER: "superpowerful", // malformed
        },
      }),
    });
    expect(r.decision).toBe("allow_recorded");
    expect(r.reason).toBe("tier_unverifiable");
  });

  it("does not gate a non-lane dispatch (evidence none)", () => {
    const r = resolveTierDispatch({
      ...baseFacts,
      attr: structuredAttr({
        specialist: undefined,
        taskId: undefined,
        isSpecialistLane: false,
        hasAdoptionPrompt: false,
        hasLaneSignature: false,
      }),
      toolInput: { subagent_type: "general-purpose", prompt: "generic fan-out" },
    });
    expect(r.evidence).toBe("none");
    expect(r.recorded).toBe(false);
    expect(r.decision).toBe("pass");
  });

  it("does not gate a stale run even with a structured violation", () => {
    const r = resolveTierDispatch({
      ...baseFacts,
      toolInput: structuredInput(),
      runFresh: false,
    });
    expect(r.recorded).toBe(false);
    expect(r.decision).toBe("pass");
  });

  it("renders the dispatch line with dashes for absent fields", () => {
    const r = resolveTierDispatch({ ...baseFacts, toolInput: structuredInput() });
    expect(buildDispatchLine(r)).toBe("lane wi-1 · score - · tier - · model MISSING");
  });
});
