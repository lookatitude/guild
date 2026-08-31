import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const TELEMETRY = path.resolve(__dirname, "../task-cell-telemetry.ts");
const EVAL = path.resolve(__dirname, "../task-cell-policy-eval.ts");

describe("TaskCell G11 operator gates", () => {
  it("makes an incomplete telemetry run a non-zero close gate", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-g11-cli-"));
    const result = spawnSync("npx", ["tsx", TELEMETRY, "summary", "--cwd", cwd, "--run-id", "run-empty"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: "guild.task_cell_telemetry_summary.v1",
      run_id: "run-empty",
      ok: false,
    });
  });

  it("returns zero only when the paired policy evaluation says promote", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "guild-task-cell-eval-cli-"));
    const file = path.join(cwd, "eval.json");
    const sample = (mode: string, quality: number, cost: number) => ({
      schema_version: "guild.task_cell_policy_eval_observation.v1",
      scenario_id: "s1",
      policy_id: mode === "single_agent_baseline" ? "single" : "multi",
      mode,
      quality_score: quality,
      coverage_score: quality,
      latency_ms: mode === "single_agent_baseline" ? 1000 : 900,
      risk_score: mode === "single_agent_baseline" ? 0.3 : 0.2,
      tokens: mode === "single_agent_baseline" ? 1000 : 1500,
      cost_usd: cost,
      evidence_refs: [`receipts/${mode}.json`],
    });
    const input = {
      baseline: [sample("single_agent_baseline", 0.7, 1)],
      candidate: [sample("multi_agent_candidate", 0.82, 1.5)],
      policy: {
        min_quality_gain: 0.05,
        min_coverage_gain: 0.05,
        min_latency_gain_ratio: 0.05,
        min_risk_reduction: 0.05,
        max_cost_multiplier: 2,
        max_latency_multiplier: 1.25,
        max_risk_increase: 0,
      },
    };
    fs.writeFileSync(file, JSON.stringify(input));
    const pass = spawnSync("npx", ["tsx", EVAL, "--input", file], { encoding: "utf8" });
    expect(pass.status).toBe(0);
    expect(JSON.parse(pass.stdout).promote).toBe(true);

    input.candidate[0].cost_usd = 3;
    fs.writeFileSync(file, JSON.stringify(input));
    const fail = spawnSync("npx", ["tsx", EVAL, "--input", file], { encoding: "utf8" });
    expect(fail.status).toBe(1);
    expect(JSON.parse(fail.stdout).promote).toBe(false);
  });
});
