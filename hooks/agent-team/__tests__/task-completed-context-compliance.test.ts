/**
 * Integration tests for the context-assemble compliance enforcement wired into
 * hooks/agent-team/task-completed.ts (the REAL hook path, spawned end-to-end).
 *
 * Verifies the all-lanes/no-assemble fix on the actual dispatch path:
 *   - lane with NEITHER bundle nor trace → loud VIOLATION + context_mode=MISSING
 *   - lane WITH a context-assemble bundle → context_mode=assemble, no violation
 *   - lane WITH only a dispatch-trace entry → context_mode=inline, no violation
 *   - both telemetry channels land (context-compliance.jsonl + v1.4 hook_event)
 *   - compliance is non-blocking (exit 0 in every mode — the lane is complete)
 */

import { spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const SCRIPT = path.resolve(__dirname, "../task-completed.ts");

function runScript(
  payloadOverride: object,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT], {
    input: JSON.stringify(payloadOverride),
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

const FULL_RECEIPT_FIELDS = {
  changed_files: "- hooks/agent-team/task-completed.ts",
  opens_for: "- none",
  assumptions: "- none",
  evidence: "- exit code 0",
  followups: "- none",
};

const VALID_ENVELOPE = {
  schema_version: "guild.handoff.v2",
  task_id: "task-001",
  tier: "mid",
  status: "done",
  summary: "Did the work.",
  artifacts: ["src/x.ts:1-10"],
  issues: [],
  learnings: [],
};

function createReceipt(
  runDir: string,
  specialist: string,
  taskId: string,
  envelope?: object,
): void {
  const handoffsDir = path.join(runDir, "handoffs");
  fs.mkdirSync(handoffsDir, { recursive: true });
  const fields = Object.entries(FULL_RECEIPT_FIELDS)
    .map(([k, v]) => `## ${k}\n${v}`)
    .join("\n\n");
  let content = `# Handoff Receipt\n\n${fields}\n`;
  if (envelope) {
    content += `\n\`\`\`guild.handoff.v2\n${JSON.stringify(envelope, null, 2)}\n\`\`\`\n`;
  }
  fs.writeFileSync(path.join(handoffsDir, `${specialist}-${taskId}.md`), content);
}

function readComplianceLog(runDir: string): Array<Record<string, unknown>> {
  const file = path.join(runDir, "context-compliance.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function readV14ContextEvents(runDir: string): Array<Record<string, unknown>> {
  const file = path.join(runDir, "logs", "v1.4-events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter(
      (e) =>
        e.event === "hook_event" &&
        typeof e.payload_excerpt_redacted === "string" &&
        (e.payload_excerpt_redacted as string).includes("context_mode="),
    );
}

describe("task-completed.ts — context-assemble compliance (real path)", () => {
  let tmp: string;
  const runId = "run-ctx";
  const specialist = "backend";
  const taskId = "task-001";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "guild-ctxhook-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function runDir(): string {
    return path.join(tmp, ".guild", "runs", runId);
  }

  const basePayload = {
    session_id: "ctx",
    cwd: "", // filled per test (tmp)
    hook_event_name: "TaskCompleted",
    task_id: taskId,
    teammate_name: specialist,
    team_name: "guild-team",
  };

  it("MISSING: neither bundle nor trace → loud violation + context_mode=MISSING, still exit 0", () => {
    createReceipt(runDir(), specialist, taskId, { ...VALID_ENVELOPE });

    const { exitCode, stderr } = runScript(
      { ...basePayload, cwd: tmp },
      { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId },
    );

    expect(exitCode).toBe(0); // non-blocking — lane already complete
    expect(stderr).toMatch(/CONTEXT-COMPLIANCE VIOLATION/);
    expect(stderr).toMatch(/context_mode=MISSING/);

    const log = readComplianceLog(runDir());
    expect(log.length).toBe(1);
    expect(log[0].context_mode).toBe("MISSING");
    expect(log[0].gap).toBe(true);
    expect(log[0].schema_version).toBe("guild.context_compliance.v1");

    const events = readV14ContextEvents(runDir());
    expect(events.length).toBe(1);
    expect(events[0].status).toBe("err");
    expect(events[0].payload_excerpt_redacted).toMatch(/context_mode=MISSING/);
  });

  it("assemble: a context-assemble bundle present → context_mode=assemble, no violation", () => {
    createReceipt(runDir(), specialist, taskId, { ...VALID_ENVELOPE });
    // Stage the bundle at the canonical path.
    const bundleDir = path.join(tmp, ".guild", "context", runId);
    fs.mkdirSync(bundleDir, { recursive: true });
    fs.writeFileSync(
      path.join(bundleDir, `${specialist}-${taskId}.md`),
      "# context bundle\nstaged context for the lane\n",
    );

    const { exitCode, stderr } = runScript(
      { ...basePayload, cwd: tmp },
      { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId },
    );

    expect(exitCode).toBe(0);
    expect(stderr).not.toMatch(/CONTEXT-COMPLIANCE VIOLATION/);
    expect(stderr).toMatch(/context_mode=assemble/);

    const log = readComplianceLog(runDir());
    expect(log[0].context_mode).toBe("assemble");
    expect(log[0].gap).toBe(false);

    const events = readV14ContextEvents(runDir());
    expect(events[0].status).toBe("ok");
  });

  it("inline: only a dispatch-trace entry with files → context_mode=inline, no violation", () => {
    createReceipt(runDir(), specialist, taskId, { ...VALID_ENVELOPE });
    // Write the inline audit trail naming the lane + a file-listed working set.
    fs.writeFileSync(
      path.join(runDir(), "dispatch-trace.md"),
      [
        "# dispatch-trace",
        "",
        "- backend-task-001 · tier mid · inlined working set:",
        "  - hooks/agent-team/task-completed.ts",
        "  - hooks/lib/context-compliance.ts",
        "",
      ].join("\n"),
    );

    const { exitCode, stderr } = runScript(
      { ...basePayload, cwd: tmp },
      { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId },
    );

    expect(exitCode).toBe(0);
    expect(stderr).not.toMatch(/CONTEXT-COMPLIANCE VIOLATION/);
    expect(stderr).toMatch(/context_mode=inline/);

    const log = readComplianceLog(runDir());
    expect(log[0].context_mode).toBe("inline");
    expect(log[0].trace_entry_found).toBe(true);
    expect(log[0].gap).toBe(false);
  });

  it("does not run the compliance check when the lane is blocked (missing receipt)", () => {
    // No receipt written → the hook dies before the compliance check.
    const { exitCode } = runScript(
      { ...basePayload, cwd: tmp },
      { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1", GUILD_RUN_ID: runId },
    );
    expect(exitCode).not.toBe(0);
    expect(readComplianceLog(runDir()).length).toBe(0);
  });
});
