/**
 * hooks/__tests__/pre-tool-use-projection-gate.test.ts
 *
 * U-TIER (T08) rework-r1 — KTD28 on the REAL adapter seam.
 *
 * The round-1 lane shipped a projection checker that production never called, so
 * an isolated worker could call any tool it liked. `pre-tool-use.ts` IS the seam
 * the Claude host adapter drives for every tool call, and these cases run that
 * hook over stdin exactly as the host does, against a real run tree:
 *
 *   [x] a tool inside the assignment's projection                 → PASS
 *   [x] a tool OUTSIDE it                                         → DENY
 *   [x] an instance with no assignment on disk                    → DENY (fail-closed)
 *   [x] a session that is not a TaskCell worker (no env identity) → PASS, no opinion
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const SCRIPT = path.resolve(__dirname, "../pre-tool-use.ts");
const RUN = "run-projection-gate";
const TASK = "T1-backend";
const INSTANCE = "T1-backend.a1.i1";

let tmp: string;

function runHook(
  payload: object,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: {
      ...process.env,
      GUILD_CWD: tmp,
      GUILD_RUN_ID: RUN,
      GUILD_TASK_ID: TASK,
      GUILD_TASK_CELL_INSTANCE_ID: INSTANCE,
      CMUX_WORKSPACE_ID: "",
      TMUX: "",
      ...env,
    },
    timeout: 30000,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? "" };
}

function decision(stdout: string): { permissionDecision?: string; permissionDecisionReason?: string } {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
      };
      if (parsed.hookSpecificOutput) return parsed.hookSpecificOutput;
    } catch {
      /* not this line */
    }
  }
  return {};
}

/** Write the instance's real `guild.task_assignment.v2` into the run tree. */
function writeAssignment(tools: string[]): void {
  const dir = path.join(
    tmp,
    ".guild",
    "runs",
    RUN,
    "task-cells",
    TASK,
    "attempts",
    "1",
    "instances",
    INSTANCE,
  );
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.relative(tmp, dir);
  fs.writeFileSync(
    path.join(dir, "assignment.json"),
    JSON.stringify(
      {
        schema_version: "guild.task_assignment.v2",
        run_id: RUN,
        cell_id: `cell-${TASK}`,
        goal_id: "goal-t08",
        phase_id: "build",
        step_id: TASK,
        team_id: "t08",
        logical_task_id: TASK,
        task_run_id: `${TASK}.tr1`,
        attempt: 1,
        attempt_id: `${TASK}.att1`,
        previous_attempt_id: null,
        retry_reason: null,
        instance_id: INSTANCE,
        lead_binding_id: "lead-binding-t08",
        team_lead_instance_id: null,
        worker_role: "backend",
        specialist_type_id: "backend",
        specialist_type_version: "1",
        specialist_type_hash: "sha256:type",
        specialist_profile_id: "backend",
        specialist_profile_hash: "sha256:profile",
        context_bundle_id: ".guild/context/x.md",
        context_bundle_hash: "sha256:ctx",
        host_id: "claude-code-cli",
        adapter_id: "claude-code-cli@1",
        host_capabilities_hash: "sha256:caps",
        objective: "implement the lane",
        non_goals: [],
        scope_paths: [],
        output_schema: "guild.handoff_receipt.v1",
        acceptance_tests: [],
        dependencies: [],
        projection: { tools, permissions: [], recorded_losses: [] },
        autonomy_policy: "supervised",
        budgets: { tokens: null, wall_clock_ms: null, cost_usd: null },
        deadline: null,
        written_at: "2026-09-15T00:00:00.000Z",
        assignment_path: path.join(rel, "assignment.json"),
        handoff_path: path.join(rel, "handoff.json"),
        heartbeat_path: path.join(rel, "heartbeat.json"),
        cancel_channel: path.join(rel, "cancel"),
      },
      null,
      2,
    ),
    "utf8",
  );
}

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guild-projection-gate-")));
  fs.mkdirSync(path.join(tmp, ".guild", "runs", RUN), { recursive: true });
});

describe("PreToolUse projection gate (KTD28)", () => {
  it("allows a tool that IS in the assignment's projection", () => {
    writeAssignment(["Read", "Grep"]);
    const out = runHook({ tool_name: "Read", tool_input: { file_path: "src/a.ts" } });
    expect(decision(out.stdout).permissionDecision).not.toBe("deny");
  });

  it("DENIES a tool outside the projection, at the seam the host actually calls", () => {
    writeAssignment(["Read"]);
    const out = runHook({ tool_name: "Bash", tool_input: { command: "rm -rf /" } });
    const d = decision(out.stdout);
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toMatch(/outside this assignment's tool projection/);
  });

  it("DENIES when the worker declares a cell identity with no assignment on disk", () => {
    // No assignment written: the session claims to be a projected instance and
    // its scope cannot be verified, so it gets no authority at all.
    const out = runHook({ tool_name: "Read", tool_input: { file_path: "src/a.ts" } });
    const d = decision(out.stdout);
    expect(d.permissionDecision).toBe("deny");
    expect(d.permissionDecisionReason).toMatch(/no readable guild.task_assignment.v2/);
  });

  it("has NO opinion on a session that is not a TaskCell worker", () => {
    writeAssignment(["Read"]);
    // A plain session carries no cell identity, so the cell's scope must not
    // leak onto it.
    const out = runHook(
      { tool_name: "Bash", tool_input: { command: "ls" } },
      { GUILD_TASK_ID: "", GUILD_TASK_CELL_INSTANCE_ID: "" },
    );
    expect(decision(out.stdout).permissionDecision).not.toBe("deny");
  });
});
