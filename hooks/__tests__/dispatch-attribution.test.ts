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

  // ── rf-wi-07c (G7c) — legacy 300-char producer-head parse, gated ─────────
  //
  // G3 (rf-wi-03) made the line-1 marker universal on every
  // composeInProcessDispatch/buildPrompt dispatch (team, tmux, in-process,
  // remote). These pin the resulting contract: the legacy anchor/prose parse
  // is DEAD the moment a line-1 marker is present (a), and still alive as the
  // fallback for the one class that has neither marker yet — the direct
  // D5 `subagent` rung, a skill-authored inline `Agent()` call with no
  // launcher descriptor (owned by rf-wi-06) (b).

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

  it("(b) still attributes via the legacy anchor when NO line-1 marker is present (unmarked direct-subagent rung)", () => {
    // Simulates guild:execute-plan's direct `subagent` rung (agent-team-launcher.ts
    // hands this rung's Agent() construction to the skill with no descriptor —
    // no GUILD_DISPATCH_PRODUCER env, no line-1 marker) but a correctly-carried
    // GUILD_AGENT_DEFINITION. This is the one path rf-wi-06 has not yet marked;
    // the legacy parse must keep attributing it until that lands.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "You are the `devops` teammate for run-id `run-x`. Your role definition is at " +
        "`.guild/agents/devops.md` — read it FIRST and adopt it fully.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.specialist).toBe("devops");
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(attr!.isSpecialistLane).toBe(true);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(b) still attributes via the legacy prose signature when NO line-1 marker is present", () => {
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "You are dispatched as the Guild backend specialist for lane wi-7.",
      env: { GUILD_RUN_ID: "run-x" },
    });
    expect(attr!.specialist).toBe("backend");
    expect(attr!.isSpecialistLane).toBe(true);
  });

  it("(b) still BLOCKS a persona-stripped unmarked direct-subagent dispatch (the exact drift this fallback exists to catch)", () => {
    // Same rung as above, but the definition env was never set — the real
    // defect the legacy anchor parse protects against on this not-yet-marked
    // rung: prose claims a persona with no GUILD_AGENT_DEFINITION to back it.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "You are the `devops` teammate for run-id `run-x`. Your role definition is at " +
        "`.guild/agents/devops.md` — read it FIRST and adopt it fully.",
      env: { GUILD_RUN_ID: "run-x", GUILD_TASK_ID: "wi-1" },
    });
    expect(attr!.specialist).toBe("devops");
    expect(attr!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(c) a REJECTED marker attempt on a NON-generic (by-name) dispatch is an accepted, security-inert residual", () => {
    // Adversarial review (rf-wi-07c rounds 1-4): gating on env/prefix evidence
    // to close this exactly reopened WORSE gaps (rounds 3 and 4 — see the
    // gating doc above `hasProjectMarker`/`hasAnyMarker` for the full
    // round-by-round tradeoff), so this is now a deliberately ACCEPTED
    // residual rather than "fixed": a rejected marker attempt on a dispatch
    // that is dispatched BY NAME (non-generic) may still have its
    // `specialist` telemetry field resolved from unrelated legacy prose. This
    // never affects a security decision — `isGeneric` is false, so
    // `dispatchViolations` returns `[]` regardless of `specialist`.
    const attr = resolveDispatchAttribution({
      subagent_type: "advisor",
      prompt:
        "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=advisor trailing-junk\n" +
        "You are dispatched as the Guild backend specialist for lane wi-7.",
      env: { GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1" },
    });
    expect(attr!.isGeneric).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(false);
  });

  it("(c) a GENERIC dispatch with a valid env producer-marker TOKEN but no role-bearing carrier still BLOCKS via the legacy anchor (round 3)", () => {
    // Adversarial review round 3: env carrying a validly-formed
    // GUILD_DISPATCH_PRODUCER TOKEN (which names no role) must NOT gate off
    // the legacy anchor on its own — GUILD_SPECIALIST/GUILD_AGENT_DEFINITION
    // were stripped, so the env token is the only non-legacy signal and it
    // carries no identity. Suppressing the anchor here would leave the #58
    // guard with NOTHING and silently PASS a persona-stripped dispatch it
    // must BLOCK. Matches the origin/rf/wi-03-tier-env baseline byte-for-byte.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt: "Your role definition is at `.guild/agents/frontend.md` — read it FIRST and adopt it.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1",
      },
    });
    expect(attr!.specialist).toBe("frontend");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(attr!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(c) a VALID producer marker (non-project class) does NOT gate off the legacy anchor (a different class) — still BLOCKS (round 4)", () => {
    // Adversarial review round 4: a role-bearing, VALIDLY-PARSED
    // GUILD_DISPATCH_PRODUCER line-1 marker (the shipped/orchestrator class)
    // must not suppress `anchorRole` (the project-specialist class) — the two
    // markers serve DIFFERENT purposes and their co-occurrence on one
    // dispatch, with GUILD_SPECIALIST/GUILD_AGENT_DEFINITION stripped, is
    // itself the corrupted/mixed-class shape the guard exists to catch.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=frontend\n" +
        "Your role definition is at `.guild/agents/frontend.md` — read it FIRST and adopt it.",
      env: { GUILD_TASK_ID: "wi-1", GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1" },
    });
    expect(attr!.specialist).toBe("frontend");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(attr!.hasAdoptionPrompt).toBe(true);
    expect(attr!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(c) prose's LANE-SIGNATURE role survives even when a marker gates its IDENTITY role (round 5)", () => {
    // Adversarial review round 5, found independently of rounds 1-4 (no
    // malformed marker, no env-only evidence, no cross-class anchor): a valid
    // role-bearing producer marker (`producerMarkerRoleValue`) correctly
    // suppresses `proseRole` as an IDENTITY source (round 4's fix — redundant/
    // possibly-conflicting legacy prose shouldn't also feed `specialist`), but
    // it must NOT suppress `hasProseSignature` — the prose is still a LANE
    // SIGNATURE that `isSpecialistLane` depends on. Without it, a
    // `general-purpose` dispatch with `GUILD_SPECIALIST`/`GUILD_AGENT_DEFINITION`
    // stripped (leaving only the role-less producer TOKEN) and prose claiming a
    // specialist persona had NO other signal to make `isSpecialistLane` true —
    // a silent pass the pre-G7c baseline caught via `missing_definition` +
    // `missing_adoption_prompt`.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_DISPATCH_PRODUCER=guild.dispatch.v1 role=frontend\n" +
        "You are dispatched as the Guild frontend specialist for lane wi-1.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_DISPATCH_PRODUCER: "guild.dispatch.v1",
      },
    });
    expect(attr!.specialist).toBe("frontend");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(attr!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(c) GUILD_AGENT_DEFINITION env alone (no marker) does NOT gate off the legacy anchor — drift is still caught", () => {
    // The gate is narrowly about MARKER evidence, not "any Guild env carrier":
    // a GUILD_AGENT_DEFINITION env with no line-1 marker is exactly the
    // not-yet-marker-covered shape (env def says "devops"; the legacy anchor
    // text elsewhere disagrees, naming "frontend") — the legacy anchor must
    // still fire so the mismatch is caught, not silently swallowed.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "You are the `devops` teammate for run-id `run-x`. Your role definition is at " +
        "`.guild/agents/frontend.md` — read it FIRST and adopt it.",
      env: {
        GUILD_RUN_ID: "run-x",
        GUILD_TASK_ID: "wi-1",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(attr!.hasConsistentIdentity).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });

  it("(c) a REJECTED GUILD_AGENT_DEFINITION marker attempt with NO backing env falls through to the legacy anchor (matches pre-G7c behavior, still fail-closed)", () => {
    // Adversarial review (rf-wi-07c round 2): the SAME malformed line-1 marker
    // as above, but with NO env evidence of producer composition at all — the
    // direct-subagent D5 rung's exact unmarked shape. Here the legacy anchor
    // MUST still fire (matching the pre-G7c baseline byte-for-byte): the
    // dispatch is attributed to "frontend" (from the later legacy sentence)
    // and, with no GUILD_AGENT_DEFINITION to back it, still BLOCKED as
    // persona-stripped — never silently passed with zero attribution.
    const attr = resolveDispatchAttribution({
      subagent_type: GENERIC_SUBAGENT_TYPE,
      prompt:
        "GUILD_AGENT_DEFINITION=.guild/agents/devops.md trailing junk\n" +
        "Your role definition is at `.guild/agents/frontend.md` — read it FIRST and adopt it.",
      env: { GUILD_RUN_ID: "run-x", GUILD_TASK_ID: "wi-1" },
    });
    expect(attr!.specialist).toBe("frontend");
    expect(attr!.isSpecialistLane).toBe(true);
    expect(attr!.hasValidDefinition).toBe(false);
    expect(isPersonaStrippedDispatch(attr!)).toBe(true);
  });
});
