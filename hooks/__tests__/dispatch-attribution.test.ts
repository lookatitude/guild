/**
 * hooks/__tests__/dispatch-attribution.test.ts
 *
 * Unit tests for the #58 dispatch-attribution resolver — the pure logic behind
 * both the PreToolUse dispatch-integrity guard and the run-trace
 * attribution_specialist stamp. Exercises the real resolver (no injected seams).
 */

import {
  GENERIC_SUBAGENT_TYPE,
  isPersonaStrippedDispatch,
  resolveDispatchAttribution,
} from "../lib/dispatch-attribution";

describe("resolveDispatchAttribution", () => {
  it("returns null for non-Agent-shaped input", () => {
    expect(resolveDispatchAttribution(null)).toBeNull();
    expect(resolveDispatchAttribution(undefined)).toBeNull();
    expect(resolveDispatchAttribution("Read a.ts")).toBeNull();
    expect(resolveDispatchAttribution({ command: "ls" })).toBeNull();
  });

  it("resolves the role + definition from a correctly-carried project dispatch (env)", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "You are the `devops` teammate for run-id `run-x`. Your role definition is at " +
        "`.guild/agents/devops.md` — read it FIRST and adopt it fully.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "nim-wi-30",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr).not.toBeNull();
    expect(attr!.subagentType).toBe(GENERIC_SUBAGENT_TYPE);
    expect(attr!.isGeneric).toBe(true);
    expect(attr!.specialist).toBe("devops");
    expect(attr!.definitionPath).toBe(".guild/agents/devops.md");
    expect(attr!.taskId).toBe("nim-wi-30");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("flags a persona-stripped dispatch: adoption prompt but NO definition env", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "You are dispatched as the Guild **devops** specialist for lane **nim-wi-30**. " +
        "First READ and adopt the persona/constraints in `.guild/agents/devops.md`.",
      env: { GUILD_RUN_ID: "run-x" },
    });
    expect(attr!.isGeneric).toBe(true);
    expect(attr!.specialist).toBe("devops");
    expect(attr!.definitionPath).toBeUndefined();
    expect(attr!.isSpecialistLane).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("resolves role from the prose signature when the path is absent", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "You are dispatched as the Guild backend specialist for lane wi-7.",
    });
    expect(attr!.specialist).toBe("backend");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("treats GUILD_SPECIALIST+GUILD_TASK_ID env (no prompt signature) as adoption", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "do the work",
      env: { GUILD_SPECIALIST: "frontend", GUILD_TASK_ID: "wi-2" },
    });
    expect(attr!.specialist).toBe("frontend");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("does NOT flag a generic learn/fan-out lane (no adoption signature)", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "Analyse this subtree and return a CodebaseMap fragment.",
      env: { GUILD_RUN_ID: "run-x" },
    });
    expect(attr!.isGeneric).toBe(true);
    expect(attr!.isSpecialistLane).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("does NOT flag a generic dispatch that merely NAMES an agents file without adoption intent", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "Review the file .guild/agents/backend.md and report any typos.",
      env: { GUILD_RUN_ID: "run-x" },
    });
    expect(attr!.isSpecialistLane).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("does NOT flag a shipped agent dispatched by name (non-generic)", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: "developer",
      prompt: "You are dispatched as the Guild developer for lane wi-1.",
      env: { GUILD_SPECIALIST: "developer", GUILD_TASK_ID: "wi-1" },
    });
    expect(attr!.isGeneric).toBe(false);
    // adoption may be true, but a non-generic dispatch is never persona-stripped.
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("flags a composed lane whose adoption prompt was stripped even WITH a valid definition", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "do the work", // adoption prompt stripped
      env: {
        GUILD_SPECIALIST: "backend",
        GUILD_TASK_ID: "wi-9",
        GUILD_AGENT_DEFINITION: ".guild/agents/backend.md",
      },
    });
    expect(attr!.hasValidDefinition).toBe(true);
    expect(attr!.hasAdoptionPrompt).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("rejects a whitespace / arbitrary / role-mismatched definition as invalid proof", () => {
    const base = {
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "Your role definition is at `.guild/agents/backend.md` — read it FIRST and adopt it.",
      env: { GUILD_SPECIALIST: "backend", GUILD_TASK_ID: "wi-9" } as Record<string, string>,
    };
    // whitespace
    expect(
      resolveDispatchAttribution({ ...base, env: { ...base.env, GUILD_AGENT_DEFINITION: "   " } })!
        .hasValidDefinition,
    ).toBe(false);
    // arbitrary path
    expect(
      resolveDispatchAttribution({
        ...base,
        env: { ...base.env, GUILD_AGENT_DEFINITION: "/etc/passwd" },
      })!.hasValidDefinition,
    ).toBe(false);
    // role-mismatched path
    const mismatch = resolveDispatchAttribution({
      ...base,
      env: { ...base.env, GUILD_AGENT_DEFINITION: ".guild/agents/frontend.md" },
    });
    expect(mismatch!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(mismatch!)).toBe(true);
  });

  it("passes a role-matched, well-formed definition WITH adoption prompt", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "Your role definition is at `.guild/agents/backend.md` — read it FIRST and adopt it.",
      env: {
        GUILD_SPECIALIST: "backend",
        GUILD_TASK_ID: "wi-9",
        GUILD_AGENT_DEFINITION: ".guild/agents/backend.md",
      },
    });
    expect(attr!.hasValidDefinition).toBe(true);
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("never stamps an unsafe GUILD_SPECIALIST value into attribution", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "do the work",
      env: { GUILD_SPECIALIST: "sk-ant-SECRET or a\nnewline", GUILD_TASK_ID: "wi-9" },
    });
    expect(attr!.specialist).toBeUndefined();
  });

  // ── adversarial-review round 2 ────────────────────────────────────────────

  it("flags a WRONG-PERSONA dispatch: env/definition say backend, prompt adopts frontend", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "Your role definition is at `.guild/agents/frontend.md` — read it FIRST and adopt it.",
      env: {
        GUILD_SPECIALIST: "backend",
        GUILD_TASK_ID: "wi-9",
        GUILD_AGENT_DEFINITION: ".guild/agents/backend.md",
      },
    });
    expect(attr!.hasValidDefinition).toBe(true);
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(attr!.hasConsistentIdentity).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("flags the TRANSCRIPT-form wrong persona: prose says devops, adoption path says frontend", () => {
    // Issue #58 evidence wording — the producer states the role in prose and the
    // path separately; the two can drift apart (adversarial review round 3).
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "You are dispatched as the Guild **devops** specialist for lane **nim-wi-30**. " +
        "First READ and adopt the persona/constraints in `.guild/agents/frontend.md`.",
      env: {
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "nim-wi-30",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.hasValidDefinition).toBe(true);
    // Transcript prose carries no producer-owned adoption instruction, so it is
    // a lane signature only — never proof (round 5).
    expect(attr!.hasAdoptionPrompt).toBe(false);
    expect(attr!.isSpecialistLane).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("accepts the TRANSCRIPT-form once it carries the marker prefix and all roles agree", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
        "You are dispatched as the Guild **devops** specialist for lane **nim-wi-30**. " +
        "First READ and adopt the persona/constraints in `.guild/agents/devops.md`.",
      env: {
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "nim-wi-30",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(attr!.hasConsistentIdentity).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("PASSES a valid lane whose SCOPE text names a different agents file (not an adoption target)", () => {
    // buildPrompt appends the lane's arbitrary `scope` to the same prompt — a
    // devops lane scoped to reviewing frontend.md is still a valid devops lane
    // and must NOT be denied (adversarial review round 4).
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "You are the `devops` teammate for run-id `run-x`. Your role definition is at " +
        "`.guild/agents/devops.md` — read it FIRST and adopt it fully. " +
        "Your lane scope: `review .guild/agents/frontend.md for drift`.",
      env: {
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.hasConsistentIdentity).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("accepts a long (but contract-bounded) specialist name and still attributes it", () => {
    const longRole = "a".repeat(100);
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: `Your role definition is at \`.guild/agents/${longRole}.md\` — adopt it.`,
      env: {
        GUILD_SPECIALIST: longRole,
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: `.guild/agents/${longRole}.md`,
      },
    });
    expect(attr!.specialist).toBe(longRole);
    expect(attr!.hasValidDefinition).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("fails CLOSED on an out-of-bounds role: no proof, no attribution, denied", () => {
    const tooLong = "a".repeat(200);
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "You are dispatched as the Guild devops specialist for lane wi-1.",
      env: {
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: `.guild/agents/${tooLong}.md`,
      },
    });
    expect(attr!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  // ── adversarial-review round 5 ────────────────────────────────────────────

  it("accepts the machine-readable GUILD_AGENT_DEFINITION marker prefix as adoption proof", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
        "You are the `devops` teammate for run-id `run-x`. Your lane scope: `ship it`.",
      env: {
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(attr!.specialist).toBe("devops");
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("R5-1: prose ALONE is a lane signature but NOT adoption proof — still denied", () => {
    // "You are dispatched as the Guild devops specialist" never tells the lane to
    // read/adopt the definition, so matching env is not enough.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "You are dispatched as the Guild devops specialist for lane nim-wi-30. Go.",
      env: {
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "nim-wi-30",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.isSpecialistLane).toBe(true);
    expect(attr!.hasValidDefinition).toBe(true);
    expect(attr!.hasAdoptionPrompt).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("R5-2: a same-sentence adoption phrase in the lane SCOPE is not an identity carrier", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
        "You are the `devops` teammate for run-id `run-x`. Your lane scope: " +
        "`Update docs explaining how users adopt project rules from .guild/agents/frontend.md`.",
      env: {
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.hasConsistentIdentity).toBe(true);
    expect(attr!.specialist).toBe("devops");
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("R5-2: a marker naming a role different from the env still DENIES", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/frontend.md\n" +
        "You are the `devops` teammate for run-id `run-x`.",
      env: {
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.hasConsistentIdentity).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("does NOT flag a benign generic prompt that mentions an agents file AND the word persona", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "Review .guild/agents/backend.md. Adopt a skeptical reviewer persona.",
      env: { GUILD_RUN_ID: "run-x" },
    });
    expect(attr!.hasAdoptionPrompt).toBe(false);
    expect(attr!.isSpecialistLane).toBe(false);
    expect(attr!.specialist).toBeUndefined();
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("never attributes a specialist to a non-lane call that merely names an agents file", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "Review the file .guild/agents/backend.md for typos.",
    });
    expect(attr!.isSpecialistLane).toBe(false);
    expect(attr!.specialist).toBeUndefined();
  });

  it("does NOT flag a bare non-Guild Agent call", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "Explore the repo and summarise the auth flow.",
    });
    expect(attr!.hasLaneSignature).toBe(false);
    expect(attr!.isSpecialistLane).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });
});
