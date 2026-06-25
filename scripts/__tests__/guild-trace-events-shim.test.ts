import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/guild-trace-events";
import * as moduleImpl from "../../src/modules/telemetry/workflows/guild-trace-events";

describe("guild-trace-events compatibility shim", () => {
  test("scripts/lib/guild-trace-events re-exports src/modules/telemetry", () => {
    expect(shim.GUILD_TRACE_SCHEMA_VERSIONS).toBe(moduleImpl.GUILD_TRACE_SCHEMA_VERSIONS);
    expect(shim.validateDispatchEvent).toBe(moduleImpl.validateDispatchEvent);
    expect(shim.validateRecallEvent).toBe(moduleImpl.validateRecallEvent);
    expect(shim.validateConfigResolutionEvent).toBe(moduleImpl.validateConfigResolutionEvent);
    expect(shim.validateSecurityDecisionEvent).toBe(moduleImpl.validateSecurityDecisionEvent);
    expect(shim.validateDegradationEvent).toBe(moduleImpl.validateDegradationEvent);
    expect(shim.validateGuildTraceEvent).toBe(moduleImpl.validateGuildTraceEvent);
    expect(shim.makeDispatchEvent).toBe(moduleImpl.makeDispatchEvent);
    expect(shim.makeRecallEvent).toBe(moduleImpl.makeRecallEvent);
    expect(shim.makeConfigResolutionEvent).toBe(moduleImpl.makeConfigResolutionEvent);
    expect(shim.makeSecurityDecisionEvent).toBe(moduleImpl.makeSecurityDecisionEvent);
    expect(shim.makeDegradationEvent).toBe(moduleImpl.makeDegradationEvent);
  });

  test("legacy path stays a thin public wrapper", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/guild-trace-events.ts"), "utf8");
    const modulePath = fs.readFileSync(
      path.join(repoRoot, "src/modules/telemetry/workflows/guild-trace-events.ts"),
      "utf8",
    );

    expect(oldPath).toMatch(/src\/modules\/telemetry\/workflows\/guild-trace-events/);
    expect(oldPath).not.toMatch(/export\s+function\s+validateRecallEvent/);
    expect(modulePath).toMatch(/export\s+function\s+validateRecallEvent/);
    expect(modulePath).toMatch(/export\s+function\s+makeSecurityDecisionEvent/);
  });
});
