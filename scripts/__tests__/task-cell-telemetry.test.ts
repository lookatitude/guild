import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  appendTaskCellLifecycleEvent,
  importTaskCellUsageFromTrace,
  readTaskCellLifecycleEvents,
  recordTaskCellUsage,
  summarizeTaskCellTelemetry,
  type TaskCellLifecycleEventInput,
} from "../../src/modules/telemetry/workflows/task-cell-telemetry";

function event(
  event_id: string,
  event_name: TaskCellLifecycleEventInput["event_name"],
  at: string,
  extra: Partial<TaskCellLifecycleEventInput> = {},
): TaskCellLifecycleEventInput {
  return {
    event_id,
    event_name,
    at,
    run_id: "run-telemetry",
    cell_id: "cell-T1",
    logical_task_id: "T1",
    task_run_id: "T1.tr1",
    attempt: 1,
    attempt_id: "attempt-1",
    instance_id: "instance-1",
    substrate: "tmux",
    mechanics_mode: "native",
    degradation_reasons: [],
    ...extra,
  };
}

describe("TaskCell lifecycle telemetry", () => {
  it("derives transition latency, rates, hashes, bundle size, degradation, and measured cost", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-telemetry-"));
    const events: TaskCellLifecycleEventInput[] = [
      event("e1", "spawn_started", "2026-08-10T10:00:00.000Z", {
        specialist_type_hash: "sha256:type",
        specialist_profile_hash: "sha256:profile",
        context_bundle_hash: "sha256:context",
        host_capabilities_hash: "sha256:host",
        projection_hash: "sha256:projection",
        context_bundle_bytes: 512,
      }),
      event("e2", "spawned", "2026-08-10T10:00:00.010Z"),
      event("e3", "ready", "2026-08-10T10:00:00.030Z"),
      event("e4", "assignment_delivered", "2026-08-10T10:00:00.050Z"),
      event("e5", "assignment_acknowledged", "2026-08-10T10:00:00.080Z"),
      event("e6", "running", "2026-08-10T10:00:00.080Z"),
      event("e7", "handoff_submitted", "2026-08-10T10:00:00.180Z"),
      event("e8", "handoff_validated", "2026-08-10T10:00:00.200Z"),
      event("e9", "handoff_accepted", "2026-08-10T10:00:00.230Z"),
      event("e10", "termination_started", "2026-08-10T10:00:00.240Z"),
      event("e11", "terminated", "2026-08-10T10:00:00.250Z"),
    ];
    for (const item of events) appendTaskCellLifecycleEvent({ cwd, event: item });
    recordTaskCellUsage({
      cwd,
      usage: {
        schema_version: "guild.task_cell_usage.v1",
        run_id: "run-telemetry",
        cell_id: "cell-T1",
        logical_task_id: "T1",
        task_run_id: "T1.tr1",
        attempt: 1,
        attempt_id: "attempt-1",
        instance_id: "instance-1",
        tokens: 1200,
        cost_usd: 0.42,
        source: "host-receipt",
        measured_at: "2026-08-10T10:00:00.260Z",
      },
    });

    const summary = summarizeTaskCellTelemetry({ cwd, runId: "run-telemetry" });
    expect(summary.ok).toBe(true);
    expect(summary.instances[0]).toMatchObject({
      instance_id: "instance-1",
      latency_ms: {
        spawn: 10,
        ready: 20,
        assign: 20,
        ack: 30,
        handoff: 100,
        accept: 30,
        terminate: 10,
      },
      usage: { status: "measured", tokens: 1200, cost_usd: 0.42 },
      bundle: {
        context_bundle_bytes: 512,
        context_bundle_hash: "sha256:context",
        projection_hash: "sha256:projection",
      },
    });
    expect(summary.rates).toMatchObject({
      success: 1,
      retry: 0,
      rejection: 0,
      timeout: 0,
      duplicate: 0,
      orphan: 0,
      leak: 0,
    });
  });

  it("fails closed on duplicate event ids, corrupt ledger lines, and unavailable usage", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-telemetry-bad-"));
    appendTaskCellLifecycleEvent({ cwd, event: event("same", "spawn_started", "2026-08-10T10:00:00.000Z") });
    expect(() => appendTaskCellLifecycleEvent({
      cwd,
      event: event("same", "spawned", "2026-08-10T10:00:00.010Z"),
    })).toThrow(/duplicate event_id/);

    const ledger = path.join(cwd, ".guild", "runs", "run-telemetry", "task-cell-telemetry", "events.jsonl");
    fs.appendFileSync(ledger, "{not-json}\n");
    expect(() => readTaskCellLifecycleEvents({ cwd, runId: "run-telemetry" })).toThrow(/invalid telemetry ledger/);

    fs.writeFileSync(ledger, `${JSON.stringify({
      schema_version: "guild.task_cell_lifecycle_event.v1",
      ...event("clean", "spawn_started", "2026-08-10T10:00:00.000Z"),
    })}\n`);
    const summary = summarizeTaskCellTelemetry({ cwd, runId: "run-telemetry" });
    expect(summary.ok).toBe(false);
    expect(summary.instances[0].usage).toEqual({
      status: "unavailable",
      tokens: null,
      cost_usd: null,
      reason: "no measured usage record",
    });
    expect(summary.rates.leak).toBe(1);
  });

  it("rejects lifecycle identity drift for an existing instance", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-telemetry-drift-"));
    appendTaskCellLifecycleEvent({ cwd, event: event("drift-1", "spawn_started", "2026-08-10T10:00:00.000Z") });
    const ledger = path.join(cwd, ".guild", "runs", "run-telemetry", "task-cell-telemetry", "events.jsonl");
    fs.appendFileSync(ledger, `${JSON.stringify({
      schema_version: "guild.task_cell_lifecycle_event.v1",
      ...event("drift-2", "spawned", "2026-08-10T10:00:00.010Z", { logical_task_id: "T-forged" }),
    })}\n`);

    expect(() => readTaskCellLifecycleEvents({ cwd, runId: "run-telemetry" })).toThrow(/identity drift.*instance-1/);
  });

  it("rejects substrate or mechanics drift for an existing instance", () => {
    for (const patch of [{ substrate: "remote" as const }, { mechanics_mode: "degraded" as const }]) {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-telemetry-mechanics-drift-"));
      appendTaskCellLifecycleEvent({ cwd, event: event("mechanics-1", "spawn_started", "2026-08-10T10:00:00.000Z") });
      const ledger = path.join(cwd, ".guild", "runs", "run-telemetry", "task-cell-telemetry", "events.jsonl");
      fs.appendFileSync(ledger, `${JSON.stringify({
        schema_version: "guild.task_cell_lifecycle_event.v1",
        ...event("mechanics-2", "spawned", "2026-08-10T10:00:00.010Z", patch),
      })}\n`);
      expect(() => readTaskCellLifecycleEvents({ cwd, runId: "run-telemetry" })).toThrow(/identity drift.*instance-1/);
    }
  });

  it("imports exact-instance token and cost usage from the canonical trace without double counting", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-trace-usage-"));
    appendTaskCellLifecycleEvent({ cwd, event: event("trace-1", "spawn_started", "2026-08-10T10:00:00.000Z") });
    appendTaskCellLifecycleEvent({ cwd, event: event("trace-2", "terminated", "2026-08-10T10:00:01.000Z") });
    const logs = path.join(cwd, ".guild", "runs", "run-telemetry", "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "v1.4-events.jsonl"), [
      { schema_version: "guild.trace_event.v2", event_id: "u1", event_name: "specialist_dispatch", run_id: "run-telemetry", at: "2026-08-10T10:00:00.100Z", task_cell_instance_id: "instance-1", tokens: { input: 100, output: 20, cost_usd: 0.03 } },
      { schema_version: "guild.trace_event.v2", event_id: "u2", event_name: "specialist_receipt", run_id: "run-telemetry", at: "2026-08-10T10:00:00.900Z", task_cell_instance_id: "instance-1", tokens: { input: 50, output: 30, cached: 10, cost_usd: 0.02 } },
      { schema_version: "guild.trace_event.v2", event_id: "other", event_name: "specialist_receipt", run_id: "run-telemetry", at: "2026-08-10T10:00:00.900Z", task_cell_instance_id: "other-instance", tokens: { input: 999, output: 999, cost_usd: 9 } },
    ].map((item) => JSON.stringify(item)).join("\n") + "\n");

    const first = importTaskCellUsageFromTrace({ cwd, runId: "run-telemetry" });
    expect(first).toEqual({ ok: true, imported: ["instance-1"], unavailable: [], parse_errors: 0 });
    const second = importTaskCellUsageFromTrace({ cwd, runId: "run-telemetry" });
    expect(second).toEqual(first);
    expect(summarizeTaskCellTelemetry({ cwd, runId: "run-telemetry" }).instances[0].usage).toMatchObject({
      status: "measured",
      tokens: 200,
      cost_usd: 0.05,
      source: "guild.trace_event.v2",
    });
  });

  it("refuses an exact-instance trace event when any present usage field is invalid", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-trace-invalid-usage-"));
    appendTaskCellLifecycleEvent({ cwd, event: event("invalid-1", "spawn_started", "2026-08-10T10:00:00.000Z") });
    const logs = path.join(cwd, ".guild", "runs", "run-telemetry", "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "v1.4-events.jsonl"), `${JSON.stringify({
      schema_version: "guild.trace_event.v2",
      event_id: "invalid-usage",
      event_name: "specialist_dispatch",
      run_id: "run-telemetry",
      at: "2026-08-10T10:00:00.100Z",
      task_cell_instance_id: "instance-1",
      tokens: { input: -50, output: 100, cost_usd: 0.5 },
    })}\n`);

    expect(importTaskCellUsageFromTrace({ cwd, runId: "run-telemetry" })).toEqual({
      ok: false,
      imported: [],
      unavailable: [{ instance_id: "instance-1", reason: "trace usage contains invalid input" }],
      parse_errors: 0,
    });
    expect(fs.existsSync(path.join(cwd, ".guild", "runs", "run-telemetry", "task-cell-telemetry", "usage", "instance-1.json"))).toBe(false);
  });

  it("refuses a present non-object token envelope even when another exact-instance event is valid", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-trace-invalid-envelope-"));
    appendTaskCellLifecycleEvent({ cwd, event: event("envelope-1", "spawn_started", "2026-08-10T10:00:00.000Z") });
    const logs = path.join(cwd, ".guild", "runs", "run-telemetry", "logs");
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(path.join(logs, "v1.4-events.jsonl"), [
      { schema_version: "guild.trace_event.v2", event_id: "valid", run_id: "run-telemetry", at: "2026-08-10T10:00:00.100Z", task_cell_instance_id: "instance-1", tokens: { input: 10, output: 5, cost_usd: 0.1 } },
      { schema_version: "guild.trace_event.v2", event_id: "invalid", run_id: "run-telemetry", at: "2026-08-10T10:00:00.200Z", task_cell_instance_id: "instance-1", tokens: "garbage" },
    ].map((item) => JSON.stringify(item)).join("\n") + "\n");

    expect(importTaskCellUsageFromTrace({ cwd, runId: "run-telemetry" })).toEqual({
      ok: false,
      imported: [],
      unavailable: [{ instance_id: "instance-1", reason: "trace usage contains invalid tokens envelope" }],
      parse_errors: 0,
    });
  });
});
