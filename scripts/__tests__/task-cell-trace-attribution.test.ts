import { resolveTraceV2Fields } from "../../src/modules/lifecycle/workflows/trace-v2";

describe("TaskCell trace attribution", () => {
  it("binds provider usage to the exact launcher-authored runtime instance", () => {
    const fields = resolveTraceV2Fields({
      runId: "run-1",
      eventType: "specialist_receipt",
      ts: "2026-08-10T10:00:00.000Z",
      actorId: "backend",
      env: {
        GUILD_TASK_CELL_INSTANCE_ID: "T1.a1.i-abc",
        GUILD_TIER: "mid",
        GUILD_MODEL: "model-mid",
      },
      tokens: { input: 100, output: 25, cost_usd: 0.04 },
    });
    expect(fields.task_cell_instance_id).toBe("T1.a1.i-abc");
    expect(fields.tokens).toEqual({ input: 100, output: 25, cost_usd: 0.04 });
  });
});
