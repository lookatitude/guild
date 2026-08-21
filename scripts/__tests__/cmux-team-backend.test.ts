import {
  CmuxTeamBackend,
  parseCmuxSurfaceId,
  terminateCmuxSurface,
} from "../lib/host/cmux-backend";
import type {
  PaneAdapter,
  RunFn,
  Specialist,
} from "../lib/core/contracts/team-backend";
import type { ProjectDefinitionRefV1 } from "../lib/core/contracts/project-definition-ref";

const DEFINITION_REF: ProjectDefinitionRefV1 = {
  schema_version: "guild.project_definition_ref.v1",
  project_id: "plugin",
  layer: "project-guild",
  kind: "agent",
  id: "backend",
  relative_path: ".guild/agents/backend.md",
  content_hash: `sha256:${"a".repeat(64)}`,
  source_commit: "0123456789abcdef0123456789abcdef01234567",
  specialist_profile_hash: "b".repeat(64),
  specialist_type_hash: "c".repeat(64),
  skills: [],
};

function lane(name: string, taskId: string): Specialist {
  return {
    name,
    scope: `Implement ${taskId}`,
    dependsOn: [],
    taskId,
    dispatch_key: `${name}--${taskId}--a1`,
    task_cell_instance_id: `${taskId}.a1.i-test`,
    task_cell_assignment_path: `.guild/runs/run-1/task-cells/${taskId}/attempt-1/i/assignment.json`,
    capability_scope: ["Read", "Edit"],
    host_kind: "claude",
  };
}

describe("W4 — CmuxTeamBackend", () => {
  it("opens one visible non-focus-stealing surface per task lane and dispatches scoped commands", () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    let created = 0;
    const run: RunFn = (cmd, args) => {
      calls.push({ cmd, args });
      if (args[0] === "new-pane") {
        created += 1;
        return { status: 0, stdout: JSON.stringify({ surface_id: `surface:${created}` }), stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const backend = new CmuxTeamBackend({ workspaceId: "workspace:9", run });
    const result = backend.launch({
      slug: "cmux-proof",
      runId: "run-20260812-000000-cmux-proof",
      cwd: process.cwd(),
      specialists: [lane("backend", "T1"), lane("backend", "T2")],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: false,
      orchestratorHostKind: "claude",
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("cmux");
    expect(result.teammatePaneIds).toEqual({
      "backend--T1--a1": "surface:1",
      "backend--T2--a1": "surface:2",
    });
    const creates = calls.filter((call) => call.args[0] === "new-pane");
    expect(creates).toHaveLength(2);
    for (const create of creates) {
      expect(create.args).toEqual(expect.arrayContaining(["--workspace", "workspace:9", "--focus", "false"]));
    }
    const sends = calls.filter((call) => call.args[0] === "send");
    expect(sends).toHaveLength(2);
    expect(sends[0].args.at(-1)).toContain("GUILD_CAPABILITY_SCOPE");
    expect(sends[0].args.at(-1)).toContain("GUILD_TASK_CELL_INSTANCE_ID");
    expect(calls.filter((call) => call.args[0] === "set-status")).toHaveLength(2);
    expect(calls.some((call) => call.args[0] === "set-progress")).toBe(true);
  });

  it("rolls back every opened surface when a later lane fails", () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    let created = 0;
    let sends = 0;
    const run: RunFn = (cmd, args) => {
      calls.push({ cmd, args });
      if (args[0] === "new-pane") {
        created += 1;
        return { status: 0, stdout: `surface:${created}\n`, stderr: "" };
      }
      if (args[0] === "send" && ++sends === 2) {
        return { status: 1, stdout: "", stderr: "send failed" };
      }
      if (args[0] === "list-pane-surfaces") {
        return { status: 0, stdout: '{"surfaces":[]}', stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const result = new CmuxTeamBackend({ workspaceId: "workspace:9", run }).launch({
      slug: "cmux-proof",
      runId: "run-20260812-000000-cmux-proof",
      cwd: process.cwd(),
      specialists: [lane("backend", "T1"), lane("security", "T2")],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: false,
    });
    expect(result.ok).toBe(false);
    expect(calls.filter((call) => call.args[0] === "close-surface").map((call) => call.args.at(-1)))
      .toEqual(["surface:2", "surface:1"]);
    expect(calls.some((call) => call.args[0] === "clear-progress")).toBe(true);
    expect(result.notes.join(" ")).toContain("confirmed rollback of 2/2");
    expect(result.teammatePaneIds).toEqual({});
  });

  it("reports unconfirmed rollback survivors and preserves their task handles", () => {
    let created = 0;
    let sends = 0;
    const run: RunFn = (_cmd, args) => {
      if (args[0] === "new-pane") {
        created += 1;
        return { status: 0, stdout: `surface:${created}\n`, stderr: "" };
      }
      if (args[0] === "send" && ++sends === 2) {
        return { status: 1, stdout: "", stderr: "send failed" };
      }
      if (args[0] === "close-surface") {
        return { status: 1, stdout: "", stderr: "close refused" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const result = new CmuxTeamBackend({ workspaceId: "workspace:9", run }).launch({
      slug: "cmux-proof",
      runId: "run-20260812-000000-cmux-proof",
      cwd: process.cwd(),
      specialists: [lane("backend", "T1"), lane("security", "T2")],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: false,
    });

    expect(result.ok).toBe(false);
    expect(result.notes.join(" ")).toContain("2 unconfirmed survivor(s)");
    expect(result.notes.join(" ")).not.toMatch(/rolled back 2 cmux surface/);
    expect(result.teammatePaneIds).toEqual({
      "backend--T1--a1": "surface:1",
      "security--T2--a1": "surface:2",
    });
  });

  it("dry-run performs no cmux calls and pins --focus false in the plan", () => {
    const run = jest.fn(() => ({ status: 0, stdout: "", stderr: "" }));
    const result = new CmuxTeamBackend({ workspaceId: "workspace:9", run }).launch({
      slug: "cmux-proof",
      runId: "run-20260812-000000-cmux-proof",
      cwd: process.cwd(),
      specialists: [lane("backend", "T1")],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: true,
    });
    expect(result.ok).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(result.plannedCommands.join("\n")).toContain("--focus false");
    expect(result.notes.join(" ")).toMatch(/availability.*withheld.*real dispatch/i);
    expect(result.notes.join(" ")).toMatch(/real dispatch may refuse.*before.*writ.*launch/i);
  });

  it("FU08 CONTROL: dry-run skips adapter preflight and performs no cmux calls", () => {
    const run: jest.MockedFunction<RunFn> = jest.fn(
      (_cmd: string, _args: string[]) => ({ status: 0, stdout: "", stderr: "" }),
    );
    const refusingAdapter: PaneAdapter = {
      hostKind: "codex",
      adapterVersion: "test",
      preflight: jest.fn(() => { throw new Error("planted preview subprocess"); }),
      command: () => "codex exec",
      env: () => ({}),
      expectedOutputs: () => [],
    };
    const result = new CmuxTeamBackend({
      workspaceId: "workspace:9",
      run,
      resolveAdapter: () => refusingAdapter,
    }).launch({
      slug: "cmux-preview-failure",
      runId: "run-20260820-120000-cmux-preview-failure",
      cwd: process.cwd(),
      specialists: [{ ...lane("backend", "T1"), host_kind: "codex" }],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(refusingAdapter.preflight).not.toHaveBeenCalled();
    expect(result.plannedCommands.join("\n")).toContain("codex exec");
    expect(run).not.toHaveBeenCalled();
  });

  it("real-dispatch planning preflights adapters without opening cmux surfaces", () => {
    const run: jest.MockedFunction<RunFn> = jest.fn(
      (_cmd: string, _args: string[]) => ({ status: 0, stdout: "", stderr: "" }),
    );
    const refusingAdapter: PaneAdapter = {
      hostKind: "codex",
      adapterVersion: "test",
      preflight: jest.fn(() => ({ ok: false, message: "planted unavailable Codex" })),
      command: () => "codex exec",
      env: () => ({}),
      expectedOutputs: () => [],
    };
    const backend = new CmuxTeamBackend({
      workspaceId: "workspace:9",
      run,
      resolveAdapter: () => refusingAdapter,
    });

    const result = backend.launch({
      slug: "cmux-real-preflight",
      runId: "run-20260820-120000-cmux-real-preflight",
      cwd: process.cwd(),
      specialists: [{ ...lane("backend", "T1"), host_kind: "codex" }],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: true,
      preflightOnly: true,
    });
    expect(result.ok).toBe(false);
    expect(result.notes.join("\n")).toMatch(/planted unavailable Codex/);
    expect(refusingAdapter.preflight).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });

  it("carries and consumes the exact definition ref for a non-Claude lane before reporting it", () => {
    const adapter: PaneAdapter = {
      hostKind: "codex",
      adapterVersion: "test",
      preflight: () => ({ ok: true, message: "ok" }),
      command: () => "codex exec 'do the work'",
      env: () => ({ GUILD_HOST: "codex-cli" }),
      expectedOutputs: () => ["handoff_receipt"],
    };
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run: RunFn = (cmd, args) => {
      calls.push({ cmd, args });
      if (args[0] === "new-pane") {
        return { status: 0, stdout: '{"surface_id":"surface:codex"}', stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };
    const codexLane = {
      ...lane("backend", "T1"),
      host_kind: "codex" as const,
      definition_ref: DEFINITION_REF,
    };

    const result = new CmuxTeamBackend({
      workspaceId: "workspace:9",
      run,
      resolveAdapter: () => adapter,
    }).launch({
      slug: "cmux-definition-proof",
      runId: "run-20260812-000000-cmux-definition-proof",
      cwd: process.cwd(),
      specialists: [codexLane],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: false,
      orchestratorHostKind: "claude",
    });

    expect(result.ok).toBe(true);
    const sentCommand = calls.find((call) => call.args[0] === "send")?.args.at(-1) ?? "";
    const serialized = JSON.stringify(DEFINITION_REF);
    const quoted = `'${serialized}'`;
    const guard =
      `export GUILD_DEFINITION_REF=${quoted}; ` +
      `test "$GUILD_DEFINITION_REF" = ${quoted} || { ` +
      `echo '[GUILD_DEFINITION_REF] exact-carriage check failed' >&2; exit 66; }; `;
    expect(sentCommand).toContain("export GUILD_DEFINITION_REF=");
    expect(sentCommand).toContain('test "$GUILD_DEFINITION_REF" =');
    expect(sentCommand).toContain(serialized);
    const executableIndex = sentCommand.indexOf("codex exec");
    expect(executableIndex).toBeGreaterThan(guard.length);
    expect(sentCommand.slice(executableIndex - guard.length, executableIndex)).toBe(guard);
    expect(result.dispatchPlan[0]?.env["GUILD_DEFINITION_REF"]).toBe(serialized);
    expect(result.dispatchPlan[0]?.definition_ref).toEqual(DEFINITION_REF);
  });

  it.each([
    {
      label: "adapter environment",
      env: { GUILD_DEFINITION_REF: "forged" },
      command: "codex exec 'do the work'",
    },
    {
      label: "adapter command",
      env: { GUILD_HOST: "codex-cli" },
      command: "export GUILD_DEFINITION_REF=forged; codex exec 'do the work'",
    },
  ])("refuses a definition-ref override from the $label", ({ env, command }) => {
    const adapter: PaneAdapter = {
      hostKind: "codex",
      adapterVersion: "adversarial",
      preflight: () => ({ ok: true, message: "ok" }),
      command: () => command,
      env: () => env,
      expectedOutputs: () => ["handoff_receipt"],
    };
    const run: jest.MockedFunction<RunFn> = jest.fn(
      (_cmd: string, _args: string[]) => ({ status: 0, stdout: "", stderr: "" }),
    );
    const result = new CmuxTeamBackend({
      workspaceId: "workspace:9",
      run,
      resolveAdapter: () => adapter,
    }).launch({
      slug: "cmux-definition-override",
      runId: "run-20260812-000000-cmux-definition-override",
      cwd: process.cwd(),
      specialists: [{
        ...lane("backend", "T1"),
        host_kind: "codex",
        definition_ref: DEFINITION_REF,
      }],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: false,
      orchestratorHostKind: "claude",
    });
    expect(result.ok).toBe(false);
    expect(result.notes.join(" ")).toContain("reserved GUILD_DEFINITION_REF boundary");
    expect(result.dispatchPlan).toEqual([]);
    expect(run.mock.calls.some(([, args]) => args[0] === "new-pane" || args[0] === "send")).toBe(false);
  });

  it.each([
    { env: { GUILD_DEFINITION_REF: "forged" }, command: "codex exec 'work'" },
    { env: { GUILD_HOST: "codex-cli" }, command: "export GUILD_DEFINITION_REF=forged; codex exec 'work'" },
  ])("refuses the reserved variable even when the lane has no definition ref", ({ env, command }) => {
    const adapter: PaneAdapter = {
      hostKind: "codex",
      adapterVersion: "adversarial-no-ref",
      preflight: () => ({ ok: true, message: "ok" }),
      command: () => command,
      env: () => env,
      expectedOutputs: () => ["handoff_receipt"],
    };
    const run: jest.MockedFunction<RunFn> = jest.fn(
      (_cmd: string, _args: string[]) => ({ status: 0, stdout: "", stderr: "" }),
    );
    const result = new CmuxTeamBackend({
      workspaceId: "workspace:9",
      run,
      resolveAdapter: () => adapter,
    }).launch({
      slug: "cmux-reserved-no-ref",
      runId: "run-20260812-000000-cmux-reserved-no-ref",
      cwd: process.cwd(),
      specialists: [{ ...lane("backend", "T1"), host_kind: "codex" }],
      targetName: "workspace:9",
      mode: "in-session",
      dryRun: false,
      orchestratorHostKind: "claude",
    });
    expect(result.ok).toBe(false);
    expect(result.notes.join(" ")).toContain("reserved GUILD_DEFINITION_REF boundary");
    expect(result.dispatchPlan).toEqual([]);
    expect(run.mock.calls.some(([, args]) => args[0] === "new-pane" || args[0] === "send")).toBe(false);
  });
});

describe("W4 — cmux surface identity + confirmed termination", () => {
  it("parses JSON and legacy human output", () => {
    expect(parseCmuxSurfaceId('{"pane":{"surface_id":"surface:44"}}')).toBe("surface:44");
    expect(parseCmuxSurfaceId("created surface:45\n")).toBe("surface:45");
    expect(parseCmuxSurfaceId("{}" )).toBeNull();
  });

  it("confirms a closed surface is absent from the live list", () => {
    const run: RunFn = (_cmd, args) =>
      args[0] === "close-surface"
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 0, stdout: '{"surfaces":[{"id":"surface:other"}]}', stderr: "" };
    expect(terminateCmuxSurface("surface:9", run)).toMatchObject({ ok: true, confirmed: true });
  });

  it("parks an unconfirmed survivor instead of claiming teardown", () => {
    const run: RunFn = (_cmd, args) =>
      args[0] === "close-surface"
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 0, stdout: '{"surfaces":[{"id":"surface:9"}]}', stderr: "" };
    expect(terminateCmuxSurface("surface:9", run)).toMatchObject({ ok: false, confirmed: false });
  });

  it("does not mistake a longer surface id for the closed surface", () => {
    const run: RunFn = (_cmd, args) =>
      args[0] === "close-surface"
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 0, stdout: '{"surfaces":[{"id":"surface:90"}]}', stderr: "" };
    expect(terminateCmuxSurface("surface:9", run)).toMatchObject({ ok: true, confirmed: true });
  });

  it("fails closed when the JSON liveness response is malformed", () => {
    const run: RunFn = (_cmd, args) =>
      args[0] === "close-surface"
        ? { status: 0, stdout: "", stderr: "" }
        : { status: 0, stdout: "surface:other", stderr: "" };
    expect(terminateCmuxSurface("surface:9", run)).toMatchObject({
      ok: false,
      confirmed: false,
      degraded: true,
    });
  });
});
