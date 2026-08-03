/**
 * hooks/__tests__/pre-tool-use-dispatch-guard.test.ts
 *
 * #58 — the PreToolUse dispatch-integrity guard. Proves the block/pass matrix
 * on the REAL hook path (runs pre-tool-use.ts via tsx over stdin, exactly as
 * Claude Code drives it):
 *
 *   [x] Guild lane, general-purpose, adoption prompt, NO GUILD_AGENT_DEFINITION → BLOCK (deny)
 *   [x] Guild lane, general-purpose, adoption prompt, WITH GUILD_AGENT_DEFINITION → PASS
 *   [x] Non-Guild Agent call (no run id)                                         → PASS
 *   [x] Guild run, generic learn/fan-out Agent call (no adoption signature)      → PASS
 *   [x] Guild run, shipped agent dispatched by name (non-generic)               → PASS
 *   [x] Non-Agent tool call inside a Guild run                                  → PASS
 *   [x] A blocked dispatch records a guild.security_event.v1 (dispatch_attribution_missing)
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../pre-tool-use.ts");
const RUN = "test-run";

function run(
  payload: object,
  env: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 20000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function securityEvents(tmp: string): Array<Record<string, unknown>> {
  const file = path.join(tmp, ".guild", "runs", RUN, "logs", "security-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const ADOPTION_PROMPT =
  "You are the `devops` teammate for run-id `test-run`. Your role definition is at " +
  "`.guild/agents/devops.md` — read it FIRST and adopt it fully (persona, boundaries).";

describe("pre-tool-use.ts — #58 dispatch-integrity guard", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-dispatch-"));
    fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
    fs.mkdirSync(path.join(tmp, ".guild", "runs", RUN), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const guildEnv = (over: Record<string, string> = {}) => ({
    GUILD_CWD: tmp,
    GUILD_RUN_ID: RUN,
    ...over,
  });

  it("BLOCKS a persona-stripped project lane (generic + adoption prompt, no definition)", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: ADOPTION_PROMPT,
          env: { GUILD_RUN_ID: RUN, GUILD_SPECIALIST: "devops", GUILD_TASK_ID: "nim-wi-30" },
        },
      },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("devops");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("GUILD_AGENT_DEFINITION");

    // Filter to the #58 event: this dispatch carries structured lane evidence
    // (GUILD_SPECIALIST + GUILD_TASK_ID) but no model param, so #60 legitimately
    // records a `tier_dispatch_untiered` twin for the same call — both defects
    // are real and independently audited.
    const events = securityEvents(tmp).filter(
      (e) => e.event_type === "dispatch_attribution_missing",
    );
    expect(events.length).toBe(1);
    expect(events[0].schema_version).toBe("guild.security_event.v1");
    expect(events[0].decision).toBe("deny");
    expect(events[0].tool).toBe("Agent");
  });

  it("PASSES a correctly-carried project lane (definition env present)", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          // #60: a structured Guild lane must also carry a model param; pin it so
          // this fixture isolates the #58 dimension (#58 never reads model).
          model: "sonnet",
          prompt: ADOPTION_PROMPT,
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });

  it("PASSES a non-Guild Agent call (no active run)", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: "Explore the repo and summarise the auth flow.",
        },
      },
      // No GUILD_RUN_ID, and no current-run-id sentinel → not a Guild run.
      { GUILD_CWD: tmp },
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });

  it("PASSES a generic learn/fan-out lane inside a Guild run (no adoption signature)", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: "Analyse this subtree and return a CodebaseMap fragment.",
          env: { GUILD_RUN_ID: RUN },
        },
      },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });

  it("PASSES a shipped agent dispatched by name (non-generic)", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "developer",
          model: "sonnet", // #60: structured lane carries a model param
          prompt: ADOPTION_PROMPT,
          env: { GUILD_RUN_ID: RUN, GUILD_SPECIALIST: "developer", GUILD_TASK_ID: "wi-1" },
        },
      },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });

  it("DENIES a stripped dispatch even when the lane is capability-scoped (integrity guard runs FIRST)", () => {
    // A scoped lane whose scope does NOT include Agent would otherwise be gated
    // to `ask` by capability enforcement. The integrity guard must win and DENY
    // outright so a persona-stripped dispatch can never be approved.
    const { stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: ADOPTION_PROMPT,
          env: { GUILD_RUN_ID: RUN, GUILD_SPECIALIST: "devops", GUILD_TASK_ID: "nim-wi-30" },
        },
      },
      guildEnv({ GUILD_CAPABILITY_SCOPE: '["Read","Edit"]', GUILD_LANE_ID: "backend" }),
    );
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    const events = securityEvents(tmp);
    expect(events.some((e) => e.event_type === "dispatch_attribution_missing")).toBe(true);
  });

  it("DENIES a composed lane with a valid definition but a STRIPPED adoption prompt", () => {
    const { stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: "just do the work", // adoption prompt stripped
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("DENIES a dispatch whose GUILD_AGENT_DEFINITION is role-mismatched (fake proof)", () => {
    const { stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: ADOPTION_PROMPT, // claims devops
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/frontend.md", // wrong role
          },
        },
      },
      guildEnv(),
    );
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("reports missing_definition (only) when the definition env is genuinely absent", () => {
    const { stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: ADOPTION_PROMPT,
          env: { GUILD_RUN_ID: RUN, GUILD_SPECIALIST: "devops", GUILD_TASK_ID: "nim-wi-30" },
        },
      },
      guildEnv(),
    );
    const why = JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason;
    expect(why).toContain("missing_definition");
    expect(why).not.toContain("missing_adoption_prompt");
  });

  it("DENIES a WRONG-PERSONA dispatch (prompt adopts a different role than the lane claims)", () => {
    const { stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt:
            "Your role definition is at `.guild/agents/frontend.md` — read it FIRST and adopt it.",
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("DENIES the TRANSCRIPT-form wrong persona (prose devops, adoption path frontend)", () => {
    const { stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt:
            "You are dispatched as the Guild **devops** specialist for lane **nim-wi-30**. " +
            "First READ and adopt the persona/constraints in `.guild/agents/frontend.md`.",
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    // Root cause here is the absent adoption prefix (the frontend path sits in
    // free text, which is deliberately never read as identity).
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain(
      "missing_adoption_prompt",
    );
  });

  it("reports identity_mismatch when the marker prefix names a different role than the env", () => {
    const { stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt:
            "GUILD_AGENT_DEFINITION=.guild/agents/frontend.md\n" +
            "You are the `devops` teammate for run-id `test-run`.",
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    const why = out.hookSpecificOutput.permissionDecisionReason;
    expect(why).toContain("identity_mismatch");
    expect(why).not.toContain("missing_definition");
  });

  it("PASSES the TRANSCRIPT-form once it carries the marker prefix and all roles agree", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          model: "sonnet", // #60: structured lane carries a model param
          prompt:
            "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
            "You are dispatched as the Guild **devops** specialist for lane **nim-wi-30**. " +
            "First READ and adopt the persona/constraints in `.guild/agents/devops.md`.",
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });

  it("PASSES a valid lane whose SCOPE text names a different agents file", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          model: "sonnet", // #60: structured lane carries a model param
          prompt:
            ADOPTION_PROMPT +
            " Your lane scope: `review .guild/agents/frontend.md for drift`.",
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });

  it("R5-1: DENIES prose-only 'dispatched as the Guild devops specialist' with matching env (no adoption proof)", () => {
    const { stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: "You are dispatched as the Guild devops specialist for lane nim-wi-30. Go.",
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    const out = JSON.parse(stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    // The diagnostic must name the invariant that ACTUALLY failed: here the env
    // is present AND matching, so blaming GUILD_AGENT_DEFINITION would be false.
    const why = out.hookSpecificOutput.permissionDecisionReason;
    expect(why).toContain("missing_adoption_prompt");
    expect(why).not.toContain("missing_definition");
  });

  it("R5-2: PASSES a valid lane whose SCOPE contains a same-sentence adoption phrase", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          model: "sonnet", // #60: structured lane carries a model param
          prompt:
            "GUILD_AGENT_DEFINITION=.guild/agents/devops.md\n" +
            "You are the `devops` teammate for run-id `test-run`. Your lane scope: " +
            "`Update docs explaining how users adopt project rules from .guild/agents/frontend.md`.",
          env: {
            GUILD_RUN_ID: RUN,
            GUILD_SPECIALIST: "devops",
            GUILD_TASK_ID: "nim-wi-30",
            GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
          },
        },
      },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });

  it("PASSES a benign generic prompt mentioning an agents file + the word persona", () => {
    const { exitCode, stdout } = run(
      {
        tool_name: "Agent",
        tool_input: {
          subagent_type: "general-purpose",
          prompt: "Review .guild/agents/backend.md. Adopt a skeptical reviewer persona.",
          env: { GUILD_RUN_ID: RUN },
        },
      },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });

  it("PASSES a non-Agent tool call inside a Guild run", () => {
    const { exitCode, stdout } = run(
      { tool_name: "Read", tool_input: { file_path: "/src/a.ts" } },
      guildEnv(),
    );
    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("permissionDecision");
    expect(securityEvents(tmp).length).toBe(0);
  });
});
