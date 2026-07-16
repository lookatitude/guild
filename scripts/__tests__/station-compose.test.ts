/**
 * scripts/__tests__/station-compose.test.ts
 *
 * G6b-1 (task-cell-runtime P0.6) — TDD for the station-compose CLI + the
 * `guild.station_signals.v1` contract + team_plan/team_result emission helpers.
 *
 * Covers:
 *  - CLI composes a station from a signals block and prints valid team_plan JSON.
 *  - CLI --signals - reads the signals block from stdin.
 *  - CLI --emit --run-id writes the plan to the canonical run-tree path.
 *  - CLI unknown station → non-zero exit + clear stderr (never a silent team).
 *  - CLI malformed signals JSON / invalid signals block → non-zero exit.
 *  - CLI --emit without --run-id → non-zero exit.
 *  - validateStationSignalsV1 rejects unknown signal keys / non-boolean values /
 *    bad schema_version / unknown top-level keys; accepts absent + empty signals.
 *  - writeTeamPlan / writeTeamResult round-trip through the canonical path and
 *    fail-closed on an invalid artifact.
 *  - emission refuses a run-tree escape (unsafe run_id).
 */

import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { validateTeamPlanV1 } from "../../src/modules/teams/workflows/station-composer";
import {
  STATION_SIGNALS_SCHEMA,
  emptyStationSignalsV1,
  readTeamPlan,
  readTeamResult,
  signalsOf,
  validateStationSignalsV1,
  writeTeamPlan,
  writeTeamResult,
} from "../../src/modules/teams/workflows/station-signals";

const SCRIPT = path.resolve(__dirname, "../station-compose.ts");

function runCli(
  args: string[],
  opts: { input?: string } = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 120_000,
    input: opts.input,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "station-compose-"));
}

function writeSignals(dir: string, block: unknown): string {
  const p = path.join(dir, "signals.json");
  fs.writeFileSync(p, JSON.stringify(block), "utf8");
  return p;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

describe("station-compose CLI", () => {
  test("composes a station from a signals block and prints valid team_plan JSON", () => {
    const tmp = mkTmp();
    const signals = writeSignals(tmp, {
      schema_version: STATION_SIGNALS_SCHEMA,
      signals: { multi_component: true, auth_touched: true },
    });
    const r = runCli(["build", "--signals", signals, "--cwd", tmp]);
    expect(r.exitCode).toBe(0);
    const plan = validateTeamPlanV1(JSON.parse(r.stdout));
    expect(plan).not.toBeNull();
    expect(plan!.station).toBe("build");
    // Non-vacuous: multi_component adds architect (optional), auth_touched fires
    // the security implied rule — both recorded in fired_rules.
    expect(plan!.fired_rules).toEqual(expect.arrayContaining(["opt:build:architect", "auth_touched"]));
    const roles = plan!.roster.map((l) => l.role);
    expect(roles).toEqual(expect.arrayContaining(["qa", "security", "architect"]));
    // Every lane carries a real roster-derived tier (not a hand table).
    for (const lane of plan!.roster) {
      expect(["cheap", "mid", "powerful"]).toContain(lane.default_tier);
    }
  });

  test("no --signals ⇒ all-false composition (defaults only, no implied rules)", () => {
    const tmp = mkTmp();
    const r = runCli(["build", "--cwd", tmp]);
    expect(r.exitCode).toBe(0);
    const plan = validateTeamPlanV1(JSON.parse(r.stdout));
    expect(plan).not.toBeNull();
    expect(plan!.fired_rules).toEqual([]);
    expect(plan!.roster.map((l) => l.role)).toEqual(["qa", "security"]);
  });

  test("reads the signals block from stdin with --signals -", () => {
    const tmp = mkTmp();
    const r = runCli(["plan", "--signals", "-", "--cwd", tmp], {
      input: JSON.stringify({
        schema_version: STATION_SIGNALS_SCHEMA,
        signals: { auth_touched: true },
      }),
    });
    expect(r.exitCode).toBe(0);
    const plan = validateTeamPlanV1(JSON.parse(r.stdout));
    expect(plan).not.toBeNull();
    // plan station has a security conditional gated on auth_touched.
    expect(plan!.fired_rules).toContain("opt:plan:security");
    expect(plan!.roster.map((l) => l.role)).toContain("security");
  });

  test("--emit --run-id writes the plan to the canonical run-tree path", () => {
    const tmp = mkTmp();
    const signals = writeSignals(tmp, {
      schema_version: STATION_SIGNALS_SCHEMA,
      signals: {},
    });
    const runId = "run-emit-1";
    const r = runCli(["qa", "--signals", signals, "--cwd", tmp, "--run-id", runId, "--emit"]);
    expect(r.exitCode).toBe(0);
    const expected = path.join(tmp, ".guild", "runs", runId, "team-plan", "qa.json");
    expect(fs.existsSync(expected)).toBe(true);
    const persisted = validateTeamPlanV1(JSON.parse(fs.readFileSync(expected, "utf8")));
    expect(persisted).not.toBeNull();
    expect(persisted!.station).toBe("qa");
  });

  test("unknown station → non-zero exit + clear stderr, never a team on stdout", () => {
    const r = runCli(["notastation"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/unknown station/i);
    expect(r.stdout.trim()).toBe("");
  });

  test("malformed signals JSON → non-zero exit", () => {
    const tmp = mkTmp();
    const p = path.join(tmp, "bad.json");
    fs.writeFileSync(p, "{ not json", "utf8");
    const r = runCli(["build", "--signals", p, "--cwd", tmp]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/malformed signals/i);
  });

  test("invalid signals block (unknown key) → non-zero exit", () => {
    const tmp = mkTmp();
    const signals = writeSignals(tmp, {
      schema_version: STATION_SIGNALS_SCHEMA,
      signals: { not_a_signal: true },
    });
    const r = runCli(["build", "--signals", signals, "--cwd", tmp]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/invalid guild\.station_signals\.v1/i);
  });

  test("--emit without --run-id → non-zero exit", () => {
    const r = runCli(["build", "--emit"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/--emit requires --run-id/i);
  });
});

// ── guild.station_signals.v1 validator ───────────────────────────────────────

describe("validateStationSignalsV1", () => {
  test("accepts a well-formed block with boolean signals + source_ref", () => {
    const block = validateStationSignalsV1({
      schema_version: STATION_SIGNALS_SCHEMA,
      signals: { auth_touched: true, backend_present: false },
      source_ref: ".guild/spec/foo.md",
    });
    expect(block).not.toBeNull();
    expect(block!.signals.auth_touched).toBe(true);
  });

  test("accepts an empty signals object (all-false composition)", () => {
    expect(validateStationSignalsV1(emptyStationSignalsV1())).not.toBeNull();
    expect(
      validateStationSignalsV1({ schema_version: STATION_SIGNALS_SCHEMA, signals: {} })
    ).not.toBeNull();
  });

  test("rejects an unknown signal key", () => {
    expect(
      validateStationSignalsV1({
        schema_version: STATION_SIGNALS_SCHEMA,
        signals: { multi_component: true, bogus: true },
      })
    ).toBeNull();
  });

  test("rejects a non-boolean signal value", () => {
    expect(
      validateStationSignalsV1({
        schema_version: STATION_SIGNALS_SCHEMA,
        signals: { auth_touched: "yes" },
      })
    ).toBeNull();
  });

  test("rejects a wrong/missing schema_version", () => {
    expect(validateStationSignalsV1({ signals: {} })).toBeNull();
    expect(
      validateStationSignalsV1({ schema_version: "guild.other.v1", signals: {} })
    ).toBeNull();
  });

  test("rejects an unknown top-level key (closed envelope shape)", () => {
    expect(
      validateStationSignalsV1({
        schema_version: STATION_SIGNALS_SCHEMA,
        signals: {},
        extra: 1,
      })
    ).toBeNull();
  });

  test("rejects a non-string / empty source_ref", () => {
    expect(
      validateStationSignalsV1({ schema_version: STATION_SIGNALS_SCHEMA, signals: {}, source_ref: 5 })
    ).toBeNull();
    expect(
      validateStationSignalsV1({ schema_version: STATION_SIGNALS_SCHEMA, signals: {}, source_ref: "" })
    ).toBeNull();
    // null source_ref is legal (absent provenance).
    expect(
      validateStationSignalsV1({ schema_version: STATION_SIGNALS_SCHEMA, signals: {}, source_ref: null })
    ).not.toBeNull();
  });

  test("rejects non-object / array input", () => {
    expect(validateStationSignalsV1(null)).toBeNull();
    expect(validateStationSignalsV1([])).toBeNull();
    expect(validateStationSignalsV1("x")).toBeNull();
  });

  test("rejects prototype-carried signals (inherited key must not leak to the composer)", () => {
    // Object.create(proto) has NO own keys, so a naive Object.entries scan sees an
    // "empty" signals block — but the composer would later read `auth_touched`
    // through the prototype chain. Fail-closed: the exotic prototype is rejected.
    const block = validateStationSignalsV1({
      schema_version: STATION_SIGNALS_SCHEMA,
      signals: Object.create({ auth_touched: true }) as object,
    });
    expect(block).toBeNull();
  });

  test("rejects an exotic-prototype envelope object itself", () => {
    const evil = Object.create({ signals: { auth_touched: true } });
    evil.schema_version = STATION_SIGNALS_SCHEMA;
    expect(validateStationSignalsV1(evil)).toBeNull();
  });

  test("accepts null-prototype signals with valid own keys and returns a fresh null-proto copy", () => {
    const raw = Object.create(null) as Record<string, unknown>;
    raw["auth_touched"] = true;
    const block = validateStationSignalsV1({ schema_version: STATION_SIGNALS_SCHEMA, signals: raw });
    expect(block).not.toBeNull();
    expect(block!.signals.auth_touched).toBe(true);
    // Returned signals is a FRESH null-prototype object (no inherited-key read path).
    expect(Object.getPrototypeOf(block!.signals)).toBeNull();
  });

  test("sanitized output does not inherit a polluted Object.prototype signal (composer read-side)", () => {
    // The composer reads `signals[key]` via bracket access. Even with a valid,
    // accepted `signals: {}`, a polluted `Object.prototype.auth_touched` must NOT
    // resolve to true on the returned object — else a phantom rule fires.
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto["auth_touched"] = true;
    try {
      const block = validateStationSignalsV1({ schema_version: STATION_SIGNALS_SCHEMA, signals: {} });
      expect(block).not.toBeNull();
      expect((block!.signals as Record<string, unknown>)["auth_touched"]).toBeUndefined();
      expect(Object.getPrototypeOf(block!.signals)).toBeNull();
    } finally {
      delete proto["auth_touched"];
    }
  });

  test("emptyStationSignalsV1 signals are null-prototype (no phantom inherited signal)", () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto["auth_touched"] = true;
    try {
      const empty = emptyStationSignalsV1();
      expect((signalsOf(empty) as Record<string, unknown>)["auth_touched"]).toBeUndefined();
      expect(Object.getPrototypeOf(empty.signals)).toBeNull();
    } finally {
      delete proto["auth_touched"];
    }
  });

  test("rejects a non-own (prototype-polluted) signals field on the envelope", () => {
    // Even with Object.prototype.signals polluted, the envelope's own key set has
    // NO `signals`, so the field is treated as absent and the block is rejected —
    // the inherited signals never reaches the composer. (cleanup in finally)
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto["signals"] = { auth_touched: true };
    try {
      expect(validateStationSignalsV1({ schema_version: STATION_SIGNALS_SCHEMA })).toBeNull();
    } finally {
      delete proto["signals"];
    }
  });

  test("returns null (never throws) for a throwing own getter field", () => {
    const evil: Record<string, unknown> = { schema_version: STATION_SIGNALS_SCHEMA };
    Object.defineProperty(evil, "signals", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => validateStationSignalsV1(evil)).not.toThrow();
    expect(validateStationSignalsV1(evil)).toBeNull();
  });

  test("rejects an accessor (getter) signals field even when it returns a valid block", () => {
    // A validator must not invoke a caller getter (non-deterministic / side-effecting);
    // an accessor-shaped `signals` is rejected outright rather than read.
    const evil: Record<string, unknown> = { schema_version: STATION_SIGNALS_SCHEMA };
    Object.defineProperty(evil, "signals", {
      enumerable: true,
      configurable: true,
      get() {
        return { auth_touched: true };
      },
    });
    expect(validateStationSignalsV1(evil)).toBeNull();
  });

  test("rejects an accessor signal field inside the signals block", () => {
    const signals: Record<string, unknown> = {};
    Object.defineProperty(signals, "auth_touched", {
      enumerable: true,
      configurable: true,
      get() {
        return true;
      },
    });
    expect(
      validateStationSignalsV1({ schema_version: STATION_SIGNALS_SCHEMA, signals })
    ).toBeNull();
  });

  test("returns null (never throws) for a Proxy that traps own-key operations by throwing", () => {
    const p = new Proxy(
      { schema_version: STATION_SIGNALS_SCHEMA, signals: {} },
      {
        ownKeys() {
          throw new Error("trap");
        },
      }
    );
    expect(() => validateStationSignalsV1(p)).not.toThrow();
    expect(validateStationSignalsV1(p)).toBeNull();
  });
});

// ── Emission helpers ─────────────────────────────────────────────────────────

const VALID_PLAN = {
  schema_version: "guild.team_plan.v1" as const,
  station: "build" as const,
  roster: [
    { role: "qa", scope: null, default_tier: "mid" as const, fanout: "lead_only" as const, source: "default" as const },
  ],
  fired_rules: [],
  plan_driven_slots: ["task-owner-implementers"],
  advisory_memory: true,
  advisory_panel: { producer: null, challengers: [], fired_challenger_rules: [] },
  cap: 6,
  capped: false,
  dropped_roles: [],
};

const VALID_RESULT = {
  schema_version: "guild.team_result.v1" as const,
  station: "build" as const,
  team_plan_ref: ".guild/runs/run-x/team-plan/build.json",
  lanes: [
    { role: "qa", instance_id: "inst-1", handoff_ref: null, acceptance_ref: null },
    { role: "security", instance_id: "inst-2", handoff_ref: null, acceptance_ref: null },
  ],
};

describe("writeTeamPlan / readTeamPlan", () => {
  test("round-trips a valid plan through the canonical path", () => {
    const tmp = mkTmp();
    const p = writeTeamPlan(tmp, "run-a", VALID_PLAN);
    expect(p).toBe(path.join(tmp, ".guild", "runs", "run-a", "team-plan", "build.json"));
    const back = readTeamPlan(tmp, "run-a", "build");
    expect(back).not.toBeNull();
    expect(back!.station).toBe("build");
  });

  test("readTeamPlan returns null for a missing artifact", () => {
    const tmp = mkTmp();
    expect(readTeamPlan(tmp, "run-missing", "build")).toBeNull();
  });

  test("fail-closed: refuses to write an invalid plan", () => {
    const tmp = mkTmp();
    expect(() => writeTeamPlan(tmp, "run-a", { schema_version: "wrong" })).toThrow(/invalid/i);
    expect(fs.existsSync(path.join(tmp, ".guild", "runs", "run-a"))).toBe(false);
  });

  test("refuses a run-tree escape (unsafe run_id)", () => {
    const tmp = mkTmp();
    expect(() => writeTeamPlan(tmp, "../evil", VALID_PLAN)).toThrow(/unsafe run_id/i);
    expect(() => readTeamPlan(tmp, "..", "build")).toThrow(/unsafe run_id/i);
  });

  test("refuses a symlinked kind dir (real-path escape — nothing leaks outside)", () => {
    const tmp = mkTmp();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "station-outside-"));
    const runDir = path.join(tmp, ".guild", "runs", "run-sym");
    fs.mkdirSync(runDir, { recursive: true });
    // Plant a symlink at team-plan → outside the run tree.
    fs.symlinkSync(outside, path.join(runDir, "team-plan"), "dir");
    expect(() => writeTeamPlan(tmp, "run-sym", VALID_PLAN)).toThrow(/symlink/i);
    // The plan must NOT have been followed through the link.
    expect(fs.existsSync(path.join(outside, "build.json"))).toBe(false);
  });

  test("refuses a symlinked run root (real-path escape)", () => {
    const tmp = mkTmp();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "station-outside-root-"));
    const runsDir = path.join(tmp, ".guild", "runs");
    fs.mkdirSync(runsDir, { recursive: true });
    // Plant a symlink at the run ROOT → outside.
    fs.symlinkSync(outside, path.join(runsDir, "run-symroot"), "dir");
    expect(() => writeTeamPlan(tmp, "run-symroot", VALID_PLAN)).toThrow(/symlink/i);
    expect(fs.existsSync(path.join(outside, "team-plan", "build.json"))).toBe(false);
  });

  test("refuses a symlinked runs CONTAINER (.guild/runs → outside, before mkdir)", () => {
    const tmp = mkTmp();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "station-runs-link-"));
    const guildDir = path.join(tmp, ".guild");
    fs.mkdirSync(guildDir, { recursive: true });
    fs.symlinkSync(outside, path.join(guildDir, "runs"), "dir");
    expect(() => writeTeamPlan(tmp, "run-link", VALID_PLAN)).toThrow(/symlink/i);
    expect(fs.existsSync(path.join(outside, "run-link", "team-plan", "build.json"))).toBe(false);
  });

  test("refuses a symlinked .guild CONTAINER (.guild → outside, before mkdir)", () => {
    const tmp = mkTmp();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "station-guild-link-"));
    // Plant a symlink at the .guild root itself → outside.
    fs.symlinkSync(outside, path.join(tmp, ".guild"), "dir");
    expect(() => writeTeamPlan(tmp, "run-link", VALID_PLAN)).toThrow(/symlink/i);
    expect(fs.existsSync(path.join(outside, "runs", "run-link", "team-plan", "build.json"))).toBe(false);
  });
});

describe("writeTeamResult / readTeamResult", () => {
  test("round-trips a valid result", () => {
    const tmp = mkTmp();
    const p = writeTeamResult(tmp, "run-b", VALID_RESULT);
    expect(p).toBe(path.join(tmp, ".guild", "runs", "run-b", "team-result", "build.json"));
    const back = readTeamResult(tmp, "run-b", "build");
    expect(back).not.toBeNull();
    expect(back!.lanes.map((l) => l.instance_id)).toEqual(["inst-1", "inst-2"]);
  });

  test("fail-closed: refuses a result with duplicate instance_ids (D3 freshness)", () => {
    const tmp = mkTmp();
    const dup = {
      ...VALID_RESULT,
      lanes: [
        { role: "qa", instance_id: "same", handoff_ref: null, acceptance_ref: null },
        { role: "security", instance_id: "same", handoff_ref: null, acceptance_ref: null },
      ],
    };
    expect(() => writeTeamResult(tmp, "run-b", dup)).toThrow(/invalid/i);
  });
});
