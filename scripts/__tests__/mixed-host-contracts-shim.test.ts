import * as fs from "node:fs";
import * as path from "node:path";
import * as shim from "../lib/mixed-host-contracts";
import * as moduleImpl from "../../src/modules/host-runtime/workflows/mixed-host-contracts";

describe("mixed-host-contracts compatibility shim", () => {
  test("scripts/lib/mixed-host-contracts re-exports src/modules/host-runtime", () => {
    expect(shim.TMUX_TEAM_SCHEMA_VERSION).toBe(moduleImpl.TMUX_TEAM_SCHEMA_VERSION);
    expect(shim.LANE_STATUS_SCHEMA_VERSION).toBe(moduleImpl.LANE_STATUS_SCHEMA_VERSION);
    expect(shim.LANE_STATUS_VALUES).toBe(moduleImpl.LANE_STATUS_VALUES);
    expect(shim.validateTmuxTeam).toBe(moduleImpl.validateTmuxTeam);
    expect(shim.validateLaneStatus).toBe(moduleImpl.validateLaneStatus);
    expect(shim.isTmuxTeam).toBe(moduleImpl.isTmuxTeam);
    expect(shim.isLaneStatus).toBe(moduleImpl.isLaneStatus);
  });

  test("preserves mixed-host contract validation through the shim", () => {
    const team = {
      schema_version: shim.TMUX_TEAM_SCHEMA_VERSION,
      run_id: "run-shim",
      session_name: "guild-shim",
      mode: "new-session",
      created_at: "2026-06-21T12:00:00Z",
      orchestrator_pane_id: "%0",
      mixed_host: true,
      panes: [{ specialist: "backend", pane_id: "%1", host_kind: "codex", adapter_version: "1" }],
    };
    const lane = {
      schema_version: shim.LANE_STATUS_SCHEMA_VERSION,
      run_id: "run-shim",
      lane_id: "backend-api-001",
      specialist: "backend",
      host_kind: "codex",
      status: "in_progress",
      heartbeat_at: "2026-06-21T12:01:00Z",
      pct_complete: 40,
      attempt: 1,
    };

    expect(shim.validateTmuxTeam(team)).toEqual({ valid: true, errors: [] });
    expect(shim.validateLaneStatus(lane)).toEqual({ valid: true, errors: [] });
    expect(shim.isTmuxTeam(team)).toBe(true);
    expect(shim.isLaneStatus({ ...lane, status: "errored" })).toBe(false);
  });

  test("only the module file defines mixed-host validators", () => {
    const repoRoot = path.resolve(__dirname, "../..");
    const oldPath = fs.readFileSync(path.join(repoRoot, "scripts/lib/mixed-host-contracts.ts"), "utf8");
    const modulePath = fs.readFileSync(path.join(repoRoot, "src/modules/host-runtime/workflows/mixed-host-contracts.ts"), "utf8");

    expect(oldPath).toMatch(/export\s+\*\s+from\s+["']\.\.\/\.\.\/src\/modules\/host-runtime\/workflows\/mixed-host-contracts["']/);
    expect(oldPath).not.toMatch(/export\s+function\s+validateTmuxTeam/);
    expect(modulePath).toMatch(/export\s+function\s+validateTmuxTeam/);
    expect(modulePath).toMatch(/export\s+function\s+validateLaneStatus/);
    expect(modulePath).toMatch(/from\s+["']\.\/host-types["']/);
  });
});
