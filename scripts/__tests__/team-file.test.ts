/**
 * scripts/__tests__/team-file.test.ts
 *
 * TDD suite for scripts/lib/team-file.ts (T1 — per-phase team-file resolver +
 * active-phase reader + .current pointer I/O).
 *
 * Coverage map (phase-compose-plan.md §1 T1 success criteria + §6 invariants):
 *  - teamFilePath: builds <slug>.<phase>.yaml; THROWS on non-canonical token (§6.9).
 *  - legacyTeamFilePath: builds <slug>.yaml.
 *  - resolveTeamFile precedence: per-phase hit; legacy fallback; double-miss → null;
 *    phase=null → consult .current then legacy; per-phase WINS over legacy (§6.7);
 *    non-canonical phase → fall through (no throw) (§6.9).
 *  - .current pointer: write→read round-trip; write throws on non-canonical;
 *    read tolerant of absent/corrupt/non-canonical → null.
 *  - readActivePhase: off a phases_log fixture (last entry); off a sentinel-only
 *    fixture (top-level phase fallback); non-canonical token → null; missing → null.
 */

import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import {
  teamFilePath,
  legacyTeamFilePath,
  slugFromTeamPath,
  resolveTeamFile,
  readActivePhase,
  readCurrentPhasePointer,
  writeCurrentPhasePointer,
  CANONICAL_PHASES,
} from "../lib/team-file";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guild-teamfile-test-"));
  fs.mkdirSync(path.join(root, ".guild", "team"), { recursive: true });
  return root;
}

function writeTeamFile(root: string, basename: string, body = "specialists: []\n"): void {
  fs.writeFileSync(path.join(root, ".guild", "team", basename), body);
}

/** Write a run.yaml with the given phases_log entries + top-level phase. */
function writeRun(
  root: string,
  runId: string,
  opts: { topPhase?: string | null; loggedPhases?: string[] },
): void {
  const runDir = path.join(root, ".guild", "runs", runId);
  fs.mkdirSync(runDir, { recursive: true });
  const lines: string[] = [
    "schema_version: guild.run.v1",
    `run_id: ${runId}`,
    "command: /guild:plan",
    `phase: ${opts.topPhase ?? "null"}`,
  ];
  if (opts.loggedPhases && opts.loggedPhases.length > 0) {
    lines.push("phases_log:");
    for (const p of opts.loggedPhases) {
      lines.push(`  - phase: ${p}`);
      lines.push(`    at: 2026-06-07T00:00:00Z`);
    }
  } else {
    lines.push("phases_log: []");
  }
  lines.push("status: open");
  fs.writeFileSync(path.join(runDir, "run.yaml"), lines.join("\n") + "\n");
}

function writeSentinel(root: string, runId: string): void {
  fs.mkdirSync(path.join(root, ".guild", "runs"), { recursive: true });
  fs.writeFileSync(path.join(root, ".guild", "runs", "current-run-id"), runId);
}

// ---------------------------------------------------------------------------
// 1. Path builders
// ---------------------------------------------------------------------------

describe("teamFilePath / legacyTeamFilePath", () => {
  it("builds the per-phase path for a canonical phase", () => {
    const root = makeRoot();
    expect(teamFilePath(root, "my-plan", "build")).toBe(
      path.join(root, ".guild", "team", "my-plan.build.yaml"),
    );
  });

  it("builds every canonical phase without throwing", () => {
    const root = makeRoot();
    for (const p of CANONICAL_PHASES) {
      expect(teamFilePath(root, "s", p)).toContain(`s.${p}.yaml`);
    }
  });

  it("THROWS on a non-canonical phase token (filesystem-safety §6.9)", () => {
    const root = makeRoot();
    expect(() => teamFilePath(root, "s", "deploy")).toThrow(/non-canonical/);
    expect(() => teamFilePath(root, "s", "../etc/passwd")).toThrow();
    expect(() => teamFilePath(root, "s", "")).toThrow();
  });

  it("legacyTeamFilePath builds <slug>.yaml", () => {
    const root = makeRoot();
    expect(legacyTeamFilePath(root, "my-plan")).toBe(
      path.join(root, ".guild", "team", "my-plan.yaml"),
    );
  });
});

// ---------------------------------------------------------------------------
// 1b. slugFromTeamPath (C4 — phase-tolerant inverse)
// ---------------------------------------------------------------------------

describe("slugFromTeamPath (C4)", () => {
  it("recovers the slug from a legacy <slug>.yaml path", () => {
    expect(slugFromTeamPath(".guild/team/my-plan.yaml")).toBe("my-plan");
    expect(slugFromTeamPath("/abs/.guild/team/team-subagent.yaml")).toBe("team-subagent");
  });

  it("strips the trailing .<phase> from a per-phase <slug>.<phase>.yaml path", () => {
    expect(slugFromTeamPath(".guild/team/my-plan.build.yaml")).toBe("my-plan");
    expect(slugFromTeamPath("/x/team-mixed-host.qa.yaml")).toBe("team-mixed-host");
    for (const p of CANONICAL_PHASES) {
      expect(slugFromTeamPath(`s.${p}.yaml`)).toBe("s");
    }
  });

  it("does NOT truncate a dotted slug whose trailing segment is not a canonical phase", () => {
    // "v1.2-plan" → last segment "2-plan" is not a phase → keep the whole slug.
    expect(slugFromTeamPath(".guild/team/v1.2-plan.yaml")).toBe("v1.2-plan");
    // a slug ending in a non-phase word is preserved
    expect(slugFromTeamPath("my.report.yaml")).toBe("my.report");
  });

  it("tolerates .yml as well as .yaml", () => {
    expect(slugFromTeamPath("plan-x.build.yml")).toBe("plan-x");
    expect(slugFromTeamPath("plan-x.yml")).toBe("plan-x");
  });
});

// ---------------------------------------------------------------------------
// 2. resolveTeamFile precedence
// ---------------------------------------------------------------------------

describe("resolveTeamFile — precedence", () => {
  it("returns the per-phase file when it exists", () => {
    const root = makeRoot();
    writeTeamFile(root, "plan-x.build.yaml");
    const r = resolveTeamFile(root, "plan-x", "build");
    expect(r).toBe(path.join(root, ".guild", "team", "plan-x.build.yaml"));
  });

  it("falls back to legacy <slug>.yaml when no per-phase file exists", () => {
    const root = makeRoot();
    writeTeamFile(root, "plan-x.yaml");
    const r = resolveTeamFile(root, "plan-x", "build");
    expect(r).toBe(path.join(root, ".guild", "team", "plan-x.yaml"));
  });

  it("per-phase WINS when BOTH per-phase and legacy exist (§6.7)", () => {
    const root = makeRoot();
    writeTeamFile(root, "plan-x.yaml", "legacy: true\n");
    writeTeamFile(root, "plan-x.build.yaml", "perphase: true\n");
    const r = resolveTeamFile(root, "plan-x", "build");
    expect(r).toBe(path.join(root, ".guild", "team", "plan-x.build.yaml"));
  });

  it("double-miss → null (compose trigger, not error)", () => {
    const root = makeRoot();
    expect(resolveTeamFile(root, "plan-x", "build")).toBeNull();
  });

  it("phase=null consults .current, then resolves that phase's file", () => {
    const root = makeRoot();
    writeTeamFile(root, "plan-x.qa.yaml");
    writeCurrentPhasePointer(root, "plan-x", "qa");
    const r = resolveTeamFile(root, "plan-x", null);
    expect(r).toBe(path.join(root, ".guild", "team", "plan-x.qa.yaml"));
  });

  it("phase=null with no .current falls back to legacy", () => {
    const root = makeRoot();
    writeTeamFile(root, "plan-x.yaml");
    const r = resolveTeamFile(root, "plan-x", null);
    expect(r).toBe(path.join(root, ".guild", "team", "plan-x.yaml"));
  });

  it("non-canonical phase falls through to legacy/null WITHOUT throwing (§6.9)", () => {
    const root = makeRoot();
    writeTeamFile(root, "plan-x.yaml");
    // a poisoned run-state token must not crash the resolver
    expect(() => resolveTeamFile(root, "plan-x", "deploy")).not.toThrow();
    expect(resolveTeamFile(root, "plan-x", "deploy")).toBe(
      path.join(root, ".guild", "team", "plan-x.yaml"),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. .current pointer I/O
// ---------------------------------------------------------------------------

describe(".current pointer I/O", () => {
  it("write→read round-trip returns the phase", () => {
    const root = makeRoot();
    writeCurrentPhasePointer(root, "plan-x", "build");
    expect(readCurrentPhasePointer(root, "plan-x")).toBe("build");
  });

  it("writes a plaintext one-line token + newline (NOT a symlink)", () => {
    const root = makeRoot();
    writeCurrentPhasePointer(root, "plan-x", "ops");
    const p = path.join(root, ".guild", "team", "plan-x.current");
    expect(fs.lstatSync(p).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(p, "utf8")).toBe("ops\n");
  });

  it("write THROWS on a non-canonical token", () => {
    const root = makeRoot();
    expect(() => writeCurrentPhasePointer(root, "plan-x", "deploy")).toThrow();
  });

  it("read returns null when the pointer is absent", () => {
    const root = makeRoot();
    expect(readCurrentPhasePointer(root, "nope")).toBeNull();
  });

  it("read returns null when the pointer content is non-canonical/corrupt", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, ".guild", "team", "plan-x.current"), "garbage\n");
    expect(readCurrentPhasePointer(root, "plan-x")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. readActivePhase
// ---------------------------------------------------------------------------

describe("readActivePhase", () => {
  it("returns the LAST phases_log entry (plan → build → build wins)", () => {
    const root = makeRoot();
    writeRun(root, "run-1", { topPhase: "build", loggedPhases: ["plan", "build"] });
    writeSentinel(root, "run-1");
    expect(readActivePhase(root)).toBe("build");
  });

  it("uses an explicit runId when supplied (no sentinel needed)", () => {
    const root = makeRoot();
    writeRun(root, "run-2", { topPhase: "qa", loggedPhases: ["qa"] });
    expect(readActivePhase(root, "run-2")).toBe("qa");
  });

  it("falls back to the top-level phase when phases_log is empty", () => {
    const root = makeRoot();
    writeRun(root, "run-3", { topPhase: "ideate", loggedPhases: [] });
    writeSentinel(root, "run-3");
    expect(readActivePhase(root)).toBe("ideate");
  });

  it("returns null when the recorded phase is non-canonical (poisoned run-state)", () => {
    const root = makeRoot();
    writeRun(root, "run-4", { topPhase: "deploy", loggedPhases: ["deploy"] });
    writeSentinel(root, "run-4");
    expect(readActivePhase(root)).toBeNull();
  });

  it("returns null for the pre-T0 main-path shape (phase: null, empty log)", () => {
    const root = makeRoot();
    writeRun(root, "run-5", { topPhase: null, loggedPhases: [] });
    writeSentinel(root, "run-5");
    expect(readActivePhase(root)).toBeNull();
  });

  it("returns null when run.yaml is absent", () => {
    const root = makeRoot();
    writeSentinel(root, "run-missing");
    expect(readActivePhase(root)).toBeNull();
  });

  it("returns null when no sentinel and no runId", () => {
    const root = makeRoot();
    expect(readActivePhase(root)).toBeNull();
  });
});
