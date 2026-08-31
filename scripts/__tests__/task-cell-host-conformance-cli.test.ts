import * as path from "node:path";

import { parseArgs } from "../task-cell-host-conformance";
import { repairRoundPrompt, streamedHostOutput } from "../guild-run";

describe("task-cell-host-conformance CLI", () => {
  it("accepts a deduplicated host matrix and deterministic output path", () => {
    expect(parseArgs([
      "--hosts", "claude,codex,claude",
      "--cwd", "/tmp/guild-probe",
      "--run-id", "run-g9",
    ])).toMatchObject({
      hosts: ["claude", "codex"],
      cwd: "/tmp/guild-probe",
      run_id: "run-g9",
      output: path.join("/tmp/guild-probe", ".guild", "runs", "run-g9", "task-cell-host-conformance", "matrix.json"),
    });
  });

  it("refuses an empty matrix and unsafe run ids", () => {
    expect(parseArgs([])).toEqual({ error: "at least one --host/--hosts or --receipt value is required" });
    expect(parseArgs(["--host", "codex", "--run-id", "../escape"])).toEqual({ error: "--run-id must be a safe path segment" });
  });

  it("streams a successful repaired wire result instead of the invalid initial output", () => {
    const repaired = {
      ok: true,
      wire_schema_version: "guild.handoff.v2",
      value: { schema_version: "guild.handoff.v2" },
      errors: [],
      rounds_used: 1,
      failed_closed: false,
    };
    expect(streamedHostOutput("invalid-initial", "valid-repair", repaired)).toBe("valid-repair");
    expect(streamedHostOutput("invalid-initial", "still-invalid", { ...repaired, ok: false, failed_closed: true })).toBe("invalid-initial");
  });

  it("keeps the assignment-bound task in every schema-repair round", () => {
    expect(repairRoundPrompt("read assignment at a.json", "add schema_version")).toContain("read assignment at a.json");
    expect(repairRoundPrompt("read assignment at a.json", "add schema_version")).toContain("add schema_version");
  });
});
