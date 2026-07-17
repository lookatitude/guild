/**
 * scripts/__tests__/mixed-host-contracts.test.ts
 *
 * Focused tests for scripts/lib/mixed-host-contracts.ts — ITEM 19,
 * mixed-host tmux sibling coordination contracts.
 *
 * Contract (BY POINTER): docs/v2/dispatch-execution.md §Mixed-host teams
 *   DI-5 decision; target-architecture.md §TmuxTeam / §LaneStatus.
 *
 * Coverage:
 *   1. Schema version constants — correct frozen strings.
 *   2. LANE_STATUS_VALUES — closed enum, exact members.
 *   3. validateTmuxTeam — happy path, key contract guarantees, malformed/edge cases.
 *   4. validateLaneStatus — happy path, key contract guarantees, malformed/edge cases.
 *   5. Type predicates (isTmuxTeam / isLaneStatus) — delegate to validators correctly.
 *   6. Lenient-reader rule — extra unknown fields are accepted (no false failures).
 *   7. Additive optional fields — absent `host_kind` / `adapter_version` / `capability_scope`
 *      on panes, absent `pct_complete` / `attempt` on lane status: all accepted.
 *
 * All tests are PURE (no disk I/O; deterministic with fixed timestamps and ids).
 */

import {
  TMUX_TEAM_SCHEMA_VERSION,
  LANE_STATUS_SCHEMA_VERSION,
  LANE_STATUS_VALUES,
  validateTmuxTeam,
  validateLaneStatus,
  isTmuxTeam,
  isLaneStatus,
  type TmuxTeam,
  type TmuxTeamPane,
  type LaneStatus,
  type LaneStatusValue,
} from "../lib/mixed-host-contracts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXED_RUN_ID = "run-test-mixedhost-001";
const FIXED_TS = "2026-06-13T12:00:00Z";

/**
 * Minimal valid TmuxTeam artifact. The only additive optional fields
 * that are omitted here (host_kind, adapter_version, capability_scope)
 * should not cause validation failures (lenient-reader rule / optional fields).
 */
function validTeam(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    schema_version: TMUX_TEAM_SCHEMA_VERSION,
    run_id: FIXED_RUN_ID,
    session_name: "guild-test-slug",
    mode: "new-session",
    created_at: FIXED_TS,
    orchestrator_pane_id: "%0",
    mixed_host: true,
    panes: [
      { specialist: "architect", pane_id: "%1" },
      { specialist: "backend", pane_id: "%2", host_kind: "codex", adapter_version: "1" },
    ],
  };
  return { ...base, ...overrides };
}

/**
 * Minimal valid LaneStatus artifact. Optional fields (host_kind,
 * current_step, pct_complete, attempt) are omitted to test optional-field
 * acceptance in separate cases.
 */
function validLane(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  const base: Record<string, unknown> = {
    schema_version: LANE_STATUS_SCHEMA_VERSION,
    run_id: FIXED_RUN_ID,
    lane_id: "backend-api-001",
    specialist: "backend",
    status: "in_progress" as LaneStatusValue,
    heartbeat_at: FIXED_TS,
  };
  return { ...base, ...overrides };
}

// ── 1. Schema version constants ───────────────────────────────────────────────

describe("schema version constants", () => {
  test("TMUX_TEAM_SCHEMA_VERSION is 'guild.tmux_team.v1'", () => {
    expect(TMUX_TEAM_SCHEMA_VERSION).toBe("guild.tmux_team.v1");
  });

  test("LANE_STATUS_SCHEMA_VERSION is 'guild.lane_status.v1'", () => {
    expect(LANE_STATUS_SCHEMA_VERSION).toBe("guild.lane_status.v1");
  });
});

// ── 2. LANE_STATUS_VALUES — closed enum ──────────────────────────────────────

describe("LANE_STATUS_VALUES — closed enum", () => {
  test("contains exactly the 6 expected values in order", () => {
    expect([...LANE_STATUS_VALUES]).toEqual([
      "pending",
      "in_progress",
      "done",
      "failed",
      "dead",
      "skipped",
    ]);
  });

  test("has exactly 6 entries (no silent additions)", () => {
    expect(LANE_STATUS_VALUES).toHaveLength(6);
  });

  test("does NOT include 'errored' (agent-bus event kind, not a run-state status)", () => {
    expect(LANE_STATUS_VALUES).not.toContain("errored");
  });
});

// ── 3. validateTmuxTeam ───────────────────────────────────────────────────────

describe("validateTmuxTeam — happy path", () => {
  test("accepts a fully-specified valid artifact with mixed-host panes", () => {
    const artifact = validTeam();
    const result = validateTmuxTeam(artifact);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("accepts pure-claude team (mixed_host: false, no host_kind on panes)", () => {
    const artifact = validTeam({
      mixed_host: false,
      panes: [
        { specialist: "architect", pane_id: "%1" },
        { specialist: "backend", pane_id: "%2" },
      ],
    });
    const result = validateTmuxTeam(artifact);
    expect(result.valid).toBe(true);
  });

  test("accepts in-session mode", () => {
    const artifact = validTeam({ mode: "in-session" });
    expect(validateTmuxTeam(artifact).valid).toBe(true);
  });

  test("accepts empty panes array (forward-compat with partial-team descriptors)", () => {
    const artifact = validTeam({ panes: [] });
    expect(validateTmuxTeam(artifact).valid).toBe(true);
  });
});

describe("validateTmuxTeam — contract guarantees", () => {
  test("schema_version is always checked against 'guild.tmux_team.v1'", () => {
    const artifact = validTeam({ schema_version: "guild.tmux_team.v2" });
    const result = validateTmuxTeam(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  test("run_id must be a non-empty string", () => {
    expect(validateTmuxTeam(validTeam({ run_id: "" })).valid).toBe(false);
    expect(validateTmuxTeam(validTeam({ run_id: 42 })).valid).toBe(false);
  });

  test("session_name must be a non-empty string", () => {
    expect(validateTmuxTeam(validTeam({ session_name: "" })).valid).toBe(false);
    expect(validateTmuxTeam(validTeam({ session_name: null })).valid).toBe(false);
  });

  test("orchestrator_pane_id must be a non-empty string", () => {
    expect(validateTmuxTeam(validTeam({ orchestrator_pane_id: "" })).valid).toBe(false);
  });

  test("mode must be 'new-session' or 'in-session'", () => {
    expect(validateTmuxTeam(validTeam({ mode: "background" })).valid).toBe(false);
    expect(validateTmuxTeam(validTeam({ mode: undefined })).valid).toBe(false);
  });

  test("created_at must be a non-empty string", () => {
    expect(validateTmuxTeam(validTeam({ created_at: "" })).valid).toBe(false);
    expect(validateTmuxTeam(validTeam({ created_at: 1234567890 })).valid).toBe(false);
  });

  test("panes must be an array", () => {
    const result = validateTmuxTeam(validTeam({ panes: "not-an-array" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("panes"))).toBe(true);
  });

  test("each pane must have non-empty specialist and pane_id", () => {
    const artifact = validTeam({
      panes: [
        { specialist: "", pane_id: "%1" },
        { specialist: "backend", pane_id: "" },
      ],
    });
    const result = validateTmuxTeam(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("specialist"))).toBe(true);
    expect(result.errors.some((e) => e.includes("pane_id"))).toBe(true);
  });

  test("mixed_host must be a boolean", () => {
    expect(validateTmuxTeam(validTeam({ mixed_host: "true" })).valid).toBe(false);
    expect(validateTmuxTeam(validTeam({ mixed_host: 1 })).valid).toBe(false);
  });
});

describe("validateTmuxTeam — lenient-reader / additive optional fields", () => {
  test("extra unknown top-level fields are silently accepted", () => {
    const artifact = validTeam({ _future_field: "some-value", another_field: 42 });
    expect(validateTmuxTeam(artifact).valid).toBe(true);
  });

  test("pane entries without host_kind and adapter_version are accepted (absent = claude / v1)", () => {
    const artifact = validTeam({
      panes: [{ specialist: "architect", pane_id: "%1" }],
    });
    expect(validateTmuxTeam(artifact).valid).toBe(true);
  });

  test("pane entries with capability_scope are accepted (additive optional)", () => {
    const artifact = validTeam({
      panes: [
        {
          specialist: "backend",
          pane_id: "%1",
          host_kind: "codex",
          adapter_version: "1",
          capability_scope: ["Read", "Write"],
        },
      ],
    });
    expect(validateTmuxTeam(artifact).valid).toBe(true);
  });

  test("extra unknown pane fields are silently accepted", () => {
    const artifact = validTeam({
      panes: [{ specialist: "architect", pane_id: "%1", _undocumented: "v3-feature" }],
    });
    expect(validateTmuxTeam(artifact).valid).toBe(true);
  });
});

describe("validateTmuxTeam — malformed / edge cases", () => {
  test("null input is rejected", () => {
    const result = validateTmuxTeam(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-null object"))).toBe(true);
  });

  test("array input is rejected", () => {
    expect(validateTmuxTeam([])).toMatchObject({ valid: false });
  });

  test("primitive input is rejected", () => {
    expect(validateTmuxTeam("guild.tmux_team.v1")).toMatchObject({ valid: false });
    expect(validateTmuxTeam(42)).toMatchObject({ valid: false });
  });

  test("pane that is not an object is flagged with an error", () => {
    const artifact = validTeam({ panes: ["not-a-pane-object"] });
    const result = validateTmuxTeam(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("panes[0]"))).toBe(true);
  });

  test("multiple errors accumulate — all are reported at once", () => {
    const artifact = {
      schema_version: "wrong",
      run_id: "",
      session_name: "",
      mode: "bad-mode",
      created_at: "",
      orchestrator_pane_id: "",
      mixed_host: "yes",
      panes: [],
    };
    const result = validateTmuxTeam(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(3);
  });
});

// ── 4. validateLaneStatus ─────────────────────────────────────────────────────

describe("validateLaneStatus — happy path", () => {
  test("accepts a minimal valid artifact (required fields only)", () => {
    const result = validateLaneStatus(validLane());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("accepts a fully-specified valid artifact with all optional fields", () => {
    const artifact = validLane({
      host_kind: "codex",
      current_step: "Implementing POST /auth endpoint",
      pct_complete: 40,
      attempt: 2,
    });
    expect(validateLaneStatus(artifact).valid).toBe(true);
  });

  test("accepts all valid status values", () => {
    for (const status of LANE_STATUS_VALUES) {
      const artifact = validLane({ status });
      const result = validateLaneStatus(artifact);
      expect(result.valid).toBe(true);
    }
  });

  test("accepts 0 and 100 as boundary pct_complete values", () => {
    expect(validateLaneStatus(validLane({ pct_complete: 0 })).valid).toBe(true);
    expect(validateLaneStatus(validLane({ pct_complete: 100 })).valid).toBe(true);
  });
});

describe("validateLaneStatus — contract guarantees", () => {
  test("schema_version is always checked against 'guild.lane_status.v1'", () => {
    const result = validateLaneStatus(validLane({ schema_version: "guild.tmux_team.v1" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schema_version"))).toBe(true);
  });

  test("run_id must be a non-empty string", () => {
    expect(validateLaneStatus(validLane({ run_id: "" })).valid).toBe(false);
    expect(validateLaneStatus(validLane({ run_id: null })).valid).toBe(false);
  });

  test("lane_id must be a non-empty string", () => {
    expect(validateLaneStatus(validLane({ lane_id: "" })).valid).toBe(false);
  });

  test("specialist must be a non-empty string", () => {
    expect(validateLaneStatus(validLane({ specialist: "" })).valid).toBe(false);
  });

  test("status must be a value in LANE_STATUS_VALUES", () => {
    const result = validateLaneStatus(validLane({ status: "errored" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("status"))).toBe(true);
  });

  test("status 'running' (not in enum) is rejected", () => {
    expect(validateLaneStatus(validLane({ status: "running" })).valid).toBe(false);
  });

  test("heartbeat_at must be a non-empty string", () => {
    expect(validateLaneStatus(validLane({ heartbeat_at: "" })).valid).toBe(false);
    expect(validateLaneStatus(validLane({ heartbeat_at: 1234567890 })).valid).toBe(false);
  });

  test("pct_complete outside [0, 100] is rejected", () => {
    expect(validateLaneStatus(validLane({ pct_complete: -1 })).valid).toBe(false);
    expect(validateLaneStatus(validLane({ pct_complete: 101 })).valid).toBe(false);
    expect(validateLaneStatus(validLane({ pct_complete: "50%" })).valid).toBe(false);
  });

  test("attempt must be a positive integer when present", () => {
    expect(validateLaneStatus(validLane({ attempt: 0 })).valid).toBe(false);
    expect(validateLaneStatus(validLane({ attempt: -1 })).valid).toBe(false);
    expect(validateLaneStatus(validLane({ attempt: 1.5 })).valid).toBe(false);
    // attempt=1 (first retry) is valid
    expect(validateLaneStatus(validLane({ attempt: 1 })).valid).toBe(true);
  });
});

describe("validateLaneStatus — lenient-reader / additive optional fields", () => {
  test("extra unknown top-level fields are silently accepted", () => {
    const artifact = validLane({ _future_field: "abc", v3_metadata: { x: 1 } });
    expect(validateLaneStatus(artifact).valid).toBe(true);
  });

  test("absent pct_complete (undefined) is accepted", () => {
    const artifact = validLane();
    // Explicitly ensure pct_complete is absent
    delete (artifact as Record<string, unknown>)["pct_complete"];
    expect(validateLaneStatus(artifact).valid).toBe(true);
  });

  test("null pct_complete is accepted (explicitly unknown / not measured)", () => {
    expect(validateLaneStatus(validLane({ pct_complete: null })).valid).toBe(true);
  });

  test("null attempt is accepted (absent-equivalent)", () => {
    expect(validateLaneStatus(validLane({ attempt: null })).valid).toBe(true);
  });

  test("absent host_kind is accepted (implies 'claude')", () => {
    const artifact = validLane();
    delete (artifact as Record<string, unknown>)["host_kind"];
    expect(validateLaneStatus(artifact).valid).toBe(true);
  });
});

describe("validateLaneStatus — malformed / edge cases", () => {
  test("null input is rejected", () => {
    const result = validateLaneStatus(null);
    expect(result.valid).toBe(false);
  });

  test("array input is rejected", () => {
    expect(validateLaneStatus([])).toMatchObject({ valid: false });
  });

  test("string input is rejected", () => {
    expect(validateLaneStatus("guild.lane_status.v1")).toMatchObject({ valid: false });
  });

  test("multiple errors accumulate", () => {
    const artifact = {
      schema_version: "wrong",
      run_id: "",
      lane_id: "",
      specialist: "",
      status: "not-a-status",
      heartbeat_at: "",
    };
    const result = validateLaneStatus(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(3);
  });
});

// ── 5. Type predicates ────────────────────────────────────────────────────────

describe("isTmuxTeam", () => {
  test("returns true for a valid artifact", () => {
    expect(isTmuxTeam(validTeam())).toBe(true);
  });

  test("returns false for an invalid artifact", () => {
    expect(isTmuxTeam(null)).toBe(false);
    expect(isTmuxTeam(validTeam({ schema_version: "wrong" }))).toBe(false);
  });

  test("is consistent with validateTmuxTeam.valid", () => {
    const good = validTeam();
    const bad = validTeam({ run_id: "" });
    expect(isTmuxTeam(good)).toBe(validateTmuxTeam(good).valid);
    expect(isTmuxTeam(bad)).toBe(validateTmuxTeam(bad).valid);
  });
});

describe("isLaneStatus", () => {
  test("returns true for a valid artifact", () => {
    expect(isLaneStatus(validLane())).toBe(true);
  });

  test("returns false for an invalid artifact", () => {
    expect(isLaneStatus(null)).toBe(false);
    expect(isLaneStatus(validLane({ status: "not-a-status" }))).toBe(false);
  });

  test("is consistent with validateLaneStatus.valid", () => {
    const good = validLane();
    const bad = validLane({ lane_id: "" });
    expect(isLaneStatus(good)).toBe(validateLaneStatus(good).valid);
    expect(isLaneStatus(bad)).toBe(validateLaneStatus(bad).valid);
  });
});

// ── 6. Cross-contract: schema versions do not collide ─────────────────────────

describe("cross-contract schema version isolation", () => {
  test("a TmuxTeam artifact fails LaneStatus validation (wrong schema_version)", () => {
    const teamArtifact = validTeam();
    expect(validateLaneStatus(teamArtifact).valid).toBe(false);
  });

  test("a LaneStatus artifact fails TmuxTeam validation (wrong schema_version)", () => {
    const laneArtifact = validLane();
    expect(validateTmuxTeam(laneArtifact).valid).toBe(false);
  });
});
