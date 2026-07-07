import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/guild-trace-emit";
import * as moduleImpl from "../../src/modules/telemetry/workflows/guild-trace-emit";

describe("guild-trace-emit compatibility shim", () => {
  test("scripts/lib/guild-trace-emit re-exports src/modules/telemetry", () => {
    expect(shim.emitTraceEvent).toBe(moduleImpl.emitTraceEvent);
  });

  test("legacy path stays a thin public wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/guild-trace-emit.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/telemetry/workflows/guild-trace-emit.ts"),
      "utf8",
    );

    expect(oldPath).toMatch(/src\/modules\/telemetry\/workflows\/guild-trace-emit/);
    expect(oldPath).not.toMatch(/export\s+function\s+emitTraceEvent/);
    expect(modulePath).toMatch(/export\s+function\s+emitTraceEvent/);
    expect(modulePath).toMatch(/validateGuildTraceEvent/);
  });
});
