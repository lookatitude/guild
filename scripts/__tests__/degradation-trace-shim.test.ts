import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/degradation-trace";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/degradation-trace";

describe("degradation-trace compatibility shim", () => {
  test("scripts/lib/degradation-trace re-exports src/modules/host-runtime", () => {
    expect(shim.DEGRADATION_KINDS).toBe(moduleImpl.DEGRADATION_KINDS);
    expect(shim.DEGRADATION_TRACE_SCHEMA).toBe(moduleImpl.DEGRADATION_TRACE_SCHEMA);
    expect(shim.DEGRADATION_EVENT_TYPE).toBe(moduleImpl.DEGRADATION_EVENT_TYPE);
    expect(shim.PARALLELISM_MODES).toBe(moduleImpl.PARALLELISM_MODES);
    expect(shim.RETRIEVAL_FALLBACK_KINDS).toBe(moduleImpl.RETRIEVAL_FALLBACK_KINDS);
    expect(shim.makeDegradationRow).toBe(moduleImpl.makeDegradationRow);
    expect(shim.validateDegradationRow).toBe(moduleImpl.validateDegradationRow);
    expect(shim.isValidDegradationRow).toBe(moduleImpl.isValidDegradationRow);
  });

  test("preserves degradation trace row behavior through the shim", () => {
    const row = shim.makeDegradationRow("feature_degraded", {
      run_id: "run-shim",
      ts: "2026-06-21T12:00:00Z",
      feature: "permission_mode",
      fdc_row: "FDC-11",
      degraded_reason: "no_ask_primitive",
      degraded_path: "file_bus_pause",
    });
    expect(row).toMatchObject({
      schema_version: "guild.trace_event.v1",
      event_type: "feature_degraded",
      kind: "feature_degraded",
      run_id: "run-shim",
      degradation: {
        kind: "feature_degraded",
        feature: "permission_mode",
      },
    });
    expect(shim.validateDegradationRow(row)).toEqual({ valid: true });
    expect(shim.isValidDegradationRow({ kind: "feature_degraded" })).toBe(false);
  });

  test("only the module file defines degradation trace builders", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/degradation-trace.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/degradation-trace.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/degradation-trace["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+makeDegradationRow/);
    expect(modulePath).toMatch(/export\s+function\s+makeDegradationRow/);
    expect(modulePath).toMatch(/export\s+const\s+DEGRADATION_KINDS/);
  });
});
