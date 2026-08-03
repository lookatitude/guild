/**
 * hooks/__tests__/post-tool-use-attribution.test.ts
 *
 * #58 — the run-trace dispatch event carries `attribution_specialist` (the
 * resolved role) so a post-hoc audit can tell a real specialist lane from a
 * bare generic agent. On-disk FINAL-state test on the REAL post-tool-use.ts
 * path (the canonical `tool_call` writer for the Agent dispatch event).
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../post-tool-use.ts");
const RUN = "run-ptu-attribution-test";

function setup(): { tmp: string; runDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ptu-attr-"));
  fs.mkdirSync(path.join(tmp, ".git"), { recursive: true });
  const runDir = path.join(tmp, ".guild", "runs", RUN);
  fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".guild", "runs", "current-run-id"), RUN, "utf8");
  return { tmp, runDir };
}

function spawnAgentDispatch(tmp: string, toolInput: unknown): number {
  const payload = {
    hook_event_name: "PostToolUse",
    tool_name: "Agent",
    tool_input: toolInput,
    tool_response: { success: true },
    cwd: tmp,
  };
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, GUILD_CWD: tmp, GUILD_RUN_ID: RUN },
    timeout: 30000,
  });
  return result.status ?? 1;
}

function toolCallEvents(runDir: string): Array<Record<string, unknown>> {
  const file = path.join(runDir, "logs", "v1.4-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((e) => e.event === "tool_call");
}

describe("post-tool-use.ts — #58 attribution_specialist on the Agent dispatch event", () => {
  let tmp: string;
  let runDir: string;
  beforeEach(() => {
    ({ tmp, runDir } = setup());
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("stamps the resolved role for a project-specialist dispatch", () => {
    const exit = spawnAgentDispatch(tmp, {
      subagent_type: "general-purpose",
      prompt:
        "You are the `devops` teammate for run-id `run-x`. Your role definition is at " +
        "`.guild/agents/devops.md` — read it FIRST and adopt it fully.",
      env: {
        GUILD_RUN_ID: RUN,
        GUILD_SPECIALIST: "devops",
        GUILD_TASK_ID: "nim-wi-30",
        GUILD_AGENT_DEFINITION: ".guild/agents/devops.md",
      },
    });
    expect(exit).toBe(0);
    const calls = toolCallEvents(runDir);
    expect(calls.length).toBe(1);
    expect(calls[0].tool).toBe("Agent");
    expect(calls[0].attribution_specialist).toBe("devops");
  });

  it("omits attribution_specialist for a generic call that merely NAMES an agents file", () => {
    // Would otherwise be mislabelled `backend` and defeat the specialist-vs-
    // bare-generic distinction the field exists to record (adversarial review).
    const exit = spawnAgentDispatch(tmp, {
      subagent_type: "general-purpose",
      prompt: "Review .guild/agents/backend.md. Adopt a skeptical reviewer persona.",
    });
    expect(exit).toBe(0);
    const calls = toolCallEvents(runDir);
    expect(calls.length).toBe(1);
    expect("attribution_specialist" in calls[0]).toBe(false);
  });

  it("omits attribution_specialist for a bare non-Guild Agent call", () => {
    const exit = spawnAgentDispatch(tmp, {
      subagent_type: "general-purpose",
      prompt: "Explore the repo and summarise the auth flow.",
    });
    expect(exit).toBe(0);
    const calls = toolCallEvents(runDir);
    expect(calls.length).toBe(1);
    expect(calls[0].tool).toBe("Agent");
    expect("attribution_specialist" in calls[0]).toBe(false);
  });
});
