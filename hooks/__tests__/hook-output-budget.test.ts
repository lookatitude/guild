/**
 * W3 (hook-output-hygiene): real-entrypoint output-budget rail.
 *
 * Every hook registration in hooks.json is executed with protocol-valid stdin
 * against an isolated repository. The table below is deliberately explicit:
 * adding a hook or moving it to a different event fails until its stdout and
 * stderr contract is reviewed and assigned a budget.
 *
 * This is a real-bundle rail, not a source-import seam. The planted-leak test
 * runs a copied built bundle through the same budget evaluator so the suite
 * cannot pass merely because its command discovery or byte accounting is dead.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { hermeticEnv } from "../test-support/hermetic-env";
import { mintTestBinding } from "../test-support/mint-binding";

type Budget = Readonly<{ stdout: number; stderr: number }>;
type HookRegistration = Readonly<{
  event: string;
  command: string;
  key: string;
  matcher?: string;
}>;

const PLUGIN_ROOT = path.resolve(__dirname, "../..");
const HOOKS_JSON = path.join(PLUGIN_ROOT, "hooks", "hooks.json");

const BUDGETS: Readonly<Record<string, Budget>> = {
  "SessionStart:hooks/bootstrap.sh": { stdout: 6144, stderr: 0 },
  "SessionStart:hooks/dist/detect-guild-version.js": { stdout: 0, stderr: 0 },
  "SessionStart:hooks/dist/update-check.js": { stdout: 0, stderr: 0 },
  "SessionStart:hooks/dist/using-guild-bootstrap.js": { stdout: 12288, stderr: 0 },
  "SessionStart:hooks/dist/session-reanchor.js": { stdout: 0, stderr: 0 },
  "UserPromptSubmit:hooks/check-skill-coverage.sh": { stdout: 0, stderr: 0 },
  "UserPromptSubmit:hooks/dist/capture-telemetry.js": { stdout: 0, stderr: 512 },
  "UserPromptSubmit:hooks/dist/run-trace-start.js": { stdout: 0, stderr: 0 },
  "PreToolUse[*]:hooks/dist/pre-tool-use.js": { stdout: 0, stderr: 512 },
  "PostToolUse[*]:hooks/dist/capture-telemetry.js": { stdout: 0, stderr: 512 },
  "PostToolUse[*]:hooks/dist/post-tool-use.js": { stdout: 0, stderr: 512 },
  "PostToolUse[Write|Edit]:hooks/dist/comms-format-lint.js": { stdout: 0, stderr: 0 },
  // The matched review.md write emits one bounded run-ledger diagnostic.
  "PostToolUse[Write|Edit]:hooks/dist/gate-outcome-writer.js": { stdout: 0, stderr: 256 },
  "PreCompact:hooks/dist/pre-compact.js": { stdout: 0, stderr: 512 },
  "SubagentStop:hooks/dist/capture-telemetry.js": { stdout: 0, stderr: 512 },
  "SubagentStop:hooks/dist/maybe-reflect.js": { stdout: 0, stderr: 512 },
  "Stop:hooks/dist/maybe-reflect.js": { stdout: 0, stderr: 512 },
  "Stop:hooks/dist/run-trace-close.js": { stdout: 0, stderr: 0 },
  "Stop:hooks/dist/learning-backstop.js": { stdout: 0, stderr: 512 },
  "Stop:hooks/dist/lean-lead-guard.js": { stdout: 0, stderr: 0 },
  "Stop:hooks/dist/lifecycle-gate.js": { stdout: 0, stderr: 0 },
  "TaskCreated:hooks/agent-team/dist/task-created.js": { stdout: 0, stderr: 2048 },
  "TaskCompleted:hooks/agent-team/dist/task-completed.js": { stdout: 0, stderr: 8192 },
  "TeammateIdle:hooks/agent-team/dist/teammate-idle.js": { stdout: 4096, stderr: 4096 },
};

const BUDGET_RUN_ID = "run-20260812-000000-hook-budget";
const BUDGET_TASK_ID = "budget-task";
let budgetBindingRef = "";

function payload(
  registration: Pick<HookRegistration, "event" | "matcher">,
  cwd: string,
  matchedTool?: "Write" | "Edit",
): Record<string, unknown> {
  const { event, matcher } = registration;
  const base = { hook_event_name: event, session_id: "budget-session", cwd };
  switch (event) {
    case "SessionStart":
      return { ...base, source: "startup" };
    case "UserPromptSubmit":
      return { ...base, prompt: "ordinary hook budget probe" };
    case "PreToolUse":
      return { ...base, tool_name: "Read", tool_input: { file_path: path.join(cwd, "README.md") } };
    case "PostToolUse":
      if (matcher === "Write|Edit") {
        const toolName = matchedTool ?? "Write";
        return {
          ...base,
          tool_name: toolName,
          tool_input: {
            file_path: path.join(cwd, ".guild", "runs", BUDGET_RUN_ID, "review.md"),
            ...(toolName === "Write"
              ? { content: "# Review\n\n✓ pass\n" }
              : { old_string: "✓ pass", new_string: "✓ pass" }),
          },
          tool_response: { success: true },
        };
      }
      return {
        ...base,
        tool_name: "Read",
        tool_input: { file_path: path.join(cwd, "README.md") },
        tool_response: { success: true },
      };
    case "PreCompact":
      return { ...base, trigger: "manual" };
    case "SubagentStop":
      return { ...base, agent_id: "agent-1", agent_type: "backend", stop_reason: "done" };
    case "Stop":
      return { ...base, stop_reason: "end_turn" };
    case "TaskCreated":
      return {
        ...base,
        task_id: BUDGET_TASK_ID,
        task_subject: "budget probe",
        task_description: "Exercise the real registered task-created validation path.",
        teammate_name: "backend",
        team_name: "guild",
      };
    case "TaskCompleted":
      return {
        ...base,
        task_id: BUDGET_TASK_ID,
        task_subject: "budget probe",
        task_description: "Exercise the real registered task-completed validation path.",
        teammate_name: "backend",
        team_name: "guild",
      };
    case "TeammateIdle":
      return { ...base, teammate_name: "backend", team_name: "guild" };
    default:
      throw new Error(`No protocol-valid budget payload for hook event ${event}`);
  }
}

function relativeEntrypoint(command: string): string {
  const match = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"']+)/);
  if (!match?.[1]) throw new Error(`Cannot resolve hook entrypoint from command: ${command}`);
  return match[1];
}

function registrations(): HookRegistration[] {
  const parsed = JSON.parse(fs.readFileSync(HOOKS_JSON, "utf8")) as {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
  };
  const out: HookRegistration[] = [];
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const relative = relativeEntrypoint(hook.command);
        const matcherKey = group.matcher ? `[${group.matcher}]` : "";
        out.push({
          event,
          command: hook.command,
          key: `${event}${matcherKey}:${relative}`,
          matcher: group.matcher,
        });
      }
    }
  }
  return out;
}

function budgetViolation(
  key: string,
  actual: Readonly<{ stdout: string; stderr: string }>,
  budget: Budget,
): string | null {
  const stdout = Buffer.byteLength(actual.stdout, "utf8");
  const stderr = Buffer.byteLength(actual.stderr, "utf8");
  if (stdout <= budget.stdout && stderr <= budget.stderr) return null;
  return `${key} exceeded output budget: stdout ${stdout}/${budget.stdout}, stderr ${stderr}/${budget.stderr}`;
}

function runRegistration(registration: HookRegistration, cwd: string): {
  status: number | null;
  stdout: string;
  stderr: string;
}[] {
  const matchedTools: Array<"Write" | "Edit" | undefined> =
    registration.matcher === "Write|Edit" ? ["Write", "Edit"] : [undefined];
  return matchedTools.map((matchedTool) => {
    const result = spawnSync(registration.command, {
      cwd,
      shell: "/bin/bash",
      input: JSON.stringify(payload(registration, cwd, matchedTool)) + "\n",
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...hermeticEnv(),
        CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
        GUILD_CWD: cwd,
        GUILD_HOOK_TEST: "1",
        GUILD_RUN_ID: BUDGET_RUN_ID,
        GUILD_RUN_BINDING_REF: budgetBindingRef,
        GUILD_RUN_DIR: path.join(cwd, ".guild", "runs", BUDGET_RUN_ID),
        GUILD_LIFECYCLE_GATE_OVERRIDE: "0",
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      },
    });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  });
}

describe("hook-output-hygiene W3 — every registered real hook has an enforced byte budget", () => {
  let cwd: string;

  beforeAll(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-hook-output-budget-"));
    fs.mkdirSync(path.join(cwd, ".git"), { recursive: true });
    fs.mkdirSync(path.join(cwd, ".guild"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "README.md"), "# Hook budget fixture\n", "utf8");
    if (!fs.existsSync(path.join(cwd, "README.md"))) {
      throw new Error("failed to create the real-path Read fixture");
    }
    fs.writeFileSync(path.join(cwd, ".guild", "settings.json"), "{}\n", "utf8");
    const runDir = path.join(cwd, ".guild", "runs", BUDGET_RUN_ID);
    const handoffsDir = path.join(runDir, "handoffs");
    fs.mkdirSync(handoffsDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, "run.yaml"),
      [
        "schema_version: guild.run.v1",
        `run_id: ${BUDGET_RUN_ID}`,
        "started_at: 2027-01-01T00:00:00.000Z",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(path.join(runDir, "review.md"), "# Review\n\n✓ pass\n", "utf8");
    fs.writeFileSync(
      path.join(handoffsDir, `backend-${BUDGET_TASK_ID}.md`),
      [
        "## changed_files",
        "- hooks/__tests__/hook-output-budget.test.ts",
        "",
        "## opens_for",
        "- validation",
        "",
        "## assumptions",
        "- none",
        "",
        "## evidence",
        "- real bundle execution",
        "",
        "## followups",
        "- none",
        "",
        "```guild.handoff.v2",
        JSON.stringify({
          schema_version: "guild.handoff.v2",
          task_id: BUDGET_TASK_ID,
          tier: "mid",
          status: "done",
          summary: "Hook budget fixture completed.",
          artifacts: [],
          issues: [],
        }),
        "```",
        "",
      ].join("\n"),
      "utf8",
    );
    budgetBindingRef = mintTestBinding(cwd, BUDGET_RUN_ID);
  });

  afterAll(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it("fails closed when hooks.json gains an unreviewed registration", () => {
    const actualKeys = registrations().map((registration) => registration.key).sort();
    expect(actualKeys).toEqual(Object.keys(BUDGETS).sort());
  });

  it.each(registrations())("$key stays within its explicit stdout/stderr budget", (registration) => {
    const budget = BUDGETS[registration.key];
    expect(budget).toBeDefined();
    const actuals = runRegistration(registration, cwd);
    expect(actuals).toHaveLength(registration.matcher === "Write|Edit" ? 2 : 1);
    for (const actual of actuals) {
      expect(actual.status).toBe(0);
      expect(budgetViolation(registration.key, actual, budget!)).toBeNull();
    }
  });

  it("exercises the bootstrap self-build + no-scan branch within its declared budget", () => {
    const registration = registrations().find(
      (candidate) => candidate.key === "SessionStart:hooks/bootstrap.sh",
    );
    expect(registration).toBeDefined();
    const emptyCodexHome = path.join(cwd, "empty-codex-home");
    fs.mkdirSync(emptyCodexHome, { recursive: true });
    fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Guild — repo orientation\n", "utf8");
    const absentScan = path.join(cwd, ".guild", "fixtures", "no-scan.md");
    expect(fs.existsSync(absentScan)).toBe(false);
    const result = spawnSync(registration!.command, {
      cwd,
      shell: "/bin/bash",
      input: JSON.stringify(payload({ event: "SessionStart" }, cwd)) + "\n",
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...hermeticEnv(),
        CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
        GUILD_PLUGIN_ROOT: PLUGIN_ROOT,
        GUILD_CWD: cwd,
        GUILD_HOOK_TEST: "1",
        GUILD_HOOK_TEST_NO_SCAN: "1",
        GUILD_HOOK_TEST_SCAN_FILE: absentScan,
        CODEX_HOME: emptyCodexHome,
        OPENAI_API_KEY: "",
      },
    });
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(cwd, ".guild", "hosts"))).toBe(true);
    expect(result.stdout).toContain("SELF-BUILD DETECTED");
    expect(result.stdout).toContain("docs-hygiene status: no scan on record");
    expect(
      budgetViolation(
        registration!.key,
        { stdout: result.stdout ?? "", stderr: result.stderr ?? "" },
        BUDGETS[registration!.key]!,
      ),
    ).toBeNull();
  });

  it("anti-vacuity: a planted stdout leak in a copied real bundle fails the same evaluator", () => {
    const planted = path.join(cwd, "planted-run-trace-start.js");
    fs.copyFileSync(path.join(PLUGIN_ROOT, "hooks", "dist", "run-trace-start.js"), planted);
    fs.appendFileSync(planted, "\nprocess.stdout.write('PLANTED_HOOK_OUTPUT_LEAK');\n", "utf8");
    const result = spawnSync(process.execPath, [planted], {
      cwd,
      input: JSON.stringify(payload({ event: "UserPromptSubmit" }, cwd)) + "\n",
      encoding: "utf8",
      timeout: 30_000,
      env: { ...hermeticEnv(), GUILD_CWD: cwd, GUILD_HOOK_TEST: "1" },
    });
    const key = "UserPromptSubmit:hooks/dist/run-trace-start.js";
    expect(result.status).toBe(0);
    expect(
      budgetViolation(
        key,
        { stdout: result.stdout ?? "", stderr: result.stderr ?? "" },
        BUDGETS[key]!,
      ),
    ).toContain("exceeded output budget");
  });
});
