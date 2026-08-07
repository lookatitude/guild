/**
 * hooks/__tests__/dispatch-attribution.test.ts
 *
 * Unit tests for the #58 dispatch-attribution resolver — the pure logic behind
 * both the PreToolUse dispatch-integrity guard and the run-trace
 * attribution_specialist stamp. Exercises the real resolver (no injected seams).
 */

import {
  GENERIC_SUBAGENT_TYPE,
  dispatchViolations,
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
      // Exactly what `buildPrompt` emits for a project specialist: the line-1
      // adoption marker, then the human-readable instruction.
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
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
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
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

  it("resolves role from the line-1 adoption marker when the definition env is absent", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/backend.md\n" +
        "You are dispatched as the Guild backend specialist for lane wi-7.",
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
        "GUILD_AGENT_DEFINITION=.guild/agents/backend.md\n" +
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
        "GUILD_AGENT_DEFINITION=.guild/agents/frontend.md\n" +
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

  it("flags the TRANSCRIPT-form dispatch: prose persona claim is NOT adoption proof", () => {
    // Issue #58 evidence wording. Since rf-wi-06 the prose is inert entirely —
    // it is neither identity nor proof — so this dispatch is a lane only via its
    // composed-lane env pair, and it is denied for the MISSING adoption marker.
    // The wrong-persona (identity_mismatch) case is covered separately, on the
    // producer-owned carriers that can actually disagree — see the "(c) the
    // line-1 marker and the definition env disagreeing" test below.
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
    expect(attr!.hasAdoptionPrompt).toBe(false);
    expect(attr!.isSpecialistLane).toBe(true);
    // The stray `.guild/agents/frontend.md` in prose is NOT an identity carrier,
    // so identity stays consistent — the denial is specifically the missing marker.
    expect(attr!.hasConsistentIdentity).toBe(true);
    expect(dispatchViolations(attr!)).toEqual(["missing_adoption_prompt"]);
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
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
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
      prompt:
        `GUILD_AGENT_DEFINITION=.guild/agents/${longRole}.md\n` +
        `Your role definition is at \`.guild/agents/${longRole}.md\` — adopt it.`,
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

  it("fails CLOSED on an out-of-bounds role in the definition env: no proof, denied", () => {
    // The line-1 marker makes this a lane and attributes it to `devops`; the
    // definition env's role is past the identifier bound, so it is NOT valid
    // proof and the dispatch is denied rather than let through on a
    // shape-matching but unbounded path.
    const tooLong = "a".repeat(200);
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
        "You are dispatched as the Guild devops specialist for lane wi-1.",
      env: {
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: `.guild/agents/${tooLong}.md`,
      },
    });
    expect(attr!.specialist).toBe("devops");
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

  // ── rf-wi-06 (issue #91) — the legacy producer-head parse is GONE ────────
  //
  // G3 (rf-wi-03) made the line-1 marker universal on every
  // composeInProcessDispatch/buildPrompt dispatch (team, tmux, in-process,
  // remote); rf-wi-06 marked the LAST uncovered class — the direct D5
  // `subagent` rung, a skill-authored inline `Agent()` call with no launcher
  // descriptor (`guild:execute-plan` SKILL.md §"Capability-scope env
  // injection" steps (2b)/(2c)). With every class marked, the class-gated
  // legacy 300-char producer-head parse (`ROLE_DEF_ANCHOR_RE` /
  // `DISPATCH_PROSE_RE`) is deleted: identity now comes from PRODUCER-OWNED
  // POSITIONS ONLY — the dispatch env and the prompt's FIRST LINE.
  //
  // (a) pins that legacy-shaped text is inert when a marker IS present, and
  // (b) that it is inert when NO marker is present — the property the
  // deletion actually adds. Prompt prose is no longer an identity carrier
  // anywhere.

  it("(b) legacy ANCHOR text alone (no line-1 marker) is INERT — no attribution, no lane", () => {
    // The pre-rf-wi-06 fallback attributed this to "devops" off the prose.
    // Post-deletion the only carriers are env + line 1, and this dispatch has
    // neither, so it is indistinguishable from an ordinary non-Guild Agent
    // call — which is exactly what an UNMARKED dispatch now is. A real Guild
    // lane on this rung always carries the marker; see the marked twin below.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "You are the `devops` teammate for run-id `run-x`. Your role definition is at " +
        "`.guild/agents/devops.md` — read it FIRST and adopt it fully.",
      env: { GUILD_RUN_ID: "run-x" },
    });
    expect(attr!.specialist).toBeUndefined();
    expect(attr!.hasAdoptionPrompt).toBe(false);
    expect(attr!.isSpecialistLane).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(b) legacy PROSE text alone (no line-1 marker) is INERT — no attribution, no lane", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "You are dispatched as the Guild backend specialist for lane wi-7.",
      env: { GUILD_RUN_ID: "run-x" },
    });
    expect(attr!.specialist).toBeUndefined();
    expect(attr!.isSpecialistLane).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(b) legacy text past the old 300-char head is equally inert — no bounded head remains for identity", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "x".repeat(400) +
        "\nYou are dispatched as the Guild backend specialist for lane wi-7.",
      env: { GUILD_RUN_ID: "run-x" },
    });
    expect(attr!.specialist).toBeUndefined();
    expect(attr!.isSpecialistLane).toBe(false);
  });

  it("(b) the MARKED direct-subagent rung still BLOCKS a persona-stripped dispatch", () => {
    // The rf-wi-06 shape: the skill stamps the line-1 marker itself, so the
    // #58 guard keeps its grip on this rung — a marker claiming `devops` with
    // no GUILD_AGENT_DEFINITION env to back it is still denied.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
        "You are the `devops` teammate for run-id `run-x`.",
      env: { GUILD_RUN_ID: "run-x", GUILD_TASK_ID: "wi-1" },
    });
    expect(attr!.specialist).toBe("devops");
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(attr!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(b) a role-bearing producer marker on a HOST-GENERIC dispatch is a class mismatch — blocked", () => {
    // Producer contract (inprocess-backend.ts + team-prompt.ts + execute-plan
    // step (2c)): the host-generic subagent_type is reserved for PROJECT
    // specialists, whose line 1 is the GUILD_AGENT_DEFINITION marker. A
    // `GUILD_DISPATCH_PRODUCER … role=` line 1 belongs to the by-name
    // shipped/orchestrator class, so its appearance on a `general-purpose`
    // dispatch means the lane claims a Guild persona with no adoption proof —
    // the drift `hasProseSignature` used to catch, now caught structurally.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=backend\nDo the lane.",
      env: { GUILD_RUN_ID: "run-x", GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1" },
    });
    expect(attr!.specialist).toBe("backend");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(a) ignores stray legacy anchor text once the GUILD_AGENT_DEFINITION line-1 marker resolves identity", () => {
    // The marker says "devops"; a stray legacy-shaped sentence later in the
    // prompt names a DIFFERENT role. Pre-G7c this would have been read as an
    // identity carrier and flagged identity_mismatch — a false positive on a
    // dispatch the marker already fully and correctly attributes.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
        "You are the `devops` teammate for run-id `run-x`. " +
        "Your lane scope: `note that a stale doc once said role definition is at " +
        ".guild/agents/frontend.md for the old flow`.",
      env: {
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.specialist).toBe("devops");
    expect(attr!.hasConsistentIdentity).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(a) ignores stray legacy prose text once the G3 producer marker resolves identity", () => {
    // A shipped/orchestrator-class dispatch carrying the G3 producer marker
    // (no GUILD_AGENT_DEFINITION line — that class never has one) plus a
    // stray "dispatched as the Guild <other-role> specialist" sentence later
    // in the prompt. The marker is authoritative; the stray prose must not
    // contribute a conflicting identity carrier.
    const attr = resolveDispatchAttribution({
      subagent_type: "devops",
      prompt:
        "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=devops\n" +
        "You are the `devops` teammate for run-id `run-x`. Your lane scope: " +
        "`archive the note that once said you are dispatched as the Guild frontend specialist`.",
      env: { GUILD_SPECIALIST: "devops", GUILD_TASK_ID: "wi-1" },
    });
    expect(attr!.specialist).toBe("devops");
    expect(attr!.hasConsistentIdentity).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(b) the MARKED direct-subagent rung with a correctly-carried definition PASSES", () => {
    // guild:execute-plan's direct `subagent` rung, post-rf-wi-06: the skill
    // stamps the line-1 marker and the definition env itself
    // (SKILL.md §"Capability-scope env injection" steps (2b)/(2c)), so the rung
    // is attributable without any prose parsing.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
        "You are the `devops` teammate for run-id `run-x`. Your role definition is at " +
        "`.guild/agents/devops.md` — read it FIRST and adopt it fully.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1",
        GUILD_SPECIALIST: "devops",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.specialist).toBe("devops");
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(attr!.isSpecialistLane).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(c) a REJECTED marker attempt now yields NO attribution at all (the legacy-prose residual is gone)", () => {
    // Pre-rf-wi-06 this dispatch's `specialist` was resolved from the unrelated
    // legacy sentence below the malformed marker — an accepted-but-untidy
    // residual (security-inert only because `isGeneric` is false). With prose
    // parsing deleted, a whole-line-rejected marker leaves nothing behind.
    const attr = resolveDispatchAttribution({
      subagent_type: "advisor",
      prompt:
        "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=advisor trailing-junk\n" +
        "You are dispatched as the Guild backend specialist for lane wi-7.",
      env: { GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1" },
    });
    expect(attr!.isGeneric).toBe(false);
    expect(attr!.specialist).toBeUndefined();
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(c) a GENERIC dispatch whose role-bearing carriers were stripped still BLOCKS via the line-1 marker", () => {
    // The rf-wi-07c round-3/round-5 shape, restated on marked carriers:
    // GUILD_SPECIALIST/GUILD_AGENT_DEFINITION stripped, leaving a role-bearing
    // line-1 marker on a host-generic dispatch. That is a class mismatch (the
    // generic type is reserved for project specialists, whose line 1 is the
    // GUILD_AGENT_DEFINITION marker), so it is denied — the protection the
    // deleted prose signature used to provide, now structural.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=frontend\n" +
        "Do the lane.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1",
      },
    });
    expect(attr!.specialist).toBe("frontend");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(attr!.hasAdoptionPrompt).toBe(false);
    expect(attr!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(c) a GENERIC dispatch carrying ONLY the role-less env producer TOKEN is not a lane (no identity claimed)", () => {
    // The env token names no role and the prompt claims no persona, so there is
    // nothing to be stripped OF — this is a producer-composed fan-out, not a
    // specialist lane. Blocking it would deny legitimate non-lane dispatches.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "Analyse this subtree and return a CodebaseMap fragment.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1",
      },
    });
    expect(attr!.specialist).toBeUndefined();
    expect(attr!.isSpecialistLane).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(c) the line-1 marker and the definition env disagreeing is still caught as drift", () => {
    // env def says "devops"; the producer-owned line 1 says "frontend" — the
    // lane would adopt the wrong persona.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/frontend.md\n" +
        "You are the `devops` teammate for run-id `run-x`.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.hasConsistentIdentity).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(c) a REJECTED GUILD_AGENT_DEFINITION marker attempt on a COMPOSED lane still fails closed", () => {
    // The line-1 marker is malformed (trailing junk ⇒ whole line rejected), so
    // it supplies no adoption proof. The composed-lane env pair
    // (GUILD_SPECIALIST + GUILD_TASK_ID) still marks this as a lane, so the
    // missing adoption prompt is caught rather than silently passed.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md trailing junk\n" +
        "Do the lane.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_SPECIALIST: "devops",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.specialist).toBe("devops");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(attr!.hasAdoptionPrompt).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });
});
